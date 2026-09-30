/**
 * DrsSystem — alerón móvil DRS (Fase 3).
 *
 * Lógica 100% pura (sin Phaser): `update` recibe el `dt` inyectado y el flag
 * `drs` del InputState. La velocidad actual NO se acopla: se consulta vía un
 * proveedor inyectado por constructor (`getSpeed`, en GameScene es
 * `() => speedSystem.speed`) — inversión de dependencias y testeable con un
 * closure mutable.
 *
 * Spec del plan:
 * - Activable solo sobre el umbral de velocidad (> 75% de `MAX_SPEED`,
 *   rectas a fondo) y con una presión NUEVA del botón (flanco): mantener
 *   presionado no reactiva solo tras el cooldown.
 * - ~3 s activos con punta ×1.25.
 * - Desactivación automática al cumplirse la duración O al bajar del umbral;
 *   cualquier desactivación entra en cooldown (~8 s) antes de reactivar.
 * - `resetCooldown()` listo para el pickup DRS de Fase 4.
 *
 * Estados expuestos (para el chip del HUD, vía EventBus en la escena):
 * - `off`      → debajo del umbral, no puede activar.
 * - `ready`    → sobre el umbral, esperando la presión.
 * - `active`   → empujando (×1.25).
 * - `cooldown` → enfriando; expone progreso y segundos restantes.
 */

import {
  DRS_COOLDOWN_SECONDS,
  DRS_DURATION_SECONDS,
  DRS_MULTIPLIER,
  DRS_SPEED_THRESHOLD,
  MAX_SPEED,
} from '../config/balance';
import type { DrsStatus } from '../core/EventBus';

/** Proveedor de la velocidad actual (px/s) — inyectado, sin acoplarse. */
export type DrsSpeedProvider = () => number;

/** Proveedor del umbral de activación (px/s) — inyectable para tests. */
export type DrsThresholdProvider = () => number;

/** dt máximo aceptado por un `update` (anti-espiral). */
const MAX_DT = 0.25;

/**
 * Épsilon de expiración (µs): los restos de coma flotante de restar `dt`
 * repetidos (3 - 180 × (1/60) deja ~3.6e-15) no deben extender duraciones
 * ni cooldowns un tick de más.
 */
const EXPIRY_EPSILON = 1e-6;

function sanitizeDt(dt: number): number {
  if (!Number.isFinite(dt) || dt <= 0) {
    return 0;
  }
  return Math.min(dt, MAX_DT);
}

/** Estado interno de la máquina (los estados del HUD se derivan). */
type InternalStatus = 'idle' | 'active' | 'cooldown';

export class DrsSystem {
  private status: InternalStatus = 'idle';
  /** Segundos de DRS restantes en la activación actual. */
  private remainingDuration = 0;
  /** Segundos de cooldown restantes. */
  private remainingCooldown = 0;
  /**
   * Flag del update anterior (detección de flanco de presión). Arranca en
   * `true`: si el botón ya viene presionado "de antes" del primer update no
   * cuenta como presión nueva — hay que observar una suelta primero.
   */
  private previousWants = true;
  private readonly getSpeed: DrsSpeedProvider;
  private readonly getThreshold: DrsThresholdProvider;

  constructor(
    getSpeed: DrsSpeedProvider,
    getThreshold: DrsThresholdProvider = () => MAX_SPEED * DRS_SPEED_THRESHOLD,
  ) {
    this.getSpeed = getSpeed;
    this.getThreshold = getThreshold;
  }

  /** Estado para el HUD (deriva `off`/`ready` del estado interno `idle`). */
  get state(): DrsStatus {
    if (this.status === 'active') {
      return 'active';
    }
    if (this.status === 'cooldown') {
      return 'cooldown';
    }
    return this.isAboveThreshold() ? 'ready' : 'off';
  }

  /** `true` mientras el DRS empuja (×1.25). */
  get isActive(): boolean {
    return this.status === 'active';
  }

  /** Multiplicador de punta: ×1.25 activo, 1 en cualquier otro estado. */
  get speedMultiplier(): number {
    return this.status === 'active' ? DRS_MULTIPLIER : 1;
  }

  /** Segundos de DRS restantes en la activación actual. */
  get remainingDurationSeconds(): number {
    return this.status === 'active' ? Math.max(0, this.remainingDuration) : 0;
  }

  /**
   * Progreso del cooldown para el chip (1 → recién entra, 0 → termina).
   * Siempre 0 fuera del cooldown.
   */
  get cooldownRatio(): number {
    if (this.status !== 'cooldown') {
      return 0;
    }
    return Math.min(1, Math.max(0, this.remainingCooldown / DRS_COOLDOWN_SECONDS));
  }

  /** Segundos restantes de cooldown (0 fuera del cooldown). */
  get cooldownSeconds(): number {
    return this.status === 'cooldown' ? Math.max(0, this.remainingCooldown) : 0;
  }

  /** Reinicia a idle sin cooldown (arranque de carrera). */
  reset(): void {
    this.status = 'idle';
    this.remainingDuration = 0;
    this.remainingCooldown = 0;
    this.previousWants = true;
  }

  /**
   * Resetea el cooldown (pickup DRS de Fase 4): pasa de cooldown a idle al
   * instante. Si está activo, restaura la duración completa (el pickup
   * también "resetea duración" según el plan).
   */
  resetCooldown(): void {
    if (this.status === 'cooldown') {
      this.status = 'idle';
      this.remainingCooldown = 0;
    } else if (this.status === 'active') {
      this.remainingDuration = DRS_DURATION_SECONDS;
    }
  }

  /**
   * Avanza la simulación un paso de `dt` segundos con el flag de DRS del
   * InputState. `dt` no finito o no positivo es un no-op.
   */
  update(dt: number, wantsDrs: boolean): void {
    const step = sanitizeDt(dt);
    if (step === 0) {
      return;
    }

    // Activación por flanco: presión nueva, no "mantener apretado".
    const pressEdge = wantsDrs && !this.previousWants;
    this.previousWants = wantsDrs;

    if (this.status === 'active') {
      this.remainingDuration -= step;
      // Desactivación automática: duración cumplida O velocidad bajo umbral.
      if (this.remainingDuration <= EXPIRY_EPSILON || !this.isAboveThreshold()) {
        this.enterCooldown();
      }
      return;
    }

    if (this.status === 'cooldown') {
      this.remainingCooldown -= step;
      if (this.remainingCooldown <= EXPIRY_EPSILON) {
        this.remainingCooldown = 0;
        this.status = 'idle';
      }
      return;
    }

    // Idle: solo una presión fresca sobre el umbral activa el DRS.
    if (pressEdge && this.isAboveThreshold()) {
      this.status = 'active';
      this.remainingDuration = DRS_DURATION_SECONDS;
    }
  }

  private enterCooldown(): void {
    this.status = 'cooldown';
    this.remainingDuration = 0;
    this.remainingCooldown = DRS_COOLDOWN_SECONDS;
  }

  /** ¿La velocidad actual supera el umbral de recta? (estrictamente mayor). */
  private isAboveThreshold(): boolean {
    const speed = this.getSpeed();
    return Number.isFinite(speed) && speed > this.getThreshold();
  }
}
