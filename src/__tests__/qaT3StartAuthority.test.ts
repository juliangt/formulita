import { describe, expect, it, vi } from 'vitest';
import { mulberry32 } from '../net/roomRng';
import { isStartFromHost, type RosterEntry } from '../net/lobbyState';
import { parseRaceFinishPayload, type StartPayload } from '../net/protocol';
import { TrysteroNetClient } from '../net/TrysteroNetClient';
import { RaceScene } from '../scenes/RaceScene';
import { FakeTrysteroRoom } from './fakes/FakeTrysteroRoom';
import type { PeerMeta } from '../net/protocol';

/**
 * qaT3 (issue #35) — teoría de auditoría "autoridad del arranque de carrera":
 *
 * 1. El payload `start` se aceptaba de CUALQUIER peer (TrysteroNetClient sólo
 *    protegía la EMISIÓN con un isHost() local): un peer malicioso arrancaba
 *    la carrera de todos cuando quería, y dos peers con vistas de metas
 *    divergentes podían creerse anfitrión a la vez y partir la sala en dos
 *    carreras con seed/roster/trackId distintos. Fix: validar el ORIGEN en
 *    recepción con un predicado puro (`isStartFromHost`) sobre el roster
 *    local — mismo criterio que `canStart` para la emisión.
 *
 * 2. `rfin` se aceptaba sin NINGÚN gate de plausibilidad: `totalMs: 0` parsea
 *    (coaccionado a 0) y cada reenvío PISABA el tiempo registrado
 *    (`finishedPeers.set`), así que un peer ganaba al instante, abría la
 *    ventana de gracia y cerraba la carrera de todos primero, o reordenaba
 *    el podio con reenvíos cada vez menores. Fix: el parse rechaza
 *    `totalMs <= 0` y la escena aplica "primer rfin gana" (set-if-absent).
 */

const ROSTER: RosterEntry[] = [
  { peerId: 'aa-creador', name: 'Ana', isCreator: true },
  { peerId: 'bb-peers', name: 'Beto', isCreator: false },
  { peerId: 'cc-tercero', name: 'Cara', isCreator: false },
];

describe('qaT3 — isStartFromHost (predicado puro de autoridad del start)', () => {
  it('acepta al CREADOR presente en el roster', () => {
    expect(isStartFromHost(ROSTER, 'aa-creador')).toBe(true);
  });

  it('acepta al peerId MENOR cuando el creador se fue (host migrado)', () => {
    const sinCreador: RosterEntry[] = ROSTER.filter((entry) => !entry.isCreator);
    expect(isStartFromHost(sinCreador, 'bb-peers')).toBe(true);
    expect(isStartFromHost(sinCreador, 'cc-tercero')).toBe(false);
  });

  it('rechaza a cualquier peer que no resuelva como anfitrión', () => {
    expect(isStartFromHost(ROSTER, 'bb-peers')).toBe(false);
    expect(isStartFromHost(ROSTER, 'cc-tercero')).toBe(false);
  });

  it('rechaza TODO con roster vacío (sin anfitrión no hay start válido)', () => {
    expect(isStartFromHost([], 'aa-creador')).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* TrysteroNetClient — gate de origen del start en RECEPCIÓN            */
/* ------------------------------------------------------------------ */

/** Fixture idéntico al de trysteroNetClient.test.ts (roomFactory fake). */
function createClientFixture(selfPeerId: string): {
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
    wordRng: mulberry32(7),
    settleScheduler: (callback) => {
      callback();
      return () => undefined;
    },
  });
  return {
    client,
    room(): FakeTrysteroRoom {
      if (!latest) {
        throw new Error('la room no fue creada todavía');
      }
      return latest!;
    },
  };
}

describe('qaT3 — TrysteroNetClient: el start sólo vale si viene del anfitrión', () => {
  const payload: StartPayload = {
    seed: 424242,
    players: [
      { peerId: 'aa-creador', name: 'Ana', color: 1 },
      { peerId: 'zz-invitado', name: 'Zeta', color: 2 },
    ],
    startAt: 1700000000000,
  };

  /** Joiner con el creador presente en SU vista de metas (anfitrión real). */
  function joinedWithCreator(selfPeerId: string): {
    net: ReturnType<typeof createClientFixture>;
    onStart: ReturnType<typeof vi.fn>;
  } {
    const net = createClientFixture(selfPeerId);
    net.client.join({ appId: 'app', roomWord: 'PARRILLA', name: 'Zeta' });
    net.room().connectPeer('aa-creador');
    net.room().receive<PeerMeta>('meta', { name: 'Ana', color: 0, isCreator: true }, 'aa-creador');
    const onStart = vi.fn();
    net.client.onStart(onStart);
    return { net, onStart };
  }

  it('un start de un peer que NO es el anfitrión del roster local NO dispara onStart', () => {
    const { net, onStart } = joinedWithCreator('zz-invitado');

    net.room().receive<StartPayload>('start', payload, 'zz-atacante');

    expect(onStart).not.toHaveBeenCalled();
  });

  it('el start del anfitrión legítimo (creador en la vista local) SÍ dispara onStart', () => {
    const { net, onStart } = joinedWithCreator('zz-invitado');

    net.room().receive<StartPayload>('start', payload, 'aa-creador');

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith(payload);
  });

  it('un atacante no puede forzar errores visibles en la víctima (descarte silencioso)', () => {
    const { net, onStart } = joinedWithCreator('zz-invitado');
    const onError = vi.fn();
    net.client.onError(onError);

    net.room().receive<StartPayload>('start', payload, 'zz-atacante');

    expect(onError).not.toHaveBeenCalled();
    expect(onStart).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* rfin — gate de plausibilidad en el parse                             */
/* ------------------------------------------------------------------ */

describe('qaT3 — parseRaceFinishPayload: totalMs debe ser un tiempo > 0', () => {
  it('rechaza totalMs <= 0 (ganar con totalMs: 0 ya no parsea)', () => {
    expect(parseRaceFinishPayload({ totalMs: 0, bestLapMs: 0 })).toBeNull();
    expect(parseRaceFinishPayload({ totalMs: -45000, bestLapMs: 0 })).toBeNull();
  });

  it('rechaza totalMs no finito (NaN/Infinity) sin coaccionar a 0', () => {
    expect(parseRaceFinishPayload({ totalMs: Number.NaN, bestLapMs: 0 })).toBeNull();
    expect(parseRaceFinishPayload({ totalMs: Number.POSITIVE_INFINITY, bestLapMs: 0 })).toBeNull();
  });

  it('bestLapMs 0 sigue siendo legítimo (ninguna vuelta válida) y un rfin sano pasa', () => {
    expect(parseRaceFinishPayload({ totalMs: 95000, bestLapMs: 0 })).toEqual({
      totalMs: 95000,
      bestLapMs: 0,
    });
  });
});

/* ------------------------------------------------------------------ */
/* RaceScene — primer rfin gana (set-if-absent en finishedPeers)         */
/* ------------------------------------------------------------------ */

/**
 * Harness ligero (patrón raceLapTelemetry.test.ts): escena REAL sin boot de
 * Phaser — `new RaceScene()` + `init(data)` (parseo puro) + llamada directa
 * al método privado `handleRaceFinish`, con `time` stubeado (única pieza de
 * Phaser que el handler toca).
 */
function createRaceHarness(players: Array<{ peerId: string; name: string }>): {
  handleRaceFinish(peerId: string, payload: unknown): void;
  finishedPeers: Map<string, { totalMs: number; bestLapMs: number }>;
  firstFinish: { peerId: string; at: number } | null;
  advanceClock(ms: number): void;
} {
  const scene = new RaceScene();
  scene.init({
    trackId: 'spa',
    mode: 'race',
    seed: 3,
    players: players.map((player, index) => ({ ...player, color: index })),
    myPeerId: players[0]?.peerId ?? '',
  });
  const internals = scene as unknown as {
    handleRaceFinish(peerId: string, payload: unknown): void;
    finishedPeers: Map<string, { totalMs: number; bestLapMs: number }>;
    firstFinish: { peerId: string; at: number } | null;
    time: { now: number };
  };
  internals.time = { now: 1000 };
  return {
    handleRaceFinish: (peerId, payload) => internals.handleRaceFinish(peerId, payload),
    finishedPeers: internals.finishedPeers,
    get firstFinish() {
      return internals.firstFinish;
    },
    advanceClock: (ms) => {
      internals.time.now += ms;
    },
  };
}

describe('qaT3 — RaceScene.handleRaceFinish: primer rfin gana', () => {
  const PEERS = [
    { peerId: 'p1-ana', name: 'Ana' },
    { peerId: 'p2-beto', name: 'Beto' },
  ];

  it('un rfin con totalMs 0 NO registra al peer NI abre la ventana de gracia', () => {
    const harness = createRaceHarness(PEERS);

    harness.handleRaceFinish('p2-beto', { totalMs: 0, bestLapMs: 0 });

    expect(harness.finishedPeers.has('p2-beto')).toBe(false);
    expect(harness.firstFinish).toBeNull();
  });

  it('un reenvío del mismo peer con tiempo menor NO reordena el podio', () => {
    const harness = createRaceHarness(PEERS);

    harness.handleRaceFinish('p2-beto', { totalMs: 95000, bestLapMs: 30000 });
    harness.advanceClock(5000);
    harness.handleRaceFinish('p2-beto', { totalMs: 1000, bestLapMs: 500 });

    expect(harness.finishedPeers.get('p2-beto')).toEqual({ totalMs: 95000, bestLapMs: 30000 });
  });

  it('dos finishes legítimos de peers distintos se registran AMBOS (flujo real intacto)', () => {
    const harness = createRaceHarness(PEERS);

    harness.handleRaceFinish('p2-beto', { totalMs: 95000, bestLapMs: 30000 });
    harness.advanceClock(1200);
    harness.handleRaceFinish('p1-ana', { totalMs: 96200, bestLapMs: 30100 });

    expect(harness.finishedPeers.get('p2-beto')).toEqual({ totalMs: 95000, bestLapMs: 30000 });
    expect(harness.finishedPeers.get('p1-ana')).toEqual({ totalMs: 96200, bestLapMs: 30100 });
    // La ventana de gracia queda abierta por el PRIMER finish (Beto).
    expect(harness.firstFinish).toEqual({ peerId: 'p2-beto', at: 1000 });
  });

  it('un rfin de un peer fuera del roster congelado se ignora (gate de roster intacto)', () => {
    const harness = createRaceHarness(PEERS);

    harness.handleRaceFinish('zz-desconocido', { totalMs: 1, bestLapMs: 1 });

    expect(harness.finishedPeers.has('zz-desconocido')).toBe(false);
    expect(harness.firstFinish).toBeNull();
  });
});
