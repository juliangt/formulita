import { describe, expect, it } from 'vitest';
import { CIRCUIT, RACE_AI } from '../../config/balance';
import { AiDriver, type AiCarVision, type AiDriverConfig } from '../../race/ai/aiDriver';
import { buildRacingLine } from '../../race/ai/racingLine';
import { buildRivalRoster, rivalDriverConfig, type Rival } from '../../race/ai/rivalRoster';
import { mulberry32 } from '../../net/roomRng';
import { CircuitPhysics, type CarState } from '../../race/circuitPhysics';
import { LapTracker } from '../../race/lapTracker';
import { assignGridOrder } from '../../race/gridOrder';
import {
  finalClassification,
  rankCars,
  type FinalCar,
  type FinalStanding,
  type RaceStanding,
} from '../../race/raceRanking';
import { buildTrackPath, getTrackById, TRACKS, type TrackDefinition } from '../../race/tracks';
import { TrackPath } from '../../race/trackPath';
import type { CpuDifficulty } from '../../race/results';

/**
 * QA issue #14 (V1) — pilotos REALES vs CPU de punta a punta y SIN Phaser:
 *
 * - Driver puro: produce `CircuitInput` (throttle/brake/steer) a partir del
 *   estado, NO muta posiciones, FRENA por lookahead antes de las curvas
 *   lentas (cinemática de frenada sobre la línea), corrige el error angular
 *   hacia el punto de mira (zona muerta incluida) y vuelve solo si se lo
 *   desplaza. Sigue la LÍNEA DE CARRERA, no el eje.
 * - Sim determinista: la sim usa `buildRivalRoster` + `rivalDriverConfig` +
 *   parrilla de `assignGridOrder` — el MISMO cableado de `RaceScene.setupVsCpu`.
 *   Misma (pista, seed, dificultad) ⇒ trayectoria EXACTA bit a bit.
 * - Vueltas completas en LAS 5 PISTAS × 3 DIFICULTADES (no queda stuck: el
 *   progreso avanza en cada ventana de 5 s, casi todo el tiempo en asfalto).
 * - Banda de vuelta por pista para un rival a speedPct alto (tabla medida).
 * - Carrera completa de 3 vueltas con PARRILLA DE 8: ranking vivo y
 *   clasificación final (`finalClassification`) con posiciones 1..8.
 *
 * Espeja el cableado de RaceScene V1 (`setupVsCpu`/`stepVsCpu`/
 * `buildVsCpuResults`) al nivel sistemas, igual que hace el full-flow de #9.
 */

/** Paso fijo de la sim headless (60 Hz, igual criterio que el render). */
const DT = 1 / 60;

/** peerId canónico del auto propio en la parrilla local (contrato RaceScene). */
const PLAYER_PEER_ID = 'player';

/** Seed fija de los tests (cualquiera sirve: todo es determinista). */
const TEST_SEED = 20260101;

/** Ventana anti-stuck (pasos): 5 s de sim por bloque. */
const STUCK_WINDOW_STEPS = 300;

/** Progreso mínimo esperado en una ventana de 5 s (px; a ~180 px/s son 900). */
const STUCK_MIN_PROGRESS_PX = 50;

/** % máximo de tiempo fuera del asfalto (medido: 0.0% en todas las sims). */
const OFF_TRACK_MAX_RATIO = 0.02;

/**
 * Tabla MEDIDA de vuelta promedio (ms) del rival RÁPIDO de
 * `buildRivalRoster(TEST_SEED, 'hard')` (mayor `speedScale`), promedio de sus
 * 3 vueltas desde parrilla — V2 (issue #14) con presets de dificultad
 * (`speedPct` 0.97, `lineQuality` 0.97, errores y goma incluidos):
 *
 *   monaco: 24583 · monza: 24450 · silverstone: 24350 · spa: 24444 ·
 *   suzuka: 24656   (0.0% del tiempo fuera de asfalto en las 5 pistas;
 *   la primera vuelta cuesta ~1.1 s más: arranca parado en la parrilla).
 *
 * La banda del test es ±12% alrededor de lo medido: bastante más rápido que
 * esto sólo sería posible cortando el pasto (invalida), bastante más lento
 * indica un driver trabado.
 */
const MEASURED_AVG_LAP_MS: Record<TrackDefinition['id'], number> = {
  monaco: 24583,
  monza: 24450,
  silverstone: 24350,
  spa: 24444,
  suzuka: 24656,
};

/** Ancho de la banda de vuelta alrededor de lo medido (±12%). */
const LAP_BAND_RATIO = 0.12;

/** Preset de driver equivalente al que arma `rivalDriverConfig` SIN personalidad
 * y SIN carácter V2 (sin errores, sin goma: los tests unitarios de conducción
 * quedan puros). */
function baseDriverConfig(difficulty: CpuDifficulty): AiDriverConfig {
  return {
    targetSpeedFraction: RACE_AI.targetSpeedFraction[difficulty],
    lineSpeedScale: RACE_AI.lineSpeedScale[difficulty],
    lineOffsetPx: 0,
    lookAheadPx: RACE_AI.lookAheadPx,
    steerDeadzoneRad: RACE_AI.steerDeadzoneRad,
    brakeMarginSpeedPx: RACE_AI.brakeMarginSpeedPx,
    mistakeEverySec: 0,
    mistakeMagPx: 0,
    aggression: 0.5,
    rubberBandPct: 0,
  };
}

/** El rival de mayor speedScale del roster (el "speedPct alto" de la banda). */
function fastestRival(roster: readonly Rival[]): Rival {
  return [...roster].sort((a, b) => b.speedScale - a.speedScale)[0];
}

/** Resultado de la sim de UN rival (estado + vueltas + calidad de pilotaje). */
interface RivalSimResult {
  state: CarState;
  lapsCompleted: number;
  totalMs: number;
  bestLapMs: number;
  avgLapMs: number;
  lastS: number;
  finished: boolean;
  /** Fracción de pasos con el auto fuera del asfalto (0..1). */
  offTrackRatio: number;
  /** Mínimo progreso neto de una ventana de 5 s (px; stuck ⇒ ~0). */
  minBlockProgressPx: number;
}

/**
 * Sim headless de un rival: roster + parrilla deterministas (seed) → línea de
 * carrera → AiDriver (preset × personalidad) → CircuitPhysics → LapTracker,
 * en el paso fijo, hasta terminar o agotar. Espeja `setupVsCpu`/`stepVsCpu`.
 */
function simulateRival(
  trackDef: TrackDefinition,
  seed: number,
  difficulty: CpuDifficulty,
  pick: (roster: readonly Rival[]) => Rival = (roster) => roster[0],
  totalLaps: number = CIRCUIT.totalLaps,
): RivalSimResult {
  const path = buildTrackPath(trackDef);
  const roster = buildRivalRoster(seed, difficulty);
  const rival = pick(roster);
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
  // V2: el harness espeja el cableado de RaceScene — driver con el RNG PROPIO
  // del rival (errores humanos deterministas por seed).
  const driver = new AiDriver(path, line, rivalDriverConfig(rival, difficulty), mulberry32(rival.seed));
  const laps = new LapTracker(path, { totalLaps });

  const lapTimes: number[] = [];
  laps.onLapCompleted = (event) => {
    lapTimes.push(event.lapMs);
  };

  // Tope holgado: (vueltas + 2) al ritmo de referencia.
  const cap = Math.ceil(((totalLaps + 2) * path.totalLength) / (CIRCUIT.referenceSpeed * DT));

  let lastS = slot.s;
  let unrolled = 0;
  let blockStart = 0;
  let stepsInBlock = 0;
  let minBlockProgressPx = Infinity;
  let offTrackSteps = 0;
  let steps = 0;

  while (!laps.finished && steps < cap) {
    const input = driver.drive(state);
    physics.step(state, DT, input);
    const projection = path.project(state.x, state.y);
    if (Math.abs(projection.lateral) > trackDef.widthPx / 2) {
      offTrackSteps += 1;
    }
    laps.update(projection.s, DT * 1000);

    // Progreso DESENROLLADO (continuo en la meta) para el chequeo no-stuck.
    let ds = projection.s - lastS;
    if (ds < -path.totalLength / 2) {
      ds += path.totalLength;
    } else if (ds > path.totalLength / 2) {
      ds -= path.totalLength;
    }
    unrolled += ds;
    lastS = projection.s;
    steps += 1;
    stepsInBlock += 1;
    if (stepsInBlock === STUCK_WINDOW_STEPS) {
      minBlockProgressPx = Math.min(minBlockProgressPx, unrolled - blockStart);
      blockStart = unrolled;
      stepsInBlock = 0;
    }
  }

  return {
    state: { ...state },
    lapsCompleted: laps.lapsCompleted,
    totalMs: laps.totalMs,
    bestLapMs: laps.bestLapMs,
    avgLapMs: lapTimes.length > 0
      ? lapTimes.reduce((total, lapMs) => total + lapMs, 0) / lapTimes.length
      : 0,
    lastS,
    finished: laps.finished,
    offTrackRatio: offTrackSteps / Math.max(steps, 1),
    minBlockProgressPx: minBlockProgressPx === Infinity ? unrolled : minBlockProgressPx,
  };
}

/* ------------------------------------------------------------------ */
/* Contrato puro del driver                                            */
/* ------------------------------------------------------------------ */

describe('AiDriver — contrato puro del piloto (línea de carrera)', () => {
  const track = getTrackById('monaco')!;
  const path = buildTrackPath(track);
  const line = buildRacingLine(path, track.widthPx);
  const driver = new AiDriver(path, line, baseDriverConfig('normal'));

  it('no muta el estado: sólo LEE {x, y, heading, speed} y devuelve input', () => {
    const slot = assignGridOrder([{ peerId: 'a' }], 1, path)[0];
    const state: CarState = { x: slot.x!, y: slot.y!, heading: slot.angle!, speed: 100 };
    const snapshot = { ...state };
    const input = driver.drive(state);
    expect(state).toEqual(snapshot);
    expect(input.throttle).toEqual(expect.any(Boolean));
    expect(input.brake).toEqual(expect.any(Boolean));
    expect([-1, 0, 1]).toContain(input.steer);
  });

  it('acelera por debajo del objetivo y suelta al alcanzarlo (en una recta)', () => {
    // Punto de máxima velocidad objetivo de la línea (= una recta de monaco).
    let straightS = 0;
    for (let i = 0; i < line.pointCount; i += 1) {
      if (line.pointAtIndex(i).targetSpeed === CIRCUIT.maxSpeed) {
        straightS = line.pointAtIndex(i).s;
        break;
      }
    }
    const start = path.sample(straightS);
    const slow: CarState = { x: start.x, y: start.y, heading: start.angle, speed: 0 };
    const cap = CIRCUIT.maxSpeed * RACE_AI.targetSpeedFraction.normal;
    const fast: CarState = { x: start.x, y: start.y, heading: start.angle, speed: cap };
    expect(driver.drive(slow)).toMatchObject({ throttle: true, brake: false });
    // Al cap el acelerador sale del piso (el objetivo nunca supera el cap):
    // sin margen de sobra NO frena (target == speed, regulación por coast).
    expect(driver.drive(fast).throttle).toBe(false);
  });

  it('FRENA por lookahead cuando llega RÁPIDO a una curva lenta (y no frenando lento)', () => {
    // El punto más lento de la línea de monaco (una horquilla).
    let slowest = line.pointAtS(0);
    for (let i = 0; i < line.pointCount; i += 1) {
      const point = line.pointAtIndex(i);
      if (point.targetSpeed < slowest.targetSpeed) {
        slowest = point;
      }
    }
    const start = path.sample(slowest.s);
    const flying: CarState = {
      x: start.x,
      y: start.y,
      heading: start.angle,
      speed: CIRCUIT.maxSpeed,
    };
    // A la punta sobre una curva que pide ~170: el freno entra ANTES de la
    // curva (velocidad > objetivo + margen de frenada).
    expect(driver.drive(flying)).toMatchObject({ brake: true, throttle: false });

    // El MISMO punto al ritmo de la curva: acelera (o coast), jamás frena.
    const slow: CarState = { ...flying, speed: slowest.targetSpeed * 0.5 };
    expect(driver.drive(slow).brake).toBe(false);
  });

  it('corrige el error angular: girando hacia el punto de mira, el error baja', () => {
    const start = path.sample(0);
    // Desalineado medio radian respecto de la tangente, sobre el eje.
    const state: CarState = { x: start.x, y: start.y, heading: start.angle + 0.5, speed: 150 };
    const input = driver.drive(state);
    // El volante es bang-bang: con medio radian de error, gira a fondo.
    expect(input.steer).not.toBe(0);
    const physics = new CircuitPhysics(path, track.widthPx);
    const before = Math.abs(path.project(state.x, state.y).angle - state.heading);
    physics.step(state, DT, input);
    const after = Math.abs(path.project(state.x, state.y).angle - state.heading);
    expect(after).toBeLessThan(before);
  });

  it('respeta la zona muerta: alineado con una recta perfecta, volante recto', () => {
    // Cuadrado gigante (misma técnica del full-flow de #9): el tramo medio de
    // cada lado es una recta PERFECTA — la línea converge al eje y el punto
    // de mira (120 px adelante sobre la línea) queda exactamente adelante.
    const SIDE = 200_000;
    const square = new TrackPath([
      { x: 0, y: 0 },
      { x: SIDE, y: 0 },
      { x: SIDE, y: SIDE },
      { x: 0, y: SIDE },
    ]);
    const squareLine = buildRacingLine(square, track.widthPx);
    const squareDriver = new AiDriver(square, squareLine, baseDriverConfig('normal'));
    const straight = square.sample(SIDE / 2);
    const state: CarState = {
      x: straight.x,
      y: straight.y,
      heading: straight.angle,
      speed: 150,
    };
    expect(squareLine.pointAtS(SIDE / 2 + RACE_AI.lookAheadPx).targetSpeed)
      .toBe(CIRCUIT.maxSpeed);
    expect(squareDriver.drive(state).steer).toBe(0);
  });

  it('vuelve al asfalto si se lo desplaza (sin quedar tirado en el pasto)', () => {
    const start = path.sample(0);
    const halfWidth = track.widthPx / 2;
    // 3/4 del ancho hacia un lado, alineado con la tangente: fuera del ruedo,
    // el driver apunta a la LÍNEA (siempre sobre asfalto) y la física lo
    // trae de vuelta — la proyección al eje sigue viva fuera de pista.
    const normal = start.angle + Math.PI / 2;
    const state: CarState = {
      x: start.x + Math.cos(normal) * halfWidth * 0.75,
      y: start.y + Math.sin(normal) * halfWidth * 0.75,
      heading: start.angle,
      speed: 120,
    };
    const physics = new CircuitPhysics(path, track.widthPx);
    let lateral = Math.abs(path.project(state.x, state.y).lateral);
    for (let step = 0; step < 300; step += 1) {
      physics.step(state, DT, driver.drive(state));
      lateral = Math.abs(path.project(state.x, state.y).lateral);
    }
    expect(lateral).toBeLessThan(halfWidth * 0.5);
  });
});

/* ------------------------------------------------------------------ */
/* Determinismo de la sim                                              */
/* ------------------------------------------------------------------ */

describe('Sim determinista — misma seed ⇒ mismo resultado', () => {
  it('misma (pista, seed, dificultad, rival) dos veces ⇒ estados idénticos bit a bit', () => {
    const track = getTrackById('monaco')!;
    const a = simulateRival(track, TEST_SEED, 'normal');
    const b = simulateRival(track, TEST_SEED, 'normal');
    expect(a).toEqual(b);
    expect(a.state).toEqual(b.state);
    expect(a.totalMs).toBe(b.totalMs);
    expect(a.lastS).toBe(b.lastS);
  });

  it('el determinismo vale también con la carrera completa de 3 vueltas', () => {
    const track = getTrackById('spa')!;
    const a = simulateRival(track, 777, 'hard');
    const b = simulateRival(track, 777, 'hard');
    expect(a.finished).toBe(true);
    expect(a).toEqual(b);
  });

  it('V2: la carrera COMPLETA de 8 (con visión, errores y goma) es reproducible', () => {
    const track = getTrackById('monza')!;
    const a = simulateRace(track, TEST_SEED, 'normal', CIRCUIT.maxSpeed * 0.9);
    const b = simulateRace(track, TEST_SEED, 'normal', CIRCUIT.maxSpeed * 0.9);
    expect(a.playerPosition).toBe(b.playerPosition);
    expect(a.classification).toEqual(b.classification);
    expect(a.rivalLaps).toEqual(b.rivalLaps);
    expect(a.standings).toEqual(b.standings);
  });

  it('la seed cambia la parrilla de 8 (misma función de #9 que usa la escena)', () => {
    const track = getTrackById('monza')!;
    const path = buildTrackPath(track);
    const roster = buildRivalRoster(TEST_SEED, 'normal');
    const entrants = [
      { peerId: PLAYER_PEER_ID },
      ...roster.map((rival) => ({ peerId: rival.peerId })),
    ];
    const slotsA = assignGridOrder(entrants, TEST_SEED, path);
    const slotsB = assignGridOrder(entrants, TEST_SEED + 1, path);
    expect(assignGridOrder(entrants, TEST_SEED, path)).toEqual(slotsA);
    // Parrilla de 8: jugador + 7 rivales, 8 casillas únicas.
    expect(slotsA).toHaveLength(1 + RACE_AI.rivalCount);
    expect(new Set(slotsA.map((slot) => slot.peerId)).size).toBe(1 + RACE_AI.rivalCount);
    // Otra seed permuta el orden (verificado para estas seeds fijas).
    expect(slotsA.map((slot) => slot.peerId)).not.toEqual(slotsB.map((slot) => slot.peerId));
  });
});

/* ------------------------------------------------------------------ */
/* Vueltas completas: no-stuck en 5 pistas × 3 dificultades            */
/* ------------------------------------------------------------------ */

describe('El driver completa vueltas en las 5 pistas (no queda stuck)', () => {
  for (const track of TRACKS) {
    for (const difficulty of ['easy', 'normal', 'hard'] as const) {
      it(`${track.id} · ${difficulty}: completa las 3 vueltas avanzando y en asfalto`, () => {
        const result = simulateRival(track, TEST_SEED, difficulty);
        expect(result.finished).toBe(true);
        expect(result.lapsCompleted).toBe(CIRCUIT.totalLaps);
        expect(result.totalMs).toBeGreaterThan(0);
        // "Sin quedar stuck": llega a la meta con velocidad de crucero, su
        // vuelta media es mejor que ir casi parado y el progreso avanza en
        // TODAS las ventanas de 5 s (ningún tramo en el que quede clavado).
        expect(result.state.speed).toBeGreaterThan(CIRCUIT.referenceSpeed * 0.8);
        expect(result.totalMs).toBeLessThan(CIRCUIT.lapMaxSeconds * 1000 * CIRCUIT.totalLaps);
        expect(result.minBlockProgressPx).toBeGreaterThan(STUCK_MIN_PROGRESS_PX);
        // No vive en el pasto: el castigo de velocidad del pasto invalidaría
        // cualquier ritmo (medido: 0.0% fuera del asfalto).
        expect(result.offTrackRatio).toBeLessThanOrEqual(OFF_TRACK_MAX_RATIO);
      });
    }
  }
});

/* ------------------------------------------------------------------ */
/* Banda de vuelta por pista (rival a speedPct alto)                   */
/* ------------------------------------------------------------------ */

describe('Banda de vuelta por pista — rival rápido (speedPct alto)', () => {
  for (const track of TRACKS) {
    const measured = MEASURED_AVG_LAP_MS[track.id];
    const bandMinMs = measured * (1 - LAP_BAND_RATIO);
    const bandMaxMs = measured * (1 + LAP_BAND_RATIO);

    it(`${track.id}: vuelta media ~${measured} ms (±${LAP_BAND_RATIO * 100}%) sin salirse`, () => {
      const result = simulateRival(
        track,
        TEST_SEED,
        'hard',
        (roster) => fastestRival(roster),
      );
      expect(result.finished).toBe(true);
      expect(result.lapsCompleted).toBe(CIRCUIT.totalLaps);
      expect(result.avgLapMs).toBeGreaterThanOrEqual(bandMinMs);
      expect(result.avgLapMs).toBeLessThanOrEqual(bandMaxMs);
      // La mejor vuelta no puede estar LEJOS de la media (sin vueltas
      // mágicas ni vueltas trabadas).
      expect(result.bestLapMs).toBeGreaterThanOrEqual(bandMinMs);
      // En asfalto (no se sale) y avanzando siempre.
      expect(result.offTrackRatio).toBeLessThanOrEqual(OFF_TRACK_MAX_RATIO);
      expect(result.minBlockProgressPx).toBeGreaterThan(STUCK_MIN_PROGRESS_PX * 2);
    });
  }
});

/* ------------------------------------------------------------------ */
/* Carrera completa con parrilla de 8: ranking + clasificación         */
/* ------------------------------------------------------------------ */

/** Resultado de la carrera completa simulada (jugador scripteado + 7 rivales). */
interface RaceSimResult {
  /** Ranking vivo final (replica el `rankCars` de `stepVsCpu`). */
  standings: RaceStanding[];
  /** Clasificación final (replica `buildVsCpuResults`). */
  classification: FinalStanding[];
  playerPosition: number;
  /** Rivales que completaron SUS 3 vueltas antes de que termine el jugador. */
  rivalsFinished: number;
  rivalLaps: number[];
}

/**
 * Carrera completa de 3 vueltas con parrilla de 8: los 7 rivales corren con
 * su driver real (roster + línea + física, cableado exacto de RaceScene V1) y
 * el "jugador" avanza SCRIPTeado a `playerSpeed` desde SU casilla (misma
 * técnica del full-flow de #9: la física del jugador ya está ejercitada por
 * otros tests; acá importa el ranking/clasificación). El modo corta cuando el
 * JUGADOR termina; los rivales que ya terminaron quedan congelados.
 */
function simulateRace(
  trackDef: TrackDefinition,
  seed: number,
  difficulty: CpuDifficulty,
  playerSpeed: number,
): RaceSimResult {
  const path = buildTrackPath(trackDef);
  const length = path.totalLength;
  const roster = buildRivalRoster(seed, difficulty);
  const slots = assignGridOrder(
    [{ peerId: PLAYER_PEER_ID }, ...roster.map((rival) => ({ peerId: rival.peerId }))],
    seed,
    path,
  );
  const line = buildRacingLine(path, trackDef.widthPx);
  const slotsByPeer = new Map(slots.map((slot) => [slot.peerId, slot]));

  // Runtime de rivales: driver V2 (rng propio) + física + vueltas
  // (setupVsCpu exacto) y su ÚLTIMA proyección para la visión.
  const rivals = roster.map((rival) => {
    const slot = slotsByPeer.get(rival.peerId)!;
    const state: CarState = {
      x: slot.x ?? path.sample(0).x,
      y: slot.y ?? path.sample(0).y,
      heading: slot.angle ?? 0,
      speed: 0,
    };
    return {
      rival,
      state,
      physics: new CircuitPhysics(path, trackDef.widthPx),
      laps: new LapTracker(path),
      driver: new AiDriver(
        path,
        line,
        rivalDriverConfig(rival, difficulty),
        mulberry32(rival.seed),
      ),
      lastS: slot.s,
      lastLateral: 0,
      finished: false,
    };
  });

  // Jugador scripteado: progreso lineal sobre el eje desde SU casilla.
  const playerSlot = slotsByPeer.get(PLAYER_PEER_ID)!;
  const playerLaps = new LapTracker(path);
  let playerDistance = 0;
  let playerS = playerSlot.s;

  // Tope: la duración SCRIPTeada del jugador + 60 s de margen.
  const cap = Math.ceil(
    ((CIRCUIT.totalLaps * length) / playerSpeed + 60) / DT,
  );

  for (let step = 0; step < cap && !playerLaps.finished; step += 1) {
    // Visión V2 (stepVsCpu exacto): estado al INICIO del frame de todos los
    // autos + gap de progreso de cada rival al jugador.
    const playerProgress = playerLaps.lapsCompleted * length + playerS;
    const playerVision: AiCarVision = { s: playerS, lateral: 0, speed: playerSpeed };
    const rivalVisions: AiCarVision[] = rivals.map((rival) => ({
      s: rival.lastS,
      lateral: rival.lastLateral,
      speed: rival.state.speed,
    }));

    // Rivales en el MISMO paso fijo que el jugador; el que terminó SUS
    // vueltas se congela (stepVsCpu exacto).
    for (let i = 0; i < rivals.length; i += 1) {
      const rival = rivals[i];
      if (rival.finished) {
        continue;
      }
      const others = rivalVisions.filter((_, j) => j !== i);
      others.push(playerVision);
      const rivalProgress = rival.laps.lapsCompleted * length + rival.lastS;
      rival.physics.step(
        rival.state,
        DT,
        rival.driver.drive(rival.state, DT, {
          cars: others,
          playerGapPx: playerProgress - rivalProgress,
        }),
      );
      const projection = path.project(rival.state.x, rival.state.y);
      rival.lastS = projection.s;
      rival.lastLateral = projection.lateral;
      rival.laps.update(projection.s, DT * 1000);
      if (rival.laps.finished) {
        rival.finished = true;
      }
    }
    playerDistance += playerSpeed * DT;
    playerS = (playerSlot.s + playerDistance) % length;
    playerLaps.update(playerS, DT * 1000);
  }

  // Ranking en vivo de 8 autos (replica stepVsCpu).
  const standings = rankCars(
    { peerId: PLAYER_PEER_ID, lap: playerLaps.lapsCompleted, s: playerS },
    rivals.map((rival) => ({
      peerId: rival.rival.peerId,
      lap: rival.laps.lapsCompleted,
      s: rival.lastS,
    })),
    length,
  );

  // Clasificación final (replica buildVsCpuResults): el jugador siempre
  // termina (el modo corta con SU bandera); cada rival por tiempo o progreso.
  const cars: FinalCar[] = [
    {
      peerId: PLAYER_PEER_ID,
      lap: playerLaps.lapsCompleted,
      s: playerS,
      status: 'finished',
      totalMs: playerLaps.totalMs,
    },
    ...rivals.map((rival): FinalCar =>
      rival.finished
        ? {
            peerId: rival.rival.peerId,
            lap: rival.laps.lapsCompleted,
            s: rival.lastS,
            status: 'finished' as const,
            totalMs: rival.laps.totalMs,
          }
        : {
            peerId: rival.rival.peerId,
            lap: rival.laps.lapsCompleted,
            s: rival.lastS,
            status: 'running' as const,
          },
    ),
  ];
  const classification = finalClassification(cars, length);
  return {
    standings,
    classification,
    playerPosition:
      classification.find((row) => row.peerId === PLAYER_PEER_ID)?.position ?? 0,
    rivalsFinished: rivals.filter((rival) => rival.finished).length,
    rivalLaps: rivals.map((rival) => rival.laps.lapsCompleted),
  };
}

describe('Carrera vs CPU con parrilla de 8 — ranking y clasificación (issue #14)', () => {
  const track = getTrackById('monza')!;

  it('jugador lento: los 7 rivales lo pasan y clasifica 8º (todos terminaron)', () => {
    const result = simulateRace(track, TEST_SEED, 'hard', CIRCUIT.referenceSpeed * 0.7);
    // Parrilla de 8: ranking y clasificación cubren a los 8.
    expect(result.standings).toHaveLength(1 + RACE_AI.rivalCount);
    expect(result.classification).toHaveLength(1 + RACE_AI.rivalCount);
    // Posiciones exactamente 1..8, sin repeticiones.
    expect(result.classification.map((row) => row.position).sort((a, b) => a - b))
      .toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // A 0.7× la referencia no le gana ni al auto de seguridad: último.
    expect(result.playerPosition).toBe(8);
    // Los rivales 'hard' completaron SUS 3 vueltas con holgura.
    expect(result.rivalsFinished).toBe(RACE_AI.rivalCount);
    expect(result.rivalLaps.every((laps) => laps === CIRCUIT.totalLaps)).toBe(true);
  });

  it('jugador rápido: gana él y los rivales clasifican detrás (2º..8º)', () => {
    // V2: los presets 'hard' son RÁPIDOS (speedPct 0.97 + personalidad por
    // encima de la línea + goma), tanto que un jugador plano AL TECHO físico
    // (300 px/s) puede perder contra el rival de pole. El caso que el test
    // fija es "un jugador claramente más veloz que CUALQUIER CPU gana": el
    // auto scripteado corre por encima del techo de los rivales.
    const result = simulateRace(track, TEST_SEED, 'hard', CIRCUIT.maxSpeed * 1.15);
    expect(result.standings).toHaveLength(1 + RACE_AI.rivalCount);
    expect(result.playerPosition).toBe(1);
    // Ningún rival puede terminar ADELANTE del jugador en la clasificación.
    expect(result.classification[0].peerId).toBe(PLAYER_PEER_ID);
    expect(result.classification[0].position).toBe(1);
  });

  it('el ranking con 8 coches empatados resuelve por peerId ASC, posiciones 1..8', () => {
    const length = buildTrackPath(track).totalLength;
    const roster = buildRivalRoster(TEST_SEED, 'normal');
    const standings = rankCars(
      { peerId: PLAYER_PEER_ID, lap: 2, s: 1200 },
      roster.map((rival) => ({ peerId: rival.peerId, lap: 2, s: 1200 })),
      length,
    );
    // Empate total de progreso ⇒ tiebreak determinista por peerId ASC
    // ('player' < 'rival-0' < … < 'rival-6') y posiciones sin empates.
    expect(standings.map((row) => row.peerId)).toEqual([
      PLAYER_PEER_ID,
      ...roster.map((rival) => rival.peerId),
    ]);
    expect(standings.map((row) => row.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
