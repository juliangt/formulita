import { describe, expect, it, vi } from 'vitest';
import { CHAT_SEND_COOLDOWN_MS, MULTIPLAYER } from '../config/balance';
import { ROOM_THREAD_ID } from '../chat/ChatStore';
import { ensureSessionChatStore } from '../chat/chatSession';
import { setSessionChatClient } from '../chat/chatClientSession';
import { sendDirectMessage } from '../chat/dmChat';
import { DM_SEND_DISCONNECTED, dmBlockedSendState, inviteJoinTarget, invitedSystemNote } from '../chat/dmView';
import { applyAvailabilitySetting, toggleAvailability } from '../chat/presenceView';
import { receiveRoomChat, sendRoomChat } from '../chat/roomChat';
import { getSocialChatSession, type SocialChatSession } from '../chat/socialChatSession';
import {
  CHAT_SETTINGS_REGISTRY_KEY,
  type IChatSettingsRepository,
} from '../data/ChatSettingsRepository';
import { PLAYER_PROFILE_REGISTRY_KEY } from '../data/PlayerProfileRepository';
import type { NetEnvSource } from '../net/appId';
import { TrysteroChatClient } from '../net/TrysteroChatClient';
import type { AvailablePeer } from '../net/ChatClient';
import type { ChatStore } from '../chat/ChatStore';
import { FakeNetClient, FakeNetHub } from './fakes/FakeNetClient';
import { FakeSocialHub } from './fakes/FakeSocialHub';

/**
 * QA automatizado del issue #2 — FLUJO SOCIAL COMPLETO con TRES clientes
 * (A=ANA, B=BETO, C=CARLA) simultáneos, de punta a punta y SIN Phaser:
 * hermano directo de `raceMultiFullFlow.test.ts` (el QA de #1), montado a
 * nivel ADAPTADORES porque el wiring de escenas no es alcanzable sin runtime
 * de Phaser:
 *
 * - PARTIDA: `FakeNetClient` sobre `FakeNetHub` (la malla del lobby de #1) —
 *   A crea la sala PARRILLA, B y C se unen, y el chat de SALA viaja por la
 *   acción `chat` con el MISMO cableado de LobbyScene (onChat →
 *   receiveRoomChat contra el roster local; envío con sendRoomChat).
 * - SOCIAL: `TrysteroChatClient` REALES sobre `FakeSocialHub` (la sala pública
 *   de presencia), cableados EXACTAMENTE como la producción: cada cliente
 *   tiene su `SocialChatSession` (onDm/onAvailablePeers/onInvite → store de
 *   sesión compartido con el hilo de sala) y la disponibilidad SOLO cambia
 *   por el camino de la UI (`applyAvailabilitySetting`/`toggleAvailability`
 *   con un repo de ajustes por cliente, default NO).
 *
 * Todo determinista: reloj lógico compartido (los envíos/recepciones pasan
 * `now` explícito), scheduler manual para heartbeat/barrido del cliente
 * social, rng fijo para la palabra de sala (ROOM_WORDS[0] = PARRILLA) y
 * settle() manual de la malla social (en la red real, dentro de
 * JOIN_SETTLE_MS). Cero Math.random, cero timers reales.
 *
 * Escenario (el del issue: "3+ dispositivos, chat de sala + 2 DMs
 * simultáneos"): sala con chat A→B/C + respuesta de B → presencia opt-in de
 * A y C (B queda escondido: privacy by default) → DM A↔C SIMULTÁNEO al chat
 * de sala (hilos y throttles independientes) → B se muestra disponible y
 * abre el 2º DM (C→B) → C se esconde y su hilo en B queda DESCONECTADO →
 * invitación de A a B por DM con la palabra PARRILLA → badges de no leídos
 * correctos por cliente (sala + DMs).
 */

const ENV: NetEnvSource = { VITE_TRYSTERO_APP_ID: 'formulita-qa' };

/** rng fijo que siempre elige ROOM_WORDS[0] → la sala de A es PARRILLA. */
const PARRILLA_RNG = () => 0;

/** Un timer del scheduler manual (vencimiento explícito, nunca real). */
interface FakeTimer {
  fired: boolean;
  canceled: boolean;
  fire(): void;
}

/** Repo de ajustes de chat EN MEMORIA (default NO) que graba cada save. */
class RecordingChatSettingsRepository implements IChatSettingsRepository {
  readonly saves: boolean[] = [];
  private showAvailable = false;

  load(): { showAvailable: boolean } {
    return { showAvailable: this.showAvailable };
  }

  save(settings: { showAvailable: boolean }): void {
    this.showAvailable = settings.showAvailable;
    this.saves.push(settings.showAvailable);
  }
}

/** Registry falso con la porción que las sesiones consumen (get/set/remove). */
function fakeRegistry(): { get(k: string): unknown; set(k: string, v: unknown): unknown; remove(k: string): unknown } {
  const store = new Map<string, unknown>();
  return {
    get: (key) => store.get(key),
    set: (key, value) => store.set(key, value),
    remove: (key) => store.delete(key),
  };
}

/**
 * El "mundo" compartido por los tres clientes: los dos hubs (partida y
 * social), el reloj lógico y la cola de timers del lado social. `advance`
 * mueve el reloj (los cooldowns del chat se miden contra él); `settleSocial`
 * dispara el descubrimiento de malla pendiente (en la red real llega
 * progresivamente dentro de JOIN_SETTLE_MS); `beat` vence UNA generación de
 * heartbeat/barrido (nadie debe caerse por stale si todos siguen vivos).
 */
class SocialQaWorld {
  readonly netHub = new FakeNetHub();
  readonly socialHub = new FakeSocialHub();
  /** Llamadas a la factory social por peerId (prueba de privacy: B = 0). */
  readonly socialFactoryCalls = new Map<string, number>();

  private clockMs = 0;
  private readonly timers: FakeTimer[] = [];

  now(): number {
    return this.clockMs;
  }

  advance(ms: number): void {
    this.clockMs += ms;
  }

  settleSocial(): void {
    this.socialHub.settle();
  }

  beat(): void {
    const generation = this.timers.splice(0);
    for (const timer of generation) {
      if (!timer.canceled) {
        timer.fire();
      }
    }
  }

  /** Scheduler inyectado a TODOS los TrysteroChatClient (nunca setTimeout). */
  readonly scheduler = (callback: () => void, _ms: number): (() => void) => {
    const timer: FakeTimer = {
      fired: false,
      canceled: false,
      fire: () => {
        timer.fired = true;
        timer.canceled = true;
        callback();
      },
    };
    this.timers.push(timer);
    return () => {
      timer.canceled = true;
    };
  };
}

/**
 * Un cliente completo: partida (FakeNetClient) + sesión social real
 * (TrysteroChatClient + SocialChatSession) compartiendo UN ChatStore por
 * jugador, igual que en producción (el lobby REUSA el store de la sesión
 * social: el hilo `room` y los DM conviven y suman al mismo badge).
 */
class SocialQaPlayer {
  readonly net: FakeNetClient;
  readonly registry = fakeRegistry();
  readonly chatSettings = new RecordingChatSettingsRepository();
  readonly social: SocialChatSession;

  private store: ChatStore | null = null;

  constructor(
    private readonly world: SocialQaWorld,
    readonly peerId: string,
    readonly name: string,
    rng: () => number,
  ) {
    this.net = new FakeNetClient(world.netHub, { peerId, rng });
    // Perfil persistido del jugador (lo lee la sesión social para su store).
    this.registry.set(PLAYER_PROFILE_REGISTRY_KEY, {
      load: () => ({ name }),
      save: vi.fn(),
    });
    this.registry.set(CHAT_SETTINGS_REGISTRY_KEY, this.chatSettings);
    // El TrysteroChatClient REAL con la red/el reloj/el scheduler inyectados.
    const calls = this.world.socialFactoryCalls;
    const ownPeerId = peerId;
    const client = new TrysteroChatClient({
      roomFactory: (appId, roomId) => {
        calls.set(ownPeerId, (calls.get(ownPeerId) ?? 0) + 1);
        return this.world.socialHub.factoryFor(ownPeerId)(appId, roomId);
      },
      selfIdProvider: () => ownPeerId,
      env: ENV,
      self: { name, color: 0 },
      scheduler: this.world.scheduler,
      now: () => this.world.now(),
    });
    setSessionChatClient(this.registry, client);
    this.social = getSocialChatSession(this.registry);
  }

  /* ---------------- partida (cableado de LobbyScene) ---------------- */

  /** CREAR sala (la palabra sale del rng inyectado del fake). */
  createRoom(): void {
    this.net.create({ appId: 'formulita-qa', name: this.name });
    this.openChatEntry();
  }

  /** UNIRSE a una sala por palabra (el flujo de #1). */
  joinRoom(roomWord: string): void {
    this.net.join({ appId: 'formulita-qa', roomWord, name: this.name });
    this.openChatEntry();
  }

  /**
   * El cableado de LobbyScene.openChatEntry: asegura el ChatStore de sesión
   * (REUSA el de la sesión social) y conecta roster/chat de la partida al
   * store — el overlay de chat lee de ahí, abierto o cerrado.
   */
  private openChatEntry(): void {
    const self =
      this.net.getRoster().find((player) => player.peerId === this.net.peerId) ??
      { peerId: this.net.peerId, name: this.name, color: 0 };
    this.store = ensureSessionChatStore(this.registry, self);
    // El cableado vive tanto como el jugador (nadie sale de la partida en el
    // flujo, así que no hace falta desuscribir).
    this.net.onRosterChange((roster) => {
      const me = roster.find((player) => player.peerId === this.net.peerId);
      if (me) {
        this.store?.updateSelf(me);
      }
    });
    this.net.onChat((fromPeerId, payload) => {
      if (!this.store) {
        return;
      }
      receiveRoomChat(this.store, this.net.getRoster(), fromPeerId, payload, this.world.now());
    });
  }

  /* ---------------- acciones (las de la UI) ---------------- */

  /** Escribe en el chat de SALA (lo que el ChatPanel hace con el input). */
  sayInRoom(text: string) {
    if (!this.store) {
      throw new Error(`${this.name} no entró a una sala`);
    }
    return sendRoomChat(this.store, this.net, text, this.world.now());
  }

  /** Envía un DM (el sendOverride del hilo de DM del ChatScene). */
  dmTo(peerId: string, text: string) {
    if (!this.store) {
      throw new Error(`${this.name} no tiene store`);
    }
    return sendDirectMessage(this.store, this.social.client, peerId, text, this.world.now());
  }

  /** Camino de la UI para mostrarse disponible (toggle → persist + join). */
  becomeVisible(): boolean {
    const next = toggleAvailability(this.chatSettings, this.social.client);
    this.world.settleSocial();
    return next;
  }

  /** Camino de la UI para esconderse (toggle → persist + leave REAL). */
  hide(): boolean {
    return toggleAvailability(this.chatSettings, this.social.client);
  }

  /** INVITAR por DM (lo que hace el botón INVITAR del hilo de ChatScene). */
  invite(peer: AvailablePeer, keyword: string): void {
    this.social.client.sendInvite(peer.peerId, keyword);
    this.store?.appendSystemMessage(peer.peerId, invitedSystemNote(peer.name, keyword), this.world.now());
  }

  /* ---------------- lecturas ---------------- */

  get client() {
    return this.social.client;
  }

  get storeOrNull(): ChatStore | null {
    return this.store;
  }

  /** El store de sesión compartido (exige haber entrado a una sala antes). */
  get sessionStore(): ChatStore {
    if (!this.store) {
      throw new Error(`${this.name} no entró a una sala`);
    }
    return this.store;
  }

  /** Mensajes del hilo de sala. */
  get roomThread() {
    return this.sessionStore.getMessages(ROOM_THREAD_ID);
  }

  /** Mensajes del hilo de DM con `peerId`. */
  dmThread(peerId: string) {
    return this.sessionStore.getMessages(peerId);
  }
}

describe('QA issue #2 — flujo social completo con 3 clientes (sala + presencia + 2 DMs + invitación)', () => {
  it('chat de sala + DM simultáneos + presencia opt-in + escondite + invite + badges, todo junto', () => {
    const world = new SocialQaWorld();
    const clock = world;

    /* ---------- 0) Los tres jugadores, con el ajuste default (NO) -------- */
    const ana = new SocialQaPlayer(world, 'aa-ana', 'ANA', PARRILLA_RNG);
    const beto = new SocialQaPlayer(world, 'bb-beto', 'BETO', PARRILLA_RNG);
    const carla = new SocialQaPlayer(world, 'cc-carla', 'CARLA', PARRILLA_RNG);

    // El camino EXACTO de la UI al abrir la tab PÚBLICO con el ajuste
    // default: applyAvailabilitySetting aplica NO y NO conecta a nadie.
    for (const player of [ana, beto, carla]) {
      expect(applyAvailabilitySetting(player.chatSettings, player.client)).toBe(false);
      expect(player.client.isAvailable()).toBe(false);
    }
    expect(world.socialFactoryCalls.get('aa-ana') ?? 0).toBe(0);
    expect(world.socialFactoryCalls.get('bb-beto') ?? 0).toBe(0);
    expect(world.socialFactoryCalls.get('cc-carla') ?? 0).toBe(0);

    /* ---------- 1) PARTIDA: A crea PARRILLA, B y C se unen ---------------- */
    clock.advance(100);
    ana.createRoom();
    expect(ana.net.roomWord).toBe('PARRILLA');
    beto.joinRoom('PARRILLA');
    carla.joinRoom('PARRILLA');

    // El store de la partida es EL MISMO de la sesión social (el lobby lo
    // reusa: hilo room + DM + bloqueos conviven en un solo store por pestaña).
    for (const player of [ana, beto, carla]) {
      expect(player.storeOrNull).toBe(player.social.store);
    }
    // Roster idéntico y determinista (colores por orden de peerId).
    const roster = ana.net.getRoster();
    expect(roster.map((p) => [p.name, p.color])).toEqual([
      ['ANA', MULTIPLAYER.palette[0]],
      ['BETO', MULTIPLAYER.palette[1]],
      ['CARLA', MULTIPLAYER.palette[2]],
    ]);

    /* ---------- 2) CHAT DE SALA: A escribe, B y C reciben; B responde ----- */
    clock.advance(900); // t=1000
    expect(ana.sayInRoom('hola gente, lista la sala?')).not.toBeNull();

    // B y C ven el mensaje de A con SU nombre y color del roster.
    expect(beto.roomThread).toHaveLength(1);
    expect(beto.roomThread[0]).toMatchObject({
      fromPeerId: 'aa-ana',
      fromName: 'ANA',
      color: MULTIPLAYER.palette[0],
      text: 'hola gente, lista la sala?',
      mine: false,
    });
    expect(carla.roomThread).toHaveLength(1);
    expect(carla.roomThread[0]).toMatchObject({ fromName: 'ANA', color: MULTIPLAYER.palette[0] });
    // El propio A lo ve como mensaje propio (no suma no leídos).
    expect(ana.roomThread[0]).toMatchObject({ mine: true });

    clock.advance(1000); // t=2000
    expect(beto.sayInRoom('hola ana!')).not.toBeNull();
    expect(ana.roomThread).toHaveLength(2);
    expect(ana.roomThread[1]).toMatchObject({ fromName: 'BETO', color: MULTIPLAYER.palette[1], mine: false });
    expect(carla.roomThread).toHaveLength(2);

    /* ---------- 3) PRESENCIA: A y C disponibles, B NO (default) ---------- */
    clock.advance(500); // t=2500
    expect(ana.becomeVisible()).toBe(true);
    clock.advance(100); // t=2600
    expect(carla.becomeVisible()).toBe(true);

    // La malla social se descubrió (en la red real, dentro de JOIN_SETTLE_MS):
    // A ve a C y C ve a A, con colores derivados del MISMO conjunto.
    expect(ana.client.getAvailablePeers()).toEqual([
      { peerId: 'cc-carla', name: 'CARLA', color: MULTIPLAYER.palette[1] },
    ]);
    expect(carla.client.getAvailablePeers()).toEqual([
      { peerId: 'aa-ana', name: 'ANA', color: MULTIPLAYER.palette[0] },
    ]);

    // PRIVACIDAD BY DEFAULT: B nunca tocó el toggle → jamás conectó a la sala
    // pública y no aparece en la lista de NADIE.
    expect(world.socialFactoryCalls.get('bb-beto') ?? 0).toBe(0);
    expect(beto.client.isAvailable()).toBe(false);
    expect(ana.client.getAvailablePeers().some((p) => p.peerId === 'bb-beto')).toBe(false);
    expect(carla.client.getAvailablePeers().some((p) => p.peerId === 'bb-beto')).toBe(false);

    /* ---------- 4) DM A↔C SIMULTÁNEO al chat de sala ---------------------- */
    clock.advance(400); // t=3000
    expect(ana.dmTo('cc-carla', 'che carla, andás?')).not.toBeNull();
    clock.advance(100); // t=3100
    expect(carla.dmTo('aa-ana', 'dale ana, decime')).not.toBeNull();

    // Cada uno lo ve en el hilo del OTRO, resuelto contra SU lista viva
    // (el propio envío ya está en el hilo del emisor como mensaje `mine`).
    expect(carla.dmThread('aa-ana')).toHaveLength(2);
    expect(carla.dmThread('aa-ana')[0]).toMatchObject({
      fromName: 'ANA',
      color: MULTIPLAYER.palette[0],
      text: 'che carla, andás?',
      mine: false,
    });
    expect(carla.dmThread('aa-ana')[1]).toMatchObject({ text: 'dale ana, decime', mine: true });
    expect(ana.dmThread('cc-carla')).toHaveLength(2);
    expect(ana.dmThread('cc-carla')[1]).toMatchObject({ fromName: 'CARLA', text: 'dale ana, decime', mine: false });

    // Hilos INDEPENDIENTES: nada de la sala contamina el DM ni viceversa.
    clock.advance(100); // t=3200
    expect(ana.sayInRoom('el chat de sala sigue vivo')).not.toBeNull();
    expect(ana.dmThread('cc-carla')).toHaveLength(2); // sin mensajes de sala
    expect(beto.dmThread('aa-ana')).toHaveLength(0); // B ni tiene hilo de DM

    // Throttles POR HILO independientes (1,5 s cada uno, relojes separados):
    clock.advance(50); // t=3250: la sala está fresca (3200) → el DM también?
    expect(ana.dmTo('cc-carla', 'dm demasiado seguido')).toBeNull(); // 250 ms < 1,5 s
    clock.advance(50); // t=3300: la sala acaba de mandar (3200) → rechaza.
    expect(ana.sayInRoom('sala demasiado seguida')).toBeNull(); // 100 ms < 1,5 s
    expect(beto.roomThread).toHaveLength(3); // NADA viajó en los rechazos

    // …y el DM reposa por SU propio reloj aunque la sala mandó en el medio.
    clock.advance(1300); // t=4600: dm 3000 → 1600 ms ≥ 1,5 s ✓
    const lateDm = ana.dmTo('cc-carla', 'dm ya reposado');
    expect(lateDm).not.toBeNull();
    expect(lateDm!.text).toBe('dm ya reposado');
    expect(carla.dmThread('aa-ana')).toHaveLength(3);
    // El hilo de sala de A sigue ENFRIANDO (su último envío fue 3200): a los
    // 4600 faltan 100 ms → rechaza. Independencia total de relojes.
    expect(ana.sayInRoom('sala aun enfriando')).toBeNull();

    /* ---------- 5) B se muestra disponible → 2º DM (C→B) ------------------ */
    clock.advance(400); // t=5000
    expect(beto.becomeVisible()).toBe(true);
    // Aparece en las listas de A y C al momento del settle (< JOIN_SETTLE_MS).
    const anaPeersWithB = ana.client.getAvailablePeers();
    expect(anaPeersWithB.map((p) => p.peerId)).toEqual(['bb-beto', 'cc-carla']);
    expect(carla.client.getAvailablePeers().map((p) => p.peerId)).toEqual(['aa-ana', 'bb-beto']);
    expect(world.socialFactoryCalls.get('bb-beto')).toBe(1); // ahora sí conectó
    // El ajuste quedó persistido en SÍ (lo que la próxima tab PÚBLICO aplicará).
    expect(beto.chatSettings.saves).toEqual([true]);

    // Un beat de heartbeat/barrido con TODOS vivos: nadie cae de las listas.
    clock.advance(500); // t=5500-… (pre-beat)
    world.beat();
    expect(ana.client.getAvailablePeers()).toHaveLength(2);

    clock.advance(100); // t≈5600
    expect(carla.dmTo('bb-beto', 'hola beto!')).not.toBeNull();
    // B lo recibe en SU hilo con C (identidad resuelta por la lista de B:
    // aa-ana=palette[0], bb-beto(self)=palette[1] → CARLA es palette[2]).
    expect(beto.dmThread('cc-carla')).toHaveLength(1);
    expect(beto.dmThread('cc-carla')[0]).toMatchObject({
      fromName: 'CARLA',
      color: MULTIPLAYER.palette[2],
      text: 'hola beto!',
      mine: false,
    });
    // El DM es DIRIGIDO: A (tercero) no recibe nada del hilo C→B.
    expect(ana.sessionStore.hasThread('bb-beto')).toBe(false);

    /* ---------- 6) C se esconde → su hilo en B queda DESCONECTADO -------- */
    clock.advance(100); // t≈5700
    expect(carla.hide()).toBe(false);
    expect(carla.client.isAvailable()).toBe(false);

    // B (y A) ven irse a C por onPeerLeave → la sesión social sincroniza los
    // hilos de DM: el de C pasa a DESCONECTADO, con historial INTACTO.
    expect(beto.sessionStore.isThreadDisconnected('cc-carla')).toBe(true);
    expect(beto.dmThread('cc-carla')).toHaveLength(1); // historial intacto
    expect(ana.sessionStore.isThreadDisconnected('cc-carla')).toBe(true);
    expect(ana.dmThread('cc-carla')).toHaveLength(3); // historial intacto
    // Y el input del hilo mostraría el aviso (dmBlockedSendState de la UI).
    expect(
      dmBlockedSendState(beto.sessionStore.isThreadDisconnected('cc-carla'), beto.sessionStore.isBlocked('cc-carla')),
    ).toEqual(DM_SEND_DISCONNECTED);

    // Enviar al hilo caído no hace NADA: ni historial ni viaje (guarda del
    // adaptador ANTES del store — defensa en profundidad con la UI).
    expect(beto.dmTo('cc-carla', 'te habrás ido?')).toBeNull();
    expect(beto.dmThread('cc-carla')).toHaveLength(1);

    /* ---------- 7) INVITE: A invita a B por DM con PARRILLA --------------- */
    clock.advance(300); // t≈6000
    const betoSeenByAna = ana.client.getAvailablePeers().find((p) => p.peerId === 'bb-beto');
    expect(betoSeenByAna).toBeDefined();
    ana.invite(betoSeenByAna!, ana.net.roomWord ?? 'PARRILLA');

    // A dejó la nota de sistema en su hilo con B (sin sumar no leídos).
    expect(ana.dmThread('bb-beto')).toHaveLength(1);
    expect(ana.dmThread('bb-beto')[0]).toMatchObject({ system: true, text: 'INVITASTE A BETO A «PARRILLA»' });

    // B recibe la invitación PENDIENTE (banner de la tab PÚBLICO), resuelta
    // contra SU lista viva, y UNIRSE resuelve el destino del flujo de #1.
    const invite = beto.social.getLatestInvite();
    expect(invite).toEqual({
      from: { peerId: 'aa-ana', name: 'ANA', color: MULTIPLAYER.palette[0] },
      keyword: 'PARRILLA',
    });
    const target = inviteJoinTarget(invite!.keyword, 'BETO');
    expect(target).toEqual({ mode: 'join', name: 'BETO', keyword: 'PARRILLA' });
    // El invite es DIRIGIDO: C (tercero) no recibió banner.
    expect(carla.social.getLatestInvite()).toBeNull();

    /* ---------- 8) Badges finales: no leídos por cliente ------------------ */
    // Nadie abrió el chat (peor caso del badge): cada mensaje ajeno suma.
    // A: la respuesta de B en sala (1) + el DM de C (1).
    expect(ana.sessionStore.getUnreadCount(ROOM_THREAD_ID)).toBe(1);
    expect(ana.sessionStore.getUnreadCount('cc-carla')).toBe(1);
    expect(ana.sessionStore.totalUnread).toBe(2);
    // B: los 2 mensajes de A en sala + el DM de C.
    expect(beto.sessionStore.getUnreadCount(ROOM_THREAD_ID)).toBe(2);
    expect(beto.sessionStore.getUnreadCount('cc-carla')).toBe(1);
    expect(beto.sessionStore.totalUnread).toBe(3);
    // C: los 3 mensajes de sala (2 de A + 1 de B) + los 2 DM de A.
    expect(carla.sessionStore.getUnreadCount(ROOM_THREAD_ID)).toBe(3);
    expect(carla.sessionStore.getUnreadCount('aa-ana')).toBe(2);
    expect(carla.sessionStore.totalUnread).toBe(5);
    // La nota de INVITAR (sistema) nunca sumó: el total de A ya lo demuestra.

    // Y la malla de partida sigue intacta detrás de todo lo social: el roster
    // no se movió y la sala PARRILLA sigue siendo la de los tres.
    expect(ana.net.getRoster()).toHaveLength(3);
    expect(world.netHub.roomSize('PARRILLA')).toBe(3);
  });

  it('privacidad by default con el camino de la UI: el toggle de C NO conecta a nadie más que a C', () => {
    const world = new SocialQaWorld();
    const ana = new SocialQaPlayer(world, 'aa-ana', 'ANA', PARRILLA_RNG);
    // B existe pero NUNCA toca el toggle (su conexión es la que se cuenta).
    new SocialQaPlayer(world, 'bb-beto', 'BETO', PARRILLA_RNG);

    // El ajuste default (NO) aplicado por la UI no crea NI una conexión.
    expect(applyAvailabilitySetting(ana.chatSettings, ana.client)).toBe(false);
    expect(world.socialFactoryCalls.get('aa-ana') ?? 0).toBe(0);

    // A se muestra: SOLO A conecta (una room), y la lista de A empieza vacía
    // (nadie más está disponible — B sigue siendo invisible para todos).
    ana.becomeVisible();
    expect(world.socialFactoryCalls.get('aa-ana')).toBe(1);
    expect(world.socialFactoryCalls.get('bb-beto') ?? 0).toBe(0);
    expect(ana.client.getAvailablePeers()).toEqual([]);
    expect(ana.client.isAvailable()).toBe(true);
  });

  it('el hilo caído corta el envío en el adaptador ANTES del store (defensa en profundidad)', () => {
    const world = new SocialQaWorld();
    const ana = new SocialQaPlayer(world, 'aa-ana', 'ANA', PARRILLA_RNG);
    const beto = new SocialQaPlayer(world, 'bb-beto', 'BETO', PARRILLA_RNG);

    ana.createRoom();
    beto.joinRoom('PARRILLA');

    world.advance(1000);
    ana.becomeVisible();
    beto.becomeVisible();
    world.advance(100);
    // DM vivo de ida y vuelta (cada hilo tiene el propio + el del otro).
    expect(ana.dmTo('bb-beto', 'hola!')).not.toBeNull();
    world.advance(CHAT_SEND_COOLDOWN_MS);
    expect(beto.dmTo('aa-ana', 'holaa!')).not.toBeNull();
    expect(beto.dmThread('aa-ana')).toHaveLength(2);

    // B se esconde: el hilo de A con B queda DESCONECTADO y el envío se corta
    // en `sendDirectMessage` (antes del store): no se agrega historial falso
    // ni se consume el cooldown del hilo.
    beto.hide();
    expect(ana.sessionStore.isThreadDisconnected('bb-beto')).toBe(true);
    expect(ana.dmTo('bb-beto', '¿se cortó?')).toBeNull();
    expect(ana.dmThread('bb-beto')).toHaveLength(2);
    // El cooldown del hilo NO se consumió con el intento fallido: en cuanto B
    // vuelva a estar disponible, el envío sale al instante.
    beto.becomeVisible();
    world.advance(1);
    expect(ana.sessionStore.isThreadDisconnected('bb-beto')).toBe(false);
    expect(ana.dmTo('bb-beto', '¿volviste?')).not.toBeNull();
    expect(ana.dmThread('bb-beto')).toHaveLength(3);
    expect(beto.dmThread('aa-ana')).toHaveLength(3); // B recibió el "¿volviste?"
  });
});
