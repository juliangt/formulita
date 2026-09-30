/**
 * PauseSystem — estado de pausa de la carrera (Fase 7).
 *
 * Lógica 100% pura (sin Phaser): una máquina de estados `running ↔ paused`
 * que recuerda si la pausa fue automática (por pérdida de foco) para que el
 * overlay pueda explicarla. La CONGELACIÓN real la hace la escena
 * (`scene.pause()` congela update, física, tweens, timers y partículas);
 * este sistema es la fuente de verdad testeable del estado y el guardián de
 * las transiciones:
 * - `pause()` es idempotente: pausar dos veces no re-dispara efectos.
 * - `resume()` es idempotente y limpia el flag de pausa automática.
 * - `reset()` vuelve al estado inicial (restart de la escena).
 *
 * Flujo en GameScene (Fase 7):
 * - Botón en pantalla o tecla P → `pause(false)`.
 * - `visibilitychange`/blur (HIDDEN/BLUR de Phaser) → `pause(true)`.
 * - REANUDAR (overlay) o P/ESC en el overlay → evento RESUME de la escena →
 *   `resume()`.
 */

/** Estados de la máquina de pausa. */
export type PauseState = 'running' | 'paused';

export class PauseSystem {
  private currentState: PauseState = 'running';
  /** `true` si la pausa vigente fue automática (pérdida de foco). */
  private byFocusLoss = false;

  /** Estado actual (debug y tests). */
  get state(): PauseState {
    return this.currentState;
  }

  /** `true` mientras la carrera esté pausada. */
  get isPaused(): boolean {
    return this.currentState === 'paused';
  }

  /**
   * `true` si la pausa vigente fue automática (pérdida de foco). Siempre
   * `false` en estado running.
   */
  get isAutoPaused(): boolean {
    return this.isPaused && this.byFocusLoss;
  }

  /**
   * Pausa. `byFocusLoss` marca la pausa como automática. Devuelve `true`
   * SOLO si transitó running → paused (idempotente: re-pausar no hace nada).
   */
  pause(byFocusLoss = false): boolean {
    if (this.currentState === 'paused') {
      return false;
    }
    this.currentState = 'paused';
    this.byFocusLoss = byFocusLoss;
    return true;
  }

  /**
   * Reanuda. Devuelve `true` SOLO si transitó paused → running (idempotente)
   * y limpia el flag de pausa automática.
   */
  resume(): boolean {
    if (this.currentState === 'running') {
      return false;
    }
    this.currentState = 'running';
    this.byFocusLoss = false;
    return true;
  }

  /** Reinicia al estado inicial (arranque de carrera / restart de escena). */
  reset(): void {
    this.currentState = 'running';
    this.byFocusLoss = false;
  }
}
