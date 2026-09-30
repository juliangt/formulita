/**
 * CountdownSystem — cuenta regresiva 3-2-1-GO! (Fase 7).
 *
 * Lógica 100% pura (sin Phaser): `update` recibe el `dt` inyectado y avanza
 * la cuenta. GameScene la consume para saber qué label mostrar y, sobre todo,
 * CUÁNDO arrancar el mundo: mientras `isFinished` es `false`, la escena no
 * avanza scroll, ni spawnea, ni puntúa, ni integra física (el plan pide que
 * "el mundo no arranca hasta terminar").
 *
 * Secuencia (config en `config/balance.ts`):
 * - '3', '2' y '1' duran `stepSeconds` cada uno.
 * - 'GO!' dura `goSeconds` y al terminar el sistema queda `finished`.
 *
 * Defensiva: dt no finito o no positivo es un no-op y un dt gigante se acota
 * (anti-espiral), igual que en SpeedSystem/TurboSystem/DrsSystem — un hitch
 * de GC nunca salta la cuenta de golpe.
 */

import { COUNTDOWN } from '../config/balance';

/** Label visible en cada tramo de la cuenta (null = terminada). */
export type CountdownLabel = '3' | '2' | '1' | 'GO!';

/** dt máximo aceptado por un `update` (anti-espiral de la muerte). */
const MAX_DT = 0.25;

/** Piso de duración por tramo (defensa contra configs degeneradas). */
const MIN_STEP_SECONDS = 0.05;

function sanitizeDt(dt: number): number {
  if (!Number.isFinite(dt) || dt <= 0) {
    return 0;
  }
  return Math.min(dt, MAX_DT);
}

function sanitizeStep(value: number, fallback: number): number {
  // Duración inválida (NaN, 0, negativa) → default; una positiva chiquita
  // se respeta con piso mínimo (nunca un tramo instantáneo).
  return Number.isFinite(value) && value > 0 ? Math.max(MIN_STEP_SECONDS, value) : fallback;
}

export class CountdownSystem {
  private readonly stepSeconds: number;
  private readonly goSeconds: number;
  /** Segundos transcurridos desde el inicio de la cuenta. */
  private elapsed = 0;

  constructor(
    stepSeconds: number = COUNTDOWN.stepSeconds,
    goSeconds: number = COUNTDOWN.goSeconds,
  ) {
    this.stepSeconds = sanitizeStep(stepSeconds, COUNTDOWN.stepSeconds);
    this.goSeconds = sanitizeStep(goSeconds, COUNTDOWN.goSeconds);
  }

  /** Duración total de la cuenta, en segundos. */
  get totalSeconds(): number {
    return this.stepSeconds * 3 + this.goSeconds;
  }

  /** Segundos transcurridos (debug y tests). */
  get elapsedSeconds(): number {
    return this.elapsed;
  }

  /** `true` cuando la cuenta terminó: el mundo puede arrancar. */
  get isFinished(): boolean {
    return this.elapsed >= this.totalSeconds;
  }

  /**
   * Label visible ahora mismo, o `null` si la cuenta terminó. Los límites de
   * cada tramo son inclusivos hacia el tramo siguiente: al acumular
   * exactamente `stepSeconds` ya se muestra el número siguiente.
   */
  get label(): CountdownLabel | null {
    if (this.isFinished) {
      return null;
    }
    if (this.elapsed >= this.stepSeconds * 3) {
      return 'GO!';
    }
    if (this.elapsed >= this.stepSeconds * 2) {
      return '1';
    }
    if (this.elapsed >= this.stepSeconds) {
      return '2';
    }
    return '3';
  }

  /**
   * Avanza la cuenta un paso de `dt` segundos. No-op cuando ya terminó o con
   * dt inválido; el elapsed se clampea al total (nunca crece de más).
   */
  update(dt: number): void {
    if (this.isFinished) {
      return;
    }
    const step = sanitizeDt(dt);
    if (step === 0) {
      return;
    }
    this.elapsed = Math.min(this.elapsed + step, this.totalSeconds);
  }

  /** Salta la cuenta (arranque inmediato: debug/futuras salas de espera). */
  skip(): void {
    this.elapsed = this.totalSeconds;
  }

  /** Reinicia la cuenta al inicio (arranque de carrera). */
  reset(): void {
    this.elapsed = 0;
  }
}
