/**
 * SpeedSystem — velocidad de avance de la carrera (Fase 3).
 *
 * Lógica 100% pura (sin Phaser): `update` recibe el `dt` inyectado y el
 * estado de acelerador/freno, y construye la velocidad actual:
 * - Avanza solo: sin input mantiene la velocidad y la lleva de vuelta
 *   hacia `BASE_SPEED` (la base es autónoma, el auto nunca se detiene).
 * - Acelerador: sube hasta `MAX_SPEED`.
 * - Freno: baja hasta `MIN_SPEED` (el freno gana si se pisa todo a la vez).
 *
 * La escena (GameScene) consume `speed` para el scroll de la pista y — en
 * Fase 4 — el ritmo de spawn. El turbo y el DRS NO viven acá: se componen
 * como multiplicadores sobre la velocidad final (`composeEffectiveSpeed`).
 */

import {
  BASE_SPEED,
  DRS_MULTIPLIER,
  MAX_SPEED,
  MIN_SPEED,
  SPEED_ACCELERATION,
  SPEED_BRAKE_DECELERATION,
  SPEED_COAST_DRAG,
  TURBO_MULTIPLIER,
} from '../config/balance';

/** Porción del `IInputState` que el SpeedSystem consume. */
export interface SpeedInput {
  /** Acelerador. */
  throttle: boolean;
  /** Freno. */
  brake: boolean;
}

/**
 * dt máximo aceptado por un `update` (anti-espiral de la muerte): pestañeos
 * de pestaña, hitches de GC o cualquier dt gigante se acotan a este paso.
 */
const MAX_DT = 0.25;

/**
 * Sanea un `dt` entrante: los valores no finitos o no positivos se vuelven 0
 * (el update se vuelve no-op) y los excesivos se acotan a `MAX_DT`.
 */
function sanitizeDt(dt: number): number {
  if (!Number.isFinite(dt) || dt <= 0) {
    return 0;
  }
  return Math.min(dt, MAX_DT);
}

/** Mueve `value` hacia `target` a lo sumo `maxDelta` (sin sobrepasar). */
function approach(value: number, target: number, maxDelta: number): number {
  if (value < target) {
    return Math.min(value + maxDelta, target);
  }
  if (value > target) {
    return Math.max(value - maxDelta, target);
  }
  return value;
}

/** Clamp defensivo de velocidad: NaN/Infinity vuelven a la base. */
function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed)) {
    return BASE_SPEED;
  }
  return Math.min(Math.max(speed, MIN_SPEED), MAX_SPEED);
}

/**
 * Compone la velocidad final de la carrera a partir del SpeedSystem y los
 * multiplicadores de turbo y DRS (en ese orden). Pura y defensiva: NaN,
 * multiplicadores inválidos (< 1) y salidas fuera de rango se corrigen, así
 * el scroll de pista nunca ve NaN ni velocidades infinitas.
 */
export function composeEffectiveSpeed(
  baseSpeed: number,
  turboMultiplier: number,
  drsMultiplier: number,
): number {
  const speed = Number.isFinite(baseSpeed) ? baseSpeed : BASE_SPEED;
  const turbo = Number.isFinite(turboMultiplier) && turboMultiplier >= 1 ? turboMultiplier : 1;
  const drs = Number.isFinite(drsMultiplier) && drsMultiplier >= 1 ? drsMultiplier : 1;
  // Techo calculado con los valores de config, no con los argumentos.
  const ceiling = MAX_SPEED * Math.max(1, TURBO_MULTIPLIER) * Math.max(1, DRS_MULTIPLIER);
  return Math.min(Math.max(speed * turbo * drs, MIN_SPEED), ceiling);
}

export class SpeedSystem {
  /** Velocidad actual (px/s), siempre en [MIN_SPEED, MAX_SPEED]. */
  private currentSpeed: number;

  constructor(initialSpeed: number = BASE_SPEED) {
    this.currentSpeed = clampSpeed(initialSpeed);
  }

  /** Velocidad actual del auto (px/s), sin multiplicadores de turbo/DRS. */
  get speed(): number {
    return this.currentSpeed;
  }

  /** Reinicia a la velocidad base (arranque de carrera / restart). */
  reset(): void {
    this.currentSpeed = clampSpeed(BASE_SPEED);
  }

  /**
   * Penalización instantánea por un impacto (issue #10, H2): resta `amount`
   * de velocidad con clamp a `MIN_SPEED`. Un `amount` no finito o ≤ 0 es un
   * no-op estricto (defensa igual que en `update`).
   */
  penalize(amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) {
      return;
    }
    this.currentSpeed = clampSpeed(this.currentSpeed - amount);
  }

  /**
   * Avanza la simulación un paso de `dt` segundos según el input.
   * `dt` no finito o no positivo es un no-op (defensa contra NaN).
   */
  update(dt: number, input: SpeedInput): void {
    const step = sanitizeDt(dt);
    if (step === 0) {
      return;
    }

    if (input.brake) {
      // El freno gana si se pisa junto con el acelerador (prioridad de seguridad).
      this.currentSpeed = Math.max(
        this.currentSpeed - SPEED_BRAKE_DECELERATION * step,
        MIN_SPEED,
      );
    } else if (input.throttle) {
      this.currentSpeed = Math.min(
        this.currentSpeed + SPEED_ACCELERATION * step,
        MAX_SPEED,
      );
    } else {
      // Sin input: la velocidad vuelve sola hacia la base (coast).
      this.currentSpeed = approach(
        this.currentSpeed,
        BASE_SPEED,
        SPEED_COAST_DRAG * step,
      );
    }

    // Clamp final defensivo (nada de NaN ni velocidades fuera de rango).
    this.currentSpeed = clampSpeed(this.currentSpeed);
  }
}
