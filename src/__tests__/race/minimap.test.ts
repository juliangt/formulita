import { describe, expect, it } from 'vitest';
import { RACE } from '../../config/balance';
import {
  MINIMAP_DOT_HALO_TINT,
  MINIMAP_DOT_SCALE,
  computeMiniMapTransform,
  miniMapContour,
  miniMapDotPresentation,
  worldToMiniMap,
} from '../../race/minimap';
import { TrackPath } from '../../race/trackPath';
import { TRACKS, buildTrackPath } from '../../race/tracks';

/**
 * Tests de la matemática del minimapa (issue #9, V1): transformación
 * uniforme que encuadra la pista en el cuadrado del HUD, contorno a escala
 * dentro del panel y mapeo de los coches.
 */

const SIZE = RACE.miniMapSize;
const PADDING = RACE.miniMapPadding;

describe('computeMiniMapTransform', () => {
  it('para cada pista: escala uniforme, encuadre dentro del panel y centrado', () => {
    for (const def of TRACKS) {
      const path = buildTrackPath(def);
      const t = computeMiniMapTransform(path, SIZE, PADDING);

      // Escala única para ambos ejes (el circuito nunca se deforma) y menor
      // que 1: el mundo de 7000 px (issue #18) entra en un cuadrado de 180.
      expect(t.scale).toBeGreaterThan(0);
      expect(t.scale).toBeLessThan(1);

      // Todo el contorno cae dentro del panel con su padding.
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < path.pointsCount; i += 1) {
        const point = worldToMiniMap(path.densePointAt(i).x, path.densePointAt(i).y, t);
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
      }
      expect(minX).toBeGreaterThanOrEqual(PADDING - 1e-6);
      expect(minY).toBeGreaterThanOrEqual(PADDING - 1e-6);
      expect(maxX).toBeLessThanOrEqual(SIZE - PADDING + 1e-6);
      expect(maxY).toBeLessThanOrEqual(SIZE - PADDING + 1e-6);

      // El eje más largo de la pista llena el área interior disponible.
      const inner = SIZE - PADDING * 2;
      const spanX = maxX - minX;
      const spanY = maxY - minY;
      expect(Math.max(spanX, spanY)).toBeCloseTo(inner, 6);
    }
  });

  it('centra el sobrante: el sobrante se reparte simétrico (transform uniforme)', () => {
    const square = new TrackPath([
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 1000 },
      { x: 0, y: 1000 },
    ]);
    const t = computeMiniMapTransform(square, SIZE, PADDING);

    // Bounds REALES de la polilínea (el Catmull-Rom puede sobrepasar los
    // waypoints): el encuadre es simétrico alrededor del centro del panel.
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < square.pointsCount; i += 1) {
      const point = square.densePointAt(i);
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
    const mappedMinX = minX * t.scale + t.offsetX;
    const mappedMaxX = maxX * t.scale + t.offsetX;
    const mappedMinY = minY * t.scale + t.offsetY;
    const mappedMaxY = maxY * t.scale + t.offsetY;
    expect(mappedMinX - PADDING).toBeCloseTo(SIZE - PADDING - mappedMaxX, 9);
    expect(mappedMinY - PADDING).toBeCloseTo(SIZE - PADDING - mappedMaxY, 9);
  });

  it('es defensivo con un tamaño inválido (no divide por cero)', () => {
    const path = new TrackPath(TRACKS[0].waypoints);
    expect(() => computeMiniMapTransform(path, 0, PADDING)).not.toThrow();
    const t = computeMiniMapTransform(path, Number.NaN, -5);
    expect(Number.isFinite(t.scale)).toBe(true);
    expect(Number.isFinite(t.offsetX)).toBe(true);
    expect(Number.isFinite(t.offsetY)).toBe(true);
  });
});

describe('miniMapContour', () => {
  it('cierra el contorno: el último punto vuelve al primero', () => {
    const path = buildTrackPath(TRACKS[0]);
    const contour = miniMapContour(path, computeMiniMapTransform(path, SIZE, PADDING));
    expect(contour.length).toBeGreaterThan(10);
    const first = contour[0];
    const last = contour[contour.length - 1];
    // El paso de muestreo deja el último punto a menos de un paso del cierre.
    const stepPx = path.totalLength / contour.length;
    expect(Math.hypot(last.x - first.x, last.y - first.y)).toBeLessThan(stepPx * 1.5);
  });

  it('los puntos del contorno están dentro del panel', () => {
    for (const def of TRACKS) {
      const path = buildTrackPath(def);
      const contour = miniMapContour(path, computeMiniMapTransform(path, SIZE, PADDING));
      for (const point of contour) {
        expect(point.x).toBeGreaterThanOrEqual(-1e-6);
        expect(point.x).toBeLessThanOrEqual(SIZE + 1e-6);
        expect(point.y).toBeGreaterThanOrEqual(-1e-6);
        expect(point.y).toBeLessThanOrEqual(SIZE + 1e-6);
      }
    }
  });
});

describe('worldToMiniMap', () => {
  it('es una transformación affine: composición con la identidad', () => {
    const path = buildTrackPath(TRACKS[0]);
    const t = computeMiniMapTransform(path, SIZE, PADDING);
    const sample = path.sample(path.totalLength / 3);
    const mapped = worldToMiniMap(sample.x, sample.y, t);
    expect(mapped.x).toBeCloseTo(sample.x * t.scale + t.offsetX, 12);
    expect(mapped.y).toBeCloseTo(sample.y * t.scale + t.offsetY, 12);
  });
});

describe('miniMapDotPresentation — destacado del auto propio (#14, V3)', () => {
  it('sin destacado reproduce el look histórico (escala base, sin halo)', () => {
    expect(MINIMAP_DOT_SCALE).toBe(3); // el CAR_DOT_SCALE de siempre
    const plain = miniMapDotPresentation(false);
    expect(plain.scale).toBe(3);
    expect(plain.halo).toBeNull();
  });

  it('el destacado es MÁS GRANDE y trae un halo tenue detrás', () => {
    const own = miniMapDotPresentation(true);
    expect(own.scale).toBeGreaterThan(miniMapDotPresentation(false).scale);
    expect(own.halo).not.toBeNull();
    if (own.halo) {
      expect(own.halo.scale).toBeGreaterThan(own.scale);
      expect(own.halo.alpha).toBeGreaterThan(0);
      expect(own.halo.alpha).toBeLessThan(1);
      expect(own.halo.tint).toBe(MINIMAP_DOT_HALO_TINT);
    }
  });

  it('la decisión es una función PURA del flag: determinista y sin estado', () => {
    expect(miniMapDotPresentation(true)).toEqual(miniMapDotPresentation(true));
    expect(miniMapDotPresentation(false)).toEqual(miniMapDotPresentation(false));
    expect(miniMapDotPresentation(true).scale).not.toBe(miniMapDotPresentation(false).scale);
  });
});
