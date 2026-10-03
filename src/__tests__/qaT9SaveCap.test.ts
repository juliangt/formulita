import { describe, expect, it } from 'vitest';
import { applyRaceResult, defaultSaveData, parseGameOverData, sanitizeSaveData } from '../data/types';

/**
 * qaT9 (issue #35) — `toCount` no tenía tope superior: un localStorage
 * manipulado (o un payload corrupto) con `1e300` pasaba el filtro
 * `Number.isFinite` y el HUD lo pintaba tal cual (`String(1e300)` →
 * "1e+300", rompiendo el look arcade de 6 dígitos de `formatScore`).
 *
 * El tope es el máximo representable del marcador de 6 dígitos: 999999.
 */

const MAX_COUNT = 999_999;

describe('qaT9 — toCount: tope superior coherente con el marcador de 6 dígitos', () => {
  it('sanitizeSaveData clampa totalCoins 1e300 al tope', () => {
    const save = sanitizeSaveData({
      totalCoins: 1e300,
      bestScore: 12,
      bestDistance: 340,
    });

    expect(save.totalCoins).toBe(MAX_COUNT);
    expect(save.bestScore).toBe(12);
    expect(save.bestDistance).toBe(340);
  });

  it('sanitizeSaveData clampa cada campo por separado', () => {
    const save = sanitizeSaveData({
      totalCoins: 5,
      bestScore: 1e300,
      bestDistance: Number.MAX_SAFE_INTEGER + 1,
    });

    expect(save.totalCoins).toBe(5);
    expect(save.bestScore).toBe(MAX_COUNT);
    expect(save.bestDistance).toBe(MAX_COUNT);
  });

  it('un valor en el borde del marcador se conserva intacto', () => {
    const save = sanitizeSaveData({ totalCoins: MAX_COUNT, bestScore: MAX_COUNT, bestDistance: 0 });

    expect(save.totalCoins).toBe(MAX_COUNT);
    expect(save.bestScore).toBe(MAX_COUNT);
  });

  it('applyRaceResult clampa el score del resumen antes de comparar récords', () => {
    const { save, isNewBest } = applyRaceResult(defaultSaveData(), {
      score: 1e300,
      distance: 1200,
      coins: 8,
    });

    expect(isNewBest).toBe(true);
    expect(save.bestScore).toBe(MAX_COUNT);
    expect(save.totalCoins).toBe(8);
  });

  it('parseGameOverData clampa el score del payload de escena', () => {
    const data = parseGameOverData({ score: 1e300, distance: 500, coins: 3, isNewBest: true });

    expect(data.score).toBe(MAX_COUNT);
    expect(data.coins).toBe(3);
  });
});
