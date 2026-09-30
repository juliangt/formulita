import Phaser from 'phaser';
import { createGameConfig } from './config/gameConfig';

/** Contenedor DOM donde Phaser monta el canvas. */
const GAME_CONTAINER_ID = 'game';

function bootstrap(): Phaser.Game {
  const container = document.getElementById(GAME_CONTAINER_ID);
  if (!container) {
    throw new Error(`No se encontró el contenedor #${GAME_CONTAINER_ID} en el DOM`);
  }
  return new Phaser.Game(createGameConfig(container));
}

// El script es un módulo (defer), por lo que el DOM ya está disponible.
bootstrap();
