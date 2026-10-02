/**
 * racePositionSwap — detección pura de cambio de posición propia (issue #14,
 * V3).
 *
 * El ranking vivo del GRAN PREMIO repinta el badge Pn/N cada
 * `RACE_MULTI.rankIntervalMs`; cuando la posición del jugador CAMBIA (adelantó
 * o lo adelantaron) la escena dispara un SFX distintivo. Para no spamear (una
 * pelea rueda a rueda cambia el orden varias veces por segundo) el detector
 * aplica las dos reglas del issue:
 *
 * - máximo UN sonido por cambio (un cambio = el badge mostró otro número);
 * - enfriamiento (~2 s): los cambios que llegan dentro de la ventana se
 *   ignoran para el audio (el badge sigue mostrando la posición real).
 *
 * La dirección se calcula SIEMPRE contra la última posición observada — aun
 * cuando el sonido quedó en enfriamiento — para que un ida-y-vuelta 5→4→5 no
 * acumule deuda ni dispare dobles.
 *
 * Puro: número + reloj inyectado ⇒ `'gained' | 'lost' | null`. Sin Phaser,
 * sin bus — testeable directo con Vitest.
 */

/** Cambio de posición detectado: menor número = `'gained'` (mejor). */
export type PositionSwap = 'gained' | 'lost';

/**
 * Detector de cambios de posición con enfriamiento. Estado mínimo: última
 * posición vista e instante del último sonido emitido.
 */
export class PositionSwapDetector {
  /** Enfriamiento entre sonidos (ms; ≤ 0 = sin enfriamiento). */
  private readonly cooldownMs: number;

  /** Última posición observada (null = todavía no hubo lectura). */
  private lastPosition: number | null = null;

  /** Reloj del último sonido emitido (null = nunca sonó). */
  private lastEmitAtMs: number | null = null;

  constructor(cooldownMs: number) {
    this.cooldownMs =
      Number.isFinite(cooldownMs) && cooldownMs > 0 ? cooldownMs : 0;
  }

  /**
   * Registra la posición del ranking en este instante. Primera lectura sólo
   * fija la línea base (el arranque de la carrera no es un "adelantamiento").
   * Lectura basura (no finita o < 1) se ignora sin tocar el estado.
   */
  update(position: number, nowMs: number): PositionSwap | null {
    if (!Number.isFinite(position) || position < 1 || !Number.isFinite(nowMs)) {
      return null;
    }
    if (this.lastPosition === null) {
      this.lastPosition = position;
      return null;
    }
    const previous = this.lastPosition;
    this.lastPosition = position;
    if (position === previous) {
      return null;
    }
    const swap: PositionSwap = position < previous ? 'gained' : 'lost';
    // Enfriamiento: el cambio existió (el badge ya lo muestra) pero su SFX
    // se descarta si el anterior sueno hace muy poco.
    if (this.lastEmitAtMs !== null && nowMs - this.lastEmitAtMs < this.cooldownMs) {
      return null;
    }
    this.lastEmitAtMs = nowMs;
    return swap;
  }

  /** Limpia el estado (el restart de la escena reutiliza la instancia). */
  reset(): void {
    this.lastPosition = null;
    this.lastEmitAtMs = null;
  }
}
