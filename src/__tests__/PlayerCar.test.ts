import { describe, expect, it } from 'vitest';
import { slipSteer } from '../entities/PlayerCar';

/**
 * Tests de la lógica PURA de PlayerCar (Fase 4): el steering durante el
 * derrape de aceite. La clase en sí (sprite arcade, body, clamp a pista,
 * inclinación) es render/física de Phaser y se verifica manualmente corriendo
 * el juego (QA checklist del README); la decisión de dirección por frame es
 * una función pura exportada y se testea acá.
 *
 * Contrato de `slipSteer(steer, slipElapsed)`:
 * - Si el jugador DOBLA, la dirección pedida se INVIERTE (el auto no obedece).
 * - Si el jugador NO dobla, el auto zigzaguea solo: signo de
 *   `sin(slipElapsed * 16)` (cambia de lado solo, con periodicidad fija).
 * - Durante el derrape NUNCA hay neutral: siempre devuelve -1 o 1.
 */

describe('slipSteer — inversión del input durante el derrape', () => {
  it('doblar a la derecha (1) se invierte a izquierda (-1)', () => {
    expect(slipSteer(1, 0)).toBe(-1);
    expect(slipSteer(1, 0.37)).toBe(-1);
  });

  it('doblar a la izquierda (-1) se invierte a derecha (1)', () => {
    expect(slipSteer(-1, 0)).toBe(1);
    expect(slipSteer(-1, 0.37)).toBe(1);
  });

  it('la inversión es constante: no depende del tiempo derrapando', () => {
    for (let elapsed = 0; elapsed <= 2; elapsed += 0.05) {
      expect(slipSteer(1, elapsed)).toBe(-1);
      expect(slipSteer(-1, elapsed)).toBe(1);
    }
  });
});

describe('slipSteer — zigzag automático sin input', () => {
  it('arranca hacia la derecha (sin(0) = 0 cae en el lado positivo)', () => {
    expect(slipSteer(0, 0)).toBe(1);
  });

  it('alterna de lado solo según el signo de sin(elapsed × 16)', () => {
    // Puntos elegidos en los tramos estables de cada semi-onda:
    // 1.6 rad → +, 3.2 rad → -, 4.8 rad → -, 6.4 rad → +, 8.0 rad → +.
    expect(slipSteer(0, 0.1)).toBe(1); // 16 × 0.1 = 1.6 rad
    expect(slipSteer(0, 0.2)).toBe(-1); // 3.2 rad
    expect(slipSteer(0, 0.3)).toBe(-1); // 4.8 rad
    expect(slipSteer(0, 0.4)).toBe(1); // 6.4 rad
    expect(slipSteer(0, 0.5)).toBe(1); // 8.0 rad
  });

  it('el zigzag es periódico: el mismo elapsed relativo da el mismo lado', () => {
    // Periodo de sin(16t) es 2π/16 ≈ 0.3927 s. Se omiten las muestras caídas
    // en la banda de cruce por cero (ahí el signo lo decide el épsilon del
    // `>= 0` y el redondeo flotante, no la forma de onda).
    const period = (2 * Math.PI) / 16;
    for (let elapsed = 0; elapsed < 1; elapsed += 0.01) {
      if (Math.abs(Math.sin(elapsed * 16)) < 0.05) {
        continue;
      }
      expect(slipSteer(0, elapsed)).toBe(slipSteer(0, elapsed + period));
    }
  });

  it('con elapsed grande (derrape encadenado) sigue oscilando entre ±1', () => {
    const sides = new Set<number>();
    for (let elapsed = 0; elapsed <= 10; elapsed += 0.01) {
      sides.add(slipSteer(0, elapsed));
    }
    expect([...sides].sort()).toEqual([-1, 1]);
  });
});

describe('slipSteer — propiedades del contrato', () => {
  it('jamás devuelve 0 ni otra magnitud: durante el derrape siempre hay giro', () => {
    const steers = [0, 1, -1];
    for (let elapsed = 0; elapsed <= 1; elapsed += 0.01) {
      for (const steer of steers) {
        const result = slipSteer(steer, elapsed);
        expect(result === -1 || result === 1).toBe(true);
      }
    }
  });
});
