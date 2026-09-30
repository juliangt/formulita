/**
 * EnergyBar — barra genérica reutilizable del HUD (Fase 3).
 *
 * Presentación 8-bit SOLO con primitivas: sin `Graphics` dinámicos (riesgo de
 * rendimiento, PLAN_DESARROLLO.md §Riesgos) — un rect de borde, un rect de
 * fondo, el relleno y muescas de segmento para el look de medidor retro.
 *
 * Es genérica y agnóstica: no conoce el EventBus ni sistemas (quien la usa
 * la conecta, p. ej. `bus.on('turbo', ({ level }) => bar.setRatio(level))`).
 * El color del relleno cambia según el nivel vía `colorStops`.
 */

import Phaser from 'phaser';

/** Tramo de color: se aplica el último tramo cuyo `minRatio` ≤ ratio actual. */
export interface EnergyBarColorStop {
  /** Ratio mínimo (0–1) desde el que aplica el color. */
  readonly minRatio: number;
  /** Color del relleno (0xrrggbb). */
  readonly color: number;
}

export interface EnergyBarConfig {
  /** X del centro de la barra. */
  readonly x: number;
  /** Y del centro de la barra. */
  readonly y: number;
  /** Ancho interior de la barra (sin borde). */
  readonly width: number;
  /** Alto interior de la barra (sin borde). */
  readonly height: number;
  /** Color de fondo del interior (default gris oscuro). */
  readonly bgColor?: number;
  /** Color del borde (default casi negro). */
  readonly borderColor?: number;
  /** Tramos de color del relleno, en orden creciente de `minRatio`. */
  readonly colorStops: readonly EnergyBarColorStop[];
  /** Etiqueta opcional arriba a la izquierda (p. ej. 'TURBO'). */
  readonly label?: string;
  /** Muescas de segmento sobre el relleno (default 4, 0 = sin muescas). */
  readonly segments?: number;
  /** Profundidad en la escena. */
  readonly depth?: number;
}

export class EnergyBar {
  readonly container: Phaser.GameObjects.Container;

  private readonly fill: Phaser.GameObjects.Rectangle;
  private readonly fillWidth: number;
  private readonly colorStops: readonly EnergyBarColorStop[];
  private ratio = -1;

  constructor(scene: Phaser.Scene, config: EnergyBarConfig) {
    const {
      x,
      y,
      width,
      height,
      bgColor = 0x26262e,
      borderColor = 0x0c0c14,
      colorStops,
      label,
      segments = 4,
      depth = 0,
    } = config;

    this.colorStops = colorStops;
    this.fillWidth = Math.max(1, width);

    this.container = scene.add.container(x, y).setDepth(depth);

    // Borde + fondo + relleno (anclado a la izquierda, origen 0/0.5).
    this.container.add(scene.add.rectangle(0, 0, width + 8, height + 8, borderColor));
    this.container.add(scene.add.rectangle(0, 0, width, height, bgColor));
    this.fill = scene.add
      .rectangle(-this.fillWidth / 2, 0, this.fillWidth, height, this.colorFor(1))
      .setOrigin(0, 0.5);
    this.container.add(this.fill);

    // Muescas de segmento (encima del relleno) para el look de medidor 8-bit.
    for (let k = 1; k < segments; k += 1) {
      this.container.add(
        scene.add
          .rectangle(
            -this.fillWidth / 2 + Math.round((this.fillWidth * k) / segments),
            0,
            2,
            height,
            borderColor,
          )
          .setAlpha(0.85),
      );
    }

    if (label) {
      this.container.add(
        scene.add
          .text(-this.fillWidth / 2, -height / 2 - 4, label, {
            fontFamily: 'monospace',
            fontSize: '20px',
            color: '#c8ccd4',
          })
          .setOrigin(0, 1),
      );
    }
  }

  /** Color del tramo que corresponde al ratio (defensivo: NaN → primer tramo). */
  private colorFor(ratio: number): number {
    let color = this.colorStops[0].color;
    for (const stop of this.colorStops) {
      if (Number.isFinite(ratio) && ratio >= stop.minRatio) {
        color = stop.color;
      }
    }
    return color;
  }

  /**
   * Fija el nivel (0–1) y repinta. NaN se trata como 0; valores fuera de
   * rango se clampean. No repinta si el ratio no cambió.
   */
  setRatio(ratio: number): void {
    const next = Number.isFinite(ratio) ? Phaser.Math.Clamp(ratio, 0, 1) : 0;
    if (next === this.ratio) {
      return;
    }
    this.ratio = next;

    const width = Math.round(this.fillWidth * next);
    this.fill.setSize(width, this.fill.height);
    this.fill.setFillStyle(this.colorFor(next));
    this.fill.setVisible(width > 0);
  }

  destroy(): void {
    this.container.destroy();
  }
}
