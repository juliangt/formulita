import { describe, expect, it } from 'vitest';
import { deriveRng, hashStringToSeed, mulberry32 } from '../net/roomRng';

/**
 * Tests del RNG de sala (M0 — pista determinista): el multijugador exige
 * que la misma seed produzca la MISMA secuencia de azar en cualquier
 * cliente. Cubre mulberry32 (secuencia y rango), la derivación de seeds por
 * entidad (determinista y distinta por índice) y el hash de strings
 * (determinista y sensible a cada carácter).
 */

/** Primeros N valores de un rng, como huella digital de su secuencia. */
function sequence(rng: () => number, count: number): number[] {
  const values: number[] = [];
  for (let i = 0; i < count; i += 1) {
    values.push(rng());
  }
  return values;
}

describe('mulberry32 — PRNG determinista', () => {
  it('misma seed → misma secuencia exacta', () => {
    const a = mulberry32(20260930);
    const b = mulberry32(20260930);
    expect(sequence(a, 128)).toEqual(sequence(b, 128));
  });

  it('distinta seed → secuencia distinta', () => {
    const fingerprints = new Set<string>();
    for (let seed = 0; seed < 32; seed += 1) {
      fingerprints.add(sequence(mulberry32(seed), 16).join(','));
    }
    // Ninguna de las 32 semillas colisiona con otra en los primeros 16 draws.
    expect(fingerprints.size).toBe(32);
  });

  it('todos los valores están en [0, 1)', () => {
    for (let seed = 0; seed < 64; seed += 1) {
      for (const value of sequence(mulberry32(seed), 256)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      }
    }
  });

  it('la secuencia no es constante ni trivialmente cíclica en corto', () => {
    const values = sequence(mulberry32(7), 1000);
    expect(new Set(values).size).toBe(1000); // sin repeticiones en 1000 draws
  });

  it('es aproximadamente uniforme (media ≈ 0.5 en 50k draws)', () => {
    const values = sequence(mulberry32(42), 50000);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(Math.abs(mean - 0.5)).toBeLessThan(0.01);
  });

  it('seed 0 es válida (caso borde del normalizado a uint32)', () => {
    const values = sequence(mulberry32(0), 16);
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('deriveRng — semillas por entidad', () => {
  it('misma (seed, índice) → misma secuencia', () => {
    expect(sequence(deriveRng(1234, 5), 64)).toEqual(sequence(deriveRng(1234, 5), 64));
  });

  it('el índice cambia el stream: cada spawn tiene su propio azar', () => {
    const firsts: number[] = [];
    for (let index = 0; index < 16; index += 1) {
      firsts.push(deriveRng(99, index)());
    }
    expect(new Set(firsts).size).toBe(16);
  });

  it('secuencias completas distintas entre índices consecutivos', () => {
    for (let index = 0; index < 8; index += 1) {
      const a = sequence(deriveRng(555, index), 32);
      const b = sequence(deriveRng(555, index + 1), 32);
      expect(a).not.toEqual(b);
    }
  });

  it('la seed de la sala cambia el stream del mismo índice', () => {
    expect(sequence(deriveRng(1, 0), 32)).not.toEqual(sequence(deriveRng(2, 0), 32));
    expect(sequence(deriveRng(1, 7), 32)).not.toEqual(sequence(deriveRng(2, 7), 32));
  });

  it('el stream derivado difiere del mulberry32 crudo de la seed', () => {
    // Si derivar no mezclara, todos los rivales compartirían el stream del
    // scheduler (y "leerían" sus próximos draws).
    expect(sequence(deriveRng(77, 0), 16)).not.toEqual(sequence(mulberry32(77), 16));
  });

  it('todos los valores derivados están en [0, 1)', () => {
    for (let index = 0; index < 32; index += 1) {
      for (const value of sequence(deriveRng(31337, index), 64)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      }
    }
  });
});

describe('hashStringToSeed — palabra clave → seed', () => {
  it('determinista: mismo string → mismo número', () => {
    expect(hashStringToSeed('monaco-gp')).toBe(hashStringToSeed('monaco-gp'));
  });

  it('sensible a cada carácter (posición incluida)', () => {
    const base = hashStringToSeed('sala-42');
    const variants = ['Sala-42', 'sala-43', 'saLa-42', 'asla-42', 'sala-4', 'sala-420', ' sala-42'];
    for (const variant of variants) {
      expect(hashStringToSeed(variant), `"${variant}" debería diferir`).not.toBe(base);
    }
  });

  it('devuelve un uint32 (0 ≤ seed < 2^32)', () => {
    for (const text of ['', 'a', 'ab', 'código-de-sala-largo-2026', 'español-y-ñ']) {
      const seed = hashStringToSeed(text);
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(2 ** 32);
    }
  });

  it('seeds de textos parecidos no colisionan en masa', () => {
    const seeds = new Set<number>();
    for (let i = 0; i < 64; i += 1) {
      seeds.add(hashStringToSeed(`room-${i}`));
    }
    expect(seeds.size).toBe(64);
  });

  it('la seed hasheada alimenta mulberry32 como cualquier otra', () => {
    const seed = hashStringToSeed('monza');
    expect(sequence(mulberry32(seed), 32)).toEqual(sequence(mulberry32(hashStringToSeed('monza')), 32));
    for (const value of sequence(mulberry32(seed), 32)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
