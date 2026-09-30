import { describe, expect, it } from 'vitest';
import { DIFFICULTY } from '../config/balance';
import { DifficultySystem } from '../systems/DifficultySystem';

/**
 * Tests del DifficultySystem (Fase 4): rampa por distancia recorrida,
 * monotónica y con clamps. Lógica pura: dt y velocidad inyectados, sin Phaser.
 */

const DT = 1 / 60;

describe('DifficultySystem — estado inicial', () => {
  it('arranca en dificultad mínima: ratio 0, rivales ×1, densidad 1, nivel 1', () => {
    const difficulty = new DifficultySystem();

    expect(difficulty.distance).toBe(0);
    expect(difficulty.ratio).toBe(0);
    expect(difficulty.rivalSpeedFactor).toBe(1);
    expect(difficulty.spawnDensity).toBe(1);
    expect(difficulty.patternLevel).toBe(1);
  });
});

describe('DifficultySystem — acumulación de distancia', () => {
  it('update acumula distancia = velocidad × dt', () => {
    const difficulty = new DifficultySystem();

    difficulty.update(DT, 300);

    expect(difficulty.distance).toBeCloseTo(300 * DT);
  });

  it('update con dt NaN, negativo o infinito es un no-op', () => {
    const difficulty = new DifficultySystem();

    difficulty.update(Number.NaN, 300);
    difficulty.update(-1, 300);
    difficulty.update(Number.POSITIVE_INFINITY, 300);

    expect(difficulty.distance).toBe(0);
  });

  it('un dt gigante se acota: un tick suma como mucho 0.25 s de avance', () => {
    const difficulty = new DifficultySystem();

    difficulty.update(10, 300);

    expect(difficulty.distance).toBeCloseTo(300 * 0.25);
  });

  it('velocidad no finita o negativa no suma distancia', () => {
    const difficulty = new DifficultySystem();

    difficulty.update(DT, Number.NaN);
    difficulty.update(DT, -100);

    expect(difficulty.distance).toBe(0);
  });

  it('advance suma directo y las cantidades inválidas no hacen retroceder', () => {
    const difficulty = new DifficultySystem();

    difficulty.advance(1000);
    expect(difficulty.distance).toBe(1000);

    difficulty.advance(-500);
    difficulty.advance(Number.NaN);
    difficulty.advance(0);
    expect(difficulty.distance).toBe(1000); // monotónica
  });

  it('reset vuelve a cero', () => {
    const difficulty = new DifficultySystem();
    difficulty.advance(12345);

    difficulty.reset();

    expect(difficulty.distance).toBe(0);
    expect(difficulty.ratio).toBe(0);
  });
});

describe('DifficultySystem — rampa monotónica', () => {
  it('los parámetros nunca retroceden al crecer la distancia', () => {
    const difficulty = new DifficultySystem();
    let lastFactor = difficulty.rivalSpeedFactor;
    let lastDensity = difficulty.spawnDensity;
    let lastLevel = difficulty.patternLevel;

    const step = DIFFICULTY.maxDistance / 50;
    for (let i = 0; i <= 120; i += 1) {
      // Se pasa del tope a propósito: una vez saturada, todo queda constante.
      difficulty.advance(step);
      const params = difficulty.params;

      expect(params.rivalSpeedFactor).toBeGreaterThanOrEqual(lastFactor);
      expect(params.spawnDensity).toBeGreaterThanOrEqual(lastDensity);
      expect(params.patternLevel).toBeGreaterThanOrEqual(lastLevel);
      expect(params.ratio).toBeGreaterThanOrEqual(0);
      expect(params.ratio).toBeLessThanOrEqual(1);

      lastFactor = params.rivalSpeedFactor;
      lastDensity = params.spawnDensity;
      lastLevel = params.patternLevel;
    }
  });

  it('al llegar al tope satura en los máximos de balance (clamps)', () => {
    const difficulty = new DifficultySystem();

    difficulty.advance(DIFFICULTY.maxDistance * 3);

    expect(difficulty.ratio).toBe(1);
    expect(difficulty.params.rivalSpeedFactor).toBeCloseTo(1 + DIFFICULTY.rivalSpeedBonus);
    expect(difficulty.params.spawnDensity).toBeCloseTo(DIFFICULTY.spawnDensityMax);
    expect(difficulty.params.patternLevel).toBe(DIFFICULTY.maxPatternLevel);
  });
});

describe('DifficultySystem — niveles de patrón', () => {
  it('desbloquea patrones por tramos: nivel 1 → 2 → 3', () => {
    const difficulty = new DifficultySystem();

    expect(difficulty.patternLevel).toBe(1); // ratio 0

    difficulty.advance(DIFFICULTY.maxDistance * 0.4);
    expect(difficulty.patternLevel).toBe(2); // 0.33 < ratio ≤ 0.66

    difficulty.advance(DIFFICULTY.maxDistance * 0.35); // ratio 0.75
    expect(difficulty.patternLevel).toBe(3);
  });

  it('params expone un snapshot plano de datos (no referencias internas)', () => {
    const difficulty = new DifficultySystem();
    difficulty.advance(1000);

    const params = difficulty.params;

    expect(params).toEqual({
      ratio: difficulty.ratio,
      rivalSpeedFactor: difficulty.rivalSpeedFactor,
      spawnDensity: difficulty.spawnDensity,
      patternLevel: difficulty.patternLevel,
    });
  });
});
