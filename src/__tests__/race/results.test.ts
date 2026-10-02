import { describe, expect, it } from 'vitest';
import { TRACKS } from '../../race/tracks';
import {
  defaultTrackId,
  parseRacePracticeResults,
  parseRaceSceneInit,
  racePracticeResultsPayload,
} from '../../race/results';

/**
 * Tests de los contratos de init data / resultados de la RaceScene (issue #9,
 * V1): parseo defensivo (nunca lanza, degrada a defaults) y round-trip del
 * payload RaceScene → GameOverScene.
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
