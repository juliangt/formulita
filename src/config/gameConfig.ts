import Phaser from 'phaser';
import { BootScene } from '../scenes/BootScene';
import { PreloadScene } from '../scenes/PreloadScene';
import { MenuScene } from '../scenes/MenuScene';
import { LobbyScene } from '../scenes/LobbyScene';
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
    //
    // `touch: true` es CLAVE: sin él Phaser solo crea el TouchManager si el
    // navegador reporta soporte táctil en el arranque (Device.input.touch).
    // En pantallas táctiles que reportan modo desktop (WebView in-app, "sitio
    // de computadora", laptops con pantalla táctil en algunos modos) ningún
    // botón interactivo recibe taps: el juego nunca escucha touchstart y el
    // `touch-action: none` del CSS suprime los mouse events emulados. Forzar
    // el manager hace que el tap funcione siempre (en desktop sin touch el
    // listener simplemente nunca dispara).
    input: {
      activePointers: 5,
      touch: true,
    },
    // M1 — multijugador: contenedor DOM para los inputs de LobbyScene
    // (palabra de sala / nombre). `add.dom()` solo funciona con
    // `createContainer: true`; los elementos quedan sobre el canvas y se
    // destruyen con la escena.
    dom: {
      createContainer: true,
    },
    // Flujo completo (Fase 5 + pausa de Fase 7 + lobby de M1): Boot →
    // Preload (texturas) → Menu → Game → GameOver; REINTENTAR vuelve a Game
    // y MENÚ a Menu. LobbyScene (M1) vive entre Menu y Game: se arranca con
    // init data {mode:'create'|'join', name} desde el menú y arranca Game
    // con los datos de la sala. PauseScene es un OVERLAY: no está en el
    // flujo, se lanza encima de Game (pausada) y se detiene al reanudar. El
    // orden del array es el flujo: Phaser arranca la primera escena.
    scene: [BootScene, PreloadScene, MenuScene, LobbyScene, GameScene, GameOverScene, PauseScene],
  };
}
