import { describe, expect, it } from 'vitest';
import {
  CPU_DIFFICULTY_LABELS,
  DEFAULT_CPU_DIFFICULTY,
  defaultTrackId,
  parseCpuDifficulty,
  parseRacePracticeResults,
  parseRaceSceneInit,
  parseRaceVsCpuResults,
  raceVsCpuResultsPayload,
  type CpuDifficulty,
} from '../../race/results';

/**
 * Tests de los contratos vs CPU de #14: init data del GRAN PREMIO
 * (`parseRaceSceneInit` con `mode:'vs-cpu'`), coacción de dificultad y el
 * payload de resultados RaceScene → GameOverScene (round-trip + parseo
 * defensivo). El modo multi de #9 y la práctica conservan sus tests propios
 * (`results.test.ts`): acá sólo se verifica que NO se rompen.
 */

describe('parseRaceSceneInit — modo vs-cpu (#14)', () => {
  it('acepta un payload válido con dificultad y seed', () => {
    expect(
      parseRaceSceneInit({ trackId: 'monza', mode: 'vs-cpu', difficulty: 'hard', seed: 1234 }),
    ).toEqual({ trackId: 'monza', mode: 'vs-cpu', difficulty: 'hard', seed: 1234 });
  });

  it('dificultad inválida degrada a NORMAL sin lanzar', () => {
    for (const difficulty of [undefined, null, 'imposible', 7, Number.NaN]) {
      const init = parseRaceSceneInit({ trackId: 'spa', mode: 'vs-cpu', difficulty, seed: 5 });
      expect(init.mode).toBe('vs-cpu');
      expect(init.difficulty).toBe('normal');
      expect(init.seed).toBe(5);
    }
  });

  it('seed inválida (basura, negativa o fraccional) degrada a 0', () => {
    for (const seed of [undefined, 'x', -3, 1.5, Number.NaN]) {
      const init = parseRaceSceneInit({ trackId: 'spa', mode: 'vs-cpu', difficulty: 'easy', seed });
      expect(init.mode).toBe('vs-cpu');
      expect(init.seed).toBe(0);
    }
  });

  it('un modo desconocido sigue degradando a práctica (regla de #9 intacta)', () => {
    expect(
      parseRaceSceneInit({ trackId: 'monaco', mode: 'gran-premio', difficulty: 'hard' }),
    ).toEqual({ trackId: 'monaco', mode: 'practice' });
    expect(parseRaceSceneInit(undefined)).toEqual({ trackId: defaultTrackId(), mode: 'practice' });
  });

  it('el modo multi de #9 sigue parseándose exactamente igual', () => {
    const players = [{ peerId: 'p1', name: 'Ana', color: 0xd63c3c }];
    expect(
      parseRaceSceneInit({ mode: 'race', trackId: 'monza', seed: 7, players, myPeerId: 'p1' }),
    ).toEqual({ mode: 'race', trackId: 'monza', seed: 7, players, myPeerId: 'p1' });
    // Un hueco en el payload multi degrada a práctica (sin red no hay multi).
    expect(
      parseRaceSceneInit({ mode: 'race', trackId: 'monza', seed: 7, players }),
    ).toEqual({ trackId: 'monza', mode: 'practice' });
  });
});

describe('parseCpuDifficulty — coacción de dificultad', () => {
  it('acepta las 3 dificultades válidas', () => {
    expect(parseCpuDifficulty('easy')).toBe('easy');
    expect(parseCpuDifficulty('normal')).toBe('normal');
    expect(parseCpuDifficulty('hard')).toBe('hard');
  });

  it('lo inválido cae al default (normal)', () => {
    expect(DEFAULT_CPU_DIFFICULTY).toBe('normal');
    expect(parseCpuDifficulty('brutal')).toBe('normal');
    expect(parseCpuDifficulty(undefined)).toBe('normal');
  });

  it('las etiquetas visibles cubren las 3 dificultades', () => {
    expect(CPU_DIFFICULTY_LABELS).toEqual({
      easy: 'FÁCIL',
      normal: 'NORMAL',
      hard: 'DIFÍCIL',
    });
  });
});

describe('raceVsCpuResultsPayload + parseRaceVsCpuResults — RaceScene → GameOverScene', () => {
  it('round-trip: payload → parseo conserva los datos', () => {
    const payload = raceVsCpuResultsPayload('monaco', 1, 2, 'normal', 3, 31_542, 96_870);
    expect(payload.mode).toBe('vs-cpu');
    expect(payload.trackName).toBe('MÓNACO');
    expect(payload.difficulty).toBe('normal');
    const parsed = parseRaceVsCpuResults(payload);
    expect(parsed).toEqual(payload);
  });

  it('payloads de OTRAS ramas devuelven null (práctica, multi, solo clásico)', () => {
    expect(parseRaceVsCpuResults(undefined)).toBeNull();
    expect(parseRaceVsCpuResults(null)).toBeNull();
    expect(parseRaceVsCpuResults({ mode: 'practice', trackId: 'monza', laps: 3 })).toBeNull();
    expect(parseRaceVsCpuResults({ mode: 'race-multi', standings: [], myPeerId: 'p' })).toBeNull();
    expect(parseRaceVsCpuResults({ mode: 'solo', score: 100 })).toBeNull();
  });

  it('es defensivo: campos basura toman defaults sin lanzar', () => {
    const parsed = parseRaceVsCpuResults({
      mode: 'vs-cpu',
      trackId: 'desconocido',
      trackName: 99,
      position: -2,
      totalCars: 'x',
      difficulty: 'imposible',
      laps: Number.NaN,
      bestLapMs: -5,
      totalMs: {},
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.trackId).toBe(defaultTrackId());
    expect(parsed?.trackName).toBe('');
    expect(parsed?.position).toBe(1);
    expect(parsed?.totalCars).toBe(1);
    expect(parsed?.difficulty).toBe('normal');
    expect(parsed?.laps).toBe(0);
    expect(parsed?.bestLapMs).toBe(0);
    expect(parsed?.totalMs).toBe(0);
  });

  it('el payload sanea sus propios inputs (posición, dificultad, tiempos)', () => {
    const payload = raceVsCpuResultsPayload('spa', 0, 9, 'brutal' as CpuDifficulty, 2.7, -10, Number.NaN);
    expect(payload.position).toBe(1);
    expect(payload.totalCars).toBe(9);
    expect(payload.difficulty).toBe('normal');
    expect(payload.laps).toBe(2);
    expect(payload.bestLapMs).toBe(0);
    expect(payload.totalMs).toBe(0);
    expect(payload.trackName).toBe('SPA');
  });

  it('el parseo de práctica ignora el payload vs-cpu y viceversa (ramas disjuntas)', () => {
    const vsCpu = raceVsCpuResultsPayload('monza', 2, 2, 'hard', 3, 30_000, 92_000);
    expect(parseRacePracticeResults(vsCpu)).toBeNull();
  });
});
