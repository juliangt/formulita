import { describe, expect, it } from 'vitest';
import {
  colorToHex,
  darkenHex,
  ghostScreenY,
  ghostTextureKeyFor,
} from '../entities/GhostCar';
import { GHOST_ALPHA, GHOST_INTERPOLATION_MS } from '../config/balance';

/**
 * Tests de la lógica PURA de los fantasmas (M2): helpers de color/textura y
 * el mapeo distancia→Y de pantalla. La clase GhostCar en sí es render de
 * Phaser (sprite tintado + label) y se verifica manualmente (misma
 * convención que PlayerCar: solo la decisión pura se testea acá).
 */

describe('ghostScreenY — posición relativa a mi auto', () => {
  const baseY = 1020; // PLAYER_START_Y

  it('a la misma distancia, el fantasma está a mi altura', () => {
    expect(ghostScreenY(baseY, 5000, 5000)).toBe(baseY);
  });

  it('más distancia que yo → más ARRIBA en pantalla', () => {
    expect(ghostScreenY(baseY, 6000, 5000)).toBe(baseY - 1000);
  });

  it('menos distancia que yo → más abajo', () => {
    expect(ghostScreenY(baseY, 4000, 5000)).toBe(baseY + 1000);
  });

  it('la escala es 1:1 en px de carrera (la cámara mide en distancia)', () => {
    for (const delta of [-3000, -100, 0, 250, 7777]) {
      expect(ghostScreenY(baseY, 10000 + delta, 10000)).toBe(baseY - delta);
    }
  });
});

describe('helpers de color de fantasmas', () => {
  it('colorToHex: 0xrrggbb → #rrggbb con padding', () => {
    expect(colorToHex(0xd63c3c)).toBe('#d63c3c');
    expect(colorToHex(0x0000ff)).toBe('#0000ff');
    expect(colorToHex(0)).toBe('#000000');
    expect(colorToHex(0xffffff)).toBe('#ffffff');
  });

  it('darkenHex: oscurece canal por canal y clampea a 0', () => {
    expect(darkenHex(0xff0000, 0.5)).toBe('#800000');
    expect(darkenHex(0x64c8ff, 0.5)).toBe('#326480');
    expect(darkenHex(0x101010, 0.1)).toBe('#020202');
    // Nunca pasa de 255 ni de 0.
    expect(darkenHex(0xffffff, 2)).toBe('#ffffff');
    expect(darkenHex(0x0a0a0a, 0)).toBe('#000000');
  });

  it('ghostTextureKeyFor: determinístico por color (una textura por jugador)', () => {
    expect(ghostTextureKeyFor(0xd63c3c)).toBe('ghost-car-d63c3c');
    expect(ghostTextureKeyFor(0x00ff00)).toBe('ghost-car-00ff00');
    expect(ghostTextureKeyFor(0x3c6cd6)).toBe(ghostTextureKeyFor(0x3c6cd6));
    expect(ghostTextureKeyFor(0x123456)).not.toBe(ghostTextureKeyFor(0x654321));
  });
});

describe('constantes de fantasma (balance)', () => {
  it('la interpolación es un intervalo entero del stream a STATE_HZ', () => {
    // 100 ms = 1/10 s: coherente con STATE_HZ (la invariante del diseño).
    expect(GHOST_INTERPOLATION_MS).toBe(100);
    expect(GHOST_ALPHA).toBeGreaterThan(0);
    expect(GHOST_ALPHA).toBeLessThan(1); // semitransparente: es un fantasma
  });
});
