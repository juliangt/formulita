/**
 * aiDriver — piloto del rival CPU (issue #14, V0).
 *
 * Un driver MÍNIMO que sigue el EJE de la pista a velocidad fija: es un
 * "piloto de pruebas" que siempre completa la carrera sin chocar contra
 * nada (no hay PvP en el circuito — igual que los remotos de #9, cada auto
 * corre contra la pista).
 *
 * Contrato (extensible: V1 lo enriquece con frenada por curvatura y
 * offsets de trazada, V2 con aleatoriedad por dificultad):
 * - SOLO produce `CircuitInput { throttle, brake, steer }` — NUNCA escribe
 *   posiciones: la física es la MISMA `CircuitPhysics` del jugador y el
 *   rival juega con las mismas reglas (auto-acelerado, pasto, techo).
 * - Dirección: error angular hacia un punto de MIRA sobre el eje, a
 *   `lookAheadPx` de arco adelante del propio arco proyectado; volante
 *   bang-bang con zona muerta (−1 / 0 / +1, la única granularidad que
 *   acepta `CircuitPhysics`).
 * - Longitudinal: acelerador pisado mientras `speed < targetSpeed` (la
 *   fracción de `CIRCUIT.maxSpeed` viene del preset de dificultad en
 *   `RACE_AI`); V0 nunca frena — si se pasa de velocidad, el pasto hace de
 *   freno (techo de `grassMaxSpeedFactor`).
 *
 * Puro: sin Phaser, sin red, sin reloj — determinista por construcción
 * (mismo estado + misma pista ⇒ mismo input). Testeable headless con Vitest.
 */

import { CIRCUIT } from '../../config/balance';
import type { CarState, CircuitInput } from '../circuitPhysics';
import type { TrackPath } from '../trackPath';

/** Configuración del driver (sale de `RACE_AI` + preset de dificultad). */
export interface AiDriverConfig {
  /**
   * Velocidad objetivo como fracción de `CIRCUIT.maxSpeed` (0–1): acelera
   * mientras esté debajo; arriba, suelta el acelerador (el roce decae solo).
   */
  readonly targetSpeedFraction: number;
  /** Distancia del punto de mira sobre el eje (px de arco). */
  readonly lookAheadPx: number;
  /** Zona muerta del error angular (rad): debajo, volante recto. */
  readonly steerDeadzoneRad: number;
}

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
    private readonly config: AiDriverConfig,
  ) {}

  /**
   * Decide el input del paso a partir del estado del auto (lectura pura:
   * no muta `state`, no avanza la física — de eso se encarga el dueño).
   */
  drive(state: CarState): CircuitInput {
    // Longitudinal: velocidad objetivo de la fracción de preset (clampeada
    // a [0, 1] contra configs basura) y acelerador mientras falte.
    const fraction = Math.min(Math.max(this.config.targetSpeedFraction, 0), 1);
    const targetSpeed = CIRCUIT.maxSpeed * fraction;
    const throttle = state.speed < targetSpeed;

    // Dirección: error angular hacia el punto de mira sobre el EJE. Proyectar
    // la posición propia da el arco `s` (y absorbe autos fuera de pista: la
    // mira siempre cae sobre el asfalto, así el driver vuelve solo).
    const projection = this.path.project(state.x, state.y);
    const aim = this.path.sample(projection.s + this.config.lookAheadPx);
    const desired = Math.atan2(aim.y - state.y, aim.x - state.x);
    const error = normalizeAngle(desired - state.heading);
    const deadzone = this.config.steerDeadzoneRad;
    const steer: CircuitInput['steer'] =
      error > deadzone ? 1 : error < -deadzone ? -1 : 0;

    // V0 no frena nunca: la velocidad objetivo se regula soltando el
    // acelerador y, en el exceso, con el techo del pasto.
    return { throttle, brake: false, steer };
  }
}
