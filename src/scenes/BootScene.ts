import Phaser from 'phaser';
import { getSaveRepository } from '../data/LocalStorageSaveRepository';
import { PreloadScene } from './PreloadScene';

/**
 * BootScene — primer eslabón del flujo Boot → Preload → Menu → Game →
 * GameOver (Fase 5).
 *
 * Prepara el fondo, resuelve el repositorio de guardado (queda cacheado en
 * el registry de Phaser como servicio de larga vida para el resto del juego:
 * menú, carrera y game over lo consumen). Inversión de dependencias: para
 * enchufar otro backend (p. ej. un futuro HttpScoreboardRepository) basta
 * inyectarlo ANTES con `game.registry.set(SAVE_REPOSITORY_REGISTRY_KEY, …)`;
 * esta resolución lo respeta. Delega de inmediato a PreloadScene, que genera
 * las texturas procedurales con barra de progreso real y arranca el menú.
 */
export class BootScene extends Phaser.Scene {
  static readonly KEY = 'Boot';

  constructor() {
    super(BootScene.KEY);
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#000000');
    getSaveRepository(this.registry);
    this.scene.start(PreloadScene.KEY);
  }
}
