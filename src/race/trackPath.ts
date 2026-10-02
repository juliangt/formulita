/**
 * trackPath — geometría pura del circuito (issue #9, V0).
 *
 * Una pista es una curva CERRADA suavizada: los waypoints son puntos de
 * control que la implementación CIERRA EXPLÍCITAMENTE (el último segmento
 * vuelve al primer waypoint; las listas NO repiten el punto inicial). El
 * suavizado es Catmull-Rom centrípeto (evita bucles y cusps con separaciones
 * desparejas de puntos de control) densificado en una polilínea con paso
 * casi constante.
 *
 * Sobre esa polilínea se precomputa la tabla de longitud de arco:
 * - `totalLength`: perímetro de la pista (px).
 * - `sample(s)`: punto + tangente (ángulo) a la distancia de arco `s`
 *   (con envoltura módulo `totalLength`). V1 renderiza con esto.
 * - `project(x, y)`: proyección de un punto del mundo sobre el eje:
 *   coordenada de arco `s`, distancia LATERAL con signo al eje (positiva
 *   del lado consistente donde cross(tangente, punto−muestra) > 0; el lado
 *   absoluto es irrelevante, la consistencia es lo que consume la física
 *   para el pasto) y ángulo de la tangente en el punto proyectado.
 * - `sectorWindows`: ventanas de sector en unidades de s (checkpoints del
 *   LapTracker; por defecto 8 tramos iguales, o las fracciones inyectadas).
 *
 * Cero Phaser, cero red: sólo aritmética.
 */

import { CIRCUIT } from '../config/balance';

/** Punto 2D del mundo (px). */
export interface Point {
  x: number;
  y: number;
}

/** Muestra del eje de la pista: posición y tangente. */
export interface TrackSample {
  x: number;
  y: number;
  /** Ángulo de la tangente (radianes, atan2-style; pantalla y hacia abajo). */
  angle: number;
}

/** Proyección de un punto del mundo sobre el eje de la pista. */
export interface TrackProjection {
  /** Coordenada de arco (px, en [0, totalLength)). */
  s: number;
  /** Distancia con signo al eje (px, ver convención en el header). */
  lateral: number;
  /** Ángulo de la tangente en el punto proyectado (radianes). */
  angle: number;
}

/** Ventana de sector en unidades de arco (px). */
export interface SectorWindow {
  startS: number;
  endS: number;
}

/** Ventana de sector como fracción de `totalLength` (0–1, para data). */
export interface SectorFraction {
  start: number;
  end: number;
}

/** Punto denso interno de la polilínea. */
interface DensePoint {
  x: number;
  y: number;
  /** Longitud de arco acumulada hasta este punto (px). */
  s: number;
  /** Ángulo de la tangente en este punto (radianes). */
  angle: number;
}

export interface TrackPathOptions {
  /**
   * Ventanas de sector como fracciones del largo total. Omitido: 8 tramos
   * iguales (`CIRCUIT.sectorCount`).
   */
  sectorFractions?: readonly SectorFraction[];
}

/** Paso objetivo de la polilínea densa (px): compromiso exactitud/costo. */
const DENSE_SPACING_PX = 12;

/** Mínimo de subdivisiones por segmento de Catmull-Rom. */
const MIN_STEPS_PER_SEGMENT = 2;

/** Tolerancia para descartar waypoints duplicados (px). */
const DUPLICATE_EPSILON = 1e-6;

/** Exponente centrípeto del Catmull-Rom (0.5 = centrípeto estándar). */
const CENTRIPETAL_ALPHA = 0.5;

function dist(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Interpolación angular por el camino corto (los ángulos viven en (−π, π]).
 */
function lerpAngle(a: number, b: number, t: number): number {
  let delta = b - a;
  while (delta > Math.PI) {
    delta -= Math.PI * 2;
  }
  while (delta < -Math.PI) {
    delta += Math.PI * 2;
  }
  return a + delta * t;
}

/**
 * Catmull-Rom centrípeto (Barry–Goldman): punto en el segmento P1→P2 con
 * vecinos P0/P3, a fracción `t` del segmento. Robusto a separaciones
 * desparejas de waypoints (no sobrepasa como el uniforme).
 */
function catmullRomPoint(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const dt0 = Math.max(dist(p0, p1), DUPLICATE_EPSILON) ** CENTRIPETAL_ALPHA;
  const dt1 = Math.max(dist(p1, p2), DUPLICATE_EPSILON) ** CENTRIPETAL_ALPHA;
  const dt2 = Math.max(dist(p2, p3), DUPLICATE_EPSILON) ** CENTRIPETAL_ALPHA;

  // Nodos paramétricos: t1 es el inicio del segmento (t = 0 local).
  const t1 = dt0;
  const t2 = t1 + dt1;
  const t3 = t2 + dt2;
  const tc = t1 + t * dt1;

  const a1x = ((t1 - tc) / dt0) * p0.x + ((tc - 0) / dt0) * p1.x;
  const a1y = ((t1 - tc) / dt0) * p0.y + ((tc - 0) / dt0) * p1.y;
  const a2x = ((t2 - tc) / dt1) * p1.x + ((tc - t1) / dt1) * p2.x;
  const a2y = ((t2 - tc) / dt1) * p1.y + ((tc - t1) / dt1) * p2.y;
  const a3x = ((t3 - tc) / dt2) * p2.x + ((tc - t2) / dt2) * p3.x;
  const a3y = ((t3 - tc) / dt2) * p2.y + ((tc - t2) / dt2) * p3.y;

  const b1x = ((t2 - tc) / t2) * a1x + (tc / t2) * a2x;
  const b1y = ((t2 - tc) / t2) * a1y + (tc / t2) * a2y;
  const b2x = ((t3 - tc) / (t3 - t1)) * a2x + ((tc - t1) / (t3 - t1)) * a3x;
  const b2y = ((t3 - tc) / (t3 - t1)) * a2y + ((tc - t1) / (t3 - t1)) * a3y;

  return {
    x: ((t2 - tc) / dt1) * b1x + ((tc - t1) / dt1) * b2x,
    y: ((t2 - tc) / dt1) * b1y + ((tc - t1) / dt1) * b2y,
  };
}

/** Envuelve `s` a [0, length). No finito → 0 (defensa). */
function wrapS(s: number, length: number): number {
  if (!Number.isFinite(s)) {
    return 0;
  }
  return ((s % length) + length) % length;
}

export class TrackPath {
  /** Perímetro completo de la pista (px). */
  readonly totalLength: number;

  /** Ventanas de sector en unidades de arco (px). */
  readonly sectorWindows: readonly SectorWindow[];

  /** Puntos densos: `count` + 1 (el último duplica al primero con s = L). */
  private readonly dense: DensePoint[];
  private readonly count: number;

  constructor(waypoints: readonly Point[], options: TrackPathOptions = {}) {
    // Limpieza: sin puntos duplicados consecutivos (romperían la spline).
    const clean: Point[] = [];
    for (const wp of waypoints) {
      const prev = clean[clean.length - 1];
      if (!prev || dist(prev, wp) > DUPLICATE_EPSILON) {
        clean.push({ x: wp.x, y: wp.y });
      }
    }
    if (clean.length < 3) {
      throw new Error('TrackPath: se necesitan al menos 3 waypoints distintos');
    }

    // Densificado: cada segmento de control se subdivide a paso ~constante.
    const n = clean.length;
    const raw: Point[] = [];
    for (let i = 0; i < n; i += 1) {
      const p0 = clean[(i - 1 + n) % n];
      const p1 = clean[i];
      const p2 = clean[(i + 1) % n];
      const p3 = clean[(i + 2) % n];
      const steps = Math.max(
        MIN_STEPS_PER_SEGMENT,
        Math.ceil(dist(p1, p2) / DENSE_SPACING_PX),
      );
      for (let j = 0; j < steps; j += 1) {
        raw.push(catmullRomPoint(p0, p1, p2, p3, j / steps));
      }
    }

    // Tabla de arco: el punto final duplica al primero (cierre explícito).
    this.count = raw.length;
    this.dense = [];
    let acc = 0;
    for (let i = 0; i < this.count; i += 1) {
      const p = raw[i];
      this.dense.push({ x: p.x, y: p.y, s: acc, angle: 0 });
      acc += dist(p, raw[(i + 1) % this.count]);
    }
    this.totalLength = acc;
    this.dense.push({
      x: raw[0].x,
      y: raw[0].y,
      s: this.totalLength,
      angle: 0,
    });

    // Tangentes por diferencia central (con envoltura sobre el anillo denso).
    for (let i = 0; i <= this.count; i += 1) {
      const prev = this.dense[i === 0 ? this.count - 1 : i - 1];
      const next = this.dense[i === this.count ? 1 : i + 1];
      this.dense[i].angle = Math.atan2(next.y - prev.y, next.x - prev.x);
    }

    this.sectorWindows = this.buildSectorWindows(options.sectorFractions);
  }

  /** Ventanas de sector: fracciones inyectadas o 8 tramos iguales. */
  private buildSectorWindows(
    fractions?: readonly SectorFraction[],
  ): SectorWindow[] {
    const source: readonly SectorFraction[] =
      fractions && fractions.length > 0
        ? fractions
        : Array.from({ length: CIRCUIT.sectorCount }, (_, i) => ({
            start: i / CIRCUIT.sectorCount,
            end: (i + 1) / CIRCUIT.sectorCount,
          }));
    return source.map((f) => ({
      startS: f.start * this.totalLength,
      endS: f.end * this.totalLength,
    }));
  }

  /** Índice de sector de una coordenada de arco (con envoltura). */
  sectorIndexOf(s: number): number {
    const wrapped = wrapS(s, this.totalLength);
    const windows = this.sectorWindows;
    for (let i = 0; i < windows.length; i += 1) {
      if (wrapped >= windows[i].startS && wrapped < windows[i].endS) {
        return i;
      }
    }
    return windows.length - 1;
  }

  /**
   * Punto + tangente a la distancia de arco `s` (envuelta módulo L). `s` no
   * finito se trata como 0. V1 consume esto para dibujar la pista.
   */
  sample(s: number): TrackSample {
    const target = wrapS(s, this.totalLength);
    const i = this.segmentIndexAt(target);
    const a = this.dense[i];
    const b = this.dense[i + 1];
    const segLen = b.s - a.s;
    const t = segLen > DUPLICATE_EPSILON ? (target - a.s) / segLen : 0;
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      angle: lerpAngle(a.angle, b.angle, t),
    };
  }

  /**
   * Proyección de un punto del mundo sobre el eje: búsqueda exacta sobre los
   * segmentos de la polilínea densa (mínima distancia punto-segmento).
   */
  project(x: number, y: number): TrackProjection {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { s: 0, lateral: 0, angle: 0 };
    }
    let bestI = 0;
    let bestT = 0;
    let bestD2 = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.count; i += 1) {
      const a = this.dense[i];
      const b = this.dense[i + 1];
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const ab2 = abx * abx + aby * aby;
      const t = ab2 > DUPLICATE_EPSILON
        ? Math.min(1, Math.max(0, ((x - a.x) * abx + (y - a.y) * aby) / ab2))
        : 0;
      const dx = x - (a.x + abx * t);
      const dy = y - (a.y + aby * t);
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestI = i;
        bestT = t;
      }
    }
    const a = this.dense[bestI];
    const b = this.dense[bestI + 1];
    const segLen = b.s - a.s;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    // Tangente unitaria del segmento → lateral con signo consistente.
    const tx = (b.x - a.x) / (len || 1);
    const ty = (b.y - a.y) / (len || 1);
    const dx = x - (a.x + (b.x - a.x) * bestT);
    const dy = y - (a.y + (b.y - a.y) * bestT);
    return {
      s: a.s + segLen * bestT,
      lateral: tx * dy - ty * dx,
      angle: lerpAngle(a.angle, b.angle, bestT),
    };
  }

  /** Punto denso i-ésimo (0 ≤ i < pointsCount); expone la polilínea. */
  densePointAt(i: number): TrackSample & { s: number } {
    const p = this.dense[Math.min(Math.max(i, 0), this.count - 1)];
    return { x: p.x, y: p.y, angle: p.angle, s: p.s };
  }

  /** Cantidad de puntos densos de la polilínea (sin el cierre duplicado). */
  get pointsCount(): number {
    return this.count;
  }

  /** Índice denso tal que dense[i].s ≤ s < dense[i+1].s (búsqueda binaria). */
  private segmentIndexAt(s: number): number {
    let lo = 0;
    let hi = this.count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.dense[mid].s <= s) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return lo;
  }
}
