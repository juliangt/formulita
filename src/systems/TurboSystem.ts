/**
 * TurboSystem — medidor de turbo (Fase 3).
 *
 * Lógica 100% pura (sin Phaser): `update` recibe el `dt` inyectado y el flag
 * `turbo` del InputState (la escena lo lee del InputSystem y lo pasa acá).
 *
 * Spec del plan:
 * - Medidor 0–100; drena ~28/s activo (~3.5 s de uso total).
 * - Activo → multiplicador ×1.6 sobre la velocidad final (la composición con
 *   el SpeedSystem vive en GameScene vía `composeEffectiveSpeed`).
 * - Recarga pasiva lenta (+4/s) cuando no está activo; el pickup (+50) llega
 *   en Fase 4 y ya tiene su método `refill(amount)` listo.
 * - Soltar el botón corta el empuje al instante; vaciarse también corta solo.
 *   Tras vaciarse exige soltar el botón antes de poder reactivar (latch): sin
 *   eso, manteniendo presionado el botón con el medidor en 0 titilaría
 *   activar/regenerar/activar cada frame.
 */

import {
  TURBO_DRAIN_PER_SECOND,
  TURBO_MAX,
  TURBO_MULTIPLIER,
  TURBO_REGEN_PER_SECOND,
} from '../config/balance';

/** dt máximo aceptado por un `update` (anti-espiral). */
const MAX_DT = 0.25;

function sanitizeDt(dt: number): number {
  if (!Number.isFinite(dt) || dt <= 0) {
    return 0;
  }
  return Math.min(dt, MAX_DT);
}

export class TurboSystem {
  /** Nivel del medidor (0–100). */
  private level: number = TURBO_MAX;

  /** `true` mientras el turbo esté empujando. */
  private active: boolean = false;

  /** Latch anti-flicker: se arma al vaciarse y se desarma al soltar el botón. */
  private latched: boolean = false;

  /** Nivel actual del medidor (0–100), nunca fuera de rango ni NaN. */
  get levelValue(): number {
    return this.level;
  }

  /** `true` si el turbo está activo ahora. */
  get isActive(): boolean {
    return this.active;
  }

  /**
   * Multiplicador de velocidad mientras está activo (×1.6), 1 si no.
   * La escena lo compone con el SpeedSystem y el DRS.
   */
  get speedMultiplier(): number {
    return this.active ? TURBO_MULTIPLIER : 1;
  }

  /** `true` si el turbo se vació y espera que se suelte el botón (latch). */
  get isEmptyLatch(): boolean {
    return this.latched;
  }

  /** Reinicia el medidor a lleno y apaga el turbo (arranque de carrera). */
  reset(): void {
    this.level = TURBO_MAX;
    this.active = false;
    this.latched = false;
  }

  /**
   * Recarga el medidor (pickup de turbo de Fase 4, +50 según balance).
   * Acepta cantidades parciales; hace clamp a `TURBO_MAX` y desarma el latch
   * de vaciado (un pickup re-habilita el uso aunque el botón siga apretado).
   * Cantidades no finitas o ≤ 0 son no-op.
   */
  refill(amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) {
      return;
    }
    this.level = Math.min(this.level + amount, TURBO_MAX);
    this.latched = false;
  }

  /**
   * Avanza la simulación un paso de `dt` segundos con el flag de turbo del
   * InputState. `dt` no finito o no positivo es un no-op.
   */
  update(dt: number, wantsTurbo: boolean): void {
    const step = sanitizeDt(dt);
    if (step === 0) {
      return;
    }

    // Soltar el botón corta el empuje al instante y desarma el latch.
    if (!wantsTurbo) {
      this.active = false;
      this.latched = false;
    }

    // Activación: hay medidor, el input lo pide y no está en latch.
    if (!this.active && wantsTurbo && !this.latched && this.level > 0) {
      this.active = true;
    }

    if (this.active) {
      // Drenaje mientras empuja (también en el frame de activación);
      // corte automático al vaciarse.
      this.level -= TURBO_DRAIN_PER_SECOND * step;
      if (this.level <= 0) {
        this.level = 0;
        this.active = false;
        this.latched = true;
      }
      return;
    }

    // Recarga pasiva lenta (jamás mientras está activo, jamás sobre el tope).
    this.level = Math.min(this.level + TURBO_REGEN_PER_SECOND * step, TURBO_MAX);
  }
}
