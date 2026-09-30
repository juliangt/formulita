import { describe, expect, it } from 'vitest';
import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, createGameConfig } from '../config/gameConfig';
import { BootScene } from '../scenes/BootScene';
import { PreloadScene } from '../scenes/PreloadScene';
import { MenuScene } from '../scenes/MenuScene';
import { GameScene } from '../scenes/GameScene';
import { GameOverScene } from '../scenes/GameOverScene';
import { PauseScene } from '../scenes/PauseScene';

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

  it('habilita multi-touch real (varios pointers activos) para el HUD táctil', () => {
    const config = createGameConfig('game');

    const input = config.input;
    if (typeof input !== 'object' || input === null) {
      throw new Error('La configuración de input no es un objeto');
    }
    // El default de Phaser es 1: sin esto no se puede doblar + acelerar a la vez.
    expect(input.activePointers ?? 1).toBeGreaterThan(1);
  });

  it('registra el flujo completo Boot → Preload → Menu → Game → GameOver y el overlay de pausa', () => {
    const config = createGameConfig('game');
    const scenes = config.scene as Phaser.Scene[];

    // Phaser arranca la primera escena del array; el orden ES el flujo.
    // PauseScene es el overlay de la Fase 7: se lanza ENCIMA de Game
    // (pausada), no participa del flujo principal.
    expect(scenes).toEqual([
      BootScene,
      PreloadScene,
      MenuScene,
      GameScene,
      GameOverScene,
      PauseScene,
    ]);
  });

  it('usa claves de escena estables y coherentes con el flujo', () => {
    expect(BootScene.KEY).toBe('Boot');
    expect(PreloadScene.KEY).toBe('Preload');
    expect(MenuScene.KEY).toBe('Menu');
    expect(GameScene.KEY).toBe('Game');
    expect(GameOverScene.KEY).toBe('GameOver');
    expect(PauseScene.KEY).toBe('Pause');
  });
});
