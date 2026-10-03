import { describe, expect, it, vi } from 'vitest';
import { ChatStore } from '../chat/ChatStore';
import { receiveRoomChat } from '../chat/roomChat';
import { TrysteroChatClient } from '../net/TrysteroChatClient';
import { TrysteroNetClient } from '../net/TrysteroNetClient';
import type { NetEnvSource } from '../net/appId';
import type { AvailablePeer, PresenceMeta } from '../net/ChatClient';
import type {
  ChatPayload,
  DmPayload,
  InvitePayload,
  PeerMeta,
  RaceStatePayload,
} from '../net/protocol';
import {
  parseRaceOverPayload,
  parseRaceStatePayload,
  sanitizeChatText,
  sanitizePlayerName,
} from '../net/protocol';
import { FakeTrysteroRoom } from './fakes/FakeTrysteroRoom';

/**
 * QA T4 del issue #35 — ENDURECIMIENTO de payloads MALFORMADOS del wire.
 *
 * Canales que confiaban en la forma del payload mientras el resto del
 * protocolo es defensivo (parseRaceInit/parseRaceFinishPayload/
 * parseRaceOverPayload sí validan):
 *
 *  1. `rstate`: el receptor (RaceScene) hacía `payload.s` sobre payload
 *     null/undefined → TypeError por mensaje (10 Hz). Nuevo
 *     `parseRaceStatePayload` al estilo de los parse* existentes.
 *  2. `meta`: `sanitizePlayerName(meta.name)` sin guard de forma en AMBOS
 *     clientes — meta null o name no-string lanza y el metas.set no corre
 *     (peer fantasma).
 *  3. `chat`/`dm`: misma raíz (`sanitizeChatText` / `.trim()` sobre
 *     no-string; `payload.text`/`payload.targetPeerId` sobre null).
 *  4. `parseRaceOverPayload`: validaba forma por fila pero aceptaba
 *     posiciones repetidas/huecos y peerIds duplicados.
 *
 * Contrato esperado post-fix: mensaje malformado = DESCARTADO en silencio,
 * sin lanzar, sin ensuciar estado; un mensaje sano del mismo peer sigue
 * procesándose (la sala no se rompe).
 */

/* ------------------------------------------------------------------ */
/* Fixtures (misma forma que trysteroNetClient/trysteroChatClient)     */
/* ------------------------------------------------------------------ */

const ENV: NetEnvSource = { VITE_TRYSTERO_APP_ID: 'formulita-test' };
const SELF: PresenceMeta = { name: 'Ana', color: 0 };

/** Cliente de LOBBY con room fake (sin red, sin timers reales). */
function createNetFixture(selfPeerId: string): {
  client: TrysteroNetClient;
  room(): FakeTrysteroRoom;
} {
  let latest: FakeTrysteroRoom | null = null;
  const client = new TrysteroNetClient({
    roomFactory: () => {
      const room = new FakeTrysteroRoom();
      latest = room;
      return room;
    },
    selfIdProvider: () => selfPeerId,
  });
  return {
    client,
    room(): FakeTrysteroRoom {
      if (!latest) {
        throw new Error('la room no fue creada todavía');
      }
      return latest;
    },
  };
}

/** Cliente de PRESENCIA con room fake + timers en cola manual. */
function createChatFixture(selfPeerId: string): {
  client: TrysteroChatClient;
  room(): FakeTrysteroRoom;
} {
  const rooms: FakeTrysteroRoom[] = [];
  const client = new TrysteroChatClient({
    roomFactory: (_appId, roomId) => {
      const room = new FakeTrysteroRoom();
      room.calls.push({ appId: _appId, roomId });
      rooms.push(room);
      return room;
    },
    selfIdProvider: () => selfPeerId,
    env: ENV,
    self: SELF,
    scheduler: (callback, _ms) => {
      // Los timers (heartbeat/barrido) no vencen en estos tests.
      void callback;
      return () => undefined;
    },
    now: () => 0,
  });
  return {
    client,
    room(): FakeTrysteroRoom {
      const last = rooms[rooms.length - 1];
      if (!last) {
        throw new Error('la room no fue creada todavía');
      }
      return last;
    },
  };
}

/** Fila de standings válida (forma que produce `finalClassification`). */
function standingRow(peerId: string, position: number, status = 'running'): Record<string, unknown> {
  return {
    peerId,
    position,
    status,
    totalMs: status === 'finished' ? 90_000 + position : undefined,
    lap: 3,
    s: 100,
    progress: 0,
  };
}

/* ------------------------------------------------------------------ */
/* 1 — rstate: parseRaceStatePayload                                   */
/* ------------------------------------------------------------------ */

describe('qaT4 — parseRaceStatePayload (rstate malformado no tira TypeError)', () => {
  it('qaT4: un rstate sano se acepta tal cual (la re-normalización de pista sigue en el receptor)', () => {
    const payload: RaceStatePayload = { s: 1234.7, o: -12.2, v: 250.9, lap: 1 };
    expect(parseRaceStatePayload(payload)).toEqual(payload);
  });

  it('qaT4: null / undefined / primitivos → null (hoy el receptor lanzaba TypeError)', () => {
    expect(parseRaceStatePayload(null)).toBeNull();
    expect(parseRaceStatePayload(undefined)).toBeNull();
    expect(parseRaceStatePayload(7)).toBeNull();
    expect(parseRaceStatePayload('junk')).toBeNull();
  });

  it('qaT4: objeto sin los 4 campos numéricos finitos → null (hoy degradaba a 0 silencioso)', () => {
    expect(parseRaceStatePayload({})).toBeNull();
    expect(parseRaceStatePayload({ s: 1, o: 0, lap: 0 })).toBeNull(); // falta v
    expect(parseRaceStatePayload({ s: '100', o: 0, v: 0, lap: 0 })).toBeNull();
    expect(parseRaceStatePayload({ s: Number.NaN, o: 0, v: 0, lap: 0 })).toBeNull();
    expect(parseRaceStatePayload({ s: 1, o: Number.POSITIVE_INFINITY, v: 0, lap: 0 })).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* 2 — meta: guards de forma en ambos clientes                         */
/* ------------------------------------------------------------------ */

describe('qaT4 — meta malformada en el lobby (TrysteroNetClient)', () => {
  it('qaT4: meta null / primitiva / name no-string NO lanza y el peer no entra al roster', () => {
    const net = createNetFixture('self');
    net.client.create({ appId: 'app-formulita', name: 'Ana' });
    const rosterListener = vi.fn();
    net.client.onRosterChange(rosterListener);
    const room = net.room();

    expect(() => room.receive<PeerMeta>('meta', null, 'zz-remoto')).not.toThrow();
    expect(() => room.receive<PeerMeta>('meta', 'Ana', 'zz-remoto')).not.toThrow();
    expect(() => room.receive<PeerMeta>('meta', 42, 'zz-remoto')).not.toThrow();
    expect(() =>
      room.receive<PeerMeta>('meta', { name: 99, color: 0, isCreator: false }, 'zz-remoto'),
    ).not.toThrow();

    // Sin fantasma: el peer malformado no aparece en el roster.
    expect(net.client.getRoster().some((player) => player.peerId === 'zz-remoto')).toBe(false);
    expect(rosterListener).not.toHaveBeenCalled();
  });

  it('qaT4: tras metas malformadas, una meta SANA del mismo peer se procesa normal', () => {
    const net = createNetFixture('self');
    net.client.create({ appId: 'app-formulita', name: 'Ana' });
    const room = net.room();

    room.receive<PeerMeta>('meta', null, 'zz-remoto');
    room.receive<PeerMeta>('meta', { name: 99, color: 0, isCreator: false }, 'zz-remoto');
    room.receive<PeerMeta>('meta', { name: 'Beto', color: 0, isCreator: false }, 'zz-remoto');

    expect(
      net.client.getRoster().some((player) => player.peerId === 'zz-remoto' && player.name === 'Beto'),
    ).toBe(true);
  });
});

describe('qaT4 — meta malformada en la sala pública (TrysteroChatClient)', () => {
  it('qaT4: meta null / name no-string NO lanza y el peer no aparece (lastSeen intacto)', () => {
    const chat = createChatFixture('self');
    chat.client.setAvailable(true);
    const peersListener = vi.fn();
    chat.client.onAvailablePeers(peersListener);
    const room = chat.room();

    expect(() => room.receive<PresenceMeta>('meta', null, 'remoto')).not.toThrow();
    expect(() => room.receive<PresenceMeta>('meta', { name: 5, color: 0 }, 'remoto')).not.toThrow();
    expect(() => room.receive<PresenceMeta>('meta', 'Ana', 'remoto')).not.toThrow();

    const peers = (): AvailablePeer[] => chat.client.getAvailablePeers();
    expect(peers().some((peer) => peer.peerId === 'remoto')).toBe(false);
    expect(peersListener).not.toHaveBeenCalled();

    // El ping solo NO resucita al peer sin meta válida.
    room.receive('ping', {}, 'remoto');
    expect(peers().some((peer) => peer.peerId === 'remoto')).toBe(false);

    // La meta sana posterior lo agrega con normalidad.
    room.receive<PresenceMeta>('meta', { name: 'Beto', color: 0 }, 'remoto');
    expect(peers().some((peer) => peer.peerId === 'remoto' && peer.name === 'Beto')).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* 3 — chat / dm / invite: texto y forma del payload                   */
/* ------------------------------------------------------------------ */

describe('qaT4 — sanitizadores tolerantes a unknown (raíz del .trim())', () => {
  it('qaT4: sanitizePlayerName(null|undefined|number|objeto) → "" sin lanzar', () => {
    expect(sanitizePlayerName(null)).toBe('');
    expect(sanitizePlayerName(undefined)).toBe('');
    expect(sanitizePlayerName(42)).toBe('');
    expect(sanitizePlayerName({ name: 'Ana' })).toBe('');
  });

  it('qaT4: sanitizeChatText(null|undefined|number|objeto) → "" sin lanzar', () => {
    expect(sanitizeChatText(null)).toBe('');
    expect(sanitizeChatText(undefined)).toBe('');
    expect(sanitizeChatText(42)).toBe('');
    expect(sanitizeChatText({ text: 'x' })).toBe('');
  });

  it('qaT4: con strings reales el comportamiento previo se preserva', () => {
    expect(sanitizePlayerName('   Juan    Pérez   ')).toBe('Juan Pérez');
    expect(sanitizeChatText('  hola\n  chat   libre  ')).toBe('hola chat libre');
  });
});

describe('qaT4 — chat malformado (cadena onChat → receiveRoomChat)', () => {
  /** Cableado EXACTO de LobbyScene/GameScene/RaceScene para el chat de sala. */
  function wireLobbyChat(net: ReturnType<typeof createNetFixture>): ChatStore {
    const store = new ChatStore({
      self: { peerId: 'self', name: 'Ana', color: 0 },
      now: () => 0,
    });
    net.client.onChat((fromPeerId, payload) => {
      receiveRoomChat(store, net.client.getRoster(), fromPeerId, payload, 0);
    });
    return store;
  }

  it('qaT4: chat null / primitivo / text no-string NO lanza ni agrega mensajes', () => {
    const net = createNetFixture('self');
    net.client.create({ appId: 'app-formulita', name: 'Ana' });
    const store = wireLobbyChat(net);
    const room = net.room();

    expect(() => room.receive<ChatPayload>('chat', null, 'remoto')).not.toThrow();
    expect(() => room.receive<ChatPayload>('chat', 'junk', 'remoto')).not.toThrow();
    expect(() => room.receive<ChatPayload>('chat', { text: 42 }, 'remoto')).not.toThrow();
    expect(store.getMessages('room')).toEqual([]);

    // El mensaje sano posterior entra al hilo con normalidad.
    room.receive<ChatPayload>('chat', { text: 'hola sala' }, 'remoto');
    expect(store.getMessages('room')).toHaveLength(1);
    expect(store.getMessages('room')[0]?.text).toBe('hola sala');
  });
});

describe('qaT4 — dm malformado (TrysteroChatClient)', () => {
  it('qaT4: dm null / targetPeerId no-string / text no-string NO lanza ni despacha', () => {
    const chat = createChatFixture('self');
    chat.client.setAvailable(true);
    const dmListener = vi.fn();
    chat.client.onDm(dmListener);
    const room = chat.room();

    expect(() => room.receive<DmPayload>('dm', null, 'remoto')).not.toThrow();
    expect(() =>
      room.receive<DmPayload>('dm', { text: 'hola', targetPeerId: 42 }, 'remoto'),
    ).not.toThrow();
    expect(() =>
      room.receive<DmPayload>('dm', { text: 42, targetPeerId: 'self' }, 'remoto'),
    ).not.toThrow();
    expect(dmListener).not.toHaveBeenCalled();

    // El dm sano posterior se despacha con normalidad.
    room.receive<DmPayload>('dm', { text: 'hola', targetPeerId: 'self' }, 'remoto');
    expect(dmListener).toHaveBeenCalledTimes(1);
  });
});

describe('qaT4 — invite malformado (TrysteroChatClient, misma clase de forma)', () => {
  it('qaT4: invite null / keyword no-string NO lanza ni despacha', () => {
    const chat = createChatFixture('self');
    chat.client.setAvailable(true);
    const inviteListener = vi.fn();
    chat.client.onInvite(inviteListener);
    const room = chat.room();

    expect(() => room.receive<InvitePayload>('invite', null, 'remoto')).not.toThrow();
    expect(() => room.receive<InvitePayload>('invite', { keyword: 42 }, 'remoto')).not.toThrow();
    expect(inviteListener).not.toHaveBeenCalled();

    // La invitación sana posterior se despacha con normalidad.
    room.receive<InvitePayload>('invite', { keyword: 'PARRILLA' }, 'remoto');
    expect(inviteListener).toHaveBeenCalledTimes(1);
    expect(inviteListener.mock.calls[0][1]).toEqual({ keyword: 'PARRILLA' });
  });
});

/* ------------------------------------------------------------------ */
/* 4 — race-over: permutación 1..N y peerIds únicos                    */
/* ------------------------------------------------------------------ */

describe('qaT4 — parseRaceOverPayload: posiciones exactamente 1..N y peerIds únicos', () => {
  it('qaT4: posiciones repetidas → null', () => {
    expect(
      parseRaceOverPayload({
        standings: [standingRow('a', 1), standingRow('b', 1)],
      }),
    ).toBeNull();
  });

  it('qaT4: hueco en las posiciones (1, 2, 4 con N=3) → null', () => {
    expect(
      parseRaceOverPayload({
        standings: [standingRow('a', 1), standingRow('b', 2), standingRow('c', 4)],
      }),
    ).toBeNull();
  });

  it('qaT4: posición fuera de rango (mayor que N) → null', () => {
    expect(
      parseRaceOverPayload({
        standings: [standingRow('a', 1), standingRow('b', 3)],
      }),
    ).toBeNull();
    expect(
      parseRaceOverPayload({ standings: [standingRow('a', 2)] }),
    ).toBeNull();
  });

  it('qaT4: peerIds duplicados → null (aunque las posiciones sean 1..N)', () => {
    expect(
      parseRaceOverPayload({
        standings: [standingRow('a', 1), standingRow('a', 2)],
      }),
    ).toBeNull();
  });

  it('qaT4: la permutación completa 1..N en DESORDEN se acepta (round-trip de finalClassification)', () => {
    const parsed = parseRaceOverPayload({
      standings: [standingRow('b', 2), standingRow('a', 1)],
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.standings.map((row) => row.position)).toEqual([2, 1]);
  });
});
