/**
 * DrsIndicator — chip del HUD con el estado del DRS (Fase 3).
 *
 * Se conecta por EventBus (inversión de dependencias: no conoce sistemas ni
 * a la escena de juego): se suscribe al evento `drs`
 * (`{ state, cooldownRatio, cooldownSeconds }`) que GameScene emite por
 * frame. Estados visuales:
 * - `off`      → panel gris, "DRS" tenue (no está en recta).
 * - `ready`    → "DRS LISTO" verde PARPADEANDO (el parpadeo usa el reloj de
 *                la escena y requiere emisiones frecuentes, que GameScene
 *                garantiza al emitir por frame).
 * - `active`   → "DRS ACTIVO" verde sólido.
 * - `cooldown` → relleno ámbar progresivo (recarga) + cuenta regresiva en s.
 *
 * Presentación con primitivas (sin `Graphics` dinámicos ni assets externos).
 */

import Phaser from 'phaser';
import { EventBus, type DrsStatus, type GameEvents } from '../core/EventBus';

export interface DrsIndicatorConfig {
  /** X del centro del chip. */
  readonly x: number;
  /** Y del centro del chip. */
  readonly y: number;
  /** Ancho del chip. */
  readonly width: number;
  /** Alto del chip. */
  readonly height: number;
  /** Profundidad en la escena. */
  readonly depth?: number;
}

/** Colores del chip por estado. */
const PANEL_COLORS: Record<DrsStatus, number> = {
  off: 0x26262e,
  ready: 0x14532d,
  active: 0x1d8f43,
  cooldown: 0x26262e,
};

const LABEL_COLORS: Record<DrsStatus, string> = {
  off: '#7d828c',
  ready: '#5dff8a',
  active: '#ffffff',
  cooldown: '#d8a72c',
};

/** Etiqueta por estado (el cooldown agrega la cuenta regresiva). */
function labelFor(state: DrsStatus, cooldownSeconds: number): string {
  switch (state) {
    case 'ready':
      return 'DRS LISTO';
    case 'active':
      return 'DRS ACTIVO';
    case 'cooldown':
      return `DRS ${Math.ceil(Math.max(0, cooldownSeconds))}s`;
    default:
      return 'DRS';
  }
}

export class DrsIndicator {
  readonly container: Phaser.GameObjects.Container;

  private readonly scene: Phaser.Scene;
  private readonly unsubscribe: () => void;
  private readonly panel: Phaser.GameObjects.Rectangle;
  private readonly cooldownFill: Phaser.GameObjects.Rectangle;
  private readonly fillWidth: number;
  private readonly label: Phaser.GameObjects.Text;
  private state: DrsStatus = 'off';

  constructor(scene: Phaser.Scene, bus: EventBus<GameEvents>, config: DrsIndicatorConfig) {
    const { x, y, width, height, depth = 0 } = config;
    this.scene = scene;
    this.fillWidth = Math.max(1, width);

    this.container = scene.add.container(x, y).setDepth(depth);

    this.panel = scene.add.rectangle(0, 0, width, height, PANEL_COLORS.off);
    this.cooldownFill = scene.add
      .rectangle(-this.fillWidth / 2, 0, 0, height, 0xd8a72c)
      .setOrigin(0, 0.5)
      .setVisible(false);
    this.label = scene.add
      .text(0, 0, 'DRS', {
        fontFamily: 'monospace',
        fontSize: '26px',
        color: LABEL_COLORS.off,
      })
      .setOrigin(0.5);

    this.container.add(this.panel);
    this.container.add(this.cooldownFill);
    this.container.add(this.label);

    this.unsubscribe = bus.on('drs', (payload) => {
      this.apply(payload.state, payload.cooldownRatio, payload.cooldownSeconds);
    });
  }

  /** Repinta el chip según el estado recibido por el bus. */
  private apply(state: DrsStatus, cooldownRatio: number, cooldownSeconds: number): void {
    if (state !== this.state) {
      this.state = state;
      this.panel.setFillStyle(PANEL_COLORS[state]);
      this.label.setColor(LABEL_COLORS[state]);
      this.cooldownFill.setVisible(state === 'cooldown');
    }

    if (state === 'cooldown') {
      // Relleno progresivo: crece de izquierda a derecha mientras recarga.
      const ratio = Number.isFinite(cooldownRatio) ? Phaser.Math.Clamp(cooldownRatio, 0, 1) : 0;
      this.cooldownFill.setSize(Math.round(this.fillWidth * (1 - ratio)), this.cooldownFill.height);
      this.label.setText(labelFor(state, cooldownSeconds));
    } else if (state === 'ready') {
      // Parpadeo de "listo" con el reloj de la escena (emisión por frame).
      const on = Math.floor(this.scene.time.now / 260) % 2 === 0;
      this.container.setAlpha(on ? 1 : 0.45);
    } else {
      this.container.setAlpha(1);
    }
  }

  /** Desuscribe del bus y destruye los game objects. */
  destroy(): void {
    this.unsubscribe();
    this.container.destroy();
  }
}
