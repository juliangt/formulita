/**
 * HealthSystem — salud del vehículo (issue #10, H1).
 *
 * Lógica 100% pura (sin Phaser), mismo criterio que SpeedSystem/TurboSystem:
 * `update` recibe el `dt` inyectado y la escena (GameScene, fase H2+) consume
 * `hp`/`ratio`/`isCritical` para el HUD y `isAlive` para el crash.
 *
 * Mecánica:
 * - Daño puntual (`damage`): choques con rivales (`impactDamage.rival`) y
 *   piedras (`impactDamage.debris`). Cada golpe aplicado arma i-frames de
 *   `invulnerabilitySeconds`; mientras duran, los impactos se ignoran.
 * - Roce con pared (`scrape`): daño continuo `scrapePerSecond` HP/s,
 *   prorrateado por frame y SIN i-frames (la pared pega todos los frames).
 * - Reparación (`heal`): el botiquín cura `repairAmount` con clamp al tope.
 *
 * El HP es SIEMPRE un entero en [0, HEALTH.max]: el daño continuo acumula
 * su parte fraccionaria en un residuo y solo descuenta HP enteros, así la
 * barra nunca ve valores raros ni depende del framerate.
 */

import { HEALTH } from '../config/balance';

/** Resultado de aplicar un daño puntual. */
export type DamageResult = 'hit' | 'ignored' | 'dead';

/** Resultado de aplicar daño continuo de roce. */
export type ScrapeResult = 'hit' | 'dead';

/** dt máximo aceptado por un `update` (anti-espiral de la muerte). */
const MAX_DT = 0.25;

function sanitizeDt(dt: number): number {
  if (!Number.isFinite(dt) || dt <= 0) {
    return 0;
  }
  return Math.min(dt, MAX_DT);
}

/** Sanea el HP/curación inicial: no finito vuelve al tope, clamp [0, max]. */
function sanitizeHp(hp: number): number {
  if (!Number.isFinite(hp)) {
    return HEALTH.max;
  }
  return Math.min(Math.max(Math.round(hp), 0), HEALTH.max);
}

export class HealthSystem {
  /** HP actual, siempre entero en [0, HEALTH.max]. */
  private currentHp: number;

  /** Segundos de i-frames restantes (0 = vulnerable). */
  private invulnerabilityLeft: number = 0;

  /** Residuo fraccionario del daño continuo de roce (HP pendientes). */
  private scrapeResidue: number = 0;

  constructor(hp: number = HEALTH.max) {
    this.currentHp = sanitizeHp(hp);
  }

  /** HP actual, entero, siempre en [0, HEALTH.max]. */
  get hp(): number {
    return this.currentHp;
  }

  /** Fracción de vida restante (0–1), para la barra del HUD. */
  get ratio(): number {
    return this.currentHp / HEALTH.max;
  }

  /** `true` mientras haya vida (hp > 0). */
  get isAlive(): boolean {
    return this.currentHp > 0;
  }

  /** `true` en estado crítico: la vida está en el umbral `criticalRatio` o debajo. */
  get isCritical(): boolean {
    return this.ratio <= HEALTH.criticalRatio;
  }

  /** `true` mientras duren los i-frames (solo afectan a `damage`). */
  get isInvulnerable(): boolean {
    return this.invulnerabilityLeft > 0;
  }

  /**
   * Hace tictac los i-frames. `dt` no finito o no positivo es un no-op;
   * un dt gigante se acota a 0.25 s (anti-espiral).
   */
  update(dt: number): void {
    const step = sanitizeDt(dt);
    if (step === 0) {
      return;
    }
    this.invulnerabilityLeft = Math.max(this.invulnerabilityLeft - step, 0);
  }

  /**
   * Aplica un daño puntual (rival/piedra). Durante i-frames el golpe se
   * ignora (y NO re-arma el temporizador); un golpe aplicado arma los
   * i-frames de `HEALTH.invulnerabilitySeconds`. Devuelve `'dead'` cuando
   * el golpe llega el HP a 0. `amount` no finito o ≤ 0 es un no-op estricto.
   */
  damage(amount: number): DamageResult {
    if (!Number.isFinite(amount) || amount <= 0) {
      return 'ignored';
    }
    if (this.invulnerabilityLeft > 0) {
      return 'ignored';
    }
    // El HP vive en enteros: el daño puntual se redondea al entero más
    // cercano antes de aplicarse (y jamás baja de 0).
    const applied = Math.max(Math.round(amount), 1);
    this.currentHp = Math.max(this.currentHp - applied, 0);
    if (this.currentHp <= 0) {
      return 'dead';
    }
    this.invulnerabilityLeft = HEALTH.invulnerabilitySeconds;
    return 'hit';
  }

  /**
   * Roce continuo con pared: `HEALTH.scrapePerSecond` HP por segundo
   * prorrateados por `dt`, SIN i-frames (ni los usa ni los arma). El daño
   * fraccionario se acumula en un residuo y solo descuenta HP enteros, así
   * el prorrateo por frame es exacto a cualquier framerate. Devuelve
   * `'dead'` al llegar el HP a 0; un `dt` inválido es un no-op (`'hit'`).
   */
  scrape(dt: number): ScrapeResult {
    const step = sanitizeDt(dt);
    if (step === 0) {
      return this.currentHp > 0 ? 'hit' : 'dead';
    }
    const pending = HEALTH.scrapePerSecond * step + this.scrapeResidue;
    const applied = Math.floor(pending);
    this.scrapeResidue = pending - applied;
    if (applied > 0) {
      this.currentHp = Math.max(this.currentHp - applied, 0);
    }
    return this.currentHp <= 0 ? 'dead' : 'hit';
  }

  /**
   * Cura con el botiquín, con clamp a `HEALTH.max`. Devuelve el HP
   * efectivamente curado (0 si el `amount` es inválido o la vida está llena).
   */
  heal(amount: number): number {
    if (!Number.isFinite(amount) || amount <= 0) {
      return 0;
    }
    const requested = Math.round(amount);
    if (requested <= 0) {
      return 0;
    }
    const healed = Math.min(requested, HEALTH.max - this.currentHp);
    this.currentHp += healed;
    return healed;
  }

  /** Reinicia a la vida llena, sin i-frames ni residuo (arranque de carrera). */
  reset(): void {
    this.currentHp = HEALTH.max;
    this.invulnerabilityLeft = 0;
    this.scrapeResidue = 0;
  }
}
