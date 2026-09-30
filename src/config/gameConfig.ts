import Phaser from 'phaser';
import { BootScene } from '../scenes/BootScene';
import { PreloadScene } from '../scenes/PreloadScene';
import { MenuScene } from '../scenes/MenuScene';
import { GameScene } from '../scenes/GameScene';
import { GameOverScene } from '../scenes/GameOverScene';
import { PauseScene } from '../scenes/PauseScene';

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
    // Multi-touch real (Fase 2): el default de Phaser es 1 puntero. Doblar
    // (◀/▶) y acelerar a la vez exige varios dedos simultáneos; 5 alcanza de
    // sobra para los 6 botones del HUD táctil.
    input: {
      activePointers: 5,
    },
    // Flujo completo (Fase 5 + pausa de Fase 7): Boot → Preload (texturas) →
    // Menu → Game → GameOver; REINTENTAR vuelve a Game y MENÚ a Menu.
    // PauseScene es un OVERLAY: no está en el flujo, se lanza encima de Game
    // (pausada) y se detiene al reanudar. El orden del array es el flujo:
    // Phaser arranca la primera escena.
    scene: [BootScene, PreloadScene, MenuScene, GameScene, GameOverScene, PauseScene],
  };
}
