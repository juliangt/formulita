/**
 * TrysteroChatClient — sala pública de presencia (issue #2, C2).
 *
 * Implementación de `ChatClient` sobre Trystero (misma estrategia torrent que
 * `TrysteroNetClient`): una sala "vestíbulo" con nombre derivado
 * `${appId}-social` donde los jugadores que ELIGEN verse aparecen como
 * disponibles. Independiente de las partidas: vive mientras la pestaña viva.
 *
 * PRIVACIDAD (requisito duro del issue): la sala es OPT-IN. El cliente NUNCA
 * llama `joinRoom` hasta `setAvailable(true)`; `setAvailable(false)` hace
 * `leave()` de verdad y corta heartbeats — mientras está OFF no hay conexión,
 * no hay exposición a peers, no hay tráfico. El default del ajuste persistido
 * (`ChatSettings.showAvailable`) es false, así que un jugador nuevo no
 * conecta jamás sin decidirlo.
 *
 * PROTOCOLO (3 piezas, todas acciones Trystero de la sala pública):
 * - `meta {name, color}`: identidad del issue #1. Mismo patrón de intercambio
 *   que el lobby: `onPeerJoin` dispara en AMBOS extremos de cada conexión, así
 *   que cada lado le envía SU meta dirigida al otro y el roster se completa
 *   solo. El color del wire es informativo: cada cliente deriva el color
 *   visible del conjunto de presentes (ver `availablePeersView`).
 * - `ping {}`: heartbeat VACÍO cada `PRESENCE_HEARTBEAT_MS` (5 s) mientras
 *   estoy disponible — la sala pública no tiene estado de carrera que sirva
 *   de señal de vida, así que el latido es explícito. La señal es el hecho
 *   del mensaje, no su contenido.
 * - Stale: un peer sin `ping`/`meta` por `PRESENCE_STALE_MS` (20 s ≈ 4
 *   heartbeats perdidos) se considera DESCONECTADO y sale de la lista — cubre
 *   pestañas muertas y cortes que no dispararon `onPeerLeave`. El barrido es
 *   un timer periódico (cadencia del heartbeat) sobre el reloj inyectado.
 * - `dm {text, targetPeerId}` (C3): mensaje DIRIGIDO a un peer de la sala.
 *   Viaja con `target` (la acción de Trystero entrega SOLO al destinatario)
 *   y, además, con el `targetPeerId` DENTRO del payload: el receptor vuelve
 *   a verificar que el mensaje es para él antes de despacharlo — si un
 *   transporte futuro degradara el dirigido a broadcast, cada cliente
 *   descartaría los dm ajenos igualmente (defensa en profundidad).
 * - `invite {keyword}` (C3): invitación DIRIGIDA a un peer con la PALABRA de
 *   la sala de partida del invitador; solo viaja si la palabra es válida
 *   (`isValidRoomWord`, A–Z 5–9) y el receptor solo despacha keywords
 *   válidas (un cliente rogue no puede colar basura por el banner).
 *
 * Testeabilidad (patrón TrysteroNetClient): `roomFactory`, `selfIdProvider`,
 * `env` y `scheduler` inyectables — los tests conectan rooms fake sin red y
 * disparan los timers a mano; `now` es el reloj inyectable del staleness.
 */

import { joinRoom, selfId as trysteroSelfId } from '@trystero-p2p/torrent';
import { PRESENCE_HEARTBEAT_MS, PRESENCE_STALE_MS } from '../config/balance';
import { resolveAppId, socialRoomId, type NetEnvSource } from './appId';
import type { AvailablePeer, ChatClient, PresenceMeta } from './ChatClient';
import { assignColors } from './lobbyState';
import {
  isValidChatText,
  isValidRoomWord,
  makeDmPayload,
  makeInvitePayload,
  makePingPayload,
  sanitizeChatText,
  sanitizePlayerName,
  sanitizeRoomWord,
  type DmPayload,
  type InvitePayload,
  type PingPayload,
  type RosterEntry,
} from './protocol';
import type { RoomFactory, TrysteroAction, TrysteroRoom } from './TrysteroNetClient';

/** Opciones del constructor (todas con default = red/tiempo real). */
export interface TrysteroChatClientOptions {
  /** Fábrica de room inyectable (default: `joinRoom` real de Trystero). */
  readonly roomFactory?: RoomFactory;
  /** Proveedor del peerId propio (default: `selfId` de Trystero). */
  readonly selfIdProvider?: () => string;
  /** Entorno de Vite para `resolveAppId` (default: `import.meta.env`). */
  readonly env?: NetEnvSource;
  /** Identidad anunciada en la meta (default: PILOTO; la escena la actualiza). */
  readonly self?: PresenceMeta;
  /**
   * Programador de timers (default: `setTimeout` cancelable). Uno solo para
   * heartbeat y barrido de stale: los tests lo inyectan para disparar los
   * vencimientos sin esperar tiempo real.
   */
  readonly scheduler?: (callback: () => void, ms: number) => () => void;
  /** Reloj inyectable para el staleness (default: `Date.now`). */
  readonly now?: () => number;
}

/** Programador default: setTimeout real (cancelable). */
const defaultScheduler = (callback: () => void, ms: number): (() => void) => {
  const id = setTimeout(callback, ms);
  return () => clearTimeout(id);
};

/**
 * Factory default: `joinRoom` real de la estrategia torrent. El cast es de
 * TIPOS únicamente (misma justificación que en TrysteroNetClient): la room
 * real cumple el subconjunto estructural `TrysteroRoom` en runtime.
 */
const defaultRoomFactory: RoomFactory = (appId, roomId) =>
  joinRoom({ appId }, roomId) as unknown as TrysteroRoom;

/** Handlers por evento (misma forma que los demás clientes). */
type HandlerMap = {
  availablePeers: Set<(peers: AvailablePeer[]) => void>;
  dm: Set<(fromPeerId: string, payload: DmPayload) => void>;
  invite: Set<(fromPeerId: string, payload: InvitePayload) => void>;
  error: Set<(message: string) => void>;
};

/**
 * Lista de disponibles DERIVADA del estado conocido (pura, exportada para
 * testear la regla de colores): entries = metas conocidas + YO, ordenadas por
 * peerId → color de paleta por posición (misma regla que
 * `lobbyState.assignColors`), SIN incluirme a mí mismo en el resultado.
 * Incluirme en el ORDEN es lo que hace el color consistente entre clientes:
 * todos computan sobre el mismo conjunto de presentes.
 */
export function availablePeersView(
  selfPeerId: string,
  self: PresenceMeta,
  metas: ReadonlyMap<string, PresenceMeta>,
): AvailablePeer[] {
  const entries: RosterEntry[] = [{ peerId: selfPeerId, name: self.name, isCreator: false }];
  for (const [peerId, meta] of metas) {
    entries.push({ peerId, name: meta.name, isCreator: false });
  }
  return assignColors(entries)
    .filter((player) => player.peerId !== selfPeerId)
    .map(({ peerId, name, color }) => ({ peerId, name, color }));
}

/** Implementación de `ChatClient` sobre la sala pública de Trystero. */
export class TrysteroChatClient implements ChatClient {
  readonly selfPeerId: string;

  private readonly roomFactory: RoomFactory;
  private readonly env: NetEnvSource | undefined;
  private readonly scheduler: (callback: () => void, ms: number) => () => void;
  private readonly now: () => number;
  private readonly handlers: HandlerMap = {
    availablePeers: new Set(),
    dm: new Set(),
    invite: new Set(),
    error: new Set(),
  };

  private available = false;
  private room: TrysteroRoom | null = null;
  private metaAction: TrysteroAction<PresenceMeta> | null = null;
  private pingAction: TrysteroAction<PingPayload> | null = null;
  private dmAction: TrysteroAction<DmPayload> | null = null;
  private inviteAction: TrysteroAction<InvitePayload> | null = null;
  /** Identidad propia anunciada (la actualiza la UI con el nombre del perfil). */
  private self: PresenceMeta;
  /** Metas conocidas de los demás peers (solo quien anunció meta aparece). */
  private metas = new Map<string, PresenceMeta>();
  /** Última señal de vida vista por peer (meta o ping recibidos). */
  private lastSeen = new Map<string, number>();
  /** Cancela el timer de heartbeat activo (si hay). */
  private cancelHeartbeat: (() => void) | null = null;
  /** Cancela el timer del barrido de stale activo (si hay). */
  private cancelSweep: (() => void) | null = null;

  constructor(options: TrysteroChatClientOptions = {}) {
    this.roomFactory = options.roomFactory ?? defaultRoomFactory;
    this.selfPeerId = (options.selfIdProvider ?? (() => trysteroSelfId))();
    this.env = options.env;
    this.self = options.self ?? { name: 'PILOTO', color: 0 };
    this.scheduler = options.scheduler ?? defaultScheduler;
    this.now = options.now ?? (() => Date.now());
  }

  /* ---------------- disponibilidad (join/leave de la sala) ---------------- */

  setAvailable(available: boolean): void {
    if (available) {
      this.becomeAvailable();
    } else {
      this.becomeUnavailable();
    }
  }

  isAvailable(): boolean {
    return this.available;
  }

  getAvailablePeers(): AvailablePeer[] {
    return availablePeersView(this.selfPeerId, this.self, this.metas);
  }

  /**
   * ON: join a `${appId}-social` + acciones + heartbeat + barrido. Fail-fast
   * del appId (sin VITE_TRYSTERO_APP_ID no hay sala posible): el error se
   * emite y el cliente queda NO disponible (nunca conecta en silencio).
   */
  private becomeAvailable(): void {
    if (this.available) {
      return; // idempotente: re-llamar con true no reconecta
    }
    let appId: string;
    try {
      appId = resolveAppId(this.env);
    } catch (error) {
      this.emitError(error instanceof Error ? error.message : String(error));
      return;
    }
    let room: TrysteroRoom;
    try {
      room = this.roomFactory(appId, socialRoomId(appId));
    } catch (error) {
      this.emitError(`No se pudo conectar a la sala pública: ${String(error)}`);
      return;
    }
    this.available = true;
    this.room = room;

    this.metaAction = room.makeAction<PresenceMeta>('meta');
    this.metaAction.onMessage = (meta, context) => this.receiveMeta(context.peerId, meta);

    this.pingAction = room.makeAction<PingPayload>('ping');
    this.pingAction.onMessage = (_payload, context) => this.receivePing(context.peerId);

    // C3 — acciones dirigidas de la sala pública (dm e invite): mismas
    // acciones que meta, enviadas SIEMPRE con target al destinatario.
    this.dmAction = room.makeAction<DmPayload>('dm');
    this.dmAction.onMessage = (payload, context) => this.receiveDmMessage(context.peerId, payload);

    this.inviteAction = room.makeAction<InvitePayload>('invite');
    this.inviteAction.onMessage = (payload, context) =>
      this.receiveInviteMessage(context.peerId, payload);

    room.onPeerJoin = (peerId) => this.handlePeerJoin(peerId);
    room.onPeerLeave = (peerId) => this.handlePeerLeave(peerId);

    // Heartbeat y barrido: se rearman solos en cada vencimiento (cadencia
    // fija de PRESENCE_HEARTBEAT_MS) hasta que la disponibilidad se apague.
    this.scheduleHeartbeat();
    this.scheduleSweep();

    this.emitPeers(); // lista inicial: [] (todavía no conozco a nadie)
  }

  /**
   * OFF: leave REAL de la sala pública + limpieza total (roster, timers,
   * acciones). La desconexión es inmediata y medible: los demás me ven ir por
   * `onPeerLeave` (o por stale si mi leave no llega a viajar).
   */
  private becomeUnavailable(): void {
    if (!this.available) {
      return; // idempotente: nunca estuve (o ya me fui)
    }
    this.available = false;
    this.cancelHeartbeat?.();
    this.cancelHeartbeat = null;
    this.cancelSweep?.();
    this.cancelSweep = null;
    if (this.room) {
      this.room.onPeerJoin = null;
      this.room.onPeerLeave = null;
      void this.room.leave();
    }
    this.room = null;
    this.metaAction = null;
    this.pingAction = null;
    this.dmAction = null;
    this.inviteAction = null;
    this.metas.clear();
    this.lastSeen.clear();
    this.emitPeers(); // la lista en vivo queda vacía
  }

  /* ---------------- identidad ---------------- */

  /**
   * Actualiza la identidad anunciada (nombre del perfil persistido, color
   * informativo). Si ya estoy disponible, re-anuncia la meta a los peers
   * conocidos para que la lista se refresque en los demás.
   */
  updateSelf(self: PresenceMeta): void {
    this.self = self;
    if (this.available && this.metaAction) {
      for (const peerId of this.metas.keys()) {
        void this.metaAction.send(self, { target: peerId });
      }
    }
  }

  /* ---------------- acciones de la sala ---------------- */

  private handlePeerJoin(peerId: string): void {
    // Patrón Trystero (mismo que el lobby): la conexión nueva dispara en
    // AMBOS extremos, cada lado manda SU meta dirigida al otro.
    if (this.metaAction) {
      void this.metaAction.send(this.self, { target: peerId });
    }
  }

  private handlePeerLeave(peerId: string): void {
    const hadMeta = this.metas.delete(peerId);
    this.lastSeen.delete(peerId);
    if (hadMeta) {
      this.emitPeers();
    }
  }

  private receiveMeta(peerId: string, meta: PresenceMeta): void {
    if (peerId === this.selfPeerId) {
      return; // eco del propio anuncio: nada que aprender de mí
    }
    this.metas.set(peerId, { ...meta, name: sanitizePlayerName(meta.name) });
    // La meta es señal de vida además de identidad.
    this.lastSeen.set(peerId, this.now());
    this.emitPeers();
  }

  private receivePing(peerId: string): void {
    // El ping no trae identidad: solo refresca la señal de vida (la meta ya
    // llegó o llegará por el intercambio del join).
    this.lastSeen.set(peerId, this.now());
  }

  private sendPing(): void {
    void this.pingAction?.send(makePingPayload());
  }

  /* ---------------- timers (heartbeat + barrido de stale) ---------------- */

  private scheduleHeartbeat(): void {
    this.cancelHeartbeat = this.scheduler(() => {
      this.sendPing();
      this.scheduleHeartbeat(); // re-arme: cadencia fija mientras disponible
    }, PRESENCE_HEARTBEAT_MS);
  }

  private scheduleSweep(): void {
    this.cancelSweep = this.scheduler(() => {
      this.sweepStale();
      this.scheduleSweep();
    }, PRESENCE_HEARTBEAT_MS);
  }

  /**
   * Barrido de stale: peers con más de `PRESENCE_STALE_MS` sin señal de vida
   * se eliminan de la lista (desconexión abrupta: pestaña muerta, corte sin
   * `onPeerLeave`). Corre sobre el reloj inyectado — nunca sobre el timer.
   */
  private sweepStale(): void {
    const now = this.now();
    let removed = false;
    for (const [peerId, seen] of this.lastSeen) {
      if (now - seen > PRESENCE_STALE_MS) {
        this.lastSeen.delete(peerId);
        removed = this.metas.delete(peerId) || removed;
      }
    }
    if (removed) {
      this.emitPeers();
    }
  }

  /* ---------------- C3 — DM e invitaciones (acciones dirigidas) ---------------- */

  /**
   * Envía un mensaje directo a `peerId` por la acción `dm` de la sala pública
   * (DIRIGIDA: `target` en el envío + `targetPeerId` en el payload). El texto
   * se sanitiza (trim/colapso/máx 200) y un texto que queda vacío NO viaja.
   * Sin disponibilidad (toggle OFF) es un no-op silencioso: sin sala pública
   * no hay a quién enviarle — la UI ni ofrece el hilo en ese estado.
   */
  sendDm(peerId: string, text: string): void {
    if (!this.dmAction) {
      return;
    }
    const target = peerId.trim();
    if (target.length === 0 || target === this.selfPeerId) {
      return; // sin destinatario, o yo mismo: no tiene sentido viajar
    }
    if (!isValidChatText(text)) {
      return; // vacío tras sanitizar: no hay mensaje que enviar
    }
    void this.dmAction.send(makeDmPayload(text, target), { target });
  }

  /**
   * Despacha un `dm` recibido SOLO si es para mí: el transporte entregó el
   * mensaje dirigido (o el emisor difundió por accidente — el `targetPeerId`
   * del payload decide). El texto se re-sanitiza (misma regla que el emisor:
   * un cliente rogue no elude el límite) antes de llegar a los handlers.
   */
  private receiveDmMessage(fromPeerId: string, payload: DmPayload): void {
    if (fromPeerId === this.selfPeerId) {
      return; // eco del propio envío
    }
    if (payload.targetPeerId !== this.selfPeerId) {
      return; // dirigido a otro peer: ni lo proceso
    }
    const text = sanitizeChatText(payload.text);
    if (text.length === 0) {
      return;
    }
    for (const handler of this.handlers.dm) {
      handler(fromPeerId, { text, targetPeerId: payload.targetPeerId });
    }
  }

  onDm(handler: (fromPeerId: string, payload: DmPayload) => void): () => void {
    this.handlers.dm.add(handler);
    return () => this.handlers.dm.delete(handler);
  }

  /**
   * Invita a `peerId` a la partida por palabra de sala (acción `invite`
   * dirigida). La palabra se normaliza (mayúsculas, solo A–Z) y una palabra
   * que queda INVÁLIDA (fuera de 5–9 A–Z) NO viaja: no existe sala con esa
   * forma, invitar a la nada solo confunde. Sin disponibilidad es no-op.
   */
  sendInvite(peerId: string, keyword: string): void {
    if (!this.inviteAction) {
      return;
    }
    const target = peerId.trim();
    if (target.length === 0 || target === this.selfPeerId) {
      return;
    }
    const payload = makeInvitePayload(keyword);
    if (!isValidRoomWord(payload.keyword)) {
      return;
    }
    void this.inviteAction.send(payload, { target });
  }

  /**
   * Despacha una invitación recibida: solo keywords VÁLIDAS (A–Z 5–9) llegan
   * a los handlers — la keyword viaja ya sanitizada, lista para el flujo de
   * UNIRSE del lobby.
   */
  private receiveInviteMessage(fromPeerId: string, payload: InvitePayload): void {
    if (fromPeerId === this.selfPeerId) {
      return; // eco del propio envío
    }
    const keyword = sanitizeRoomWord(payload.keyword);
    if (!isValidRoomWord(keyword)) {
      return;
    }
    for (const handler of this.handlers.invite) {
      handler(fromPeerId, { keyword });
    }
  }

  onInvite(handler: (fromPeerId: string, payload: InvitePayload) => void): () => void {
    this.handlers.invite.add(handler);
    return () => this.handlers.invite.delete(handler);
  }

  /* ---------------- lifecycle ---------------- */

  destroy(): void {
    this.becomeUnavailable();
    for (const set of Object.values(this.handlers)) {
      set.clear();
    }
  }

  /* ---------------- eventos ---------------- */

  onAvailablePeers(handler: (peers: AvailablePeer[]) => void): () => void {
    this.handlers.availablePeers.add(handler);
    return () => this.handlers.availablePeers.delete(handler);
  }

  onError(handler: (message: string) => void): () => void {
    this.handlers.error.add(handler);
    return () => this.handlers.error.delete(handler);
  }

  private emitPeers(): void {
    const peers = this.getAvailablePeers();
    for (const handler of this.handlers.availablePeers) {
      handler(peers);
    }
  }

  private emitError(message: string): void {
    for (const handler of this.handlers.error) {
      handler(message);
    }
  }
}
