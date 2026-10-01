import { describe, expect, it, vi } from 'vitest';
import { MULTIPLAYER, PRESENCE_HEARTBEAT_MS, PRESENCE_STALE_MS } from '../config/balance';
import { SOCIAL_ROOM_SUFFIX, socialRoomId, type NetEnvSource } from '../net/appId';
import {
  availablePeersView,
  TrysteroChatClient,
} from '../net/TrysteroChatClient';
import type { RoomFactory, TrysteroAction } from '../net/TrysteroNetClient';
import type { ActionSendOptions } from '../net/TrysteroNetClient';
import type { AvailablePeer, PresenceMeta } from '../net/ChatClient';
import type { PingPayload } from '../net/protocol';
import { FakeTrysteroRoom } from './fakes/FakeTrysteroRoom';

/**
 * Tests del TrysteroChatClient (C2 — sala pública de presencia) con
 * roomFactory FAKE (`fakes/FakeTrysteroRoom`, el mismo doble del NetClient):
 * TODO el protocolo de presencia (join/meta/ping/stale/leave) corre sin red.
 * Los timers (heartbeat + barrido) y el reloj (staleness) son inyectados:
 * los tests los disparan a mano con `fireTimers()` y avanzan `clock`.
 *
 * La integración de DOS CLIENTS usa un `FakeSocialHub` (acá mismo) que
 * conecta las rooms fake entre sí: entrega de acciones dirigida/broadcast,
 * onPeerJoin en ambos extremos y desconexiones educadas/abruptas.
 */

const ENV: NetEnvSource = { VITE_TRYSTERO_APP_ID: 'formulita-test' };
const APP_ID = 'formulita-test';
const SELF: PresenceMeta = { name: 'Ana', color: 0 };

/** Un timer programado por el scheduler inyectado (vencimiento manual). */
interface FakeTimer {
  readonly ms: number;
  fired: boolean;
  canceled: boolean;
  fire(): void;
}

/**
 * Fixture de UN cliente: rooms fake + cola de timers manual + reloj manual.
 * `fireTimers()` vence UNA generación de timers (cada vencimiento re-programa
 * la siguiente, como el re-arme real del cliente).
 */
function createClientFixture(selfPeerId: string, self: PresenceMeta = SELF) {
  const rooms: FakeTrysteroRoom[] = [];
  const factoryCalls: Array<{ appId: string; roomId: string }> = [];
  const pending: FakeTimer[] = [];
  const clock = {
    now: 0,
    advance(ms: number): void {
      clock.now += ms;
    },
  };
  const client = new TrysteroChatClient({
    roomFactory: (appId, roomId) => {
      const room = new FakeTrysteroRoom();
      room.calls.push({ appId, roomId });
      rooms.push(room);
      factoryCalls.push({ appId, roomId });
      return room;
    },
    selfIdProvider: () => selfPeerId,
    env: ENV,
    self,
    scheduler: (callback, ms) => {
      const timer: FakeTimer = {
        ms,
        fired: false,
        canceled: false,
        fire: () => {
          timer.fired = true;
          timer.canceled = true; // un timer vencido no vuelve a vencer
          callback();
        },
      };
      pending.push(timer);
      return () => {
        timer.canceled = true;
      };
    },
    now: () => clock.now,
  });
  return {
    client,
    clock,
    factoryCalls,
    room(): FakeTrysteroRoom {
      const last = rooms[rooms.length - 1];
      if (!last) {
        throw new Error('la room no fue creada todavía');
      }
      return last;
    },
    rooms(): FakeTrysteroRoom[] {
      return rooms;
    },
    /** Vence TODOS los timers pendientes de la generación actual. */
    fireTimers(): void {
      const generation = pending.splice(0);
      for (const timer of generation) {
        if (!timer.canceled) {
          timer.fire();
        }
      }
    },
    /** Timers aún sin vencer (para asertar cadencias/cancelaciones). */
    liveTimers(): FakeTimer[] {
      return pending.filter((timer) => !timer.canceled);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Hub de integración: dos rooms fake conectadas                       */
/* ------------------------------------------------------------------ */

/** Room fake enchufada al hub: sus envíos se enrutan a los demás miembros. */
class HubRoom extends FakeTrysteroRoom {
  constructor(
    private readonly hub: FakeSocialHub,
    private readonly ownPeerId: string,
  ) {
    super();
  }

  override makeAction<T>(namespace: string): TrysteroAction<T> {
    const action = super.makeAction<T>(namespace);
    const baseSend = action.send.bind(action);
    action.send = (data: T, options?: ActionSendOptions) => {
      baseSend(data, options);
      // El hub modela envío dirigido a UN peer (lo único que usan los
      // clientes): target no-string cuenta como broadcast.
      const target = options?.target ?? null;
      this.hub.route(this.ownPeerId, namespace, data, typeof target === 'string' ? target : null);
    };
    return action;
  }

  override leave(): void {
    super.leave();
    this.hub.disconnect(this.ownPeerId); // leave educado: los demás se enteran
  }
}

/**
 * La "red social" en memoria: rooms por roomId, entrega de acciones entre
 * miembros (broadcast o dirigida), onPeerJoin en AMBOS extremos de cada
 * conexión nueva (semántica Trystero) y dos formas de irse:
 * `disconnect` (educada, dispara onPeerLeave) y `drop` (abrupta, nadie se
 * entera — la cubre el stale).
 *
 * ASENTAMIENTO: en Trystero la malla se descubre ASÍNCRONA después de que
 * `joinRoom` vuelve y el cliente cableó sus handlers — nunca adentro de la
 * propia factory. El hub modela eso: la factory solo REGISTRA al miembro
 * (para que el routing de acciones ya funcione) y encola el aviso mutuo de
 * join; `settle()` lo dispara cuando el cliente ya está cableado.
 */
class FakeSocialHub {
  private readonly rooms = new Map<string, Map<string, HubRoom>>();
  private readonly roomOf = new Map<string, { roomId: string; room: HubRoom }>();
  private readonly pendingJoins: Array<{ roomId: string; peerId: string }> = [];

  factoryFor(peerId: string): RoomFactory {
    return (_appId, roomId) => {
      const room = new HubRoom(this, peerId);
      let members = this.rooms.get(roomId);
      if (!members) {
        members = new Map();
        this.rooms.set(roomId, members);
      }
      members.set(peerId, room);
      this.roomOf.set(peerId, { roomId, room });
      this.pendingJoins.push({ roomId, peerId });
      return room;
    };
  }

  /** Dispara los joins pendientes: onPeerJoin en AMBOS extremos, en orden. */
  settle(): void {
    const joins = this.pendingJoins.splice(0);
    for (const { roomId, peerId } of joins) {
      const members = this.rooms.get(roomId);
      if (!members) {
        continue;
      }
      for (const [existingPeerId, existingRoom] of members) {
        if (existingPeerId === peerId) {
          continue;
        }
        existingRoom.connectPeer(peerId); // el residente ve llegar al nuevo
        members.get(peerId)?.connectPeer(existingPeerId); // el nuevo ve al residente
      }
    }
  }

  /** Entrega una acción de `from` a los demás miembros de su sala. */
  route(from: string, namespace: string, data: unknown, target: string | null): void {
    const entry = this.roomOf.get(from);
    if (!entry) {
      return;
    }
    const members = this.rooms.get(entry.roomId);
    if (!members) {
      return;
    }
    for (const [peerId, room] of members) {
      if (peerId === from) {
        continue; // Trystero no echa las acciones al emisor
      }
      if (target !== null && peerId !== target) {
        continue;
      }
      room.receive(namespace, data, from);
    }
  }

  /** Salida EDUCADA (leave): los demás reciben onPeerLeave. */
  disconnect(peerId: string): void {
    const entry = this.roomOf.get(peerId);
    if (!entry) {
      return;
    }
    const members = this.rooms.get(entry.roomId);
    members?.delete(peerId);
    this.roomOf.delete(peerId);
    if (members) {
      for (const [, room] of members) {
        room.disconnectPeer(peerId);
      }
    }
  }

  /** Salida ABRUPTA (pestaña muerta): nadie recibe onPeerLeave. */
  drop(peerId: string): void {
    const entry = this.roomOf.get(peerId);
    if (!entry) {
      return;
    }
    this.rooms.get(entry.roomId)?.delete(peerId);
    this.roomOf.delete(peerId);
  }
}

/** Fixture de integración: dos clientes sobre un mismo hub/reloj/cola. */
function createTwoClientFixture() {
  const hub = new FakeSocialHub();
  const pending: FakeTimer[] = [];
  const clock = {
    now: 0,
    advance(ms: number): void {
      clock.now += ms;
    },
  };
  const makeOptions = (peerId: string, self: PresenceMeta) => ({
    roomFactory: hub.factoryFor(peerId),
    selfIdProvider: () => peerId,
    env: ENV,
    self,
    scheduler: (callback: () => void, ms: number) => {
      const timer: FakeTimer = {
        ms,
        fired: false,
        canceled: false,
        fire: () => {
          timer.fired = true;
          timer.canceled = true;
          callback();
        },
      };
      pending.push(timer);
      return () => {
        timer.canceled = true;
      };
    },
    now: () => clock.now,
  });
  return {
    hub,
    clock,
    makeClient(peerId: string, self: PresenceMeta): TrysteroChatClient {
      return new TrysteroChatClient(makeOptions(peerId, self));
    },
    /** Asienta la malla: dispara los onPeerJoin pendientes de ambos lados. */
    settle(): void {
      hub.settle();
    },
    fireTimers(): void {
      const generation = pending.splice(0);
      for (const timer of generation) {
        if (!timer.canceled) {
          timer.fire();
        }
      }
    },
  };
}

/** Un peer disponible con defaults (para aserciones legibles). */
function peer(partial: Partial<AvailablePeer>): AvailablePeer {
  return { peerId: 'p', name: 'P', color: 0, ...partial };
}

describe('TrysteroChatClient — privacidad by default', () => {
  it('sin setAvailable(true) NUNCA llama a la factory ni programa timers', () => {
    const net = createClientFixture('yo');
    expect(net.factoryCalls).toEqual([]);
    expect(net.liveTimers()).toEqual([]);
    expect(net.client.isAvailable()).toBe(false);
    expect(net.client.getAvailablePeers()).toEqual([]);
  });

  it('sin VITE_TRYSTERO_APP_ID: fail-fast con error visible y sin conexión', () => {
    let factoryCalled = false;
    const client = new TrysteroChatClient({
      roomFactory: () => {
        factoryCalled = true;
        throw new Error('no debería llamarse');
      },
      selfIdProvider: () => 'yo',
      env: {},
    });
    const onError = vi.fn();
    client.onError(onError);

    client.setAvailable(true);

    expect(factoryCalled).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0][0])).toMatch(/falta VITE_TRYSTERO_APP_ID/);
    expect(client.isAvailable()).toBe(false);
  });
});

describe('TrysteroChatClient — sala pública y meta', () => {
  it('setAvailable(true) hace join a `${appId}-social` con el appId del env', () => {
    const net = createClientFixture('yo');
    net.client.setAvailable(true);

    expect(net.factoryCalls).toEqual([{ appId: APP_ID, roomId: `${APP_ID}${SOCIAL_ROOM_SUFFIX}` }]);
    expect(net.client.isAvailable()).toBe(true);
  });

  it('socialRoomId deriva SIEMPRE del mismo helper (appId + sufijo)', () => {
    expect(SOCIAL_ROOM_SUFFIX).toBe('-social');
    expect(socialRoomId('mi-app')).toBe('mi-app-social');
  });

  it('al conectar un peer le envía MI meta DIRIGIDA (patrón Trystero)', () => {
    const net = createClientFixture('yo');
    net.client.setAvailable(true);

    net.room().connectPeer('zz-remoto');

    const sends = net.room().recorded<PresenceMeta>('meta').sends;
    expect(sends).toEqual([{ data: SELF, options: { target: 'zz-remoto' } }]);
  });

  it('la meta recibida agrega al peer a la lista en vivo SIN incluirme', () => {
    const net = createClientFixture('yo');
    const onPeers = vi.fn();
    net.client.onAvailablePeers(onPeers);
    net.client.setAvailable(true);

    net.room().connectPeer('zz-remoto');
    net.room().receive<PresenceMeta>('meta', { name: 'Beto', color: 0 }, 'zz-remoto');

    // Colores derivados del conjunto ORDENADO {yo, zz-remoto}: yo = palette[0],
    // zz-remoto = palette[1] (misma regla que assignColors del lobby).
    expect(net.client.getAvailablePeers()).toEqual([
      peer({ peerId: 'zz-remoto', name: 'Beto', color: MULTIPLAYER.palette[1] }),
    ]);
    expect(onPeers).toHaveBeenLastCalledWith(net.client.getAvailablePeers());
  });

  it('el nombre de la meta recibida se sanitiza al leerla', () => {
    const net = createClientFixture('yo');
    net.client.setAvailable(true);
    net.room().connectPeer('zz-remoto');

    net.room().receive<PresenceMeta>('meta', { name: '  Nombre   Larguísimo  ', color: 0 }, 'zz-remoto');

    expect(net.client.getAvailablePeers()[0]?.name).toBe('Nombre Largu');
  });

  it('el eco de MI PROPIA meta no me agrega a mi lista', () => {
    const net = createClientFixture('yo');
    net.client.setAvailable(true);

    net.room().receive<PresenceMeta>('meta', { name: 'Yo Mismo', color: 0 }, 'yo');

    expect(net.client.getAvailablePeers()).toEqual([]);
  });

  it('un peer sin meta todavía NO aparece (hasta anunciarla)', () => {
    const net = createClientFixture('yo');
    net.client.setAvailable(true);
    net.room().connectPeer('mudo');
    expect(net.client.getAvailablePeers()).toEqual([]);
  });

  it('updateSelf re-anuncia la identidad nueva a los peers conocidos', () => {
    const net = createClientFixture('yo');
    net.client.setAvailable(true);
    net.room().connectPeer('zz-remoto');
    net.room().receive<PresenceMeta>('meta', { name: 'Beto', color: 0 }, 'zz-remoto');

    net.client.updateSelf({ name: 'Ana Renombrada', color: 3 });

    const sends = net.room().recorded<PresenceMeta>('meta').sends;
    expect(sends[sends.length - 1]).toEqual({
      data: { name: 'Ana Renombrada', color: 3 },
      options: { target: 'zz-remoto' },
    });
  });

  it('idempotente: setAvailable(true) dos veces hace UN solo join', () => {
    const net = createClientFixture('yo');
    net.client.setAvailable(true);
    net.client.setAvailable(true);

    expect(net.factoryCalls).toHaveLength(1);
    expect(net.rooms()).toHaveLength(1);
    expect(net.room().left).toBe(false);
  });
});

describe('TrysteroChatClient — heartbeat', () => {
  it('al volver disponible programa heartbeat y barrido de PRESENCE_HEARTBEAT_MS', () => {
    const net = createClientFixture('yo');
    net.client.setAvailable(true);

    const cadences = net.liveTimers().map((timer) => timer.ms).sort();
    expect(cadences).toEqual([PRESENCE_HEARTBEAT_MS, PRESENCE_HEARTBEAT_MS]);
  });

  it('cada vencimiento emite un ping {} en broadcast', () => {
    const net = createClientFixture('yo');
    net.client.setAvailable(true);

    net.fireTimers(); // 5 s
    net.fireTimers(); // 10 s

    const sends = net.room().recorded<PingPayload>('ping').sends;
    expect(sends).toEqual([
      { data: {}, options: undefined },
      { data: {}, options: undefined },
    ]);
  });

  it('setAvailable(false) corta el heartbeat (no hay pings tras apagarse)', () => {
    const net = createClientFixture('yo');
    net.client.setAvailable(true);
    net.fireTimers();
    const pingsAfterFirstBeat = net.room().recorded<PingPayload>('ping').sends.length;
    expect(pingsAfterFirstBeat).toBe(1);

    net.client.setAvailable(false);
    net.fireTimers();
    net.fireTimers();

    expect(net.room().recorded<PingPayload>('ping').sends.length).toBe(1);
  });
});

describe('TrysteroChatClient — stale (desconexión abrupta)', () => {
  it('un peer sin señal por más de PRESENCE_STALE_MS sale de la lista', () => {
    const net = createClientFixture('yo');
    const onPeers = vi.fn();
    net.client.onAvailablePeers(onPeers);
    net.client.setAvailable(true);
    net.room().connectPeer('zz-remoto');
    net.room().receive<PresenceMeta>('meta', { name: 'Beto', color: 0 }, 'zz-remoto');
    expect(net.client.getAvailablePeers()).toHaveLength(1);

    // El peer desaparece sin avisar: pasan 20 s + un barrido.
    net.clock.advance(PRESENCE_STALE_MS + 1);
    net.fireTimers();

    expect(net.client.getAvailablePeers()).toEqual([]);
    expect(onPeers).toHaveBeenLastCalledWith([]);
  });

  it('un peer que SIGUE pineando se mantiene en la lista', () => {
    const net = createClientFixture('yo');
    net.client.setAvailable(true);
    net.room().connectPeer('zz-remoto');
    net.room().receive<PresenceMeta>('meta', { name: 'Beto', color: 0 }, 'zz-remoto');

    // 4 ciclos de heartbeat con el peer pineando cada vez (los pings del
    // remoto refrescan su última señal de vida): 20 s exactos NO es stale
    // (la condición es > PRESENCE_STALE_MS).
    for (let cycle = 0; cycle < 4; cycle += 1) {
      net.clock.advance(PRESENCE_HEARTBEAT_MS);
      net.fireTimers();
      net.room().receive<PingPayload>('ping', {}, 'zz-remoto');
    }
    net.fireTimers();

    expect(net.client.getAvailablePeers()).toHaveLength(1);

    // Deja de pinear: a los 20 s + 1 ms del último ping el barrido lo saca.
    net.clock.advance(PRESENCE_STALE_MS + 1);
    net.fireTimers();
    expect(net.client.getAvailablePeers()).toEqual([]);
  });

  it('onPeerLeave saca al peer de la lista INMEDIATAMENTE (sin esperar stale)', () => {
    const net = createClientFixture('yo');
    net.client.setAvailable(true);
    net.room().connectPeer('zz-remoto');
    net.room().receive<PresenceMeta>('meta', { name: 'Beto', color: 0 }, 'zz-remoto');

    net.room().disconnectPeer('zz-remoto');

    expect(net.client.getAvailablePeers()).toEqual([]);
  });
});

describe('TrysteroChatClient — setAvailable(false) y destroy', () => {
  it('OFF deja la sala de verdad: leave, handlers nulos, roster vacío, lista []', () => {
    const net = createClientFixture('yo');
    const onPeers = vi.fn();
    net.client.onAvailablePeers(onPeers);
    net.client.setAvailable(true);
    net.room().connectPeer('zz-remoto');
    net.room().receive<PresenceMeta>('meta', { name: 'Beto', color: 0 }, 'zz-remoto');

    net.client.setAvailable(false);

    expect(net.room().left).toBe(true);
    expect(net.room().onPeerJoin).toBeNull();
    expect(net.room().onPeerLeave).toBeNull();
    expect(net.client.isAvailable()).toBe(false);
    expect(net.client.getAvailablePeers()).toEqual([]);
    expect(onPeers).toHaveBeenLastCalledWith([]);
    expect(net.liveTimers()).toEqual([]);
  });

  it('OFF sin haber conectado es no-op (nunca rompe)', () => {
    const net = createClientFixture('yo');
    expect(() => {
      net.client.setAvailable(false);
      net.client.setAvailable(false);
    }).not.toThrow();
    expect(net.factoryCalls).toEqual([]);
  });

  it('ON tras OFF reconecta con una room nueva (ciclo completo)', () => {
    const net = createClientFixture('yo');
    net.client.setAvailable(true);
    net.client.setAvailable(false);
    net.client.setAvailable(true);

    expect(net.factoryCalls).toHaveLength(2);
    expect(net.client.isAvailable()).toBe(true);
  });

  it('destroy desconecta y apaga handlers: nada llega tras destruir', () => {
    const net = createClientFixture('yo');
    const onPeers = vi.fn();
    const onError = vi.fn();
    net.client.onAvailablePeers(onPeers);
    net.client.onError(onError);
    net.client.setAvailable(true);

    net.client.destroy();
    // Los handlers vivos pudieron recibir emisiones hasta acá (leave incl.):
    // lo que se aserta es que TRAS destroy no llega NADA más.
    onPeers.mockClear();

    expect(net.room().left).toBe(true);
    net.room().connectPeer('zz-remoto');
    net.room().receive<PresenceMeta>('meta', { name: 'Beto', color: 0 }, 'zz-remoto');
    expect(onPeers).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(net.client.isAvailable()).toBe(false);
  });

  it('la factory que lanza se reporta como error y el cliente queda OFF', () => {
    const client = new TrysteroChatClient({
      roomFactory: () => {
        throw new Error('booom');
      },
      selfIdProvider: () => 'yo',
      env: ENV,
    });
    const onError = vi.fn();
    client.onError(onError);

    client.setAvailable(true);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0][0])).toContain('booom');
    expect(client.isAvailable()).toBe(false);
  });
});

describe('TrysteroChatClient — availablePeersView (colores deterministas)', () => {
  it('incluye MI peerId en el orden pero no en el resultado (consistencia entre clientes)', () => {
    const metas = new Map<string, PresenceMeta>([
      ['zz-beto', { name: 'Beto', color: 0 }],
      ['aa-caro', { name: 'Caro', color: 0 }],
    ]);

    const view = availablePeersView('mm-yo', { name: 'Yo', color: 0 }, metas);

    // Orden por peerId: aa-caro, mm-yo, zz-beto → palette[0], [1], [2].
    expect(view).toEqual([
      peer({ peerId: 'aa-caro', name: 'Caro', color: MULTIPLAYER.palette[0] }),
      peer({ peerId: 'zz-beto', name: 'Beto', color: MULTIPLAYER.palette[2] }),
    ]);
  });
});

describe('TrysteroChatClient — integración dos clientes (hub fake)', () => {
  it('A y B disponibles: la lista de A incluye a B y la de B incluye a A', () => {
    const net = createTwoClientFixture();
    const a = net.makeClient('peer-a', { name: 'Ana', color: 0 });
    const b = net.makeClient('peer-b', { name: 'Beto', color: 0 });
    a.setAvailable(true);
    b.setAvailable(true);
    net.settle(); // la malla se descubre: onPeerJoin mutuo → intercambio de meta

    // Nadie se incluye a sí mismo; los colores derivan del MISMO conjunto
    // {peer-a, peer-b} en ambos clientes (peer-a → palette[0], peer-b → [1]).
    expect(a.getAvailablePeers()).toEqual([
      peer({ peerId: 'peer-b', name: 'Beto', color: MULTIPLAYER.palette[1] }),
    ]);
    expect(b.getAvailablePeers()).toEqual([
      peer({ peerId: 'peer-a', name: 'Ana', color: MULTIPLAYER.palette[0] }),
    ]);
  });

  it('B se esconde (setAvailable(false)) → sale de la lista de A por peerLeave', () => {
    const net = createTwoClientFixture();
    const a = net.makeClient('peer-a', { name: 'Ana', color: 0 });
    const b = net.makeClient('peer-b', { name: 'Beto', color: 0 });
    a.setAvailable(true);
    b.setAvailable(true);
    net.settle();
    expect(a.getAvailablePeers()).toHaveLength(1);

    b.setAvailable(false); // leave educado: A recibe onPeerLeave

    expect(a.getAvailablePeers()).toEqual([]);
    expect(a.isAvailable()).toBe(true); // A sigue disponible
  });

  it('A se desconecta ABRUPTAMENTE → stale lo saca de la lista de B a los 20 s', () => {
    const net = createTwoClientFixture();
    const a = net.makeClient('peer-a', { name: 'Ana', color: 0 });
    const b = net.makeClient('peer-b', { name: 'Beto', color: 0 });
    a.setAvailable(true);
    b.setAvailable(true);
    net.settle();
    expect(b.getAvailablePeers()).toHaveLength(1);

    net.hub.drop('peer-a'); // pestaña muerta: nadie recibe onPeerLeave

    // Ciclos de heartbeat: B sigue pineando y barriendo, A ya no responde.
    net.clock.advance(PRESENCE_HEARTBEAT_MS);
    net.fireTimers();
    expect(b.getAvailablePeers()).toHaveLength(1); // aún dentro de la ventana

    net.clock.advance(PRESENCE_STALE_MS - PRESENCE_HEARTBEAT_MS + 1);
    net.fireTimers();

    expect(b.getAvailablePeers()).toEqual([]); // stale: 20 s sin señal
  });
});
