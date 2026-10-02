import { describe, expect, it } from 'vitest';
import { CIRCUIT, RACE_AI } from '../../../config/balance';
import {
  AiDriver,
  rubberBandMultiplier,
  type AiCarVision,
  type AiDriverConfig,
} from '../../../race/ai/aiDriver';
import { buildRacingLine } from '../../../race/ai/racingLine';
import { buildRivalRoster, rivalDriverConfig, type Rival } from '../../../race/ai/rivalRoster';
import { mulberry32 } from '../../../net/roomRng';
import { CircuitPhysics, type CarState } from '../../../race/circuitPhysics';
import { LapTracker } from '../../../race/lapTracker';
import { assignGridOrder } from '../../../race/gridOrder';
import { TrackPath } from '../../../race/trackPath';
import { buildTrackPath, getTrackById, TRACKS, type TrackDefinition } from '../../../race/tracks';

/**
 * QA issue #14 (V2) — TRES DIFICULTADES CON CARÁCTER, SIN Phaser:
 *
 * - ERRORES HUMANOS (Poisson, RNG propio del rival): frecuencia aproximada
 *   correcta por dificultad (estadístico con muchas sims cortas, seeds
 *   fijas), estrictamente MÁS errores en fácil que en difícil, cada fallo
 *   TERMINA SOLO (mistakeMs) y sin RNG el driver no crashea ni "erra".
 * - ADELANTAMIENTO: con visión de un auto lento adelante (y cerrando), el
 *   rival desvía SU trazada hacia el hueco y VUELVE a la línea al pasar
 *   (comparación contra una corrida control sin tráfico). La agresividad
 *   decide si intenta: con stub de RNG constante, agresivo intenta y tímido
 *   nunca (determinista).
 * - RUBBER-BANDING: el multiplicador es una función pura acotada a
 *   ±rubberBandPct, nunca supera el techo físico, y es fácil-elástica vs
 *   difícil-rígida (comportamiento probado sobre recta infinita).
 * - TABLA DE VALIDACIÓN DEL ISSUE: pista × dificultad, vuelta media del
 *   rival MEDIO (speedScale mediano) en banda ±10% de lo medido, y solape
 *   acotado: normal ≥3% más rápido que fácil y difícil ≥3% más rápido que
 *   normal (medido: 7–8% y 11–12%), con seeds fijas.
 *
 * Espeja el cableado de RaceScene V2 (`setupVsCpu`/`stepVsCpu`): driver con
 * el RNG derivado de la seed del rival, física idéntica, paso fijo 60 Hz.
 */

/** Paso fijo de la sim headless (60 Hz, igual criterio que el render). */
const DT = 1 / 60;

/** peerId canónico del auto propio en la parrilla local (contrato RaceScene). */
const PLAYER_PEER_ID = 'player';

/** Seed fija de los tests (cualquiera sirve: todo es determinista). */
const TEST_SEED = 20260101;

/** Lado del cuadrado gigante (recta infinita para sondas de objetivo). */
const SQUARE_SIDE = 200_000;

/** Config base sin carácter (errores/goma apagados) para tests de conducción. */
function driverConfig(overrides: Partial<AiDriverConfig>): AiDriverConfig {
  return {
    targetSpeedFraction: RACE_AI.targetSpeedFraction.normal,
    lineSpeedScale: RACE_AI.lineSpeedScale.normal,
    lineOffsetPx: 0,
    lookAheadPx: RACE_AI.lookAheadPx,
    steerDeadzoneRad: RACE_AI.steerDeadzoneRad,
    brakeMarginSpeedPx: RACE_AI.brakeMarginSpeedPx,
    mistakeEverySec: 0,
    mistakeMagPx: 0,
    aggression: 0.5,
    rubberBandPct: 0,
    ...overrides,
  };
}

/** El rival de speedScale MEDIANO del roster (el "rival medio" del issue). */
function medianRival(roster: readonly Rival[]): Rival {
  return [...roster].sort((a, b) => a.speedScale - b.speedScale)[
    Math.floor(roster.length / 2)
  ];
}

/** Coordenada de arco de una recta de la pista (targetSpeed = techo). */
function straightS(line: ReturnType<typeof buildRacingLine>): number {
  for (let i = 0; i < line.pointCount; i += 1) {
    const point = line.pointAtIndex(i);
    if (point.targetSpeed === CIRCUIT.maxSpeed) {
      return point.s;
    }
  }
  return 0;
}

/* ------------------------------------------------------------------ */
/* Rubber-banding                                                      */
/* ------------------------------------------------------------------ */

describe('rubberBandMultiplier — puro y acotado', () => {
  const PCT = RACE_AI.rubberBandPct.easy;
  const FULL = RACE_AI.rubberBandFullGapPx;

  it('sin gap no ajusta; al gap completo llega exactamente al tope del preset', () => {
    expect(rubberBandMultiplier(0, PCT, FULL)).toBe(1);
    expect(rubberBandMultiplier(FULL, PCT, FULL)).toBeCloseTo(1 + PCT, 12);
    expect(rubberBandMultiplier(-FULL, PCT, FULL)).toBeCloseTo(1 - PCT, 12);
  });

  it('queda acotado a ±rubberBandPct para CUALQUIER gap (y monotónico)', () => {
    for (let gap = -50_000; gap <= 50_000; gap += 137) {
      const mult = rubberBandMultiplier(gap, PCT, FULL);
      expect(mult).toBeGreaterThanOrEqual(1 - PCT);
      expect(mult).toBeLessThanOrEqual(1 + PCT);
      // Monotonía: más jugador adelante ⇒ más mult (hasta el tope).
      expect(rubberBandMultiplier(gap + 137, PCT, FULL)).toBeGreaterThanOrEqual(mult);
    }
    // Más allá del gap completo: clampeado (no sigue creciendo).
    expect(rubberBandMultiplier(FULL * 10, PCT, FULL)).toBeCloseTo(1 + PCT, 12);
  });

  it('inputs basura degradan a "sin ajuste" (sin NaN)', () => {
    expect(rubberBandMultiplier(Number.NaN, PCT, FULL)).toBe(1);
    expect(rubberBandMultiplier(500, Number.NaN, FULL)).toBe(1);
    expect(rubberBandMultiplier(500, PCT, 0)).toBe(1);
    expect(Number.isFinite(rubberBandMultiplier(Number.NaN, Number.NaN, -3))).toBe(true);
  });

  it('FÁCIL es más elástico que DIFÍCIL para el mismo gap', () => {
    const easyGain =
      rubberBandMultiplier(FULL, RACE_AI.rubberBandPct.easy, FULL) - 1;
    const hardGain =
      rubberBandMultiplier(FULL, RACE_AI.rubberBandPct.hard, FULL) - 1;
    expect(easyGain).toBeGreaterThan(hardGain * 3);
  });
});

describe('goma en el driver — acotada al techo físico y por carácter', () => {
  // Recta infinita (cuadrado gigante): el target de la línea es el techo y
  // el cap del preset manda — las sondas leen throttle/brake directamente.
  const square = new TrackPath([
    { x: 0, y: 0 },
    { x: SQUARE_SIDE, y: 0 },
    { x: SQUARE_SIDE, y: SQUARE_SIDE },
    { x: 0, y: SQUARE_SIDE },
  ]);
  const squareLine = buildRacingLine(square, getTrackById('monaco')!.widthPx);

  function probeInput(
    config: AiDriverConfig,
    speed: number,
    playerGapPx: number,
  ): { throttle: boolean; brake: boolean } {
    const start = square.sample(SQUARE_SIDE / 2);
    const state: CarState = { x: start.x, y: start.y, heading: start.angle, speed };
    const driver = new AiDriver(square, squareLine, config);
    return driver.drive(state, 0, { playerGapPx });
  }

  it('FÁCIL: la goma (+6%) levanta el cap y evita el frenado (elástico)', () => {
    const config = driverConfig({
      targetSpeedFraction: RACE_AI.targetSpeedFraction.easy,
      lineSpeedScale: 1,
      rubberBandPct: RACE_AI.rubberBandPct.easy,
    });
    const cap = CIRCUIT.maxSpeed * RACE_AI.targetSpeedFraction.easy;
    // ~5% por encima del cap: sin goma frena (objetivo + margen < velocidad);
    // con el jugador lejos adelante la goma cubre el exceso y acelera.
    const speed = cap * 1.051;
    expect(probeInput(config, speed, 0).brake).toBe(true);
    const boosted = probeInput(config, speed, RACE_AI.rubberBandFullGapPx * 5);
    expect(boosted.brake).toBe(false);
    expect(boosted.throttle).toBe(true);
  });

  it('DIFÍCIL: la goma (+1%) apenas responde (casi rígida)', () => {
    const config = driverConfig({
      targetSpeedFraction: RACE_AI.targetSpeedFraction.hard,
      lineSpeedScale: 1,
      rubberBandPct: RACE_AI.rubberBandPct.hard,
    });
    const cap = CIRCUIT.maxSpeed * RACE_AI.targetSpeedFraction.hard;
    // El MISMO exceso relativo (~5%): en difícil la goma NO lo cubre — frena
    // igual con o sin jugador adelante.
    const speed = cap * 1.051;
    expect(probeInput(config, speed, 0).brake).toBe(true);
    expect(probeInput(config, speed, RACE_AI.rubberBandFullGapPx * 5).brake).toBe(true);
  });

  it('nunca supera el techo físico: a punta, con el jugador lejísimos, no acelera', () => {
    // Fracción y escala a 1 + goma al tope: sin el clamp el objetivo (y el
    // cap) superarían maxSpeed y el driver pisaría el acelerador a punta.
    const input = probeInput(
      driverConfig({ targetSpeedFraction: 1, lineSpeedScale: 1, rubberBandPct: RACE_AI.rubberBandPct.easy }),
      CIRCUIT.maxSpeed,
      RACE_AI.rubberBandFullGapPx * 50,
    );
    expect(input.throttle).toBe(false);
    expect(input.brake).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Errores humanos (Poisson)                                           */
/* ------------------------------------------------------------------ */

/**
 * Sim corta de ERRORES: driver sobre monaco con dt real (coche a velocidad
 * crucero, la física no hace falta para el schedule) y RNG semillado.
 */
function countMistakes(difficulty: 'easy' | 'normal' | 'hard', seed: number, simS: number): number {
  const track = getTrackById('monaco')!;
  const path = buildTrackPath(track);
  const line = buildRacingLine(path, track.widthPx);
  const start = path.sample(0);
  const driver = new AiDriver(
    path,
    line,
    driverConfig({
      mistakeEverySec: RACE_AI.mistakeEverySec[difficulty],
      mistakeMagPx: RACE_AI.mistakeMagPx[difficulty],
    }),
    mulberry32(seed),
  );
  const state: CarState = { x: start.x, y: start.y, heading: start.angle, speed: 375 };
  for (let step = 0; step < simS / DT; step += 1) {
    driver.drive(state, DT);
  }
  return driver.mistakes;
}

describe('errores humanos — frecuencia Poisson por dificultad', () => {
  const SIM_SECONDS = 25;
  const SIM_COUNT = 24;

  it('la cantidad total por dificultad cae en banda alrededor de 1/mean', () => {
    const totals: Record<string, number> = {};
    for (const difficulty of ['easy', 'normal', 'hard'] as const) {
      let total = 0;
      for (let i = 0; i < SIM_COUNT; i += 1) {
        total += countMistakes(difficulty, 1000 + i, SIM_SECONDS);
      }
      totals[difficulty] = total;
      const expected = (SIM_COUNT * SIM_SECONDS) / RACE_AI.mistakeEverySec[difficulty];
      // Banda ±100%: la suma de Poisson ruido varía, el orden no.
      expect(total).toBeGreaterThan(expected * 0.5);
      expect(total).toBeLessThan(expected * 2);
    }
    // Documentado (seeds 1000..1023, 24×25 s): easy 67, normal 34, hard 21.
    expect(totals.easy).toBeGreaterThan(totals.normal);
    expect(totals.normal).toBeGreaterThan(totals.hard);
  });

  it('el error TERMINA SOLO: ningún episodio dura más que mistakeMs', () => {
    const track = getTrackById('monaco')!;
    const path = buildTrackPath(track);
    const line = buildRacingLine(path, track.widthPx);
    const start = path.sample(0);
    const driver = new AiDriver(
      path,
      line,
      driverConfig({
        mistakeEverySec: RACE_AI.mistakeEverySec.easy,
        mistakeMagPx: RACE_AI.mistakeMagPx.easy,
      }),
      mulberry32(7),
    );
    const state: CarState = { x: start.x, y: start.y, heading: start.angle, speed: 375 };
    const episodeCapSteps = RACE_AI.mistakeMs / 1000 / DT + 2;
    let run = 0;
    let longestRun = 0;
    let triggered = false;
    for (let step = 0; step < 200 / DT; step += 1) {
      driver.drive(state, DT);
      if (driver.mistaking) {
        triggered = true;
        run += 1;
        longestRun = Math.max(longestRun, run);
      } else {
        run = 0;
      }
    }
    expect(triggered).toBe(true);
    expect(longestRun).toBeLessThanOrEqual(episodeCapSteps);
    expect(driver.mistakes).toBeGreaterThan(0);
  });

  it('sin RNG inyectado no crashea y NO hay errores (piloto limpio)', () => {
    const track = getTrackById('monaco')!;
    const path = buildTrackPath(track);
    const line = buildRacingLine(path, track.widthPx);
    const start = path.sample(0);
    const driver = new AiDriver(
      path,
      line,
      driverConfig({
        mistakeEverySec: RACE_AI.mistakeEverySec.easy,
        mistakeMagPx: RACE_AI.mistakeMagPx.easy,
      }),
    );
    const state: CarState = { x: start.x, y: start.y, heading: start.angle, speed: 375 };
    for (let step = 0; step < 600; step += 1) {
      const input = driver.drive(state, DT);
      expect([-1, 0, 1]).toContain(input.steer);
      expect(typeof input.throttle).toBe('boolean');
    }
    expect(driver.mistakes).toBe(0);
    expect(driver.mistaking).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Adelantamiento                                                      */
/* ------------------------------------------------------------------ */

/** Resultado de la sim de rodeo: desvío máximo vs control y final. */
interface OvertakeRun {
  /** Máximo |lateral − control| durante la aproximación (primeros 2 s). */
  maxDeviationPx: number;
  /** |lateral − control| al final de la sim (6 s): volvió a la línea. */
  finalDeviationPx: number;
}

/**
 * Sim de adelantamiento sobre monaco: el rival arranca en una recta a
 * `rivalSpeed` con un auto lento (SOLO VISIÓN, sin física: los coches se
 * atraviesan) adelante a 150 px. `aggression` y el stub de RNG gobiernan el
 * intento. Devuelve el desvío lateral respecto de una corrida control
 * idéntica SIN tráfico (misma seed): aísla la maniobra del seguimiento.
 */
function simulateOvertake(
  aggression: number,
  rngValue: number | null,
): OvertakeRun {
  const track = getTrackById('monaco')!;
  const path = buildTrackPath(track);
  const line = buildRacingLine(path, track.widthPx);
  const s0 = straightS(line);
  const start = path.sample(s0);

  const run = (withTraffic: boolean): number[] => {
    const state: CarState = {
      x: start.x,
      y: start.y,
      heading: start.angle,
      speed: 625,
    };
    const config = driverConfig({ aggression, lineOffsetPx: 0 });
    const rng: (() => number) | undefined = rngValue === null ? undefined : () => rngValue;
    const driver = new AiDriver(path, line, config, rng);
    const physics = new CircuitPhysics(path, track.widthPx);
    let carS = s0 + 375;
    const laterals: number[] = [];
    for (let step = 0; step < 6 / DT; step += 1) {
      let cars: AiCarVision[] | undefined;
      if (withTraffic) {
        cars = [{ s: carS, lateral: 0, speed: 150 }];
        carS += 150 * DT;
      }
      const input = driver.drive(state, DT, { cars });
      physics.step(state, DT, input);
      laterals.push(path.project(state.x, state.y).lateral);
    }
    return laterals;
  };

  const control = run(false);
  const traffic = run(true);
  const windowSteps = Math.floor(2 / DT);
  let maxDeviationPx = 0;
  for (let i = 0; i < windowSteps; i += 1) {
    maxDeviationPx = Math.max(maxDeviationPx, Math.abs(traffic[i] - control[i]));
  }
  return {
    maxDeviationPx,
    finalDeviationPx: Math.abs(traffic[traffic.length - 1] - control[control.length - 1]),
  };
}

describe('adelantamiento — búsqueda de hueco con visión', () => {
  it('detrás de un auto lento lo RODEA (se desvía) y vuelve a la línea al pasar', () => {
    // Stub RNG 0: siempre intenta (roll < chance para cualquier agresión).
    const run = simulateOvertake(0.5, 0);
    // Durante la aproximación la trazada se desvía MÁS que el control.
    // (Umbrales ×2.5 con el mundo del #18: el desvío de la maniobra es
    // `overtakeSidePx`, que escaló 34 → 85.)
    expect(run.maxDeviationPx).toBeGreaterThan(38);
    // Pasado el auto, el desvío vuelve a ~0 (retorno suave a la línea).
    expect(run.finalDeviationPx).toBeLessThan(25);
  });

  it('con aggression baja lo intenta MENOS (determinista con stub de RNG)', () => {
    // Stub 0.9: el agresivo (chance 0.925) pasa el roll y maniobra; el
    // tímido (chance 0.325) jamás — mismo mundo, misma seed, distinto carácter.
    const aggressive = simulateOvertake(0.9, 0.9);
    const shy = simulateOvertake(0.1, 0.9);
    expect(aggressive.maxDeviationPx).toBeGreaterThan(38);
    expect(shy.maxDeviationPx).toBeLessThan(13);
    // Y sin maniobra no hay desvío final que explicar.
    expect(shy.finalDeviationPx).toBeLessThan(13);
  });
});

/* ------------------------------------------------------------------ */
/* Tabla de validación del issue — pista × dificultad                  */
/* ------------------------------------------------------------------ */

/** Resultado de la sim de N vueltas de UN rival (cableado RaceScene V2). */
interface LapSimResult {
  avgLapMs: number;
  lapsCompleted: number;
  finished: boolean;
  offTrackRatio: number;
}

/**
 * Sim headless del rival elegido del roster (con RNG propio, errores y
 * goma apagados para la tabla: el ritmo del PRESET, sin ruido de carrera
 * con tráfico) — el mismo harness de `aiDriverVsCpu.test.ts`.
 */
function simulateLaps(
  trackDef: TrackDefinition,
  seed: number,
  difficulty: 'easy' | 'normal' | 'hard',
  totalLaps: number,
): LapSimResult {
  const path = buildTrackPath(trackDef);
  const roster = buildRivalRoster(seed, difficulty);
  const rival = medianRival(roster);
  const slots = assignGridOrder(
    [{ peerId: PLAYER_PEER_ID }, ...roster.map((entry) => ({ peerId: entry.peerId }))],
    seed,
    path,
  );
  const slot = slots.find((entry) => entry.peerId === rival.peerId)!;
  const line = buildRacingLine(path, trackDef.widthPx);
  const state: CarState = {
    x: slot.x ?? path.sample(0).x,
    y: slot.y ?? path.sample(0).y,
    heading: slot.angle ?? 0,
    speed: 0,
  };
  const physics = new CircuitPhysics(path, trackDef.widthPx);
  const driver = new AiDriver(
    path,
    line,
    rivalDriverConfig(rival, difficulty),
    mulberry32(rival.seed),
  );
  const laps = new LapTracker(path, { totalLaps });
  const lapTimes: number[] = [];
  laps.onLapCompleted = (event) => lapTimes.push(event.lapMs);
  const cap = Math.ceil((totalLaps * path.totalLength) / (CIRCUIT.referenceSpeed * DT)) + 6000;

  let offTrackSteps = 0;
  let steps = 0;
  while (!laps.finished && steps < cap) {
    const input = driver.drive(state, DT);
    physics.step(state, DT, input);
    const projection = path.project(state.x, state.y);
    if (Math.abs(projection.lateral) > trackDef.widthPx / 2) {
      offTrackSteps += 1;
    }
    laps.update(projection.s, DT * 1000);
    steps += 1;
  }
  return {
    avgLapMs: lapTimes.length > 0
      ? lapTimes.reduce((total, lapMs) => total + lapMs, 0) / lapTimes.length
      : 0,
    lapsCompleted: laps.lapsCompleted,
    finished: laps.finished,
    offTrackRatio: offTrackSteps / Math.max(steps, 1),
  };
}

/**
 * Tabla MEDIDA (V2, seeds TEST_SEED) de vuelta promedio (ms) del rival MEDIO
 * (speedScale mediano del roster), promedio de sus 3 vueltas desde parrilla —
 * presets puros por dificultad, con RNG propio del rival:
 *
 *   pista       | fácil  | normal | difícil
 *   ------------+--------+--------+--------
 *   monaco      | 29756  | 27489  | 24256
 *   monza       | 29856  | 27383  | 24028
 *   silverstone | 29683  | 27272  | 23956
 *   spa         | 29733  | 27378  | 24089
 *   suzuka      | 29594  | 27517  | 24378
 *   galvez      | 29272  | 27028  | 24133
 *
 * Solape acotado (medido, mismas seeds): normal es 7.0–8.3% más rápido que
 * fácil y difícil 10.7–12.3% más rápido que normal — se pueden batir entre
 * sí en una carrera punta a punta, pero NUNCA se confunden en el ritmo.
 */
const MEASURED_MEDIAN_RIVAL_LAP_MS: Record<
  TrackDefinition['id'],
  Record<'easy' | 'normal' | 'hard', number>
> = {
  monaco: { easy: 29756, normal: 27489, hard: 24256 },
  monza: { easy: 29856, normal: 27383, hard: 24028 },
  silverstone: { easy: 29683, normal: 27272, hard: 23956 },
  spa: { easy: 29733, normal: 27378, hard: 24089 },
  suzuka: { easy: 29594, normal: 27517, hard: 24378 },
  galvez: { easy: 29272, normal: 27028, hard: 24133 },
};

/** Ancho de la banda de validación alrededor de lo medido (±10%). */
const DIFFICULTY_BAND_RATIO = 0.1;

/** Solape mínimo exigido entre dificultades consecutivas (3% de vuelta). */
const DIFFICULTY_MIN_GAP_RATIO = 0.03;

describe('tabla de validación — vuelta media del rival medio por pista × dificultad', () => {
  for (const track of TRACKS) {
    for (const difficulty of ['easy', 'normal', 'hard'] as const) {
      const measured = MEASURED_MEDIAN_RIVAL_LAP_MS[track.id][difficulty];
      it(`${track.id} · ${difficulty}: ~${measured} ms (±${DIFFICULTY_BAND_RATIO * 100}%) en asfalto`, () => {
        const result = simulateLaps(track, TEST_SEED, difficulty, CIRCUIT.totalLaps);
        expect(result.finished).toBe(true);
        expect(result.lapsCompleted).toBe(CIRCUIT.totalLaps);
        expect(result.offTrackRatio).toBeLessThanOrEqual(0.02);
        expect(result.avgLapMs).toBeGreaterThanOrEqual(measured * (1 - DIFFICULTY_BAND_RATIO));
        expect(result.avgLapMs).toBeLessThanOrEqual(measured * (1 + DIFFICULTY_BAND_RATIO));
      });
    }

    it(`${track.id}: las 3 dificultades son DISTINGUIBLES (solape acotado)`, () => {
      const easy = simulateLaps(track, TEST_SEED, 'easy', CIRCUIT.totalLaps).avgLapMs;
      const normal = simulateLaps(track, TEST_SEED, 'normal', CIRCUIT.totalLaps).avgLapMs;
      const hard = simulateLaps(track, TEST_SEED, 'hard', CIRCUIT.totalLaps).avgLapMs;
      // NORMAL puede batir a FÁCIL y DIFÍCIL a NORMAL, pero con margen:
      // nunca vueltas idénticas entre dificultades.
      expect(normal).toBeLessThanOrEqual(easy * (1 - DIFFICULTY_MIN_GAP_RATIO));
      expect(hard).toBeLessThanOrEqual(normal * (1 - DIFFICULTY_MIN_GAP_RATIO));
    });
  }
});
