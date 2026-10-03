/**
 * circuitPhysics — física arcade de conducción pura (issue #9, V0).
 *
 * Un paso fijo con `dt` inyectado sobre el estado `{x, y, heading, speed}`:
 * - Longitudinal con las TRES acciones explícitas del `CircuitInput`: gas,
 *   freno (prioridad sobre el gas) y giro. Sin gas ni freno el roce
 *   (`coastDrag`) decae la velocidad hacia 0. El default de `step` es el
 *   input "a fondo" (`defaultCircuitInput`), pensado para sims headless —
 *   el input del JUGADOR llega por `raceControls.circuitInputFromState`
 *   (issue #20: gas manual, sin auto-acelerado).
 * - Giro con tasa que DECAE con la velocidad (`turnRateAtSpeed` interpola de
 *   `CIRCUIT.turnRateBase` a `CIRCUIT.turnRateAtMaxSpeed`): a más velocidad,
 *   menos giro. Convención: `steer = -1` izquierda, `+1` derecha (pantalla
 *   con y hacia abajo: heading crece girando a la derecha).
 * - Pasto (sin muros duros): la distancia lateral que da `project` decide;
 *   más allá de `widthPx / 2` del eje, el TECHO de velocidad se recorta a
 *   `maxSpeed × grassMaxSpeedFactor` hasta volver al asfalto.
 *
 * Las constantes viven en `CIRCUIT` (balance.ts): cero números mágicos acá.
 */

import { CIRCUIT } from '../config/balance';
import type { TrackPath } from './trackPath';

/** Estado de un auto en el mundo (px, radianes, px/s). */
export interface CarState {
  x: number;
  y: number;
  /** Orientación (radianes, atan2-style; pantalla y hacia abajo). */
  heading: number;
  /** Velocidad escalar a lo largo del heading (px/s, ≥ 0). */
  speed: number;
}

/**
 * Input de conducción: gas, freno y giro son ACCIONES explícitas (issue #20:
 * el puente del jugador las mapea de teclado/táctil; el AiDriver produce el
 * suyo).
 */
export interface CircuitInput {
  throttle: boolean;
  brake: boolean;
  /** Giro continuo: −1 izquierda, 0 recto, +1 derecha; intermedios = giro
   * proporcional del joystick táctil (issue #37). */
  steer: number;
}

/**
 * Input neutro "a fondo" (default de `step`): acelerador pisado, sin freno
 * ni giro. Lo consumen sims headless y harness; el input del jugador NUNCA
 * llega forzado por acá (ver `raceControls.circuitInputFromState`).
 */
export function defaultCircuitInput(): CircuitInput {
  return { throttle: true, brake: false, steer: 0 };
}

/**
 * Tasa de giro disponible (rad/s) a una velocidad dada: interpola linealmente
 * de `turnRateBase` (parado) a `turnRateAtMaxSpeed` (a punta). Es la función
 * que consume la validación de pistas (radio de curvatura mínimo alcanzable).
 */
export function turnRateAtSpeed(speed: number): number {
  const s = Number.isFinite(speed)
    ? Math.min(Math.max(speed, 0), CIRCUIT.maxSpeed)
    : 0;
  const ratio = s / CIRCUIT.maxSpeed;
  return (
    CIRCUIT.turnRateAtMaxSpeed +
    (CIRCUIT.turnRateBase - CIRCUIT.turnRateAtMaxSpeed) * (1 - ratio)
  );
}

/**
 * dt máximo aceptado por paso (anti-espiral de la muerte), igual criterio
 * que SpeedSystem: hitches se acotan; no finito o ≤ 0 es no-op.
 *
 * Constante COMPARTIDA (issue #35): es el techo de delta de los sistemas
 * puros — cualquier consumidor de tiempo fuera de src/systems (LapTracker)
 * importa ésta en lugar de duplicar el número.
 */
export const MAX_DT = 0.25;

export class CircuitPhysics {
  constructor(
    private readonly path: TrackPath,
    /** Ancho jugable de la pista (px); el pasto empieza en `widthPx / 2`. */
    private readonly widthPx: number,
  ) {}

  /**
   * Avanza `state` un paso de `dt` segundos según `input` (muta y devuelve el
   * MISMO objeto, estilo SpeedSystem). `dt` no finito o ≤ 0: no-op estricto.
   *
   * #39 — `speedCapPx` (opcional, default `CIRCUIT.maxSpeed`): techo de
   * velocidad del paso, consumido por el desgaste de neumáticos del GRAN
   * PREMIO (la goma gastada recorta la punta). El pasto sigue mandando: el
   * techo efectivo es el MÍNIMO entre pasto, cap y punta global. Un cap
   * basura (no finito, ≤ 0) degrada al default — sin castigo fantasma.
   */
  step(state: CarState, dt: number, input: CircuitInput = defaultCircuitInput(), speedCapPx: number = CIRCUIT.maxSpeed): CarState {
    if (!Number.isFinite(dt) || dt <= 0) {
      return state;
    }
    const step = Math.min(dt, MAX_DT);

    // Velocidad defensiva: un estado corrupto (NaN) arranca desde 0.
    let speed = Number.isFinite(state.speed) ? state.speed : 0;

    // 1) Longitudinal. El pasto se mide con la posición ANTES de mover.
    const projection = this.path.project(state.x, state.y);
    const halfWidth = this.widthPx / 2;
    const onGrass = Math.abs(projection.lateral) > halfWidth;
    const ceiling = CIRCUIT.maxSpeed * (onGrass ? CIRCUIT.grassMaxSpeedFactor : 1);
    const cap =
      Number.isFinite(speedCapPx) && speedCapPx > 0
        ? Math.min(speedCapPx, CIRCUIT.maxSpeed)
        : CIRCUIT.maxSpeed;

    if (input.brake) {
      // El freno gana si se pisa junto con el acelerador (prioridad de seguridad).
      speed -= CIRCUIT.brakeDeceleration * step;
    } else if (input.throttle) {
      speed += CIRCUIT.acceleration * step;
    } else {
      // Roce: sin acelerador ni freno la velocidad decae hacia 0.
      speed = Math.max(0, speed - CIRCUIT.coastDrag * step);
    }

    // Techo (pasto, desgaste o punta) y piso: clamp final defensivo.
    speed = Math.min(Math.max(speed, 0), Math.min(ceiling, cap));

    // 2) Giro: tasa que decae con la velocidad. El steer es continuo
    // [−1, 1] (issue #37): se clampea defensivamente (NaN/no finito → 0).
    const steerInput = input.steer;
    const steer = Number.isFinite(steerInput) ? Math.min(Math.max(steerInput, -1), 1) : 0;
    const heading = Number.isFinite(state.heading)
      ? state.heading + steer * turnRateAtSpeed(speed) * step
      : 0;

    // 3) Integración de posición a lo largo del heading.
    state.x = (Number.isFinite(state.x) ? state.x : 0)
      + Math.cos(heading) * speed * step;
    state.y = (Number.isFinite(state.y) ? state.y : 0)
      + Math.sin(heading) * speed * step;
    state.heading = heading;
    state.speed = speed;
    return state;
  }
}
