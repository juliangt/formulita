/**
 * ScoreHud — marcador de puntaje y contador de monedas del HUD (Fase 5).
 *
 * Se conecta por EventBus (no conoce sistemas ni la escena de juego): se
 * suscribe a `score` y `coins`, que GameScene emite. Repinta solo cuando
 * cambia el valor mostrado (la emisión llega por frame). Presentación con
 * primitivas: textos monospace con contorno + la moneda pixel de
 * TextureFactory como icono.
 */

import Phaser from 'phaser';
import { EventBus, type GameEvents } from '../core/EventBus';
import { TEXTURE_KEYS } from '../systems/TextureFactory';
import { formatScore } from './format';

export interface ScoreHudConfig {
  /** X del puntaje (el texto ancla por su borde izquierdo). */
  readonly scoreX: number;
  /** Y del puntaje (centro del texto). */
  readonly scoreY: number;
  /** X de las monedas (el texto ancla por su borde derecho). */
  readonly coinsX: number;
  /** Y de las monedas (centro del texto). */
  readonly coinsY: number;
  /** Tamaño de fuente (px). */
  readonly fontSize?: number;
  /** Profundidad en la escena. */
  readonly depth?: number;
}

/** Separación entre el icono de moneda y su contador (px). */
const COIN_ICON_GAP = 10;

export class ScoreHud {
  readonly container: Phaser.GameObjects.Container;

  private readonly unsubscribe: () => void;
  private readonly coinsText: Phaser.GameObjects.Text;
  private readonly coinIcon: Phaser.GameObjects.Image;
  private readonly coinsX: number;
  private lastScore: number | null = null;
  private lastCoins: number | null = null;

  constructor(scene: Phaser.Scene, bus: EventBus<GameEvents>, config: ScoreHudConfig) {
    const { scoreX, scoreY, coinsX, coinsY, fontSize = 26, depth = 0 } = config;
    this.coinsX = coinsX;

    const style: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: 'monospace',
      fontSize: `${fontSize}px`,
      color: '#f2f2f2',
    };

    this.container = scene.add.container(0, 0).setDepth(depth);

    const scoreText = scene.add
      .text(scoreX, scoreY, `PTS ${formatScore(0)}`, style)
      .setOrigin(0, 0.5)
      .setStroke('#0c0c14', 6);
    this.coinsText = scene.add
      .text(coinsX, coinsY, 'x 0', style)
      .setOrigin(1, 0.5)
      .setStroke('#0c0c14', 6);
    this.coinIcon = scene.add
      .image(coinsX, coinsY, TEXTURE_KEYS.coin)
      .setOrigin(1, 0.5)
      .setScale(1.2);
    this.repositionCoinIcon();

    this.container.add([scoreText, this.coinsText, this.coinIcon]);

    this.unsubscribe = bus.on('score', (score) => {
      if (score !== this.lastScore) {
        this.lastScore = score;
        scoreText.setText(`PTS ${formatScore(score)}`);
      }
    });
    const unsubscribeCoins = bus.on('coins', (coins) => {
      if (coins !== this.lastCoins) {
        this.lastCoins = coins;
        this.coinsText.setText(`x ${Math.max(0, Math.floor(coins))}`);
        this.repositionCoinIcon();
      }
    });

    // Desuscripción conjunta (el bus soporta una sola función por widget acá).
    const inner = this.unsubscribe;
    this.unsubscribe = () => {
      inner();
      unsubscribeCoins();
    };
  }

  /** El icono acompaña al borde izquierdo del contador (que crece a la derecha). */
  private repositionCoinIcon(): void {
    this.coinIcon.setX(this.coinsX - this.coinsText.width - COIN_ICON_GAP);
  }

  /** Desuscribe del bus y destruye los game objects. */
  destroy(): void {
    this.unsubscribe();
    this.container.destroy();
  }
}
