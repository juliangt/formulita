import { describe, expect, it } from 'vitest';
import {
  CPU_DIFFICULTY_LABELS,
  DEFAULT_CPU_DIFFICULTY,
  defaultTrackId,
  parseCpuDifficulty,
  parseRacePracticeResults,
  parseRaceSceneInit,
  parseRaceVsCpuResults,
  raceVsCpuPodium,
  raceVsCpuResultsPayload,
  VS_CPU_FALLBACK_PILOT_NAME,
  VS_CPU_PLAYER_NAME,
  VS_CPU_PODIUM_SIZE,
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

describe('podio del GRAN PREMIO (V4) — raceVsCpuPodium + viaje en el payload', () => {
  /** Clasificación de ejemplo (salida de `finalClassification`). */
  const standings = [
    { position: 1, peerId: 'rival-0' },
    { position: 2, peerId: 'player' },
    { position: 3, peerId: 'rival-1' },
    { position: 4, peerId: 'rival-2' },
  ];
  const nameOf = (peerId: string): string =>
    peerId.startsWith('rival') ? `RIVAL-${peerId.slice(-1)}` : VS_CPU_PLAYER_NAME;

  it('raceVsCpuPodium arma el top 3 con el jugador etiquetado (TÚ) e isPlayer', () => {
    expect(raceVsCpuPodium(standings, nameOf, 'player')).toEqual([
      { position: 1, name: 'RIVAL-0', isPlayer: false },
      { position: 2, name: VS_CPU_PLAYER_NAME, isPlayer: true },
      { position: 3, name: 'RIVAL-1', isPlayer: false },
    ]);
  });

  it('el jugador fuera del top 3 NO viaja en el podio (la pantalla lo agrega)', () => {
    const fueraDelPodio = [
      { position: 1, peerId: 'rival-0' },
      { position: 2, peerId: 'rival-1' },
      { position: 3, peerId: 'rival-2' },
      { position: 4, peerId: 'rival-3' },
      { position: 5, peerId: 'player' },
    ];
    const podio = raceVsCpuPodium(fueraDelPodio, nameOf, 'player');
    expect(podio).toHaveLength(VS_CPU_PODIUM_SIZE);
    expect(podio.some((entry) => entry.isPlayer)).toBe(false);
  });

  it('un nombre que queda vacío tras sanitizar se descarta (el fallback PILOTO vive en la escena)', () => {
    expect(raceVsCpuPodium([{ position: 1, peerId: 'fantasma' }], () => '')).toEqual([]);
    expect(VS_CPU_FALLBACK_PILOT_NAME).toBe('PILOTO');
  });

  it('round-trip: el podio viaja en el payload y sobrevive al parseo EXACTO', () => {
    const podium = raceVsCpuPodium(standings, nameOf, 'player');
    const payload = raceVsCpuResultsPayload('monza', 2, 8, 'hard', 3, 30_000, 92_000, podium);
    expect(payload.podium).toEqual(podium);
    expect(parseRaceVsCpuResults(payload)).toEqual(payload);
  });

  it('sin podio (payload viejo de V0) el parseo degrada a podio vacío', () => {
    const viejo = { ...raceVsCpuResultsPayload('spa', 4, 8, 'normal', 3, 31_000, 95_000) };
    delete (viejo as { podium?: unknown }).podium;
    const parsed = parseRaceVsCpuResults(viejo);
    expect(parsed).not.toBeNull();
    expect(parsed?.podium).toEqual([]);
  });

  it('es defensivo: podio basura se filtra sin lanzar (misma normalización del armador)', () => {
    const parsed = parseRaceVsCpuResults({
      mode: 'vs-cpu',
      trackId: 'spa',
      position: 4,
      podium: [
        'no soy objeto',
        { position: 0, name: 'P0' }, // posición < 1 → fuera
        { position: 2, name: '   ' }, // nombre vacío tras sanitizar → fuera
        { position: 2, name: 'NOMBRE', isPlayer: 'sí' }, // isPlayer no-boolean → false
        { position: 2, name: 'SEGUNDO', isPlayer: true }, // primera P2 gana
        { position: 2, name: 'DUPLICADO' }, // P2 duplicada → fuera
        { position: 1, name: 'PRIMERO' }, // desordenado → se reordena
        { position: 4, name: 'FUERA' }, // fuera del podio → fuera
        { position: 3, name: 99 }, // nombre no-string → fuera
      ],
    });
    expect(parsed?.podium).toEqual([
      { position: 1, name: 'PRIMERO', isPlayer: false },
      { position: 2, name: 'NOMBRE', isPlayer: false },
    ]);
    expect(parsed?.position).toBe(4);
  });

  it('es defensivo: podio no-array (u objetos basura) degrada a [] sin lanzar', () => {
    for (const podium of ['x', 42, null, true, [{ position: 1 }, 'basura'], [null, 7]]) {
      const parsed = parseRaceVsCpuResults({ mode: 'vs-cpu', trackId: 'spa', podium });
      expect(parsed).not.toBeNull();
      expect(parsed?.podium).toEqual([]);
    }
  });

  it('los nombres del podio se sanitizan igual que los del wire (trim/collapse/máx 12)', () => {
    const parsed = parseRaceVsCpuResults({
      mode: 'vs-cpu',
      trackId: 'spa',
      podium: [{ position: 1, name: `  ${'A'.repeat(30)}   B  ` }],
    });
    expect(parsed?.podium[0]?.name.length).toBeLessThanOrEqual(12);
    expect(parsed?.podium[0]?.name).not.toMatch(/\s{2,}/);
  });
});
