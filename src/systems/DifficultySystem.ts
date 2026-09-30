/**
 * DifficultySystem — rampa de dificultad por distancia recorrida (Fase 4).
 *
 * Lógica 100% pura (sin Phaser): `update` recibe el `dt` y la velocidad
 * actuales (inyectados) y acumula la distancia recorrida. De esa distancia
 * salen los parámetros que consume el SpawnScheduler (y el cierre de los
 * rivales), todos monotónicos y con clamp:
 *
 * - `rivalSpeedFactor`: los rivales avanzan hasta `×1 + rivalSpeedBonus`.
 * - `spawnDensity`: el intervalo entre oleadas se divide por este factor.
 * - `patternLevel`: desbloquea patrones más complejos (slalom, muro con
 *   hueco…) por niveles.
 *
 * La rampa nunca retrocede (la distancia solo crece) y termina saturada:
 * `ratio` hace clamp a [0, 1] en `maxDistance`.
 */

import { DIFFICULTY } from '../config/balance';

/** Parámetros de dificultad que consume el scheduler en cada update. */
export interface DifficultyParams {
  /** Progreso crudo de la rampa (0 = arrancada, 1 = tope). */
  readonly ratio: number;
  /** Factor de velocidad de avance de los rivales (≥ 1). */
  readonly rivalSpeedFactor: number;
  /** Factor de densidad de spawn (≥ 1; divide el intervalo). */
  readonly spawnDensity: number;
  /** Nivel de variedad de patrones desbloqueado (1..maxPatternLevel). */
  readonly patternLevel: number;
}

/** dt máximo aceptado por un `update` (anti-espiral de la muerte). */
const MAX_DT = 0.25;

function sanitizeDt(dt: number): number {
  if (!Number.isFinite(dt) || dt <= 0) {
    return 0;
  }
  return Math.min(dt, MAX_DT);
}

export class DifficultySystem {
  /** Distancia recorrida en la carrera actual (px), solo crece. */
  private distancePx = 0;

  /** Distancia recorrida (px) — viaja en el payload de game-over. */
  get distance(): number {
    return this.distancePx;
  }

  /** Progreso de la rampa, clampeado a [0, 1]. */
  get ratio(): number {
    if (DIFFICULTY.maxDistance <= 0) {
      return 1;
    }
    return Math.min(Math.max(this.distancePx / DIFFICULTY.maxDistance, 0), 1);
  }

  /** Factor de velocidad de los rivales: ×1 → ×1 + rivalSpeedBonus. */
  get rivalSpeedFactor(): number {
    return 1 + this.ratio * DIFFICULTY.rivalSpeedBonus;
  }

  /** Densidad de spawn: 1 → spawnDensityMax (el intervalo se divide). */
  get spawnDensity(): number {
    return 1 + this.ratio * (DIFFICULTY.spawnDensityMax - 1);
  }

  /** Nivel de patrones desbloqueado: 1 → maxPatternLevel (clamp). */
  get patternLevel(): number {
    return Math.min(
      DIFFICULTY.maxPatternLevel,
      1 + Math.floor(this.ratio * DIFFICULTY.maxPatternLevel),
    );
  }

  /** Snapshot de parámetros para el SpawnScheduler (datos, no referencias). */
  get params(): DifficultyParams {
    return {
      ratio: this.ratio,
      rivalSpeedFactor: this.rivalSpeedFactor,
      spawnDensity: this.spawnDensity,
      patternLevel: this.patternLevel,
    };
  }

  /** Reinicia la rampa (arranque de carrera / restart). */
  reset(): void {
    this.distancePx = 0;
  }

  /**
   * Avanza la simulación un paso de `dt` segundos a la velocidad dada.
   * `dt` o velocidad no finitos / no positivos son no-op.
   */
  update(dt: number, speed: number): void {
    const step = sanitizeDt(dt);
    if (step === 0) {
      return;
    }
    const safeSpeed = Number.isFinite(speed) && speed > 0 ? speed : 0;
    this.distancePx += safeSpeed * step;
  }

  /**
   * Suma distancia directamente (testeo y sync con el scroll real).
   * Cantidades no finitas o ≤ 0 son no-op: la rampa nunca retrocede.
   */
  advance(distancePx: number): void {
    if (!Number.isFinite(distancePx) || distancePx <= 0) {
      return;
    }
    this.distancePx += distancePx;
  }
}
