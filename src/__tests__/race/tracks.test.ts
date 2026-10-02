import { describe, expect, it } from 'vitest';
import { CIRCUIT } from '../../config/balance';
import { turnRateAtSpeed } from '../../race/circuitPhysics';
import { TRACKS, buildTrackPath, getTrackById } from '../../race/tracks';
import type { TrackDefinition } from '../../race/tracks';

/**
 * Validación pura de las 6 pistas del registro (issues #9 y #26): el test
 * compila sólo si el
 * diseño pasa. Para cada pista se verifica que:
 * - la trayectoria CIERRA (sample(0) ≡ sample(L));
 * - NO se autointersecta (barrido de segmentos de la polilínea densa,
 *   excluyendo adyacentes — incluye la adyacencia por el cierre);
 * - el radio de curvatura en cada punto dense es alcanzable a la velocidad
 *   de referencia: vRef / turnRateAtSpeed(vRef) — es decir, un auto a ritmo
 *   de referencia puede sostener cualquier curva sin levantar;
 * - la longitud cae en la banda de vuelta objetivo [36, 44] s a vRef;
 * - los waypoints están dentro del mundo y son 20–35.
 */

/** Circunradio del triplete (a,b,c): infinito si son colineales. */
function circumradius(
  ax: number, ay: number, bx: number, by: number, cx: number, cy: number,
): number {
  const ab = Math.hypot(bx - ax, by - ay);
  const bc = Math.hypot(cx - bx, cy - by);
  const ca = Math.hypot(ax - cx, ay - cy);
  const area2 = Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
  if (area2 < 1e-9) {
    return Number.POSITIVE_INFINITY;
  }
  return (ab * bc * ca) / (2 * area2);
}

/** Segmentos (a→b) y (c→d) se cruzan estrictamente. */
function segmentsIntersect(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  return (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0))
    && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  );
}

describe('tracks — registro', () => {
  it('hay exactamente 6 pistas con ids únicos', () => {
    expect(TRACKS).toHaveLength(6);
    const ids = TRACKS.map((t) => t.id);
    expect(new Set(ids).size).toBe(6);
  });

  it('getTrackById resuelve por id y da undefined para desconocidos', () => {
    for (const def of TRACKS) {
      expect(getTrackById(def.id)).toBe(def);
    }
    expect(getTrackById('nurburgring')).toBeUndefined();
  });

  it('cada definición tiene la data completa del issue', () => {
    for (const def of TRACKS) {
      expect(def.waypoints.length).toBeGreaterThanOrEqual(20);
      expect(def.waypoints.length).toBeLessThanOrEqual(35);
      expect(def.lapTargetMs).toBe(40000);
      expect(def.sectors).toHaveLength(CIRCUIT.sectorCount);
      // Issue #18: mundo del circuito ×2.5 (2800 → 7000).
      expect(def.worldSize.width).toBe(7000);
      expect(def.worldSize.height).toBe(7000);
      expect(def.widthPx).toBeGreaterThan(0);
      // Sectores: fracciones contiguas que cubren [0, 1].
      expect(def.sectors[0].start).toBe(0);
      def.sectors.forEach((w, i) => {
        expect(w.end).toBeGreaterThan(w.start);
        if (i > 0) {
          expect(w.start).toBeCloseTo(def.sectors[i - 1].end, 12);
        }
      });
      expect(def.sectors[def.sectors.length - 1].end).toBeCloseTo(1, 12);
      // Waypoints dentro del mundo (margen de 250 px de la escala ×2.5).
      for (const wp of def.waypoints) {
        expect(wp.x).toBeGreaterThan(250);
        expect(wp.x).toBeLessThan(6750);
        expect(wp.y).toBeGreaterThan(250);
        expect(wp.y).toBeLessThan(6750);
      }
    }
  });
});

describe('tracks — invariantes geométricos y físicos', () => {
  const vRef = CIRCUIT.referenceSpeed;
  const minRadiusRequired = vRef / turnRateAtSpeed(vRef);
  const minLapPx = CIRCUIT.lapMinSeconds * vRef;
  const maxLapPx = CIRCUIT.lapMaxSeconds * vRef;

  function validate(def: TrackDefinition): void {
    const path = buildTrackPath(def);

    // 1) La curva cierra explícitamente.
    const start = path.sample(0);
    const end = path.sample(path.totalLength);
    expect(end.x).toBeCloseTo(start.x, 4);
    expect(end.y).toBeCloseTo(start.y, 4);

    // 2) Longitud dentro de la banda de vuelta objetivo.
    expect(path.totalLength).toBeGreaterThanOrEqual(minLapPx);
    expect(path.totalLength).toBeLessThanOrEqual(maxLapPx);

    // 3) Radio de curvatura mínimo alcanzable a vRef en CADA punto denso.
    const n = path.pointsCount;
    for (let i = 0; i < n; i += 1) {
      const a = path.densePointAt((i - 1 + n) % n);
      const b = path.densePointAt(i);
      const c = path.densePointAt((i + 1) % n);
      const radius = circumradius(a.x, a.y, b.x, b.y, c.x, c.y);
      expect(radius).toBeGreaterThanOrEqual(minRadiusRequired * 0.98);
    }

    // 4) Sin auto-intersección (segmentos no adyacentes, cierre incluido).
    for (let i = 0; i < n; i += 1) {
      const a = path.densePointAt(i);
      const b = path.densePointAt((i + 1) % n);
      for (let j = i + 2; j < n; j += 1) {
        if (i === 0 && j === n - 1) {
          continue; // adyacentes por el cierre
        }
        const c = path.densePointAt(j);
        const d = path.densePointAt((j + 1) % n);
        const crosses = segmentsIntersect(a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y);
        expect(crosses).toBe(false);
      }
    }
  }

  it('MONACO cierra, no se cruza, es sostenible y dura 36–44 s', () => {
    validate(getTrackById('monaco')!);
  });

  it('MONZA cierra, no se cruza, es sostenible y dura 36–44 s', () => {
    validate(getTrackById('monza')!);
  });

  it('SILVERSTONE cierra, no se cruza, es sostenible y dura 36–44 s', () => {
    validate(getTrackById('silverstone')!);
  });

  it('SPA cierra, no se cruza, es sostenible y dura 36–44 s', () => {
    validate(getTrackById('spa')!);
  });

  it('SUZUKA cierra, no se cruza (sin cruce en 8) y dura 36–44 s', () => {
    validate(getTrackById('suzuka')!);
  });

  it('GÁLVEZ cierra, no se cruza, es sostenible y dura 36–44 s', () => {
    validate(getTrackById('galvez')!);
  });
});
