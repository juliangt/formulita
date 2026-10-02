/**
 * minimap — matemática pura del minimapa de carrera (issue #9, V1).
 *
 * El minimapa dibuja el contorno de la pista a escala dentro de un cuadrado
 * de HUD (`RACE.miniMapSize`). Toda la matemática vive acá, sin Phaser:
 * - `computeMiniMapTransform`: recorre la polilínea densa de la pista para
 *   hallar su bounding box y deriva una transformación uniforme (misma
 *   escala en X e Y — el circuito nunca se deforma) que lo centra dentro del
 *   cuadrado con padding.
 * - `worldToMiniMap`: mundo (px) → coordenadas locales del minimapa (px).
 * - `miniMapContour`: muestreo del eje cada `stepPx` de arco para el trazo
   del contorno (el widget de `ui/MiniMap` lo dibuja UNA vez).
 *
 * `TrackPath` es geometría pura, así que todo esto es testeable headless.
 */

import type { TrackPath } from './trackPath';
import type { Point } from './trackPath';

/** Transformación affine (uniforme + traslación) mundo → minimapa. */
export interface MiniMapTransform {
  /** Escala mundo→mapa (px de mapa por px de mundo, ≤ 1 siempre). */
  scale: number;
  /** Traslación en X (px de mapa). */
  offsetX: number;
  /** Traslación en Y (px de mapa). */
  offsetY: number;
}

/**
 * Deriva la transformación que encuadra la pista en un cuadrado de `size`
 * px con `padding` de aire. La escala es la mínima necesaria para que el
 * eje (ancho o alto, el más grande) entre completo; el sobrante centra el
 * trazado. `size`/`padding` inválidos caen a valores seguros.
 */
export function computeMiniMapTransform(
  path: TrackPath,
  size: number,
  padding: number,
): MiniMapTransform {
  const box = Number.isFinite(size) && size > 0 ? size : 1;
  const pad = Number.isFinite(padding) && padding >= 0 ? padding : 0;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < path.pointsCount; i += 1) {
    const point = path.densePointAt(i);
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);
  const inner = Math.max(box - pad * 2, 1e-6);
  const scale = inner / Math.max(spanX, spanY);
  const offsetX = pad + (inner - spanX * scale) / 2 - minX * scale;
  const offsetY = pad + (inner - spanY * scale) / 2 - minY * scale;

  return { scale, offsetX, offsetY };
}

/** Mundo (px) → coordenadas locales del minimapa (px). */
export function worldToMiniMap(x: number, y: number, transform: MiniMapTransform): Point {
  return {
    x: x * transform.scale + transform.offsetX,
    y: y * transform.scale + transform.offsetY,
  };
}

/** Paso de muestreo del contorno (px de arco): el minimapa es chico. */
const CONTOUR_STEP_PX = 48;

/**
 * Puntos del contorno de la pista (eje muestreado a paso casi constante) ya
 * transformados a coordenadas locales del minimapa. El widget dibuja estos
 * puntos UNA vez en su construcción (cero Graphics dinámicos por frame).
 */
export function miniMapContour(path: TrackPath, transform: MiniMapTransform): Point[] {
  const step = CONTOUR_STEP_PX;
  const points: Point[] = [];
  for (let s = 0; s < path.totalLength; s += step) {
    const sample = path.sample(s);
    points.push(worldToMiniMap(sample.x, sample.y, transform));
  }
  return points;
}

/* ------------------------------------------------------------------ */
/* Presentación de los puntos de coche (issue #14, V3)                  */
/* ------------------------------------------------------------------ */

/** Escala de la partícula 4×4 usada como punto de coche (idem ui/MiniMap). */
export const MINIMAP_DOT_SCALE = 3;

/**
 * Destacado del auto PROPIO (V3 #14): punto más grande + halo tenue detrás,
 * para encontrarlo entre los 8 marcadores del GRAN PREMIO. Ratios sobre la
 * escala base y tinte/alfa del halo (blanco hueso del contorno).
 */
const DOT_HIGHLIGHT_RATIO = 1.5;
const DOT_HALO_RATIO = 3.2;
const DOT_HALO_ALPHA = 0.3;
export const MINIMAP_DOT_HALO_TINT = 0xe8e6e0;

/** Cómo se dibuja un punto del minimapa (escala + halo opcional). */
export interface MiniMapDotPresentation {
  /** Escala del punto (`MINIMAP_DOT_SCALE` base). */
  readonly scale: number;
  /** Halo detrás del punto (null = sin destacado, look clásico). */
  readonly halo: { readonly scale: number; readonly alpha: number; readonly tint: number } | null;
}

/**
 * Presentación de un punto según si es el auto destacado (el propio). Es la
 * decisión PURA de tamaño/halo del widget (testeable headless): sin
 * destacado devuelve la presentación histórica (escala base, sin halo).
 */
export function miniMapDotPresentation(highlight: boolean): MiniMapDotPresentation {
  if (!highlight) {
    return { scale: MINIMAP_DOT_SCALE, halo: null };
  }
  return {
    scale: MINIMAP_DOT_SCALE * DOT_HIGHLIGHT_RATIO,
    halo: {
      scale: MINIMAP_DOT_SCALE * DOT_HALO_RATIO,
      alpha: DOT_HALO_ALPHA,
      tint: MINIMAP_DOT_HALO_TINT,
    },
  };
}
