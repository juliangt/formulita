import { describe, expect, it } from 'vitest';
import {
  sampleFromProgress,
  unrollProgress,
  wrapProgress,
} from '../../race/raceRemote';
import { buildTrackPath, getTrackById } from '../../race/tracks';

/**
 * Tests de la reconstrucción de autos remotos del circuito (issue #9, V2):
 * el wire viaja en coordenadas de pista (`rstate {s, o, lap}`) y la posición
 * de mundo se reconstruye LOCALMENTE con el TrackPath determinista. La
 * propiedad clave: la reconstrucción es CONTINUA en la meta — el progreso
 * desenrollado L−ε y L+ε caen a ambos lados de s=0, a distancia de arco 2ε.
 */

/** Pista real del registro (MÓNACO, la más lenta/estrecha). */
const path = buildTrackPath(getTrackById('monaco')!);
const L = path.totalLength;

describe('unrollProgress / wrapProgress — inversos exactos', () => {
  it('desenrolla y re-envuelve sin pérdida para laps 0..3 (float-tolerante)', () => {
    for (let lap = 0; lap <= 3; lap += 1) {
      for (const s of [0, 1, 1234, L - 1]) {
        const wrapped = wrapProgress(unrollProgress(lap, s, L), L);
        expect(wrapped.lap).toBe(lap);
        // s puede traer épsilon de punto flotante (lap × L + s mod L).
        expect(wrapped.s).toBeCloseTo(s, 6);
      }
    }
  });

  it('defensa: entradas no finitas o negativas aportan 0', () => {
    expect(unrollProgress(-2, 100, L)).toBe(100);
    expect(unrollProgress(Number.NaN, 100, L)).toBe(100);
    expect(unrollProgress(1, Number.NaN, L)).toBe(L);
    expect(unrollProgress(1.9, 0, L)).toBe(L); // lap fraccional → floor
    expect(wrapProgress(Number.NaN, L)).toEqual({ lap: 0, s: 0 });
  });
});

describe('sampleFromProgress — reconstrucción de posición (x, y, ángulo)', () => {
  it('con lateral 0 cae EXACTAMENTE sobre el eje: igual que path.sample(s)', () => {
    for (const s of [0, L / 4, L / 2, L - 0.5]) {
      const position = sampleFromProgress(path, s, 0);
      const sample = path.sample(s);
      expect(position.x).toBeCloseTo(sample.x, 6);
      expect(position.y).toBeCloseTo(sample.y, 6);
      expect(position.angle).toBeCloseTo(sample.angle, 6);
    }
  });

  it('con lateral ≠ 0 se desplaza sobre la NORMAL (perpendicular a la tangente)', () => {
    const s = L / 3;
    const sample = path.sample(s);
    const normal = sample.angle + Math.PI / 2;
    const position = sampleFromProgress(path, s, 35);
    expect(position.x).toBeCloseTo(sample.x + Math.cos(normal) * 35, 6);
    expect(position.y).toBeCloseTo(sample.y + Math.sin(normal) * 35, 6);
  });

  it('es CONTINUA en la meta: progreso L−ε y L+ε caen a distancia ~2ε', () => {
    const EPS = 2;
    const before = sampleFromProgress(path, L - EPS, 0);
    const after = sampleFromProgress(path, L + EPS, 0);
    const distance = Math.hypot(after.x - before.x, after.y - before.y);
    // 2 px de arco de diferencia, con margen por el denso de la polilínea.
    expect(distance).toBeLessThan(6);
    // Y no puede ser "el corto por el pasto": la distancia NUNCA es la de
    // una vuelta completa (eso sería haber envuelto el escalar, no la s).
    expect(distance).toBeLessThan(L / 2);
  });

  it('múltiples vueltas: progreso 3L + s reconstruye igual que s a secas', () => {
    const s = L / 5;
    const plain = sampleFromProgress(path, s, 10);
    const rolled = sampleFromProgress(path, 3 * L + s, 10);
    expect(rolled.x).toBeCloseTo(plain.x, 6);
    expect(rolled.y).toBeCloseTo(plain.y, 6);
  });

  it('progreso negativo o NaN no rompe (defensa, cae en la meta)', () => {
    const start = sampleFromProgress(path, 0, 0);
    const weird = sampleFromProgress(path, Number.NaN, 0);
    expect(weird.x).toBeCloseTo(start.x, 6);
    expect(weird.y).toBeCloseTo(start.y, 6);
  });
});
