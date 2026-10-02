import { describe, expect, it } from 'vitest';
import { CIRCUIT } from '../../config/balance';
import { TrackPath } from '../../race/trackPath';

/**
 * Tests del TrackPath (issue #9, V0): coherencia sample/project, tangente
 * consistente con el avance, envoltura de s, estabilidad de totalLength y
 * ventanas de sector. Geometría pura sobre un anillo sintético.
 */

/** Anillo sintético: círculo de radio 600 con 16 waypoints. */
function circleWaypoints(radius = 600, n = 16): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i += 1) {
    const theta = (2 * Math.PI * i) / n;
    points.push({ x: Math.cos(theta) * radius, y: Math.sin(theta) * radius });
  }
  return points;
}

function makeCirclePath(): TrackPath {
  return new TrackPath(circleWaypoints());
}

/** Normal de la tangente (rota +90°, mismo lado que lateral > 0). */
function normalAt(path: TrackPath, s: number): { x: number; y: number } {
  const sample = path.sample(s);
  return { x: -Math.sin(sample.angle), y: Math.cos(sample.angle) };
}

describe('TrackPath — construcción y tabla de arco', () => {
  it('totalLength es estable entre instancias idénticas y cercano al círculo', () => {
    const a = makeCirclePath();
    const b = makeCirclePath();
    expect(b.totalLength).toBe(a.totalLength);
    // El círculo real mide 2π·600 ≈ 3770; la spline por 16 puntos queda cerca.
    expect(Math.abs(a.totalLength - 2 * Math.PI * 600)).toBeLessThan(120);
  });

  it('rechaza menos de 3 waypoints distintos', () => {
    expect(() => new TrackPath([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toThrow();
  });

  it('las 8 ventanas de sector cubren [0, L) sin huecos', () => {
    const path = makeCirclePath();
    expect(path.sectorWindows).toHaveLength(CIRCUIT.sectorCount);
    expect(path.sectorWindows[0].startS).toBe(0);
    path.sectorWindows.forEach((w, i) => {
      expect(w.endS).toBeGreaterThan(w.startS);
      if (i > 0) {
        expect(w.startS).toBeCloseTo(path.sectorWindows[i - 1].endS, 6);
      }
    });
    expect(path.sectorWindows[CIRCUIT.sectorCount - 1].endS).toBeCloseTo(path.totalLength, 6);
  });

  it('sectorIndexOf es consistente con las ventanas', () => {
    const path = makeCirclePath();
    path.sectorWindows.forEach((w, i) => {
      const mid = (w.startS + w.endS) / 2;
      expect(path.sectorIndexOf(mid)).toBe(i);
    });
    // Envoltura: s = L cae en el sector 0.
    expect(path.sectorIndexOf(path.totalLength)).toBe(0);
  });
});

describe('TrackPath — sample', () => {
  it('sample(s) cae sobre la polilínea: project lo devuelve con lateral ≈ 0', () => {
    const path = makeCirclePath();
    for (let s = 0; s < path.totalLength; s += 97) {
      const sample = path.sample(s);
      const proj = path.project(sample.x, sample.y);
      expect(proj.s).toBeCloseTo(s, 0);
      expect(Math.abs(proj.lateral)).toBeLessThan(0.5);
    }
  });

  it('envuelve: sample(-50) ≡ sample(L - 50) y sample(0) ≡ sample(L)', () => {
    const path = makeCirclePath();
    const wrapped = path.sample(path.totalLength - 50);
    const negative = path.sample(-50);
    expect(negative.x).toBeCloseTo(wrapped.x, 6);
    expect(negative.y).toBeCloseTo(wrapped.y, 6);

    const start = path.sample(0);
    const end = path.sample(path.totalLength);
    expect(end.x).toBeCloseTo(start.x, 6);
    expect(end.y).toBeCloseTo(start.y, 6);
  });

  it('s no finito se trata como 0 (defensa)', () => {
    const path = makeCirclePath();
    const origin = path.sample(0);
    const nan = path.sample(Number.NaN);
    expect(nan.x).toBeCloseTo(origin.x, 6);
    expect(nan.y).toBeCloseTo(origin.y, 6);
  });
});

describe('TrackPath — tangente y lateral', () => {
  it('la tangente apunta en la dirección del avance', () => {
    const path = makeCirclePath();
    for (let s = 0; s < path.totalLength - 20; s += 53) {
      const a = path.sample(s);
      const b = path.sample(s + 12);
      const stepAngle = Math.atan2(b.y - a.y, b.x - a.x);
      const diff = Math.abs(Math.atan2(
        Math.sin(stepAngle - a.angle),
        Math.cos(stepAngle - a.angle),
      ));
      expect(diff).toBeLessThan(0.15);
    }
  });

  it('lateral con signo consistente: el lado del eje positivo es estable', () => {
    const path = makeCirclePath();
    for (let s = 0; s < path.totalLength; s += 211) {
      const sample = path.sample(s);
      const n = normalAt(path, s);
      const right = path.project(sample.x + n.x * 120, sample.y + n.y * 120);
      const left = path.project(sample.x - n.x * 120, sample.y - n.y * 120);
      expect(right.lateral).toBeGreaterThan(119);
      expect(left.lateral).toBeLessThan(-119);
    }
  });

  it('project de puntos no finitos devuelve el origen defensivo', () => {
    const path = makeCirclePath();
    const proj = path.project(Number.NaN, 5);
    expect(proj.s).toBe(0);
    expect(proj.lateral).toBe(0);
  });
});
