/**
 * ScoreSystem — puntaje de la carrera (Fase 5).
 *
 * Lógica 100% pura (sin Phaser): `update` recibe el `dt` y la velocidad
 * efectiva inyectados por frame y acumula DOS fuentes de puntos:
 *
 * - **Distancia**: `SCORE_PER_SECOND_AT_BASE_SPEED` puntos por segundo a
 *   `BASE_SPEED`, escalado linealmente con la velocidad real (a punta con
 *   turbo+DRS, 840 px/s, rinde 2.8× más que a base). La distancia recorrida
 *   se acumula acá y viaja en el resumen de la carrera.
 * - **Bonus por velocidad sostenida**: mientras la velocidad se mantiene
 *   sobre `SCORE_BONUS_SPEED_FRACTION × MAX_SPEED` durante al menos
 *   `SCORE_BONUS_WARMUP_SECONDS`, se suman `SCORE_BONUS_PER_SECOND` pts/s
 *   prorrateados por frame. Bajar del umbral corta la racha.
 *
 * Además `addPoints` suma puntos planos (las monedas: `COIN_SCORE` por
 * recolección). Las MONEDAS COMO MONEDA no viven acá — van aparte en
 * GameScene y viajan por su propio evento del bus (`coins`): monedas y
 * puntaje son economías separadas.
 *
 * La emisión por EventBus la hace GameScene (igual que con speed/turbo/drs):
 * los sistemas permanecen puros y la escena orquesta.
 */

import {
  BASE_SPEED,
  MAX_SPEED,
  SCORE_BONUS_PER_SECOND,
  SCORE_BONUS_SPEED_FRACTION,
  SCORE_BONUS_WARMUP_SECONDS,
  SCORE_PER_SECOND_AT_BASE_SPEED,
} from '../config/balance';

/** dt máximo aceptado por un `update` (anti-espiral de la muerte). */
const MAX_DT = 0.25;

/** Épsilon del redondeo a entero (evita 9.999… → 9 por error de float). */
const FLOOR_EPSILON = 1e-9;

function sanitizeDt(dt: number): number {
  if (!Number.isFinite(dt) || dt <= 0) {
    return 0;
  }
  return Math.min(dt, MAX_DT);
}

/** Piso tolerante: `Math.floor` con épsilon para acumulación float. */
function floorTolerant(value: number): number {
  return Math.floor(value + FLOOR_EPSILON);
}

/** Puntos por px recorridos: 10 pts/s repartidos en BASE_SPEED px/s. */
const POINTS_PER_PIXEL = SCORE_PER_SECOND_AT_BASE_SPEED / (BASE_SPEED > 0 ? BASE_SPEED : 1);

export class ScoreSystem {
  /** Acumulador fraccional de puntos por distancia. */
  private distanceScoreValue = 0;

  /** Acumulador fraccional de puntos del bonus de velocidad sostenida. */
  private speedBonusScoreValue = 0;

  /** Puntos planos sumados por fuera (monedas: COIN_SCORE por moneda). */
  private extraScoreValue = 0;

  /** Distancia recorrida en la carrera (px). */
  private distancePx = 0;

  /** Segundos continuos sosteniendo la velocidad sobre el umbral. */
  private sustainedSecondsValue = 0;

  /** Puntaje total de la carrera (entero). */
  get score(): number {
    return floorTolerant(this.distanceScoreValue + this.speedBonusScoreValue + this.extraScoreValue);
  }

  /** Puntos aportados solo por la distancia (entero, para tests/telemetría). */
  get distanceScore(): number {
    return floorTolerant(this.distanceScoreValue);
  }

  /** Puntos aportados solo por el bonus de velocidad (entero). */
  get speedBonusScore(): number {
    return floorTolerant(this.speedBonusScoreValue);
  }

  /** Distancia recorrida (px) — viaja en el resumen de la carrera. */
  get distance(): number {
    return this.distancePx;
  }

  /** Racha actual de velocidad sostenida, en segundos (0 si está bajo el umbral). */
  get sustainedSeconds(): number {
    return this.sustainedSecondsValue;
  }

  /**
   * Avanza la simulación un paso de `dt` segundos a la velocidad efectiva
   * dada (la ya compuesta con turbo y DRS). `dt` no finito o no positivo es
   * un no-op; los dt excesivos se acotan a `MAX_DT`.
   */
  update(dt: number, speed: number): void {
    const step = sanitizeDt(dt);
    if (step === 0) {
      return;
    }
    const safeSpeed = Number.isFinite(speed) && speed > 0 ? speed : 0;

    // Puntaje por distancia, escalado con la velocidad real del frame.
    this.distanceScoreValue += POINTS_PER_PIXEL * safeSpeed * step;
    this.distancePx += safeSpeed * step;

    // Bonus por velocidad sostenida: la racha solo corre sobre el umbral.
    const threshold = SCORE_BONUS_SPEED_FRACTION * MAX_SPEED;
    if (safeSpeed >= threshold) {
      const previous = this.sustainedSecondsValue;
      this.sustainedSecondsValue = previous + step;
      // Facturación prorrateada: solo la porción del tick que cae después
      // del warmup (un tick que cruza el límite no regala el tick completo).
      const billable =
        Math.max(0, this.sustainedSecondsValue - SCORE_BONUS_WARMUP_SECONDS) -
        Math.max(0, previous - SCORE_BONUS_WARMUP_SECONDS);
      if (billable > 0) {
        this.speedBonusScoreValue += SCORE_BONUS_PER_SECOND * billable;
      }
    } else {
      this.sustainedSecondsValue = 0;
    }
  }

  /**
   * Suma puntos planos (monedas, futuros near-miss). Cantidades no finitas o
   * ≤ 0 son un no-op.
   */
  addPoints(points: number): void {
    if (!Number.isFinite(points) || points <= 0) {
      return;
    }
    this.extraScoreValue += points;
  }

  /** Reinicia el puntaje de la carrera (arranque / restart). */
  reset(): void {
    this.distanceScoreValue = 0;
    this.speedBonusScoreValue = 0;
    this.extraScoreValue = 0;
    this.distancePx = 0;
    this.sustainedSecondsValue = 0;
  }
}
