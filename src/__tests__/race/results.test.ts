import { describe, expect, it } from 'vitest';
import { TRACKS } from '../../race/tracks';
import {
  defaultTrackId,
  fastestRaceLap,
  parseRaceMultiResults,
  parseRacePracticeResults,
  parseRaceSceneInit,
  raceMultiResultsPayload,
  racePracticeResultsPayload,
} from '../../race/results';

/**
 * Tests de los contratos de init data / resultados de la RaceScene (issue #9,
 * V1): parseo defensivo (nunca lanza, degrada a defaults) y round-trip del
 * payload RaceScene → GameOverScene. V4: vuelta rápida de la carrera multi
 * (`fastestRaceLap` + su viaje en el payload de resultados).
 */

describe('parseRaceSceneInit — init data del menú', () => {
  it('acepta un payload válido de práctica', () => {
    expect(parseRaceSceneInit({ trackId: 'monza', mode: 'practice' })).toEqual({
      trackId: 'monza',
      mode: 'practice',
    });
  });

  it('payload ausente o basura degrada a la pista default en práctica', () => {
    expect(parseRaceSceneInit(undefined)).toEqual({ trackId: defaultTrackId(), mode: 'practice' });
    expect(parseRaceSceneInit(null)).toEqual({ trackId: defaultTrackId(), mode: 'practice' });
    expect(parseRaceSceneInit('junk')).toEqual({ trackId: defaultTrackId(), mode: 'practice' });
    expect(parseRaceSceneInit({ trackId: 42 })).toEqual({
      trackId: defaultTrackId(),
      mode: 'practice',
    });
  });

  it('un id desconocido cae al default (la escena siempre puede arrancar)', () => {
    expect(parseRaceSceneInit({ trackId: 'nurburgring' }).trackId).toBe(defaultTrackId());
  });

  it('el default es la primera pista del registro (MÓNACO)', () => {
    expect(defaultTrackId()).toBe(TRACKS[0].id);
    expect(defaultTrackId()).toBe('monaco');
  });
});

describe('racePracticeResultsPayload + parseRacePracticeResults — RaceScene → GameOverScene', () => {
  it('round-trip: payload → parseo conserva los datos', () => {
    const payload = racePracticeResultsPayload('spa', 3, 39_987, 121_543);
    expect(payload.mode).toBe('practice');
    expect(payload.trackName).toBe('SPA');
    const parsed = parseRacePracticeResults(payload);
    expect(parsed).toEqual(payload);
  });

  it('payloads de OTRAS ramas devuelven null (modo solo clásico y multi)', () => {
    expect(parseRacePracticeResults(undefined)).toBeNull();
    expect(parseRacePracticeResults({ mode: 'solo', score: 100 })).toBeNull();
    expect(parseRacePracticeResults({ mode: 'multi', standings: [] })).toBeNull();
    expect(parseRacePracticeResults(null)).toBeNull();
  });

  it('es defensivo: campos basura toman defaults sin lanzar', () => {
    const parsed = parseRacePracticeResults({
      mode: 'practice',
      trackId: 'desconocido',
      trackName: 123,
      laps: -5,
      bestLapMs: Number.NaN,
      totalMs: 'x',
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.trackId).toBe(defaultTrackId());
    expect(parsed?.trackName).toBe('');
    expect(parsed?.laps).toBe(0);
    expect(parsed?.bestLapMs).toBe(0);
    expect(parsed?.totalMs).toBe(0);
  });

  it('el payload sanea también sus propios inputs (laps/bestLapMs/totalMs)', () => {
    const payload = racePracticeResultsPayload('monza', 2.7, -10, Number.NaN);
    expect(payload.laps).toBe(2);
    expect(payload.bestLapMs).toBe(0);
    expect(payload.totalMs).toBe(0);
    expect(payload.trackName).toBe('MONZA');
  });
});

describe('fastestRaceLap — vuelta rápida de la carrera multi (V4)', () => {
  const standings = (peerId: string, bestLapMs: number) => ({ peerId, bestLapMs });

  it('elige el mejor bestLapMs de los rfin', () => {
    expect(
      fastestRaceLap([standings('a', 41_500), standings('b', 39_987), standings('c', 40_200)]),
    ).toEqual({ peerId: 'b', bestLapMs: 39_987 });
  });

  it('el empate cae a peerId ASC (determinista en todos los clientes)', () => {
    expect(fastestRaceLap([standings('zeta', 40_000), standings('alfa', 40_000)])).toEqual({
      peerId: 'alfa',
      bestLapMs: 40_000,
    });
  });

  it('ignora entradas inválidas: peerId vacío y ms no finito o ≤ 0', () => {
    expect(
      fastestRaceLap([
        standings('', 38_000),
        standings('sin-vuelta', 0),
        standings('negativo', -5),
        standings('nan', Number.NaN),
        standings('valido', 42_100),
      ]),
    ).toEqual({ peerId: 'valido', bestLapMs: 42_100 });
  });

  it('sin candidatas válidas devuelve null', () => {
    expect(fastestRaceLap([])).toBeNull();
    expect(fastestRaceLap([standings('a', 0), standings('b', Number.NaN)])).toBeNull();
  });

  it('trunca los fraccionales de milisegundo (no redondea el cronómetro)', () => {
    expect(fastestRaceLap([standings('a', 39_987.9)])).toEqual({
      peerId: 'a',
      bestLapMs: 39_987,
    });
  });
});

describe('raceMultiResultsPayload + parseRaceMultiResults — fastLap en el payload (V4)', () => {
  /** Fila de podio válida (el parseo exige ≥ 1 standing con campos saneados). */
  const standing = (peerId: string) => ({
    position: 1,
    peerId,
    status: 'finished' as const,
    totalMs: 121_000,
    lap: 3,
    s: 0,
    progress: 3 * 7200,
  });

  it('default: el payload lleva fastLap null (quien no lo computa no se rompe)', () => {
    const payload = raceMultiResultsPayload('monza', [standing('peer-1')], 'peer-1');
    expect(payload.fastLap).toBeNull();
    const parsed = parseRaceMultiResults(payload);
    expect(parsed?.fastLap).toBeNull();
  });

  it('round-trip: la vuelta rápida elegida viaja y se conserva', () => {
    const payload = raceMultiResultsPayload('monza', [standing('peer-1')], 'peer-1', [], {
      peerId: 'peer-2',
      bestLapMs: 39_987,
    });
    expect(payload.fastLap).toEqual({ peerId: 'peer-2', bestLapMs: 39_987 });
    const parsed = parseRaceMultiResults(payload);
    expect(parsed?.fastLap).toEqual({ peerId: 'peer-2', bestLapMs: 39_987 });
  });

  it('es defensivo: fastLap basura en el payload parsea a null sin lanzar', () => {
    for (const fastLap of [
      undefined,
      null,
      'junk',
      {},
      { peerId: '' },
      { peerId: 'a', bestLapMs: 0 },
      { peerId: 'a', bestLapMs: 'x' },
    ]) {
      const payload = {
        mode: 'race-multi',
        trackId: 'monza',
        standings: [standing('peer-1')],
        myPeerId: 'peer-1',
        fastLap,
      };
      expect(parseRaceMultiResults(payload)?.fastLap).toBeNull();
    }
  });
});
