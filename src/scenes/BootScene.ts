import Phaser from 'phaser';
import { getAudioEngine } from '../audio/AudioManager';
import { getSaveRepository } from '../data/LocalStorageSaveRepository';
import { getSessionEventBus } from '../core/EventBus';
import { getSocialChatSession } from '../chat/socialChatSession';
import { PreloadScene } from './PreloadScene';

/**
 * BootScene — primer eslabón del flujo Boot → Preload → Menu → Game →
 * GameOver (Fase 5).
 *
 * Prepara el fondo y resuelve los SERVICIOS DE SESIÓN en el registry de
 * Phaser (quedan cacheados como servicios de larga vida para el resto del
 * juego — menú, carrera y game over los consumen):
 * - Repositorio de guardado (Fase 5): `getSaveRepository`.
 * - Bus de sesión (Fase 6): `getSessionEventBus` — un único canal de
 *   eventos compartido por escenas, HUD y audio.
 * - Motor de audio (Fase 6): `getAudioEngine` — se conecta al bus (traduce
 *   eventos → SFX) y arma el desbloqueo del AudioContext en el primer gesto
 *   (pointerdown/keydown, política de autoplay móvil).
 * - Sesión social de chat (issue #2, auditoría #2 MENOR 2):
 *   `getSocialChatSession`. Este es el punto de creación EAGER deliberado:
 *   Boot corre EXACTAMENTE UNA vez por carga de página (Preload → Menu →
 *   Game → GameOver se reinician entre sí, Boot jamás), así la disponibilidad
 *   persistida se aplica una sola vez y al arrancar — quien dejó el toggle
 *   SÍ reconecta a la sala pública (join + heartbeat) sin abrir el chat,
 *   cumpliendo el modelo mental del criterio C2. Con el default NO el
 *   constructor de la sesión NI toca el ChatClient: cero conexión, cero
 *   coste (el cliente Trystero se construye igual en el primer consumidor
 *   que lo pida — resolverlo no abre red).
 *
 * Inversión de dependencias: para enchufar otros backends basta inyectarlos
 * ANTES con `game.registry.set(...)`; estas resoluciones los respetan.
 * Delega de inmediato a PreloadScene, que genera las texturas procedurales
 * con barra de progreso real y arranca el menú.
 */
export class BootScene extends Phaser.Scene {
  static readonly KEY = 'Boot';

  constructor() {
    super(BootScene.KEY);
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#000000');
    getSaveRepository(this.registry);

    // Fase 6 — audio: resolver, conectar al bus de sesión y preparar el
    // desbloqueo por gesto. El AudioContext se crea lazy (primer gesto), así
    // que acá no hay coste ni advertencias de autoplay.
    const audio = getAudioEngine(this.registry);
    audio.attachBus(getSessionEventBus(this.registry));
    audio.attachUnlockListeners();

    // Issue #2 (auditoría #2, MENOR 2) — sesión social eager: aplica el
    // ajuste persistido de disponibilidad al arrancar (ver header).
    getSocialChatSession(this.registry);

    this.scene.start(PreloadScene.KEY);
  }
}
