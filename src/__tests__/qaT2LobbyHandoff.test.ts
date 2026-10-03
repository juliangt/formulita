import { describe, expect, it, vi } from 'vitest';
import { MULTIPLAYER } from '../config/balance';
import { LobbyScene } from '../scenes/LobbyScene';
import type { NetClient } from '../net/NetClient';
import { bindLobbyNet, evaluateLobbyEntry } from '../net/netClientSession';
import { TrysteroNetClient } from '../net/TrysteroNetClient';
import type { StartPayload } from '../net/protocol';
import { FakeNetClient, FakeNetHub } from './fakes/FakeNetClient';

/**
 * qaT2 (issue #35) — handlers zombie del lobby tras el handoff del NetClient.
 *
 * Teoría auditada:
 * 1. LobbyScene entrega el cliente a la carrera (handoffNetClient) pero sólo
 *    desuscribe onChat: onStart/onRosterChange/onHostChange/onRoomFull/onError
 *    siguen vivos TODA la partida apuntando a widgets destruidos y a
 *    startRace(). Un `start` de un anfitrión migrado (joiner que heredó el
 *    mando) re-ejecuta startRace en plena partida; cualquier rosterChange
 *    despacha renderRoster sobre objetos muertos.
 * 2. createRoom/tryJoin marcan `joined = true` aunque la entrada haya fallado
 *    (create/join son fire-and-forget y fallan ANTES de abrir sala): la UI
 *    pinta la sala como si existiera y PISA el error que onError dejó en
 *    pantalla (el error es síncrono).
 *
 * Harness de escena: técnica de lobbyTelemetry.test.ts — escena REAL sin
 * arrancar, `scene.start` espía y widgets muertos de la escena reemplazados
 * por stubs vía Object.assign; el cableado de red es el de producción
 * (`wireLobbyNet`), la entrada a sala y a carrera son las reales
 * (`createRoom`/`tryJoin`/`startRace`).
 */

const APP = 'formulita-dev';

/** Superficie privada de LobbyScene que estos tests manejan vía cast. */
interface LobbyInternals {
  wireLobbyNet(client: NetClient): void;
  startRace(payload: StartPayload): void;
  createRoom(): void;
  tryJoin(): void;
  joined: boolean;
  handedOff: boolean;
}

function internals(scene: LobbyScene): LobbyInternals {
  return scene as unknown as LobbyInternals;
}

/** Registry falso con la porción get/set/remove que consumen los sesiones. */
function fakeRegistry(): {
  registry: { get(key: string): unknown; set(key: string, v: unknown): unknown; remove(key: string): unknown };
  dump(): Map<string, unknown>;
} {
  const store = new Map<string, unknown>();
  return {
    registry: {
      get: (key: string) => store.get(key),
      set: (key: string, value: unknown) => store.set(key, value),
      remove: (key: string) => store.delete(key),
    },
    dump: () => store,
  };
}

/** Stub de GameObject Phaser: cualquier setter devuelve el mismo objeto. */
function widgetStub(): Record<string, ReturnType<typeof vi.fn>> {
  const stub: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ['setText', 'setVisible', 'setColor', 'setStrokeStyle', 'setOrigin', 'destroy']) {
    stub[method] = vi.fn(() => stub);
  }
  return stub;
}

interface SceneStatus {
  text: string;
  color: string;
}

interface LobbyHarness {
  scene: LobbyScene;
  internals: LobbyInternals;
  sceneStart: ReturnType<typeof vi.fn>;
  status: SceneStatus;
  wordText: Record<string, ReturnType<typeof vi.fn>>;
  wordInput: Record<string, ReturnType<typeof vi.fn>>;
  enterButton: Record<string, ReturnType<typeof vi.fn>>;
  rosterLabel: Record<string, ReturnType<typeof vi.fn>>;
  openChatEntry: ReturnType<typeof vi.fn>;
  createStartButton: ReturnType<typeof vi.fn>;
  syncStartButton: ReturnType<typeof vi.fn>;
}

/**
 * Escena REAL preparada para operar sin Phaser: widgets que el cableado de
 * red toca (como los destruidos tras el shutdown, en el caso zombie) y los
 * helpers de UI de la entrada a sala como spies. `wireLobbyNet` deja el
 * cableado de red EXACTO al de producción.
 */
function lobbyHarness(client: NetClient, overrides: Record<string, unknown> = {}): LobbyHarness {
  const scene = new LobbyScene();
  const sceneStart = vi.fn();
  const status: SceneStatus = { text: '', color: '' };
  const statusText = {
    setText: vi.fn((text: string) => {
      status.text = text;
      return statusText;
    }),
    setColor: vi.fn((color: string) => {
      status.color = color;
      return statusText;
    }),
  };
  // Los widgets que el test reemplaza (p. ej. `wordText: undefined` para
  // simular la escena apagada) son los MISMA referencia que se devuelve.
  const pick = (key: string): Record<string, ReturnType<typeof vi.fn>> =>
    key in overrides ? (overrides[key] as Record<string, ReturnType<typeof vi.fn>>) : widgetStub();
  const wordText = pick('wordText');
  const wordInput = pick('wordInput');
  const enterButton = pick('enterButton');
  const rosterLabel = pick('rosterLabel');
  const add =
    'add' in overrides
      ? overrides.add
      : {
          rectangle: vi.fn(() => widgetStub()),
          text: vi.fn(() => widgetStub()),
          dom: vi.fn(() => widgetStub()),
          container: vi.fn(() => widgetStub()),
        };
  const openChatEntry = vi.fn();
  const createStartButton = vi.fn();
  const syncStartButton = vi.fn();
  Object.assign(scene, {
    scene: { start: sceneStart },
    registry: fakeRegistry().registry,
    client,
    appId: APP,
    playerName: 'Ana',
    joined: false,
    handedOff: false,
    chatStore: null,
    startButton: null,
    chatButton: null,
    rosterRows: [],
    scale: { width: 1280, height: 720 },
    statusText,
    wordLabel: widgetStub(),
    openChatEntry,
    createStartButton,
    syncStartButton,
  });
  Object.assign(scene, { wordText, wordInput, enterButton, rosterLabel, add });
  // Overrides restantes (joined, playerName, etc.) — los de los widgets ya
  // fueron absorbidos por `pick`, así que re-aplicarlos es un no-op.
  Object.assign(scene, overrides);
  const cast = internals(scene);
  cast.wireLobbyNet(client);
  return {
    scene,
    internals: cast,
    sceneStart,
    status,
    wordText: wordText as Record<string, ReturnType<typeof vi.fn>>,
    wordInput: wordInput as Record<string, ReturnType<typeof vi.fn>>,
    enterButton: enterButton as Record<string, ReturnType<typeof vi.fn>>,
    rosterLabel: rosterLabel as Record<string, ReturnType<typeof vi.fn>>,
    openChatEntry,
    createStartButton,
    syncStartButton,
  };
}

/** Host + joiner ya en sala, con el joiner cableado con bindLobbyNet. */
function boundJoinerScenario(): {
  hub: FakeNetHub;
  host: FakeNetClient;
  joiner: FakeNetClient;
  handlers: ReturnType<typeof spyHandlers>;
  detach: () => void;
} {
  const hub = new FakeNetHub();
  const host = new FakeNetClient(hub, { peerId: 'aa-host' });
  host.create({ appId: APP, name: 'Host' });
  const joiner = new FakeNetClient(hub, { peerId: 'mm-joiner' });
  joiner.join({ appId: APP, roomWord: host.roomWord ?? '', name: 'Joiner' });
  const handlers = spyHandlers();
  const detach = bindLobbyNet(joiner, handlers);
  return { hub, host, joiner, handlers, detach };
}

/** Los seis handlers del lobby como spies (los mismos que cablea el lobby). */
function spyHandlers() {
  return {
    onStatus: vi.fn(),
    onRoomFull: vi.fn(),
    onRosterChange: vi.fn(),
    onHostChange: vi.fn(),
    onStart: vi.fn(),
    onChat: vi.fn(),
  };
}

/** Arma una sala LLENA (maxPlayers adentro) y devuelve su palabra. */
function fullRoomWord(hub: FakeNetHub): string {
  const host = new FakeNetClient(hub, { peerId: 'p-00' });
  host.create({ appId: APP, name: 'P0' });
  for (let i = 1; i < MULTIPLAYER.maxPlayers; i += 1) {
    const peer = new FakeNetClient(hub, { peerId: `p-${String(i).padStart(2, '0')}` });
    peer.join({ appId: APP, roomWord: host.roomWord ?? '', name: `P${i}` });
  }
  return host.roomWord ?? '';
}

/** Cliente real con transporte ROTO (el roomFactory lanza, como sin red). */
function brokenTransportClient(selfId: string): TrysteroNetClient {
  return new TrysteroNetClient({
    roomFactory: () => {
      throw new Error('boom');
    },
    selfIdProvider: () => selfId,
    settleScheduler: () => () => {},
  });
}

describe('qaT2 issue #35 — bindLobbyNet: los seis eventos del lobby y su detach total', () => {
  it('mientras el lobby vive, los seis eventos llegan (roster/host/start/chat/error/roomFull)', () => {
    const { hub, host, joiner, handlers } = boundJoinerScenario();

    // rosterChange: entra un peer nuevo a la sala.
    const extra = new FakeNetClient(hub, { peerId: 'zz-extra' });
    extra.join({ appId: APP, roomWord: joiner.roomWord ?? '', name: 'Extra' });
    expect(handlers.onRosterChange).toHaveBeenCalled();

    // start del anfitrión.
    host.start({ seed: 7, players: joiner.getRoster(), startAt: 5 });
    expect(handlers.onStart).toHaveBeenCalledWith(expect.objectContaining({ seed: 7 }));

    // chat de sala desde un peer.
    extra.sendChat('hola sala');
    expect(handlers.onChat).toHaveBeenCalledTimes(1);

    // error de validación (join con palabra inválida: sólo emite error).
    joiner.join({ appId: APP, roomWord: '!!!', name: 'Joiner' });
    expect(handlers.onStatus).toHaveBeenCalledWith(expect.stringContaining('inválida'));

    // hostChange: el creador se va y el joiner hereda el mando (peerId menor).
    host.leave();
    expect(handlers.onHostChange).toHaveBeenCalledWith(joiner.selfPeerId);
  });

  it('roomFull llega mientras el lobby vive (flujo legítimo intacto)', () => {
    const hub = new FakeNetHub();
    const word = fullRoomWord(hub);
    const eleventh = new FakeNetClient(hub, { peerId: 'zz-11' });
    const handlers = spyHandlers();
    const detach = bindLobbyNet(eleventh, handlers);
    expect(typeof detach).toBe('function');

    eleventh.join({ appId: APP, roomWord: word, name: 'Once' });
    expect(handlers.onRoomFull).toHaveBeenCalledTimes(1);
    expect(eleventh.roomWord).toBeNull(); // semántica del cliente: se fue solo
  });

  it('detach() desuscribe TODOS los handlers (no sólo onChat) sin destruir la sala', () => {
    const { hub, host, joiner, handlers, detach } = boundJoinerScenario();
    detach();

    // Durante la "carrera" pasan de todo; el lobby ya no escucha nada.
    const extra = new FakeNetClient(hub, { peerId: 'zz-extra' });
    extra.join({ appId: APP, roomWord: joiner.roomWord ?? '', name: 'Extra' });
    host.start({ seed: 7, players: joiner.getRoster(), startAt: 5 });
    extra.sendChat('durante la partida');
    joiner.join({ appId: APP, roomWord: '!!!', name: 'Joiner' });
    host.leave();

    const otherHub = new FakeNetHub();
    joiner.join({ appId: APP, roomWord: fullRoomWord(otherHub), name: 'Joiner' });

    expect(handlers.onRosterChange).not.toHaveBeenCalled();
    expect(handlers.onStart).not.toHaveBeenCalled();
    expect(handlers.onChat).not.toHaveBeenCalled();
    expect(handlers.onStatus).not.toHaveBeenCalled();
    expect(handlers.onHostChange).not.toHaveBeenCalled();
    expect(handlers.onRoomFull).not.toHaveBeenCalled();
  });

  it('detach NO destruye el transporte: la carrera puede seguir suscribiendo y recibiendo', () => {
    const { host, joiner, handlers, detach } = boundJoinerScenario();
    detach();

    // La carrera se suscribe DESPUÉS del handoff (patrón RaceScene/GameScene).
    const raceChat: string[] = [];
    joiner.onChat((_from, payload) => raceChat.push(payload.text));

    host.sendChat('desde la carrera');
    expect(raceChat).toEqual(['desde la carrera']);

    // Y el cliente puede seguir difundiendo (rstate/eliminated/chat).
    const echoed: string[] = [];
    host.onChat((_from, payload) => echoed.push(payload.text));
    joiner.sendChat('respuesta del que corre');
    expect(echoed).toEqual(['respuesta del que corre']);

    // Los handlers del lobby siguen muertos: nada de doble procesamiento.
    expect(handlers.onChat).not.toHaveBeenCalled();
  });
});

describe('qaT2 issue #35 — LobbyScene: sin handlers zombie tras el handoff', () => {
  it('rosterChange durante la carrera no despacha al lobby muerto (sin TypeError sobre widgets destruidos)', () => {
    const hub = new FakeNetHub();
    const host = new FakeNetClient(hub, { peerId: 'aa-host' });
    host.create({ appId: APP, name: 'Host' });
    const racer = new FakeNetClient(hub, { peerId: 'zz-racer' });
    racer.join({ appId: APP, roomWord: host.roomWord ?? '', name: 'Racer' });

    // Sin stubs de widgets: si el lobby muerto recibe rosterChange, el
    // renderRoster zombie revienta contra wordText/rosterLabel inexistentes
    // (en producción: destruidos por el shutdown de la escena).
    const { internals: cast } = lobbyHarness(racer, {
      wordText: undefined,
      rosterLabel: undefined,
      add: undefined,
    });
    cast.startRace({ seed: 1, players: racer.getRoster(), startAt: 100 });

    const late = new FakeNetClient(hub, { peerId: 'bb-late' });
    expect(() => host.leave()).not.toThrow();
    expect(() => late.join({ appId: APP, roomWord: racer.roomWord ?? '', name: 'Late' })).not.toThrow();
  });

  it('el start de un anfitrión migrado durante la carrera NO reinicia la escena de carrera', () => {
    const hub = new FakeNetHub();
    const host = new FakeNetClient(hub, { peerId: 'aa-host' });
    host.create({ appId: APP, name: 'Host' });
    const racer = new FakeNetClient(hub, { peerId: 'zz-racer' });
    racer.join({ appId: APP, roomWord: host.roomWord ?? '', name: 'Racer' });

    const { internals: cast, sceneStart } = lobbyHarness(racer, { joined: true });

    // Start legítimo: la escena arranca SU carrera una sola vez (handoff).
    host.start({ seed: 1, players: racer.getRoster(), startAt: 100 });
    expect(sceneStart).toHaveBeenCalledTimes(1);
    expect(cast.handedOff).toBe(true);

    // El anfitrión original se va; un joiner que entra durante la partida
    // hereda el mando (resolveHostPeerId: sin creador, peerId menor).
    host.leave();
    const late = new FakeNetClient(hub, { peerId: 'bb-late' });
    late.join({ appId: APP, roomWord: racer.roomWord ?? '', name: 'Late' });
    expect(late.isHost()).toBe(true);

    // Su INICIAR difunde start… y NO debe re-arrancar la carrera de nadie.
    late.start({ seed: 2, players: late.getRoster(), startAt: 200 });
    expect(sceneStart).toHaveBeenCalledTimes(1);
  });

  it('el flujo legítimo del lobby sigue vivo ANTES del handoff (no se desuscribe de más)', () => {
    const hub = new FakeNetHub();
    const host = new FakeNetClient(hub, { peerId: 'aa-host' });
    host.create({ appId: APP, name: 'Host' });
    const racer = new FakeNetClient(hub, { peerId: 'zz-racer' });
    racer.join({ appId: APP, roomWord: host.roomWord ?? '', name: 'Racer' });

    const { sceneStart, rosterLabel, status } = lobbyHarness(racer, { joined: true });

    // En el lobby: el roster llega y pinta; el start arranca UNA vez.
    const extra = new FakeNetClient(hub, { peerId: 'bb-extra' });
    extra.join({ appId: APP, roomWord: racer.roomWord ?? '', name: 'Extra' });
    expect(rosterLabel.setText).toHaveBeenCalledWith(`JUGADORES 3/${MULTIPLAYER.maxPlayers}`);

    host.start({ seed: 3, players: racer.getRoster(), startAt: 300 });
    expect(sceneStart).toHaveBeenCalledTimes(1);
    // El joiner legítimo ve el roster y queda esperando al anfitrión.
    expect(status.text).toBe('ESPERANDO AL ANFITRIÓN…');
  });
});

describe('qaT2 issue #35 — createRoom/tryJoin: joined sólo con sala real', () => {
  it('createRoom con entrada fallida (transporte lanza): joined false, sin INICIAR y error visible', () => {
    const client = brokenTransportClient('self-x');
    const { internals: cast, status, wordText, openChatEntry, createStartButton, syncStartButton } = lobbyHarness(client);

    cast.createRoom();

    expect(cast.joined).toBe(false);
    expect(openChatEntry).not.toHaveBeenCalled();
    expect(createStartButton).not.toHaveBeenCalled();
    expect(syncStartButton).not.toHaveBeenCalled();
    expect(wordText.setText).not.toHaveBeenCalled();
    // El error quedó en pantalla (el flujo viejo lo pintaba y lo pisaba con
    // "COMPARTÍ LA PALABRA…", mostrando una sala que no existe).
    expect(status.text).toBe('No se pudo conectar a la sala: Error: boom');
    expect(status.color).toBe('#d63c3c');
  });

  it('tryJoin con entrada fallida (transporte lanza): joined false, input vivo y error visible', () => {
    const client = brokenTransportClient('self-x');
    const {
      internals: cast,
      status,
      wordInput,
      enterButton,
      openChatEntry,
      createStartButton,
      syncStartButton,
    } = lobbyHarness(client, {
      wordInput: { ...widgetStub(), node: { value: 'FIESTA' } } as unknown as LobbyScene['wordInput'],
    });

    cast.tryJoin();

    expect(cast.joined).toBe(false);
    expect(openChatEntry).not.toHaveBeenCalled();
    expect(createStartButton).not.toHaveBeenCalled();
    expect(syncStartButton).not.toHaveBeenCalled();
    // El input y ENTRAR siguen vivos para reintentar (no se consumieron).
    expect(wordInput.destroy).not.toHaveBeenCalled();
    expect(enterButton.destroy).not.toHaveBeenCalled();
    expect(status.text).toBe('No se pudo conectar a la sala: Error: boom');
    expect(status.color).toBe('#d63c3c');
  });

  it('createRoom exitoso: joined true y sala pintada (flujo legítimo intacto)', () => {
    const hub = new FakeNetHub();
    const client = new FakeNetClient(hub, { peerId: 'aa-host' });
    const {
      internals: cast,
      status,
      wordText,
      openChatEntry,
      createStartButton,
    } = lobbyHarness(client);

    cast.createRoom();

    expect(cast.joined).toBe(true);
    expect(openChatEntry).toHaveBeenCalledTimes(1);
    expect(createStartButton).toHaveBeenCalledTimes(1);
    expect(wordText.setText).toHaveBeenCalledWith(client.roomWord);
    expect(status.text).toBe('COMPARTÍ LA PALABRA PARA INVITAR JUGADORES');
  });

  it('tryJoin exitoso: joined true y "BUSCANDO SALA…" (flujo legítimo intacto)', () => {
    const hub = new FakeNetHub();
    const host = new FakeNetClient(hub, { peerId: 'aa-host' });
    host.create({ appId: APP, name: 'Host' });
    const client = new FakeNetClient(hub, { peerId: 'zz-joiner' });
    const {
      internals: cast,
      status,
      wordInput,
      enterButton,
      openChatEntry,
      createStartButton,
    } = lobbyHarness(client, {
      wordInput: { ...widgetStub(), node: { value: host.roomWord ?? 'FIESTA' } } as unknown as LobbyScene['wordInput'],
    });

    cast.tryJoin();

    expect(cast.joined).toBe(true);
    expect(openChatEntry).toHaveBeenCalledTimes(1);
    expect(createStartButton).toHaveBeenCalledTimes(1);
    expect(wordInput.destroy).toHaveBeenCalledTimes(1);
    expect(enterButton.destroy).toHaveBeenCalledTimes(1);
    expect(status.text).toBe('BUSCANDO SALA…');
  });
});

describe('qaT2 issue #35 — evaluateLobbyEntry: la señal de éxito es la sala vigente', () => {
  it('entrada exitosa: entered true con la palabra vigente', () => {
    const hub = new FakeNetHub();
    const host = new FakeNetClient(hub, { peerId: 'aa' });
    host.create({ appId: APP, name: 'Ana' });

    const entry = evaluateLobbyEntry(host);
    expect(entry.entered).toBe(true);
    expect(entry.roomWord).toBe(host.roomWord);
  });

  it('create con nombre inválido: entered false y palabra vacía', () => {
    const hub = new FakeNetHub();
    const client = new FakeNetClient(hub, { peerId: 'aa' });
    client.create({ appId: APP, name: '   ' }); // sanitiza a vacío → error, sin sala

    const entry = evaluateLobbyEntry(client);
    expect(entry.entered).toBe(false);
    expect(entry.roomWord).toBe('');
  });

  it('join/create con roomFactory que lanza (cliente real): entered false', () => {
    const joiner = brokenTransportClient('self-x');
    joiner.join({ appId: APP, roomWord: 'FIESTA', name: 'Ana' });
    expect(evaluateLobbyEntry(joiner).entered).toBe(false);

    const creator = brokenTransportClient('self-y');
    creator.create({ appId: APP, name: 'Ana' });
    const entry = evaluateLobbyEntry(creator);
    expect(entry.entered).toBe(false);
    expect(entry.roomWord).toBe('');
  });
});
