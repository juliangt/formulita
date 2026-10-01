import { describe, expect, it, vi } from 'vitest';
import { CHAT_MAX_LEN, JOIN_SETTLE_MS, MULTIPLAYER } from '../config/balance';
import { mulberry32 } from '../net/roomRng';
import { ROOM_WORDS } from '../net/roomWords';
import {
  MAX_WORD_REGEN_ATTEMPTS,
  resolveAppId,
  TrysteroNetClient,
  type ActionSendOptions,
  type TrysteroAction,
  type TrysteroRoom,
} from '../net/TrysteroNetClient';
import type { ChatPayload, PeerMeta, StartPayload } from '../net/protocol';

/**
 * Tests del TrysteroNetClient (M1) con roomFactory FAKE: un doble
 * estructural de la room de Trystero (makeAction/onPeerJoin/onPeerLeave/
 * getPeers/leave) permite ejercitar TODO el flujo del lobby sin red — la
 * red real (WebRTC + señalización torrent) se valida jugando.
 */

/** Acción fake: registra los envíos y permite disparar onMessage. */
interface RecordedAction<T> extends TrysteroAction<T> {
  readonly sends: Array<{ data: T; options?: ActionSendOptions }>;
}

/** Doble de la room de Trystero: mismo subconjunto estructural que usa el cliente. */
class FakeTrysteroRoom implements TrysteroRoom {
  onPeerJoin: ((peerId: string) => void) | null = null;
  onPeerLeave: ((peerId: string) => void) | null = null;
  /** Peers "conectados" (lo que devolvería getPeers de Trystero). */
  peers: Record<string, unknown> = {};
  left = false;
  readonly calls: Array<{ appId: string; roomId: string }> = [];
  private readonly actions = new Map<string, RecordedAction<never>>();

  makeAction<T>(namespace: string): TrysteroAction<T> {
    const existing = this.actions.get(namespace);
    if (existing) {
      return existing as unknown as TrysteroAction<T>;
    }
    const action: RecordedAction<never> = {
      sends: [],
      send: ((data: never, options?: ActionSendOptions) => {
        action.sends.push({ data, options });
      }) as never,
      onMessage: null,
    };
    this.actions.set(namespace, action);
    return action as unknown as TrysteroAction<T>;
  }

  /** Acción grabada por namespace (para inspeccionar sends/disparar onMessage). */
  recorded<T>(namespace: string): RecordedAction<T> {
    return this.actions.get(namespace) as unknown as RecordedAction<T>;
  }

  getPeers(): Readonly<Record<string, unknown>> {
    return this.peers;
  }

  leave(): void {
    this.left = true;
  }

  /** Simula la conexión de un peer remoto (dispara onPeerJoin local). */
  connectPeer(peerId: string): void {
    this.peers[peerId] = {};
    this.onPeerJoin?.(peerId);
  }

  /** Simula la desconexión de un peer remoto (dispara onPeerLeave local). */
  disconnectPeer(peerId: string): void {
    delete this.peers[peerId];
    this.onPeerLeave?.(peerId);
  }

  /** Entrega un mensaje de acción como si viniera de un peer remoto. */
  receive<T>(namespace: string, data: T, from: string): void {
    const action = this.recorded<T>(namespace);
    action.onMessage?.(data, { peerId: from });
  }
}

/**
 * Crea un cliente con roomFactory fake; `room()` resuelve a la ÚLTIMA room
 * creada (acceso DIFERIDO: solo existe después de create/join).
 *
 * La ventana de asentamiento (JOIN_SETTLE_MS) se inyecta como cola manual:
 * `fireSettle()` la vence sin esperar tiempo real, y `settleWindows` registra
 * cada programación (para assertar la constante y el orden).
 */
function createClientFixture(selfPeerId: string): {
  client: TrysteroNetClient;
  room(): FakeTrysteroRoom;
  /** TODAS las rooms creadas por el factory (en orden). */
  allRooms(): FakeTrysteroRoom[];
  /** Vence TODAS las ventanas de asentamiento pendientes (timer inyectado). */
  fireSettle(): void;
  /** Una entrada por ventana programada: los ms pedidos y si ya venció. */
  readonly settleWindows: Array<{ ms: number; fired: boolean }>;
} {
  let latest: FakeTrysteroRoom | null = null;
  const rooms: FakeTrysteroRoom[] = [];
  const pending: Array<() => void> = [];
  const settleWindows: Array<{ ms: number; fired: boolean }> = [];
  const client = new TrysteroNetClient({
    roomFactory: (appId: string, roomId: string) => {
      const room = new FakeTrysteroRoom();
      room.calls.push({ appId, roomId });
      rooms.push(room);
      latest = room;
      return room;
    },
    selfIdProvider: () => selfPeerId,
    wordRng: mulberry32(7),
    settleScheduler: (callback: () => void, ms: number) => {
      const window = { ms, fired: false };
      settleWindows.push(window);
      const fire = () => {
        window.fired = true;
        callback();
      };
      pending.push(fire);
      return () => {
        const index = pending.indexOf(fire);
        if (index >= 0) {
          pending.splice(index, 1);
        }
      };
    },
  });
  return {
    client,
    room(): FakeTrysteroRoom {
      if (!latest) {
        throw new Error('la room no fue creada todavía');
      }
      return latest;
    },
    fireSettle(): void {
      while (pending.length > 0) {
        pending.shift()!();
      }
    },
    allRooms(): FakeTrysteroRoom[] {
      return rooms;
    },
    settleWindows,
  };
}

describe('TrysteroNetClient — creación y join', () => {
  it('create() entra a una sala con palabra del diccionario y meta de creador', () => {
    const net = createClientFixture('self');
    const client = net.client;
    const rosterListener = vi.fn();
    client.onRosterChange(rosterListener);

    client.create({ appId: 'app-formulita', name: 'Ana' });

    expect(net.room().calls.length).toBe(1);
    expect(net.room().calls[0].appId).toBe('app-formulita');
    expect(ROOM_WORDS).toContain(net.room().calls[0].roomId);
    expect(client.roomWord).toBe(net.room().calls[0].roomId);
    // Roster inicial: solo yo, y soy el anfitrión (creador).
    expect(client.getRoster()).toEqual([
      { peerId: 'self', name: 'Ana', color: MULTIPLAYER.palette[0] },
    ]);
    expect(client.getHostPeerId()).toBe('self');
    expect(client.isHost()).toBe(true);
    expect(rosterListener).toHaveBeenCalled();
  });

  it('join() con palabra inválida emite error y no toca la red', () => {
    let factoryCalled = false;
    const client = new TrysteroNetClient({
      roomFactory: () => {
        factoryCalled = true;
        throw new Error('no debería llamarse');
      },
      selfIdProvider: () => 'self',
    });
    const onError = vi.fn();
    client.onError(onError);

    client.join({ appId: 'app', roomWord: 'NO VALIDA!', name: 'Ana' });

    expect(factoryCalled).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0][0])).toContain('inválida');
  });

  it('join() entra con meta de no-creador y roster inicial propio', () => {
    const net = createClientFixture('joiner');
    const client = net.client;
    client.join({ appId: 'app', roomWord: 'PARRILLA', name: 'Beto' });

    expect(client.roomWord).toBe('PARRILLA');
    expect(net.room().calls[0].roomId).toBe('PARRILLA');
    expect(client.getRoster().length).toBe(1);
    expect(client.getRoster()[0].name).toBe('Beto');
  });

  it('name vacío → error sin tocar la red', () => {
    let factoryCalled = false;
    const client = new TrysteroNetClient({
      roomFactory: () => {
        factoryCalled = true;
        throw new Error('no debería llamarse');
      },
      selfIdProvider: () => 'self',
    });
    const onError = vi.fn();
    client.onError(onError);

    client.create({ appId: 'app', name: '   ' });
    client.join({ appId: 'app', roomWord: 'PARRILLA', name: '' });

    expect(factoryCalled).toBe(false);
    expect(onError).toHaveBeenCalledTimes(2);
  });
});

describe('TrysteroNetClient — roster y meta', () => {
  it('onPeerJoin envía la meta propia al nuevo peer (patrón Trystero)', () => {
    const net = createClientFixture('self');
    const client = net.client;
    client.create({ appId: 'app', name: 'Ana' });
    net.fireSettle(); // ventana de colisión vencida: la sala es suya

    net.room().connectPeer('remoto');

    const metaSends = net.room().recorded<PeerMeta>('meta').sends;
    expect(metaSends.length).toBe(1);
    expect(metaSends[0].data).toEqual({ name: 'Ana', color: 0, isCreator: true });
    expect(metaSends[0].options?.target).toBe('remoto');
  });

  it('la meta recibida completa el roster, con colores derivados y anfitrión', () => {
    const net = createClientFixture('self');
    const client = net.client;
    const onRoster = vi.fn();
    client.onRosterChange(onRoster);
    client.create({ appId: 'app', name: 'Ana' });
    net.fireSettle(); // ventana de colisión vencida: la sala es suya

    net.room().connectPeer('zz-remoto');
    net.room().receive<PeerMeta>('meta', { name: 'Beto', color: 0, isCreator: false }, 'zz-remoto');

    // Colores por peerId ORDENADO: 'self' < 'zz-remoto'.
    expect(client.getRoster()).toEqual([
      { peerId: 'self', name: 'Ana', color: MULTIPLAYER.palette[0] },
      { peerId: 'zz-remoto', name: 'Beto', color: MULTIPLAYER.palette[1] },
    ]);
    expect(client.isHost()).toBe(true); // el creador sigue
    expect(onRoster).toHaveBeenCalled();
  });

  it('el nombre de la meta recibida se sanitiza al leerla', () => {
    const net = createClientFixture('self');
    const client = net.client;
    client.create({ appId: 'app', name: 'Ana' });
    net.fireSettle(); // ventana de colisión vencida: la sala es suya
    net.room().connectPeer('r2');
    net.room().receive<PeerMeta>('meta', { name: '  Nombre   Larguísimo  ', color: 0, isCreator: false }, 'r2');

    const beto = client.getRoster().find((p) => p.peerId === 'r2');
    expect(beto?.name).toBe('Nombre Largu'); // colapsado + recortado a 12
  });

  it('migración de anfitrión: al irse el creador, manda el peerId menor', () => {
    const net = createClientFixture('mm-self');
    const client = net.client;
    const onHostChange = vi.fn();
    client.onHostChange(onHostChange);
    client.join({ appId: 'app', roomWord: 'PARRILLA', name: 'Yo' });

    // Un creador remoto y otro peer más chico que yo.
    net.room().connectPeer('aa-creator');
    net.room().receive<PeerMeta>('meta', { name: 'Host', color: 0, isCreator: true }, 'aa-creator');
    net.room().connectPeer('bb-peer');
    net.room().receive<PeerMeta>('meta', { name: 'Tercero', color: 0, isCreator: false }, 'bb-peer');

    expect(client.getHostPeerId()).toBe('aa-creator');
    expect(client.isHost()).toBe(false);

    // El creador se va → anfitrión = peerId menor entre los presentes ('bb-peer').
    net.room().disconnectPeer('aa-creator');
    expect(client.getHostPeerId()).toBe('bb-peer');
    expect(onHostChange).toHaveBeenLastCalledWith('bb-peer');
  });

  it('un peer sin meta aún no aparece en el roster (hasta anunciarla)', () => {
    const net = createClientFixture('self');
    const client = net.client;
    client.create({ appId: 'app', name: 'Ana' });
    net.fireSettle(); // ventana de colisión vencida: la sala es suya
    net.room().connectPeer('mudo');

    expect(client.getRoster().length).toBe(1);
  });
});

describe('TrysteroNetClient — capacidad (ventana de asentamiento)', () => {
  it('al entrar se programa UNA ventana de asentamiento de JOIN_SETTLE_MS', () => {
    const net = createClientFixture('joiner');
    net.client.join({ appId: 'app', roomWord: 'PARRILLA', name: 'J' });

    expect(net.settleWindows.length).toBe(1);
    expect(net.settleWindows[0].ms).toBe(JOIN_SETTLE_MS);
    expect(net.settleWindows[0].fired).toBe(false);
  });

  it('(a) sala con 10 exactos: el 11º se asienta, ve 10 peers y se va solo con roomFull', () => {
    const net = createClientFixture('once');
    const client = net.client;
    const onRoomFull = vi.fn();
    client.onRoomFull(onRoomFull);
    client.join({ appId: 'app', roomWord: 'PARRILLA', name: 'Once' });

    // Descubrimiento progresivo de los 10 residentes (cada conexión dispara
    // onPeerJoin en el joiner también — patrón Trystero).
    for (let i = 0; i < MULTIPLAYER.maxPlayers; i += 1) {
      net.room().connectPeer(`p${i}`);
    }

    // Con el 10º peer visto (11 contándose) anticipa el fallo SIN timer.
    expect(onRoomFull).toHaveBeenCalledTimes(1);
    expect(net.room().left).toBe(true);
    expect(client.roomWord).toBeNull();
    expect(net.settleWindows[0].fired).toBe(false); // anticipado, no vencido
  });

  it('(a-timer) el vencimiento de la ventana también expulsa al que está de más', () => {
    const net = createClientFixture('once');
    const client = net.client;
    const onRoomFull = vi.fn();
    client.onRoomFull(onRoomFull);
    client.join({ appId: 'app', roomWord: 'PARRILLA', name: 'Once' });

    // 10 peers PRESENTES sin disparar onPeerJoin (la anticipación no corre):
    // solo el vencimiento de la ventana decide la admisión.
    for (let i = 0; i < MULTIPLAYER.maxPlayers; i += 1) {
      net.room().peers[`p${i}`] = {};
    }
    net.fireSettle();

    expect(onRoomFull).toHaveBeenCalledTimes(1);
    expect(net.room().left).toBe(true);
    expect(client.roomWord).toBeNull();
  });

  it('(b) un joiner RESIDENTE permanece cuando entra el 11º (no implosión)', () => {
    // Este es el bug de la auditoría: los residentes veían 10 peers + ellos
    // mismos = 11 y se auto-expulsaban en cadena al conectar el 11º.
    const net = createClientFixture('residente');
    const client = net.client;
    const onRoomFull = vi.fn();
    client.onRoomFull(onRoomFull);
    client.join({ appId: 'app', roomWord: 'PARRILLA', name: 'Residente' });

    // Era el #10 legítimo (9 residentes + él): ventana vencida → admitido.
    for (let i = 0; i < MULTIPLAYER.maxPlayers - 1; i += 1) {
      net.room().connectPeer(`p${i}`);
    }
    net.fireSettle();
    expect(onRoomFull).not.toHaveBeenCalled();

    // Entra el 11º (el joiner residente lo descubre): se queda, pase lo que
    // pase con el contador de capacidad. El que se va solo es el 11º (que
    // evalúa SU propia admisión en su propia ventana).
    net.room().connectPeer('p9');
    expect(onRoomFull).not.toHaveBeenCalled();
    expect(net.room().left).toBe(false);
    expect(client.roomWord).toBe('PARRILLA');
  });

  it('(c) joiner #10 legítimo con 9 peers: admitido al vencer la ventana', () => {
    const net = createClientFixture('diez');
    const client = net.client;
    const onRoomFull = vi.fn();
    client.onRoomFull(onRoomFull);
    client.join({ appId: 'app', roomWord: 'PARRILLA', name: 'Diez' });

    for (let i = 0; i < MULTIPLAYER.maxPlayers - 1; i += 1) {
      net.room().connectPeer(`p${i}`);
    }
    net.fireSettle(); // 9 peers + yo = 10: cabe justo

    expect(onRoomFull).not.toHaveBeenCalled();
    expect(net.room().left).toBe(false);
    expect(net.settleWindows[0].fired).toBe(true);
    // 9 peers remotos + yo = 10 conectados.
    expect(Object.keys(net.room().getPeers()).length + 1).toBe(MULTIPLAYER.maxPlayers);
  });

  it('el creador NUNCA se auto-rechaza por capacidad (la sala es suya)', () => {
    const net = createClientFixture('creator');
    const client = net.client;
    const onRoomFull = vi.fn();
    client.onRoomFull(onRoomFull);
    client.create({ appId: 'app', name: 'Host' });
    net.fireSettle(); // ventana de colisión vencida: la sala es suya

    for (let i = 0; i < MULTIPLAYER.maxPlayers; i += 1) {
      net.room().connectPeer(`p${i}`);
    }

    expect(onRoomFull).not.toHaveBeenCalled();
    expect(net.room().left).toBe(false);
  });

  it('leave() cancela la ventana pendiente (el timer vencido ya no decide nada)', () => {
    const net = createClientFixture('joiner');
    const client = net.client;
    client.join({ appId: 'app', roomWord: 'PARRILLA', name: 'J' });

    client.leave();
    net.fireSettle(); // no debe re-entrar ni emitir nada post-leave

    expect(client.roomWord).toBeNull();
    expect(client.getRoster()).toEqual([]);
  });
});

describe('TrysteroNetClient — colisión de palabra (creador, plan §4)', () => {
  it('un peer durante la ventana ⇒ regenera palabra y sala nuevas', () => {
    const net = createClientFixture('creador');
    const client = net.client;
    client.create({ appId: 'app', name: 'Ana' });
    const firstRoom = net.room();
    const firstWord = firstRoom.calls[0].roomId;

    // Un peer aparece antes de que el creador haya compartido la palabra:
    // colisión (otra sala usó la misma palabra), no un invitado.
    firstRoom.connectPeer('intruso');

    expect(net.allRooms().length).toBe(2); // sala regenerada
    const secondWord = net.room().calls[0].roomId;
    expect(secondWord).not.toBe(firstWord);
    expect(ROOM_WORDS).toContain(secondWord);
    expect(client.roomWord).toBe(secondWord);
    expect(firstRoom.left).toBe(true); // la sala colisionada quedó abandonada
    // El roster es el de la sala nueva: solo el creador.
    expect(client.getRoster()).toEqual([
      { peerId: 'creador', name: 'Ana', color: MULTIPLAYER.palette[0] },
    ]);
  });

  it('tras MAX_WORD_REGEN_ATTEMPTS colisiones consecutivas se queda (tope anti-bucle)', () => {
    const net = createClientFixture('creador');
    const client = net.client;
    client.create({ appId: 'app', name: 'Ana' });

    // Cada sala nueva colisiona igual (un peer aparece en cada ventana).
    for (let i = 0; i < MAX_WORD_REGEN_ATTEMPTS; i += 1) {
      net.room().connectPeer('intruso');
    }
    expect(net.allRooms().length).toBe(1 + MAX_WORD_REGEN_ATTEMPTS);

    // Tope agotado: la siguiente sala NO se regenera aunque aparezcan peers.
    const lastRoom = net.room();
    const lastWord = lastRoom.calls[0].roomId;
    lastRoom.connectPeer('otro-intruso');
    expect(net.allRooms().length).toBe(1 + MAX_WORD_REGEN_ATTEMPTS);
    expect(client.roomWord).toBe(lastWord);
    expect(lastRoom.left).toBe(false);
  });
});

describe('TrysteroNetClient — start', () => {
  const payload: StartPayload = {
    seed: 424242,
    players: [
      { peerId: 'host', name: 'Ana', color: 1 },
      { peerId: 'guest', name: 'Beto', color: 2 },
    ],
    startAt: 1700000000000,
  };

  it('el anfitrión difunde start tal cual', () => {
    const net = createClientFixture('host');
    const client = net.client;
    client.create({ appId: 'app', name: 'Ana' });

    client.start(payload);

    expect(net.room().recorded<StartPayload>('start').sends).toEqual([{ data: payload, options: undefined }]);
  });

  it('un no-anfitrión no puede difundir start (error, sin envío)', () => {
    const net = createClientFixture('guest');
    const client = net.client;
    const onError = vi.fn();
    client.onError(onError);
    client.join({ appId: 'app', roomWord: 'PARRILLA', name: 'Beto' });

    // El creador está presente (meta recibida): el joiner NO es anfitrión.
    net.room().connectPeer('aa-host');
    net.room().receive<PeerMeta>('meta', { name: 'Ana', color: 0, isCreator: true }, 'aa-host');
    expect(client.isHost()).toBe(false);

    client.start(payload);

    expect(net.room().recorded<StartPayload>('start').sends).toEqual([]);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('onStart se dispara al recibir la acción de un peer remoto', () => {
    const net = createClientFixture('guest');
    const client = net.client;
    const onStart = vi.fn();
    client.onStart(onStart);
    client.join({ appId: 'app', roomWord: 'PARRILLA', name: 'Beto' });

    net.room().receive<StartPayload>('start', payload, 'host-remoto');

    expect(onStart).toHaveBeenCalledWith(payload);
  });
});

describe('TrysteroNetClient — chat de sala (C1)', () => {
  it('sendChat difunde la acción chat con el payload YA sanitizado', () => {
    const net = createClientFixture('self');
    net.client.create({ appId: 'app', name: 'Ana' });

    net.client.sendChat('  hola\n  sala   de   juego  ');

    expect(net.room().recorded<ChatPayload>('chat').sends).toEqual([
      { data: { text: 'hola sala de juego' }, options: undefined },
    ]);
  });

  it('sendChat recorta a CHAT_MAX_LEN antes de viajar (wire acotado)', () => {
    const net = createClientFixture('self');
    net.client.create({ appId: 'app', name: 'Ana' });

    net.client.sendChat('y'.repeat(CHAT_MAX_LEN + 500));

    const sends = net.room().recorded<ChatPayload>('chat').sends;
    expect(sends).toHaveLength(1);
    expect(sends[0]?.data.text.length).toBe(CHAT_MAX_LEN);
  });

  it('sendChat sin sala activa → error visible y sin envío', () => {
    const client = new TrysteroNetClient({
      roomFactory: () => {
        throw new Error('no debería llamarse');
      },
      selfIdProvider: () => 'self',
    });
    const onError = vi.fn();
    client.onError(onError);

    client.sendChat('hola');

    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0][0])).toContain('No hay sala activa');
  });

  it('onChat cablea el listener de la acción chat (mismo patrón que las demás)', () => {
    const net = createClientFixture('self');
    net.client.create({ appId: 'app', name: 'Ana' });
    const onChat = vi.fn();
    net.client.onChat(onChat);

    net.room().receive<ChatPayload>('chat', { text: 'llegó' }, 'peer-9');

    expect(onChat).toHaveBeenCalledTimes(1);
    expect(onChat).toHaveBeenCalledWith('peer-9', { text: 'llegó' });
  });

  it('desuscripción y leave: el chat muere con la sala (acciones limpias)', () => {
    const net = createClientFixture('self');
    const client = net.client;
    client.create({ appId: 'app', name: 'Ana' });
    const onChat = vi.fn();
    const unsubscribe = client.onChat(onChat);

    unsubscribe();
    net.room().receive<ChatPayload>('chat', { text: 'x' }, 'peer-9');
    expect(onChat).not.toHaveBeenCalled();

    client.leave();
    const onError = vi.fn();
    client.onError(onError);
    client.sendChat('tras leave');
    expect(onError).toHaveBeenCalledTimes(1); // no hay acción viva tras leave
  });
});

describe('TrysteroNetClient — lifecycle', () => {
  it('leave() suelta la room (handlers nulos, meta limpia, idempotente)', () => {
    const net = createClientFixture('self');
    const client = net.client;
    client.create({ appId: 'app', name: 'Ana' });

    client.leave();
    client.leave(); // idempotente

    expect(net.room().left).toBe(true);
    expect(net.room().onPeerJoin).toBeNull();
    expect(net.room().onPeerLeave).toBeNull();
    expect(client.roomWord).toBeNull();
    expect(client.getRoster()).toEqual([]);
  });

  it('destroy() además apaga todos los handlers', () => {
    const net = createClientFixture('self');
    const client = net.client;
    const onStart = vi.fn();
    client.onStart(onStart);
    client.create({ appId: 'app', name: 'Ana' });

    client.destroy();
    net.room().receive<StartPayload>('start', { seed: 1, players: [], startAt: 0 }, 'x');

    expect(onStart).not.toHaveBeenCalled();
  });

  it('la factory que lanza se reporta como error sin romper el cliente', () => {
    const client = new TrysteroNetClient({
      roomFactory: () => {
        throw new Error('booom');
      },
      selfIdProvider: () => 'self',
    });
    const onError = vi.fn();
    client.onError(onError);

    client.create({ appId: 'app', name: 'Ana' });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0][0])).toContain('booom');
    expect(client.roomWord).toBeNull();
  });
});

describe('TrysteroNetClient — resolveAppId (fail-fast)', () => {
  it('sin VITE_TRYSTERO_APP_ID lanza el error claro', () => {
    expect(() => resolveAppId({})).toThrowError(/falta VITE_TRYSTERO_APP_ID/);
    expect(() => resolveAppId({ VITE_TRYSTERO_APP_ID: '' })).toThrowError(/falta/);
    expect(() => resolveAppId({ VITE_TRYSTERO_APP_ID: '   ' })).toThrowError(/falta/);
  });

  it('con la variable definida la devuelve recortada', () => {
    expect(resolveAppId({ VITE_TRYSTERO_APP_ID: 'formulita-dev' })).toBe('formulita-dev');
    expect(resolveAppId({ VITE_TRYSTERO_APP_ID: '  con-espacios  ' })).toBe('con-espacios');
  });

  it('lee import.meta.env real (vi.stubEnv) y falla rápido sin ella', () => {
    vi.stubEnv('VITE_TRYSTERO_APP_ID', 'stubbed-app');
    expect(resolveAppId()).toBe('stubbed-app');
    vi.unstubAllEnvs();
  });
});
