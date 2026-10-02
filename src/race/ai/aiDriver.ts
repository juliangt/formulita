/**
 * aiDriver — piloto del rival CPU (issue #14, V1).
 *
 * Un piloto REAL que sigue la LÍNEA DE CARRERA (`racingLine.ts`, no el eje):
 *
 * - Dirección: error angular hacia un punto de MIRA sobre la línea a
 *   `lookAheadPx` de arco adelante del propio arco proyectado, desplazado
 *   por el offset lateral PERSONAL del driver (la personalidad no es un
 *   temblor: es SU trazada). Volante bang-bang con zona muerta (−1/0/+1, la
 *   única granularidad que acepta `CircuitPhysics`), acotado igual que el
 *   jugador. Si el auto se sale, la proyección al eje sigue viva y la mira
 *   cae sobre el asfalto: el driver vuelve solo.
 * - Longitudinal: escanea el horizonte de FRENADA sobre la línea — para cada
 *   distancia `d` adelante, la velocidad máxima permitida HOY para llegar al
 *   `targetSpeed` de ese punto frenando a `CIRCUIT.brakeDeceleration` es
 *   `√(v_t² + 2·a·d)` (cinemática pura; el lookahead queda así proporcional
 *   a la distancia de frenada disponible). El objetivo del paso es el mínimo
 *   de esa barra (y el cap de recta del preset). Con velocidad sobre el
 *   objetivo + margen, FRENA (antes de la curva, no dentro); debajo,
 *   acelera; en el medio, regula soltando (sin bang-bang nervioso).
 *
 * Contrato (igual que V0):
 * - SOLO produce `CircuitInput { throttle, brake, steer }` — NUNCA escribe
 *   posiciones: la física es la MISMA `CircuitPhysics` del jugador y el
 *   rival juega con las mismas reglas (auto-acelerado, pasto, techo).
 *
 * Puro: sin Phaser, sin red, sin reloj — determinista por construcción
 * (mismo estado + misma línea ⇒ mismo input). Testeable headless con Vitest.
 */

import { CIRCUIT } from '../../config/balance';
import type { CarState, CircuitInput } from '../circuitPhysics';
import type { TrackPath } from '../trackPath';
import type { RacingLine } from './racingLine';

/** Configuración del driver (`RACE_AI` + preset de dificultad + personalidad). */
export interface AiDriverConfig {
  /**
   * Techo de velocidad en recta como fracción de `CIRCUIT.maxSpeed` (0–1):
   * preset de dificultad × personalidad, resuelto por `rivalRoster`.
   */
  readonly targetSpeedFraction: number;
  /** Escala sobre el `targetSpeed` de la línea (preset × personalidad). */
  readonly lineSpeedScale: number;
  /** Offset lateral propio sobre la línea (px, ±; SU trazada). */
  readonly lineOffsetPx: number;
  /** Distancia del punto de mira sobre la línea (px de arco). */
  readonly lookAheadPx: number;
  /** Zona muerta del error angular (rad): debajo, volante recto. */
  readonly steerDeadzoneRad: number;
  /** Margen de frenada (px/s): recién tan por encima del objetivo frena. */
  readonly brakeMarginSpeedPx: number;
}

/**
 * Paso del escaneo de frenada sobre la línea (px de arco): muestrear el
 * horizonte a este ritmo captura cualquier curva de la pista (radios ≥ 87 px
 * ⇒ arcos de curva mucho más largos que el paso) sin costar por frame.
 */
const BRAKE_SCAN_STEP_PX = 40;

/** Horizonte máximo del escaneo de frenada (px de arco): frenar de punta a
 * la curva más lenta ocupa ~50 px (`CIRCUIT.brakeDeceleration`), así que con
 * margen sobra — mirar más lejos no cambia ninguna decisión. */
const BRAKE_SCAN_MAX_PX = 240;

/** Normaliza un ángulo a (−π, π] (los headings y tangentes viven ahí). */
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

export class AiDriver {
  constructor(
    private readonly path: TrackPath,
    private readonly line: RacingLine,
    private readonly config: AiDriverConfig,
  ) {}

  /**
   * Decide el input del paso a partir del estado del auto (lectura pura:
   * no muta `state`, no avanza la física — de eso se encarga el dueño).
   */
  drive(state: CarState): CircuitInput {
    // Proyección al eje: da el arco `s` propio (absorbe autos fuera de
    // pista: la mira siempre cae sobre la línea, así el driver vuelve solo).
    const projection = this.path.project(state.x, state.y);
    const s = projection.s;

    // --- Longitudinal: objetivo = mínima velocidad permitida en el horizonte.
    const fraction = Math.min(Math.max(this.config.targetSpeedFraction, 0), 1);
    const cap = CIRCUIT.maxSpeed * fraction;
    const scale = Math.max(this.config.lineSpeedScale, 0);

    let target = Math.min(this.line.pointAtS(s).targetSpeed * scale, cap);
    for (let d = BRAKE_SCAN_STEP_PX; d <= BRAKE_SCAN_MAX_PX; d += BRAKE_SCAN_STEP_PX) {
      const ahead = this.line.pointAtS(s + d);
      const aheadTarget = Math.min(ahead.targetSpeed * scale, cap);
      // Cinemática: velocidad HOY que permite llegar a `aheadTarget` frenando.
      const allowed = Math.sqrt(aheadTarget * aheadTarget + 2 * CIRCUIT.brakeDeceleration * d);
      if (allowed < target) {
        target = allowed;
      }
    }

    // Bang-bang longitudinal con banda muerta: sobre objetivo+margen frena,
    // debajo acelera, en el medio regula soltando (roce de `CIRCUIT`).
    const brake = state.speed > target + this.config.brakeMarginSpeedPx;
    const throttle = !brake && state.speed < target;

    // --- Dirección: error angular hacia el punto de mira sobre la LÍNEA,
    // desplazado por el offset personal (su trazada, no un temblor).
    const aim = this.line.pointAtS(s + this.config.lookAheadPx);
    const aimAxis = this.path.sample(aim.s);
    const normal = aimAxis.angle + Math.PI / 2;
    const aimX = aim.x + Math.cos(normal) * this.config.lineOffsetPx;
    const aimY = aim.y + Math.sin(normal) * this.config.lineOffsetPx;
    const desired = Math.atan2(aimY - state.y, aimX - state.x);
    const error = normalizeAngle(desired - state.heading);
    const deadzone = this.config.steerDeadzoneRad;
    const steer: CircuitInput['steer'] =
      error > deadzone ? 1 : error < -deadzone ? -1 : 0;

    return { throttle, brake, steer };
  }
}
