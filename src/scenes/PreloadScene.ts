import Phaser from 'phaser';
import {
  ALL_TEXTURE_KEYS,
  TextureFactory,
  TOTAL_TEXTURE_COUNT,
  type TextureKey,
} from '../systems/TextureFactory';
import { MenuScene } from './MenuScene';

/** Medidas de la barra de progreso. */
const BAR_WIDTH = 460;
const BAR_HEIGHT = 30;

/**
 * PreloadScene — "carga" del juego (Fase 1).
 *
 * No hay assets externos: la carga ES la generación de texturas
 * procedurales. Para que el progreso sea real (y visible), se hornea UNA
 * textura por frame en `update()` y la barra refleja texturas generadas /
 * total. Al terminar, arranca el menú (Fase 5).
 */
export class PreloadScene extends Phaser.Scene {
  static readonly KEY = 'Preload';

  private pendingKeys: TextureKey[] = [];
  private completed = 0;
  private barFill!: Phaser.GameObjects.Rectangle;
  private progressLabel!: Phaser.GameObjects.Text;

  constructor() {
    super(PreloadScene.KEY);
  }

  create(): void {
    const { width, height } = this.scale;
    const centerX = width / 2;
    const centerY = height / 2;

    this.cameras.main.setBackgroundColor('#000000');

    this.add
      .text(centerX, centerY - 110, 'FORMULITA', {
        fontFamily: 'monospace',
        fontSize: '72px',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    this.add
      .text(centerX, centerY - 48, 'generando texturas…', {
        fontFamily: 'monospace',
        fontSize: '24px',
        color: '#9e9e9e',
      })
      .setOrigin(0.5);

    // Marco + relleno de la barra.
    this.add
      .rectangle(centerX, centerY, BAR_WIDTH + 8, BAR_HEIGHT + 8, 0x000000)
      .setStrokeStyle(3, 0xffffff);
    this.barFill = this.add
      .rectangle(centerX - BAR_WIDTH / 2, centerY, 0, BAR_HEIGHT, 0xf7c531)
      .setOrigin(0, 0.5);

    this.progressLabel = this.add
      .text(centerX, centerY + 70, '0%', {
        fontFamily: 'monospace',
        fontSize: '28px',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    this.pendingKeys = [...ALL_TEXTURE_KEYS];
    this.completed = 0;
  }

  override update(_time: number, _delta: number): void {
    const key = this.pendingKeys.shift();

    if (key === undefined) {
      // Todas las texturas generadas: al menú.
      this.scene.start(MenuScene.KEY);
      return;
    }

    TextureFactory.generate(this, key);

    this.completed += 1;
    const ratio = this.completed / TOTAL_TEXTURE_COUNT;
    this.barFill.width = BAR_WIDTH * ratio;
    this.progressLabel.setText(`GENERANDO TEXTURAS ${Math.round(ratio * 100)}%`);
  }
}
