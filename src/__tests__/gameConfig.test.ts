import { describe, expect, it } from 'vitest';
import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, createGameConfig } from '../config/gameConfig';
import { BootScene } from '../scenes/BootScene';

describe('gameConfig', () => {
  it('usa la resolución base portrait 720×1280', () => {
    const config = createGameConfig('game');

    expect(GAME_WIDTH).toBe(720);
    expect(GAME_HEIGHT).toBe(1280);
    expect(config.width).toBe(GAME_WIDTH);
    expect(config.height).toBe(GAME_HEIGHT);
  });

  it('usa tipo AUTO, Scale.FIT y CENTER_BOTH', () => {
    const config = createGameConfig('game');

    expect(config.type).toBe(Phaser.AUTO);
    expect(config.scale?.mode).toBe(Phaser.Scale.FIT);
    expect(config.scale?.autoCenter).toBe(Phaser.Scale.CENTER_BOTH);
  });

  it('activa pixelArt y roundPixels', () => {
    const config = createGameConfig('game');

    expect(config.pixelArt).toBe(true);
    expect(config.roundPixels).toBe(true);
  });

  it('configura Arcade Physics sin gravedad y sin debug', () => {
    const config = createGameConfig('game');

    expect(config.physics?.default).toBe('arcade');
    const arcade = config.physics?.arcade;
    if (typeof arcade !== 'object' || arcade === null) {
      throw new Error('La configuración de física arcade no es un objeto');
    }
    expect(arcade.gravity?.x).toBe(0);
    expect(arcade.gravity?.y).toBe(0);
    expect(arcade.debug).toBe(false);
  });

  it('registra BootScene como escena inicial', () => {
    const config = createGameConfig('game');
    const scenes = config.scene as Phaser.Scene[];

    // Phaser acepta clases o instancias; la config registra la clase directamente.
    expect(Array.isArray(scenes)).toBe(true);
    expect(scenes).toContain(BootScene);
  });
});
