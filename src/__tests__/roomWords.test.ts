import { describe, expect, it } from 'vitest';
import { MULTIPLAYER } from '../config/balance';
import { mulberry32 } from '../net/roomRng';
import { pickRoomWord, ROOM_WORDS } from '../net/roomWords';

/**
 * Tests del diccionario de palabras de sala (M1): la palabra ES el roomId de
 * Trystero, así que el formato no es negociable — el test valida TODAS las
 * entradas y `pickRoomWord` (determinismo con rng sembrado, sin Math.random).
 */

describe('roomWords — diccionario de palabras de sala', () => {
  it('tiene ~150 palabras (150±10)', () => {
    expect(ROOM_WORDS.length).toBeGreaterThanOrEqual(140);
    expect(ROOM_WORDS.length).toBeLessThanOrEqual(160);
  });

  it('todas son uppercase A-Z y de 5 a 9 letras (formato del roomId)', () => {
    for (const word of ROOM_WORDS) {
      expect(word).toMatch(/^[A-Z]{5,9}$/);
    }
  });

  it('todas son únicas', () => {
    expect(new Set(ROOM_WORDS).size).toBe(ROOM_WORDS.length);
  });

  it('las longitudes calzan con los límites de balance', () => {
    for (const word of ROOM_WORDS) {
      expect(word.length).toBeGreaterThanOrEqual(MULTIPLAYER.roomWordMinLength);
      expect(word.length).toBeLessThanOrEqual(MULTIPLAYER.roomWordMaxLength);
    }
  });

  it('incluye palabras clave del dominio (spot check)', () => {
    for (const expected of ['PARRILLA', 'BOXES', 'NEUMATICO', 'ESCAPERIA', 'CHICANE']) {
      expect(ROOM_WORDS).toContain(expected);
    }
  });

  it('pickRoomWord siempre devuelve una palabra de la lista', () => {
    const rng = mulberry32(1234);
    for (let i = 0; i < 500; i += 1) {
      expect(ROOM_WORDS).toContain(pickRoomWord(rng));
    }
  });

  it('pickRoomWord es determinista con el mismo rng sembrado', () => {
    const first = pickRoomWord(mulberry32(42));
    const second = pickRoomWord(mulberry32(42));
    expect(first).toBe(second);
    expect(ROOM_WORDS).toContain(first);
  });

  it('rng distintos reparten por toda la lista (cubre índices extremos)', () => {
    // rng constantes extremos: 0 → primera palabra, ~1 → última.
    expect(pickRoomWord(() => 0)).toBe(ROOM_WORDS[0]);
    expect(pickRoomWord(() => 0.999999)).toBe(ROOM_WORDS[ROOM_WORDS.length - 1]);
    // rng defectuoso (1 exacto o NaN) queda clampeado dentro del array.
    expect(ROOM_WORDS).toContain(pickRoomWord(() => 1));
    expect(ROOM_WORDS).toContain(pickRoomWord(() => Number.NaN));
    // Muchas seeds cubren una porción amplia de la lista (no siempre la misma).
    const picks = new Set<string>();
    for (let seed = 0; seed < 200; seed += 1) {
      picks.add(pickRoomWord(mulberry32(seed)));
    }
    expect(picks.size).toBeGreaterThan(50);
  });
});
