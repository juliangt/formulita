import Phaser from 'phaser';
import { PreloadScene } from './PreloadScene';

/**
 * BootScene — primer eslabón del flujo Boot → Preload → Game (Fase 1).
 *
 * Prepara el fondo y delega de inmediato a PreloadScene, que genera las
 * texturas procedurales con barra de progreso real y arranca GameScene.
 */
export class BootScene extends Phaser.Scene {
  static readonly KEY = 'Boot';

  constructor() {
    super(BootScene.KEY);
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#000000');
    this.scene.start(PreloadScene.KEY);
  }
}
