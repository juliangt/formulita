import Phaser from 'phaser';
import { BootScene } from '../scenes/BootScene';
import { PreloadScene } from '../scenes/PreloadScene';
import { GameScene } from '../scenes/GameScene';

/** Resolución base de diseño (portrait). */
export const GAME_WIDTH = 720;
export const GAME_HEIGHT = 1280;

/** Color de fondo del juego (letterbox negro). */
export const GAME_BACKGROUND_COLOR = '#000000';

/**
 * Fábrica de la configuración de Phaser.Game.
 *
 * - Tipo AUTO (WebGL si está disponible, canvas como fallback).
 * - Resolución base 720×1280 con Scale.FIT + CENTER_BOTH: en desktop queda
 *   letterbox centrado; en móvil escala completo sin distorsión.
 * - pixelArt + roundPixels para la nitidez del pixel art procedural.
 * - Arcade Physics sin gravedad (carrera vertical top-down).
 */
export function createGameConfig(parent: HTMLElement | string): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    parent,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    backgroundColor: GAME_BACKGROUND_COLOR,
    // Pixel art nítido: desactiva antialias y redondea píxeles.
    pixelArt: true,
    roundPixels: true,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    physics: {
      default: 'arcade',
      arcade: {
        gravity: { x: 0, y: 0 },
        debug: false,
      },
    },
    // Flujo de escenas de la Fase 1: Boot → Preload (texturas + barra) → Game.
    scene: [BootScene, PreloadScene, GameScene],
  };
}
