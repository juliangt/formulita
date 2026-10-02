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
