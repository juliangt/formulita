/**
 * raceAudio — puente puro entre la física del circuito y el dron del motor
 * (issue #9, V4).
 *
 * El AudioManager mapea velocidad → frecuencia del dron sobre el dominio de
 * la BATALLA (`engineFrequencyForSpeed` interpola entre MIN_SPEED y la punta
 * combinada turbo × DRS). El circuito es otro mundo físico: la velocidad
 * propia vive en [0, CIRCUIT.maxSpeed] px/s (750 desde el issue #18), por
 * debajo del piso significativo del dominio de la batalla — pasarla cruda
 * haría que el dron apenas se moviera de su frecuencia mínima.
 *
 * `raceEngineSpeed` NORMALIZA: la fracción speed/maxSpeed del circuito entra
 * como la misma fracción del dominio [MIN_SPEED, MAX_SPEED], de modo que el
 * dron barra TODA su banda (con el perfil móvil de #4 intacto — el mapeo es
 * proporcional, solo cambia la banda base).
 *
 * Puro: número → número, sin Phaser ni AudioContext — testeable directo.
 */

import { CIRCUIT, MAX_SPEED, MIN_SPEED } from '../config/balance';

/**
 * Velocidad del circuito (px/s) → velocidad efectiva del dominio del dron
 * (px/s). Lineal en [0, CIRCUIT.maxSpeed] → [MIN_SPEED, MAX_SPEED]; defensiva:
 * NaN/infinitos y fuera de rango se clampean (siempre finito en el dominio).
 */
export function raceEngineSpeed(speed: number): number {
  const clamped =
    Number.isFinite(speed) ? Math.min(Math.max(speed, 0), CIRCUIT.maxSpeed) : 0;
  return MIN_SPEED + (clamped / CIRCUIT.maxSpeed) * (MAX_SPEED - MIN_SPEED);
}
