/**
 * Speedometer — velocímetro numérico del HUD (Fase 3).
 *
 * Se conecta por EventBus (no conoce sistemas): se suscribe al evento
 * `speed` (px/s efectivos ya compuestos con turbo y DRS) y los convierte a
 * km/h estéticos con `SPEEDOMETER_KMH_PER_PX`. Solo repinta cuando cambia el
 * entero mostrado (la emisión llega por frame).
 */

import Phaser from 'phaser';
import { EventBus, type GameEvents } from '../core/EventBus';
import { SPEEDOMETER_KMH_PER_PX } from '../config/balance';

export interface SpeedometerConfig {
  /** X del centro del texto. */
  readonly x: number;
  /** Y del centro del texto. */
  readonly y: number;
  /** Tamaño de fuente (px). */
  readonly fontSize?: number;
  /** Profundidad en la escena. */
  readonly depth?: number;
}

export class Speedometer {
  readonly container: Phaser.GameObjects.Container;

  private readonly unsubscribe: () => void;
  private readonly text: Phaser.GameObjects.Text;
  private lastKmh: number | null = null;

  constructor(scene: Phaser.Scene, bus: EventBus<GameEvents>, config: SpeedometerConfig) {
    const { x, y, fontSize = 56, depth = 0 } = config;

    this.container = scene.add.container(x, y).setDepth(depth);
    this.text = scene.add
      .text(0, 0, '', {
        fontFamily: 'monospace',
        fontSize: `${fontSize}px`,
        color: '#f2f2f2',
      })
      .setOrigin(0.5)
      .setStroke('#0c0c14', 8);
    this.container.add(this.text);

    this.unsubscribe = bus.on('speed', (speed) => {
      const kmh = Math.round(
        (Number.isFinite(speed) ? speed : 0) * SPEEDOMETER_KMH_PER_PX,
      );
      if (kmh !== this.lastKmh) {
        this.lastKmh = kmh;
        this.text.setText(`${kmh} KM/H`);
      }
    });
  }

  /** Desuscribe del bus y destruye los game objects. */
  destroy(): void {
    this.unsubscribe();
    this.container.destroy();
  }
}
