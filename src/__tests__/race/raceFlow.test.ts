import { describe, expect, it } from 'vitest';
import { CIRCUIT } from '../../config/balance';
import { turnRateAtSpeed, type CarState, CircuitPhysics } from '../../race/circuitPhysics';
import { LapTracker } from '../../race/lapTracker';
import { assignGridOrder } from '../../race/gridOrder';
import { finalClassification } from '../../race/raceRanking';
import { TRACKS, buildTrackPath } from '../../race/tracks';
import type { TrackDefinition } from '../../race/tracks';
import { TrackPath } from '../../race/trackPath';

/**
 * Test estrella de la V1 (issue #9): el flujo completo de la RaceScene
 * simulado headless — física de circuito + LapTracker + ranking (exactamente
 * los sistemas que la escena orquesta por frame, sin Phaser). Un piloto
 * automático (pure pursuit + frenado por curvatura, giro binario como el
 * input real del juego) tiene que completar las 3 vueltas de CADA pista
 * dentro de la banda de tiempos, sin cortarse sectores.
 */

/** Paso de simulación (s): el juego corre a ~60 fps. */
const DT = 1 / 60;
/** Distancia de mirada del pure pursuit (px; ×2.5 con el mundo del #18). */
const LOOKAHEAD_PX = 225;
/** Distancias de anticipación del frenado (px; ×2.5 con el mundo del #18). */
const BRAKE_LOOKAHEADS_PX = [150, 375] as const;
/** Margen del frenado: frena apenas la punta supere el máximo de curva (px/s). */
const BRAKE_MARGIN_PXS = 10;
/** Zona muerta del giro (rad): con giro binario evita el zigzag. */
const STEER_DEADZONE_RAD = 0.06;
/** Tope de simulación (pasos): 15 minutos de carrera simulada. */
const STEP_CAP = 60 * 60 * 15;

/** Normaliza un ángulo a (−π, π]. */
function normalizeAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) {
    a -= Math.PI * 2;
  }
  while (a < -Math.PI) {
    a += Math.PI * 2;
  }
  return a;
}

/**
 * Velocidad máxima sostenible en una curva de radio `radius` (px): resuelve
 * `v = turnRateAtSpeed(v) × radius` (turnRate es lineal en v) con un 10%
 * de seguridad. En recta (kappa ≈ 0) devuelve la punta.
 */
function maxCorneringSpeed(radius: number): number {
  const turnBase = CIRCUIT.turnRateBase;
  const turnSlope = (CIRCUIT.turnRateBase - CIRCUIT.turnRateAtMaxSpeed) / CIRCUIT.maxSpeed;
  const vmax = (turnBase * radius) / (1 + turnSlope * radius);
  return Math.min(CIRCUIT.maxSpeed, vmax * 0.9);
}

interface RaceResult {
  tracker: LapTracker;
  state: CarState;
  steps: number;
  offTrackRatio: number;
}

/**
 * Corre una carrera completa en la pista dada: parrilla real (pole detrás de
 * la meta), física, vueltas. Devuelve también la fracción de tiempo fuera de
 * asfalto (el piloto debería mantenerse en pista casi siempre).
 */
function simulateRace(def: TrackDefinition, path: TrackPath): RaceResult {
  const physics = new CircuitPhysics(path, def.widthPx);
  const tracker = new LapTracker(path);

  const slot = assignGridOrder([{ peerId: 'player' }], 0, path)[0];
  const state: CarState = {
    x: slot.x ?? path.sample(0).x,
    y: slot.y ?? path.sample(0).y,
    heading: slot.angle ?? 0,
    speed: 0,
  };

  let steps = 0;
  let offTrackSteps = 0;
  const halfWidth = def.widthPx / 2;

  while (!tracker.finished && steps < STEP_CAP) {
    const projection = path.project(state.x, state.y);
    if (Math.abs(projection.lateral) > halfWidth) {
      offTrackSteps += 1;
    }

    // Dirección: pure pursuit hacia el punto de la pista a LOOKAHEAD.
    const target = path.sample(projection.s + LOOKAHEAD_PX);
    const alpha = normalizeAngle(
      Math.atan2(target.y - state.y, target.x - state.x) - state.heading,
    );
    const steer = alpha > STEER_DEADZONE_RAD ? 1 : alpha < -STEER_DEADZONE_RAD ? -1 : 0;

    // Frenado: si la velocidad supera el máximo sostenible de alguna curva
    // venidera (miradas corta y larga), pisa el freno.
    let brake = false;
    for (const ahead of BRAKE_LOOKAHEADS_PX) {
      const here = path.sample(projection.s);
      const there = path.sample(projection.s + ahead);
      const kappa =
        Math.abs(normalizeAngle(there.angle - here.angle)) / Math.max(ahead, 1e-6);
      if (kappa > 1e-9) {
        const vmax = maxCorneringSpeed(1 / kappa);
        if (state.speed > vmax + BRAKE_MARGIN_PXS) {
          brake = true;
          break;
        }
      }
    }

    physics.step(state, DT, { throttle: true, brake, steer });
    tracker.update(path.project(state.x, state.y).s, DT * 1000);
    steps += 1;
  }

  return { tracker, state, steps, offTrackRatio: offTrackSteps / Math.max(steps, 1) };
}

describe('flujo completo de carrera (física + vueltas + ranking, headless)', () => {
  for (const def of TRACKS) {
    it(`completa las 3 vueltas en ${def.name} con tiempos coherentes`, () => {
      const path = buildTrackPath(def);
      const result = simulateRace(def, path);

      // Terminó dentro del tope de simulación (la pista es pasable).
      expect(result.tracker.finished).toBe(true);
      expect(result.tracker.lapsCompleted).toBe(CIRCUIT.totalLaps);

      // El piloto se mantiene en pista casi todo el tiempo (pasto = castigo
      // de velocidad, no error duro, pero un piloto que vive en el pasto
      // invalidaría la banda de tiempos).
      expect(result.offTrackRatio).toBeLessThan(0.2);

      // Ritmo: la vuelta cae en una banda holgada alrededor del objetivo
      // (el piloto no es óptimo pero tampoco anda a 20 km/h).
      const lapsBandMinMs = 20_000;
      const lapsBandMaxMs = 90_000;
      const expectedTotal = CIRCUIT.totalLaps * def.lapTargetMs;
      expect(result.tracker.bestLapMs).toBeGreaterThanOrEqual(lapsBandMinMs);
      expect(result.tracker.bestLapMs).toBeLessThanOrEqual(lapsBandMaxMs);
      expect(result.tracker.totalMs).toBeGreaterThanOrEqual(CIRCUIT.totalLaps * lapsBandMinMs);
      expect(result.tracker.totalMs).toBeLessThanOrEqual(expectedTotal * 2.5);

      // La mejor vuelta es coherente con el total (≤ total/2 con margen:
      // ninguna vuelta puede durar más que la mitad de la carrera completa
      // en una carrera de 3 vueltas pareja).
      expect(result.tracker.bestLapMs).toBeLessThanOrEqual(result.tracker.totalMs * 0.5);

      // La clasificación final con este único corredor: puesto 1, finished,
      // con el tiempo total del tracker.
      const standings = finalClassification(
        [
          {
            peerId: 'player',
            lap: result.tracker.lapsCompleted,
            s: 0,
            status: 'finished',
            totalMs: result.tracker.totalMs,
          },
        ],
        path.totalLength,
      );
      expect(standings).toHaveLength(1);
      expect(standings[0].position).toBe(1);
      expect(standings[0].status).toBe('finished');
      expect(standings[0].totalMs).toBe(result.tracker.totalMs);
    });
  }

  it('el techo de velocidad y el pasto se comportan como declara CIRCUIT', () => {
    // Circuito sintético cuadrado gigante: el tramo medio de cada lado es
    // una recta PERFECTA (Catmull-Rom con vecinos colineales es lineal), así
    // que el auto con steer 0 no se va nunca del asfalto y el measurement
    // del techo queda limpio.
    const SIDE = 200_000;
    const square = new TrackPath([
      { x: 0, y: 0 },
      { x: SIDE, y: 0 },
      { x: SIDE, y: SIDE },
      { x: 0, y: SIDE },
    ]);
    const physics = new CircuitPhysics(square, TRACKS[0].widthPx);
    const midStraight = square.sample(SIDE / 2);
    const state: CarState = {
      x: midStraight.x,
      y: midStraight.y,
      heading: midStraight.angle,
      speed: 0,
    };

    // Acelerando a fondo sobre asfalto: nunca supera maxSpeed. La tangente
    // del circuito sintético es casi recta: siguiéndola la deriva lateral es
    // de unos pocos px, siempre dentro del asfalto (el umbral escala ×2.5
    // con la punta del #18: la deriva cuantiza con speed × dt).
    for (let i = 0; i < 60 * 5; i += 1) {
      physics.step(state, DT, { throttle: true, brake: false, steer: 0 });
      expect(Math.abs(square.project(state.x, state.y).lateral)).toBeLessThan(25);
    }
    expect(state.speed).toBeLessThanOrEqual(CIRCUIT.maxSpeed + 1e-6);
    expect(state.speed).toBeGreaterThan(CIRCUIT.maxSpeed * 0.95);

    // Fuera del asfalto el techo es maxSpeed × grassMaxSpeedFactor.
    const offTrack: CarState = {
      x: midStraight.x,
      y: midStraight.y,
      heading: midStraight.angle,
      speed: CIRCUIT.maxSpeed,
    };
    const lateralOffset = TRACKS[0].widthPx / 2 + 40;
    offTrack.x += Math.cos(midStraight.angle + Math.PI / 2) * lateralOffset;
    offTrack.y += Math.sin(midStraight.angle + Math.PI / 2) * lateralOffset;
    const grassCeiling = CIRCUIT.maxSpeed * CIRCUIT.grassMaxSpeedFactor;
    for (let i = 0; i < 60 * 5; i += 1) {
      physics.step(offTrack, DT, { throttle: true, brake: false, steer: 0 });
      expect(offTrack.speed).toBeLessThanOrEqual(grassCeiling + 1e-6);
    }
    expect(offTrack.speed).toBeLessThanOrEqual(grassCeiling + 1e-6);
  });

  it('la tasa de giro disponible decae con la velocidad (la que valida las curvas)', () => {
    expect(turnRateAtSpeed(0)).toBeCloseTo(CIRCUIT.turnRateBase, 9);
    expect(turnRateAtSpeed(CIRCUIT.maxSpeed)).toBeCloseTo(CIRCUIT.turnRateAtMaxSpeed, 9);
    expect(turnRateAtSpeed(CIRCUIT.maxSpeed / 2)).toBeCloseTo(
      (CIRCUIT.turnRateBase + CIRCUIT.turnRateAtMaxSpeed) / 2,
      9,
    );
  });
});
