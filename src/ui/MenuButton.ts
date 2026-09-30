/**
 * MenuButton — botón interactivo de las pantallas de menú/game over (Fase 5).
 *
 * A diferencia del `PixelButton` del HUD táctil (presentación pura, sin
 * input, para no robar eventos del juego), acá SÍ es un objeto interactivo
 * de Phaser: en los menús no hay gameplay que proteger. Look 8-bit con
 * primitivas (rectángulos con borde + texto monospace), mismo lenguaje
 * visual que EnergyBar/DrsIndicator, y feedback de presión (escala + color
 * de etiqueta).
 *
 * El callback `onPress` dispara en `pointerup` SOLO si el pointer sigue
 * sobre el botón (patrón táctil estándar: si el dedo se desliza fuera, no
 * hay acción). El teclado (Enter/Espacio) lo maneja cada escena.
 */

import Phaser from 'phaser';

/** Estilo de un botón de menú. */
export interface MenuButtonConfig {
  /** X del centro del botón. */
  readonly x: number;
  /** Y del centro del botón. */
  readonly y: number;
  /** Ancho total del panel. */
  readonly width: number;
  /** Alto total del panel. */
  readonly height: number;
  /** Etiqueta (ASCII corto: JUGAR, REINTENTAR, MENÚ). */
  readonly label: string;
  /** Color del panel (0xrrggbb). */
  readonly tint: number;
  /** Tamaño de fuente de la etiqueta (px). */
  readonly fontSize?: number;
  /** Color de la etiqueta en reposo (default blanco hueso). */
  readonly textColor?: string;
  /** Profundidad en la escena. */
  readonly depth?: number;
  /** Callback de activación. */
  readonly onPress: () => void;
}

/** Grosor del borde oscuro alrededor del panel. */
const BORDER_PX = 4;

export class MenuButton {
  readonly container: Phaser.GameObjects.Container;

  private readonly onPress: () => void;
  private readonly label: Phaser.GameObjects.Text;
  private readonly textColor: string;
  private pressed = false;

  constructor(scene: Phaser.Scene, config: MenuButtonConfig) {
    const {
      x,
      y,
      width,
      height,
      label,
      tint,
      fontSize = 40,
      textColor = '#f2f2f2',
      depth = 0,
      onPress,
    } = config;
    this.onPress = onPress;
    this.textColor = textColor;

    this.container = scene.add.container(x, y).setDepth(depth);

    const border = scene.add.rectangle(0, 0, width + BORDER_PX * 2, height + BORDER_PX * 2, 0x0c0c14);
    const fill = scene.add.rectangle(0, 0, width, height, tint);
    this.label = scene.add
      .text(0, 0, label, {
        fontFamily: 'monospace',
        fontSize: `${fontSize}px`,
        color: textColor,
      })
      .setOrigin(0.5);

    this.container.add([border, fill, this.label]);

    // Hit area explícito: los Container no computan bounds de sus hijos.
    const hitWidth = width + BORDER_PX * 2;
    const hitHeight = height + BORDER_PX * 2;
    this.container.setSize(hitWidth, hitHeight);
    this.container.setInteractive(
      new Phaser.Geom.Rectangle(-hitWidth / 2, -hitHeight / 2, hitWidth, hitHeight),
      Phaser.Geom.Rectangle.Contains,
    );
    if (this.container.input) {
      this.container.input.cursor = 'pointer';
    }

    this.container.on('pointerdown', this.handleDown);
    this.container.on('pointerup', this.handleUp);
    this.container.on('pointerupoutside', this.handleRelease);
    this.container.on('pointerout', this.handleRelease);
  }

  /** Feedback de presión: encoge y "invierte" la etiqueta. */
  private handleDown = (): void => {
    this.pressed = true;
    this.container.setScale(0.94);
    this.label.setColor('#1d1d24');
  };

  /** Suelta y dispara la acción solo si el pointer sigue sobre el botón. */
  private handleUp = (): void => {
    const wasPressed = this.pressed;
    this.handleRelease();
    if (wasPressed) {
      this.onPress();
    }
  };

  /** Suelta sin accionar (el dedo se deslizó fuera o se soltó afuera). */
  private handleRelease = (): void => {
    this.pressed = false;
    this.container.setScale(1);
    this.label.setColor(this.textColor);
  };

  destroy(): void {
    this.container.destroy();
  }
}
