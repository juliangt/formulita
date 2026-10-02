import { describe, expect, it } from 'vitest';
import { CIRCUIT } from '../../config/balance';
import {
  parseRaceFinishPayload,
  parseRaceInit,
  parseRaceOverPayload,
  roundRaceFinishPayload,
  roundRaceStatePayload,
  type PlayerInfo,
} from '../../net/protocol';
import { finalClassification, type FinalCar } from '../../race/raceRanking';
import { TRACKS } from '../../race/tracks';

/**
 * Tests del protocolo de la CARRERA en circuito (issue #9, V2): acciones
 * nuevas `rstate`/`rfin`/`race-over` y el `start` extendido (gameMode +
 * trackId). Mismo criterio que protocol.test.ts de la BATALLA: la misma
 * sanitización corre en emisor y receptor, y TODO payload corrupto degrada
 * (a default o a null) sin lanzar.
 */

/** Longitud de vuelta "wire" de los tests (px; cualquier pista ronda esto). */
const LAP_LENGTH = 7000;

/** Medio ancho de pista "wire" (px; MÓNACO tiene widthPx 290 desde #18). */
const HALF_WIDTH = 145;

const ROSTER: PlayerInfo[] = [
  { peerId: 'peer-ana', name: 'Ana', color: 0xd63c3c },
  { peerId: 'peer-beto', name: 'Beto', color: 0x3c6cd6 },
];

describe('roundRaceStatePayload — sanitización de rstate (emisor y receptor)', () => {
  it('redondea a enteros y preserva un estado ya sano (idempotente)', () => {
    const raw = { s: 1234.7, o: -12.2, v: 250.9, lap: 1 };
    const once = roundRaceStatePayload(raw, LAP_LENGTH, HALF_WIDTH);
    expect(once).toEqual({ s: 1235, o: -12, v: 251, lap: 1 });
    // Segunda pasada (como la hace el receptor): mismo resultado exacto.
    expect(roundRaceStatePayload(once, LAP_LENGTH, HALF_WIDTH)).toEqual(once);
  });

  it('envuelve s a [0, lapLength) — también con s negativa', () => {
    expect(roundRaceStatePayload({ s: LAP_LENGTH + 100, o: 0, v: 0, lap: 1 }, LAP_LENGTH, HALF_WIDTH).s).toBe(100);
    expect(roundRaceStatePayload({ s: -50, o: 0, v: 0, lap: 0 }, LAP_LENGTH, HALF_WIDTH).s).toBe(LAP_LENGTH - 50);
    expect(roundRaceStatePayload({ s: LAP_LENGTH * 4 + 7, o: 0, v: 0, lap: 2 }, LAP_LENGTH, HALF_WIDTH).s).toBe(7);
  });

  it('acota o a ±halfWidth y lap a [0..CIRCUIT.totalLaps]', () => {
    expect(roundRaceStatePayload({ s: 0, o: 9999, v: 0, lap: 0 }, LAP_LENGTH, HALF_WIDTH).o).toBe(HALF_WIDTH);
    expect(roundRaceStatePayload({ s: 0, o: -9999, v: 0, lap: 0 }, LAP_LENGTH, HALF_WIDTH).o).toBe(-HALF_WIDTH);
    expect(roundRaceStatePayload({ s: 0, o: 0, v: 0, lap: -3 }, LAP_LENGTH, HALF_WIDTH).lap).toBe(0);
    expect(roundRaceStatePayload({ s: 0, o: 0, v: 0, lap: 99 }, LAP_LENGTH, HALF_WIDTH).lap).toBe(CIRCUIT.totalLaps);
  });

  it('v jamás es negativa y NADA es NaN: no finitos degradan a 0', () => {
    expect(roundRaceStatePayload({ s: 10, o: 0, v: -80, lap: 0 }, LAP_LENGTH, HALF_WIDTH).v).toBe(0);
    const clean = roundRaceStatePayload(
      { s: Number.NaN, o: Number.NaN, v: Number.NaN, lap: Number.NaN },
      LAP_LENGTH,
      HALF_WIDTH,
    );
    expect(clean).toEqual({ s: 0, o: 0, v: 0, lap: 0 });
  });

  it('lapLength/halfWidth corruptos no rompen (defensa de la pista local)', () => {
    const clean = roundRaceStatePayload(
      { s: 100, o: 10, v: 5, lap: 1 },
      Number.NaN,
      Number.NaN,
    );
    expect(clean.s).toBe(0); // lapLength inválido ⇒ 1 → 100 % 1 = 0
    expect(clean.o).toBe(0); // halfWidth inválido ⇒ 0 → acotado a 0
  });
});

describe('rfin — sanitización y parseo defensivo', () => {
  it('roundRaceFinishPayload redondea tiempos a enteros ≥ 0', () => {
    expect(roundRaceFinishPayload({ totalMs: 120000.6, bestLapMs: 39999.4 })).toEqual({
      totalMs: 120001,
      bestLapMs: 39999,
    });
    expect(roundRaceFinishPayload({ totalMs: -5, bestLapMs: Number.NaN })).toEqual({
      totalMs: 0,
      bestLapMs: 0,
    });
  });

  it('parseRaceFinishPayload acepta un payload sano y rechaza basura', () => {
    expect(parseRaceFinishPayload({ totalMs: 90000, bestLapMs: 29500 })).toEqual({
      totalMs: 90000,
      bestLapMs: 29500,
    });
    expect(parseRaceFinishPayload(null)).toBeNull();
    expect(parseRaceFinishPayload('junk')).toBeNull();
    expect(parseRaceFinishPayload({ totalMs: 'a', bestLapMs: 1 })).toBeNull();
    expect(parseRaceFinishPayload({ totalMs: 1 })).toBeNull(); // falta bestLapMs
  });
});

describe('race-over — parseo defensivo de la clasificación final', () => {
  it('acepta la salida EXACTA de finalClassification (round-trip)', () => {
    const cars: FinalCar[] = [
      { peerId: 'peer-ana', lap: 3, s: 10, status: 'finished', totalMs: 120000 },
      { peerId: 'peer-beto', lap: 2, s: 3400, status: 'running' },
    ];
    const standings = finalClassification(cars, LAP_LENGTH);
    const parsed = parseRaceOverPayload({ standings });
    expect(parsed).not.toBeNull();
    expect(parsed!.standings).toEqual(standings);
  });

  it('rechaza payloads corruptos (una fila basura invalida TODO)', () => {
    expect(parseRaceOverPayload(null)).toBeNull();
    expect(parseRaceOverPayload({})).toBeNull();
    expect(parseRaceOverPayload({ standings: [] })).toBeNull();
    expect(
      parseRaceOverPayload({
        standings: [
          { peerId: 'a', position: 1, status: 'finished', totalMs: 10, lap: 3, s: 0, progress: 3 },
          { peerId: 'b', position: 0, status: 'running', lap: 1, s: 0, progress: 1 }, // position < 1
        ],
      }),
    ).toBeNull();
    expect(
      parseRaceOverPayload({
        standings: [{ peerId: 'a', position: 1, status: 'ganador', lap: 3, s: 0 }], // status ajeno
      }),
    ).toBeNull();
  });

  it('un finished sin totalMs finito cae a null (mismo criterio que el ranking)', () => {
    const parsed = parseRaceOverPayload({
      standings: [{ peerId: 'a', position: 1, status: 'finished', totalMs: Number.NaN, lap: 3, s: 0 }],
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.standings[0].totalMs).toBeNull();
  });
});

describe('parseRaceInit — el start extendido (V2) parseado de forma defensiva', () => {
  const baseStart = {
    seed: 12345,
    players: ROSTER,
    startAt: 1700000000000,
  };

  it('un start VIEJO de #1 (sin gameMode) degrada a BATALLA con trackId null', () => {
    const parsed = parseRaceInit(baseStart);
    expect(parsed).not.toBeNull();
    expect(parsed!.gameMode).toBe('battle');
    expect(parsed!.trackId).toBeNull();
    expect(parsed!.players).toEqual(ROSTER);
  });

  it('un start de CARRERA conserva seed/players y resuelve la pista pedida', () => {
    const parsed = parseRaceInit({ ...baseStart, gameMode: 'race', trackId: 'spa' });
    expect(parsed!.gameMode).toBe('race');
    expect(parsed!.trackId).toBe('spa');
    expect(parsed!.seed).toBe(baseStart.seed);
    expect(parsed!.players).toEqual(ROSTER);
  });

  it('un trackId desconocido en CARRERA degrada a la primera pista (MÓNACO)', () => {
    const parsed = parseRaceInit({ ...baseStart, gameMode: 'race', trackId: 'nurburgring' });
    expect(parsed!.gameMode).toBe('race');
    expect(parsed!.trackId).toBe(TRACKS[0].id);
  });

  it('un gameMode ajeno degrada a batalla (no lanza)', () => {
    const parsed = parseRaceInit({ ...baseStart, gameMode: 'somos-f1' });
    expect(parsed!.gameMode).toBe('battle');
    expect(parsed!.trackId).toBeNull();
  });

  it('null si el payload ni siquiera tiene forma de start (degradación)', () => {
    expect(parseRaceInit(undefined)).toBeNull();
    expect(parseRaceInit(null)).toBeNull();
    expect(parseRaceInit('junk')).toBeNull();
    expect(parseRaceInit({ ...baseStart, seed: -1 })).toBeNull();
    expect(parseRaceInit({ ...baseStart, seed: 1.5 })).toBeNull();
    expect(parseRaceInit({ ...baseStart, players: [] })).toBeNull();
    expect(parseRaceInit({ ...baseStart, players: [{ peerId: 'x' }] })).toBeNull();
    expect(parseRaceInit({ ...baseStart, startAt: Number.NaN })).toBeNull();
  });
});
