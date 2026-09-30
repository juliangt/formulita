/**
 * PixelButton — presentación 8-bit de un botón del HUD táctil (Fase 2).
 *
 * Implementa `TouchButtonVisual` (la interfaz de `systems/TouchButton`):
 * SOLO presentación. No maneja input — el tracking de `pointerId`, el
 * hit-test y el ciclo attach/detach viven en `systems/TouchButton` +
 * `TouchSource`, que observan los eventos de pointer de la escena y hacen
 * hit-test manual. Así el botón no es interactivo para Phaser y no roba
 * eventos al resto del juego (aceptación de Fase 2).
 *
 * Look pixel: panel procedural tintable (`TextureFactory`, panel blanco con
 * borde horneado) + glifo (textura de flecha o etiqueta ASCII corta en
 * monospace, coherente con el texto 8-bit del resto del juego).
 * Feedback de presión según el plan: cambia alpha + scale (+ color de letra).
 */

import Phaser from 'phaser';
import { TOUCH_HUD } from '../config/balance';
import { TEXTURE_KEYS, type TextureKey } from '../systems/TextureFactory';
import type { TouchButtonRect, TouchButtonVisual } from '../systems/TouchButton';

/** Estilo visual de un botón del HUD táctil. */
export interface PixelButtonStyle {
  /** Textura procedural del glifo (flechas del HUD). Tiene prioridad sobre `label`. */
  readonly icon?: TextureKey;
  /** Etiqueta ASCII corta (GAS, BRK, TURBO, DRS). */
  readonly label?: string;
  /** Color del panel: tint multiplicativo sobre la textura blanca. */
  readonly tint: number;
  /** Color de la etiqueta en reposo (default blanco hueso). */
  readonly labelColor?: string;
}

/** Botón pixel del HUD táctil (visual puro del `TouchButton`). */
export class PixelButton implements TouchButtonVisual {
  readonly container: Phaser.GameObjects.Container;

  private readonly labelColor: string;
  private label: Phaser.GameObjects.Text | null = null;

  constructor(scene: Phaser.Scene, rect: TouchButtonRect, style: PixelButtonStyle) {
    this.labelColor = style.labelColor ?? '#f2f2f2';

    // Contenedor centrado en el rect del botón; la lógica NO lo toca.
    this.container = scene.add
      .container(rect.x + rect.width / 2, rect.y + rect.height / 2)
      .setDepth(TOUCH_HUD.depth);

    // Panel compartido (blanco tintable con borde horneado a la textura).
    this.container.add(scene.add.image(0, 0, TEXTURE_KEYS.hudPanel).setTint(style.tint));

    if (style.icon) {
      this.container.add(scene.add.image(0, 0, style.icon).setTint(0xffffff));
    }

    if (style.label) {
      this.label = scene.add
        .text(0, 0, style.label, {
          fontFamily: 'monospace',
          fontSize: `${TOUCH_HUD.labelFontSize}px`,
          color: this.labelColor,
        })
        .setOrigin(0.5);
      this.container.add(this.label);
    }

    this.setPressed(false);
  }

  /** Feedback de presión: opaco, levemente encogido y letra resaltada. */
  setPressed(pressed: boolean): void {
    this.container.setAlpha(pressed ? TOUCH_HUD.pressedAlpha : TOUCH_HUD.baseAlpha);
    this.container.setScale(pressed ? TOUCH_HUD.pressedScale : 1);
    this.label?.setColor(pressed ? '#ffffff' : this.labelColor);
  }

  destroy(): void {
    this.container.destroy();
  }
}
