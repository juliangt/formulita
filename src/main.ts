import Phaser from 'phaser';
import { createGameConfig } from './config/gameConfig';

/** Contenedor DOM donde Phaser monta el canvas. */
const GAME_CONTAINER_ID = 'game';

/**
 * Bloquea los gestos del navegador que arruinan la experiencia de juego en
 * móvil (Fase 7 — robustez): menú contextual de long-press, zoom por
 * double-tap (belt-and-suspenders sobre `touch-action: none` y
 * `user-scalable=no`), gesto de pizña propio de iOS (`gesturestart`) y
 * selección de texto al mantener presionado. El CSS base de index.html hace
 * la mayor parte; estos listeners cubren los huecos que quedan en algunos
 * WebViews viejos. Nunca lanza: si `document` no existe (SSR/tests), no-op.
 */
function installGestureGuards(): void {
  if (typeof document === 'undefined') {
    return;
  }
  const block = (event: Event): void => {
    event.preventDefault();
  };
  // Los tipos de eventos no estándar (iOS) no viven en HTMLElementEventMap:
  // se registran por la sobrecarga de string que acepta cualquier listener.
  document.addEventListener('contextmenu', block);
  document.addEventListener('dblclick', block);
  document.addEventListener('gesturestart', block);
  document.addEventListener('selectstart', block);
}

function bootstrap(): Phaser.Game {
  const container = document.getElementById(GAME_CONTAINER_ID);
  if (!container) {
    throw new Error(`No se encontró el contenedor #${GAME_CONTAINER_ID} en el DOM`);
  }
  return new Phaser.Game(createGameConfig(container));
}

// El script es un módulo (defer), por lo que el DOM ya está disponible.
installGestureGuards();
bootstrap();
