/**
 * racingLine — línea de carrera precomputada (issue #14, V1).
 *
 * `buildRacingLine` muestrea el eje denso de la pista y genera, por punto,
 * el OFFSET LATERAL óptimo: en curva se desplaza hacia el INTERIOR (corte de
 * apex) y en recta converge al centro. Implementación simple y estable:
 *
 * 1. Curvatura local con signo por diferencia central de tangentes del eje
 *    (la convención de `TrackPath.project`: lateral positivo es el lado
 *    interior de un giro a derecha, donde la tangente AVANZA — κ > 0).
 * 2. Offset crudo proporcional a |κ| con saturación (curvaturas fuertes no
 *    piden más que el margen al borde), hacia el interior de la curva.
 * 3. Suavizado con pasadas de media móvil circular (sin zigzag; en recta la
 *    curvatura ≈ 0 decae el offset a centro por las propias ventanas).
 *
 * Cada punto trae además `targetSpeed`: la velocidad máxima sostible según
 * el radio de curvatura LOCAL de la línea, derivada de `turnRateAtSpeed` de
 * `CIRCUIT` (misma resolución analítica que la validación de pistas de #9:
 * resuelve `v = turnRate(v) × r`, lineal en v) con un factor de seguridad,
 * recortada a `maxSpeed`. El driver (V1) la consume con lookahead de frenada.
 *
 * Se precomputa UNA vez por pista y se comparte entre todos los rivales.
 * Puro: sin Phaser, sin red, sin reloj — determinista por construcción.
 */

import { CIRCUIT } from '../../config/balance';
import type { TrackPath } from '../trackPath';

/** Punto de la línea de carrera. */
export interface RacingLinePoint {
  /** Coordenada de arco del eje (px, en [0, totalLength)). */
  readonly s: number;
  /** Posición en el mundo (px). */
  readonly x: number;
  readonly y: number;
  /** Offset lateral respecto del eje (px; convención de `TrackPath.project`). */
  readonly offset: number;
  /** Velocidad máxima sostible en este punto (px/s, ≤ `CIRCUIT.maxSpeed`). */
  readonly targetSpeed: number;
}

/* ------------------------------------------------------------------ */
/* Constantes geométricas del módulo (no gameplay: ver RACE_AI)         */
/* ------------------------------------------------------------------ */

/** Paso objetivo entre puntos de la línea (px de arco). */
const STEP_PX = 10;

/** Media-ventana (px) de la diferencia central de tangentes para κ. */
const CURVATURE_WINDOW_PX = 26;

/**
 * Radio de curvatura (px) al que el offset pide TODO su rango: curvas más
 * cerradas que esto (r < 160) no piden más — el corte de apex ya está.
 */
const OFFSET_SATURATION_RADIUS_PX = 160;

/** Margen de la línea al borde del asfalto (px): |offset| ≤ widthPx/2 − esto. */
export const RACING_LINE_EDGE_MARGIN_PX = 14;

/** Ancho (px) de la ventana de suavizado del offset. */
const SMOOTHING_WINDOW_PX = 90;

/** Pasadas de media móvil sobre el offset (más = más lisa y más "centrada"). */
const SMOOTHING_PASSES = 2;

/**
 * Factor de seguridad sobre la velocidad sostenible teórica de cada punto:
 * la física permite sostener EXACTAMENTE `v = turnRate(v) × r` con volante
 * a fondo; un piloto real deja margen (mismo criterio que el piloto de
 * referencia de los tests de flujo de #9).
 */
const SPEED_SAFETY = 0.9;

/** Normaliza un ángulo a (−π, π]. */
function normalizeAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) {
    a -= Math.PI * 2;
  }
  while (a < -Math.PI) {
    a += Math.PI * 2;
  }
  return a;
}

/**
 * Velocidad máxima sostenible en una curva de radio `radius` (px): resuelve
 * `v = turnRateAtSpeed(v) × radius` (la tasa es lineal en v) y aplica el
 * factor de seguridad. En recta (kappa ≈ 0) devuelve la punta.
 */
function sustainableSpeed(radius: number): number {
  const slope = (CIRCUIT.turnRateBase - CIRCUIT.turnRateAtMaxSpeed) / CIRCUIT.maxSpeed;
  const vmax = (CIRCUIT.turnRateBase * radius) / (1 + slope * radius);
  return Math.min(CIRCUIT.maxSpeed, vmax * SPEED_SAFETY);
}

/** Línea de carrera: puntos equiespaciados en arco sobre el eje cerrado. */
export class RacingLine {
  /** Paso real entre puntos (px de arco; `totalLength / pointCount`). */
  readonly stepPx: number;

  /** Perímetro de la pista (px): la línea cubre el MISMO anillo. */
  readonly totalLength: number;

  /**
   * Tope del offset lateral al ASFTALTO (px; = ancho/2 − margen al borde):
   * V2 lo consume el driver para clampear la mira (personalidad + desvío
   * de error/adelantamiento) dentro del ruedo — el error humano cuesta
   * tiempo, no tira al auto al pasto.
   */
  readonly maxOffsetPx: number;

  private readonly points: RacingLinePoint[];

  constructor(
    points: RacingLinePoint[],
    stepPx: number,
    totalLength: number,
    maxOffsetPx: number,
  ) {
    this.points = points;
    this.stepPx = stepPx;
    this.totalLength = totalLength;
    this.maxOffsetPx = maxOffsetPx;
  }

  /** Cantidad de puntos de la línea (el anillo NO repite el primero). */
  get pointCount(): number {
    return this.points.length;
  }

  /** Punto i-ésimo con envoltura circular (índices fuera de rango incluidos). */
  pointAtIndex(index: number): RacingLinePoint {
    const count = this.points.length;
    const wrapped = ((index % count) + count) % count;
    return this.points[wrapped];
  }

  /** Índice del punto más cercano a la coordenada de arco `s` (envuelta). */
  indexAtS(s: number): number {
    const wrapped = Number.isFinite(s)
      ? ((s % this.totalLength) + this.totalLength) % this.totalLength
      : 0;
    const index = Math.floor(wrapped / this.stepPx);
    return Math.min(Math.max(index, 0), this.points.length - 1);
  }

  /** Punto de la línea a la coordenada de arco `s` (envuelta; más cercano). */
  pointAtS(s: number): RacingLinePoint {
    return this.pointAtIndex(this.indexAtS(s));
  }
}

/**
 * Construye la línea de carrera de una pista: muestreo equiespaciado del
 * eje, offsets por curvatura suavizados y velocidad objetivo por punto.
 * Determinista: la misma (pista, ancho) devuelve exactamente la misma línea.
 */
export function buildRacingLine(path: TrackPath, widthPx: number): RacingLine {
  const totalLength = path.totalLength;
  const count = Math.max(8, Math.round(totalLength / STEP_PX));
  const step = totalLength / count;
  const maxOffset = Math.max(0, widthPx / 2 - RACING_LINE_EDGE_MARGIN_PX);

  // 1) Curvatura con signo por diferencia central de tangentes del eje.
  const curvature = new Float64Array(count);
  for (let i = 0; i < count; i += 1) {
    const s = i * step;
    const before = path.sample(s - CURVATURE_WINDOW_PX).angle;
    const after = path.sample(s + CURVATURE_WINDOW_PX).angle;
    curvature[i] = normalizeAngle(after - before) / (2 * CURVATURE_WINDOW_PX);
  }

  // 2) Offset crudo: hacia el interior de la curva (κ > 0 = giro a derecha
  //    = interior al lado lateral positivo), saturado y acotado al asfalto.
  let offsets = new Array<number>(count);
  for (let i = 0; i < count; i += 1) {
    const magnitude = Math.min(Math.abs(curvature[i]) * OFFSET_SATURATION_RADIUS_PX, 1);
    offsets[i] = Math.sign(curvature[i]) * magnitude * maxOffset;
  }

  // 3) Suavizado: pasadas de media móvil circular (el corte de apex queda,
  //    el zigzag no; en recta el offset decae a centro por las ventanas).
  const halfWindow = Math.max(1, Math.round(SMOOTHING_WINDOW_PX / step / 2));
  for (let pass = 0; pass < SMOOTHING_PASSES; pass += 1) {
    const smoothed = new Array<number>(count);
    for (let i = 0; i < count; i += 1) {
      let sum = 0;
      for (let d = -halfWindow; d <= halfWindow; d += 1) {
        sum += offsets[((i + d) % count + count) % count];
      }
      smoothed[i] = sum / (2 * halfWindow + 1);
    }
    offsets = smoothed;
  }

  // 4) Puntos: posición sobre la normal del eje + velocidad por curvatura
  //    SUAVIZADA (la geometría que realmente recorre el auto).
  const points: RacingLinePoint[] = [];
  for (let i = 0; i < count; i += 1) {
    const s = i * step;
    const sample = path.sample(s);
    const normal = sample.angle + Math.PI / 2;
    const kappa = Math.abs(curvature[i]);
    points.push({
      s,
      x: sample.x + Math.cos(normal) * offsets[i],
      y: sample.y + Math.sin(normal) * offsets[i],
      offset: offsets[i],
      targetSpeed:
        kappa > 1e-9 ? sustainableSpeed(1 / kappa) : CIRCUIT.maxSpeed,
    });
  }

  return new RacingLine(points, step, totalLength, maxOffset);
}
