import { describe, expect, it } from 'vitest';
import type Phaser from 'phaser';
import {
  ALL_TEXTURE_KEYS,
  CAR_SPRITE_ROWS,
  COIN_SPRITE,
  DEBRIS_SPRITE,
  DRS_PICKUP_SPRITE,
  OIL_STAIN_SPRITE,
  TEXTURE_KEYS,
  TextureFactory,
  TURBO_PICKUP_SPRITE,
  TOTAL_TEXTURE_COUNT,
  makeCarSprite,
  pixelSpriteSize,
  type PixelSprite,
  type TextureKey,
} from '../systems/TextureFactory';

/**
 * Tests de la parte pura/no-Phaser de TextureFactory: claves de texturas y
 * validez de los mapas de píxeles (que las filas sean rectangulares y que
 * cada caracter tenga color en la paleta). El horneado con Graphics real se
 * verifica al correr el juego, no acá.
 */

const HEX_PATTERN = /^#[0-9a-f]{6}$/i;

function expectValidPixelSprite(sprite: PixelSprite, label: string): void {
  expect(sprite.rows.length, `${label}: debe tener filas`).toBeGreaterThan(0);

  const width = sprite.rows[0].length;
  expect(width, `${label}: la primera fila debe tener píxeles`).toBeGreaterThan(0);

  for (const row of sprite.rows) {
    expect(row.length, `${label}: todas las filas miden lo mismo`).toBe(width);
    for (const char of row) {
      if (char === '.') {
        continue;
      }
      expect(sprite.palette[char], `${label}: color de '${char}'`).toMatch(HEX_PATTERN);
    }
  }
}

describe('TEXTURE_KEYS', () => {
  it('expone todas las texturas requeridas por la Fase 1', () => {
    const values = Object.values(TEXTURE_KEYS);
    expect(values).toEqual(
      expect.arrayContaining([
        'road-tile',
        'player-car',
        'rival-car-blue',
        'rival-car-green',
        'rival-car-yellow',
        'coin',
        'debris',
        'oil-stain',
        'pickup-turbo',
        'pickup-drs',
        'particle',
      ]),
    );
  });

  it('no tiene claves duplicadas', () => {
    const values = Object.values(TEXTURE_KEYS);
    expect(new Set(values).size).toBe(values.length);
  });

  it('ALL_TEXTURE_KEYS y TOTAL_TEXTURE_COUNT son consistentes', () => {
    expect(ALL_TEXTURE_KEYS.length).toBe(Object.keys(TEXTURE_KEYS).length);
    expect(TOTAL_TEXTURE_COUNT).toBe(ALL_TEXTURE_KEYS.length);
    expect(TOTAL_TEXTURE_COUNT).toBeGreaterThanOrEqual(11);
  });

  it('generate() lanza error para una clave desconocida', () => {
    expect(() =>
      TextureFactory.generate(null as unknown as Phaser.Scene, 'no-existe' as TextureKey),
    ).toThrow(/Textura desconocida/);
  });
});

describe('mapas de píxeles', () => {
  it('el mapa del auto es rectangular de 12 px de ancho', () => {
    expect(CAR_SPRITE_ROWS.length).toBeGreaterThan(0);
    for (const row of CAR_SPRITE_ROWS) {
      expect(row.length).toBe(12);
    }
  });

  it('los sprites declarados son válidos', () => {
    const sprites: Array<[PixelSprite, string]> = [
      [COIN_SPRITE, 'coin'],
      [DEBRIS_SPRITE, 'debris'],
      [OIL_STAIN_SPRITE, 'oil-stain'],
      [TURBO_PICKUP_SPRITE, 'pickup-turbo'],
      [DRS_PICKUP_SPRITE, 'pickup-drs'],
    ];
    for (const [sprite, label] of sprites) {
      expectValidPixelSprite(sprite, label);
    }
  });

  it('makeCarSprite aplica el palette swap sin romper el mapa', () => {
    const player = makeCarSprite('#d63c3c', '#8f1f1f');
    const rival = makeCarSprite('#3c6cd6', '#24509a');

    expectValidPixelSprite(player, 'player');
    expectValidPixelSprite(rival, 'rival');

    // Mismo mapa (rivales reutilizan la forma del jugador)…
    expect(rival.rows).toEqual(CAR_SPRITE_ROWS);
    expect(player.rows).toEqual(CAR_SPRITE_ROWS);

    // …con carrocería y sombra propios.
    expect(player.palette.r).toBe('#d63c3c');
    expect(player.palette.d).toBe('#8f1f1f');
    expect(rival.palette.r).toBe('#3c6cd6');
    expect(rival.palette.d).toBe('#24509a');
  });

  it('pixelSpriteSize calcula el tamaño horneado correctamente', () => {
    // Moneda: mapa 8×8 con escala 3 → 24×24.
    expect(pixelSpriteSize(COIN_SPRITE, 3)).toEqual({ width: 24, height: 24 });
    // Auto: mapa 12×19 con escala 4 → 48×76.
    expect(pixelSpriteSize(makeCarSprite('#d63c3c', '#8f1f1f'), 4)).toEqual({
      width: 48,
      height: 76,
    });
  });

  it('la mancha de aceite es semitransparente (hazard no bloquea la visión)', () => {
    expect(OIL_STAIN_SPRITE.alpha).toBeDefined();
    expect(OIL_STAIN_SPRITE.alpha).toBeGreaterThan(0);
    expect(OIL_STAIN_SPRITE.alpha).toBeLessThan(1);
  });
});
