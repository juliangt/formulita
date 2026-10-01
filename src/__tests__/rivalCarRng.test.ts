import { describe, expect, it } from 'vitest';
import { RIVAL, SPAWN } from '../config/balance';
import {
  DEFAULT_RIVAL_RNG,
  laneChangeCooldown,
  laneChangeDirection,
  nextLaneIndex,
} from '../entities/RivalCar';
import { deriveRng, mulberry32 } from '../net/roomRng';

/**
 * Tests del rng inyectable de RivalCar (M0 — pista determinista), siguiendo
 * el patrón de PlayerCar.test.ts: las decisiones de cambio de carril son
 * funciones puras exportadas (la clase es sprite arcade de Phaser y se
 * verifica corriendo el juego). El contrato:
 *
 * - `laneChangeDirection(roll)`: roll < 0.5 → izquierda (-1); si no, derecha.
 * - `laneChangeCooldown(roll)`: roll de [0,1) → cooldown en
 *   [laneChangeCooldownMin, laneChangeCooldownMax] (misma distribución que
 *   el Math.random original).
 * - `nextLaneIndex(lane, dir)`: carril vecino clampeado a la pista.
 *
 * Con un rng SEMBRADO, la secuencia de decisiones es determinista: el MISMO
 * rival (misma seed + índice de spawn) esquiva igual en todos los clientes.
 */

describe('laneChangeDirection — dirección del cambio de carril', () => {
  it('roll < 0.5 → izquierda (-1); roll ≥ 0.5 → derecha (+1)', () => {
    expect(laneChangeDirection(0)).toBe(-1);
    expect(laneChangeDirection(0.4999)).toBe(-1);
    expect(laneChangeDirection(0.5)).toBe(1);
    expect(laneChangeDirection(0.9999)).toBe(1);
  });

  it('la frontera es exactamente 0.5, como el `< 0.5` original', () => {
    for (let i = 0; i <= 10; i += 1) {
      const roll = i / 10;
      expect(laneChangeDirection(roll)).toBe(roll < 0.5 ? -1 : 1);
    }
  });
});

describe('laneChangeCooldown — enfriamiento entre cambios', () => {
  it('mapea [0, 1) al rango de balance sin salirse jamás', () => {
    for (let i = 0; i <= 100; i += 1) {
      const roll = i / 100;
      const cooldown = laneChangeCooldown(roll);
      expect(cooldown).toBeGreaterThanOrEqual(RIVAL.laneChangeCooldownMin);
      expect(cooldown).toBeLessThanOrEqual(RIVAL.laneChangeCooldownMax);
    }
  });

  it('es lineal: roll 0 → mínimo, roll cercano a 1 → máximo', () => {
    expect(laneChangeCooldown(0)).toBe(RIVAL.laneChangeCooldownMin);
    expect(laneChangeCooldown(0.999999)).toBeCloseTo(RIVAL.laneChangeCooldownMax, 4);
    const mid = laneChangeCooldown(0.5);
    expect(mid).toBeCloseTo((RIVAL.laneChangeCooldownMin + RIVAL.laneChangeCooldownMax) / 2, 6);
  });
});

describe('nextLaneIndex — carril vecino clampeado', () => {
  it('se mueve un carril por decisión y no sale de la pista', () => {
    expect(nextLaneIndex(2, -1)).toBe(1);
    expect(nextLaneIndex(2, 1)).toBe(3);
    // Bordes: el clamp deja al rival en su carril (decisión sin efecto).
    expect(nextLaneIndex(0, -1)).toBe(0);
    expect(nextLaneIndex(SPAWN.laneCount - 1, 1)).toBe(SPAWN.laneCount - 1);
  });
});

describe('RivalCar — rng por defecto intacto', () => {
  it('el default es exactamente Math.random (comportamiento de siempre)', () => {
    expect(DEFAULT_RIVAL_RNG).toBe(Math.random);
  });
});

describe('RivalCar — decisiones deterministas con rng inyectado', () => {
  /** Secuencia de decisiones de un rival: pares [carril objetivo, cooldown]. */
  function decisionSequence(rng: () => number, decisions: number, startLane: number): string[] {
    const out: string[] = [];
    let lane = startLane;
    for (let i = 0; i < decisions; i += 1) {
      const direction = laneChangeDirection(rng());
      const cooldown = laneChangeCooldown(rng());
      lane = nextLaneIndex(lane, direction);
      out.push(`${lane}@${cooldown.toFixed(6)}`);
    }
    return out;
  }

  it('misma secuencia de rng (misma seed) ⇒ mismas decisiones y mismo carril objetivo', () => {
    const a = decisionSequence(mulberry32(2026), 32, 2);
    const b = decisionSequence(mulberry32(2026), 32, 2);
    expect(a).toEqual(b);
    expect(a.length).toBe(32);
  });

  it('seed distinta ⇒ el rival esquiva distinto en algún momento', () => {
    const a = decisionSequence(mulberry32(1), 32, 1);
    const b = decisionSequence(mulberry32(2), 32, 1);
    expect(a).not.toEqual(b);
  });

  it('rivales de la misma sala (deriveRng por índice) tienen azar independiente', () => {
    const roomSeed = 4242;
    const rival0 = decisionSequence(deriveRng(roomSeed, 0), 24, 0);
    const rival1 = decisionSequence(deriveRng(roomSeed, 1), 24, 0);
    expect(rival0).not.toEqual(rival1);

    // Y el mismo índice en la MISMA sala es reproducible (otro cliente).
    expect(decisionSequence(deriveRng(roomSeed, 1), 24, 0)).toEqual(rival1);
  });

  it('el pool puede reasignar el rng: secuencia nueva ⇒ decisiones nuevas', () => {
    // El mismo stream consumido desde cero reproduce; avanzado, difiere
    // (así un rival reciclado con otra seed no repite su danza anterior).
    const rng = mulberry32(77);
    const first = decisionSequence(rng, 8, 3);
    const continued = decisionSequence(rng, 8, 3);
    expect(first).not.toEqual(continued);
  });
});
