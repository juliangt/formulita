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
 * La acción dispara en `pointerdown`, no en `pointerup`: en pantalla táctil
 * el patrón "soltar encima" hace que un micro-deslizamiento del dedo dispare
 * `pointerout` y cancele el tap (botones que "no responden"), y además suma
 * la latencia de esperar el release. En un menú de juego no hay nada que
 * proteger de una activación inmediata: disparar al presionar es lo que
 * espera el pulgar. `pointerup`/`pointerupoutside`/`pointerout` solo sueltan
 * el feedback visual. El teclado (Enter/Espacio) lo maneja cada escena.
 *
 * El hit area coincide exactamente con el borde visual del botón
 * (`width + BORDER_PX * 2` × `height + BORDER_PX * 2`) y centrado en (0, 0)
 * local (Phaser normaliza con displayOrigin = width/2, height/2).
 */

import Phaser from 'phaser';
import { EventBus, type GameEvents } from '../core/EventBus';

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
  /**
   * Bus de sesión opcional (Fase 6): si se inyecta, cada activación emitirá
   * `ui-click` ANTES de llamar a `onPress` para que el AudioManager suene el
   * click. El botón sigue sin conocer el audio (solo emite).
   */
  readonly bus?: EventBus<GameEvents>;
  /** Callback de activación. */
  readonly onPress: () => void;
}

/** Grosor del borde oscuro alrededor del panel. */
const BORDER_PX = 4;

export class MenuButton {
  readonly container: Phaser.GameObjects.Container;

  private readonly onPress: () => void;
  private readonly bus: EventBus<GameEvents> | null;
  private readonly label: Phaser.GameObjects.Text;
  private readonly textColor: string;

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
      bus = null,
      onPress,
    } = config;
    this.onPress = onPress;
    this.bus = bus;
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

    // Hit area que coincide exactamente con el borde visual del botón
    // (width + BORDER_PX * 2 × height + BORDER_PX * 2). En Phaser, los
    // Containers tienen displayOrigin = width * 0.5, height * 0.5 y el hit-test
    // suma displayOrigin a las coordenadas locales (pointWithinHitArea):
    // el Rectangle debe originarse en (0, 0) para quedar perfectamente centrado
    // sobre los hijos colocados en (0, 0).
    const hitWidth = width + BORDER_PX * 2;
    const hitHeight = height + BORDER_PX * 2;
    this.container.setSize(hitWidth, hitHeight);
    this.container.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, hitWidth, hitHeight),
      Phaser.Geom.Rectangle.Contains,
    );
    if (this.container.input) {
      this.container.input.cursor = 'pointer';
    }

    this.container.on('pointerdown', this.handleDown);
    this.container.on('pointerup', this.handleRelease);
    this.container.on('pointerupoutside', this.handleRelease);
    this.container.on('pointerout', this.handleRelease);
  }

  /** Presión: feedback visual inmediato + acción (dispara una vez por gesto). */
  private handleDown = (): void => {
    this.container.setScale(0.94);
    this.label.setColor('#1d1d24');
    // Fase 6: el SFX de click viaja por el bus (si la escena lo inyectó),
    // antes de la acción para que se escuche aunque la escena cambie.
    this.bus?.emit('ui-click', undefined);
    this.onPress();
  };

  /** Suelta el feedback visual (la acción ya disparó en el pointerdown). */
  private handleRelease = (): void => {
    this.container.setScale(1);
    this.label.setColor(this.textColor);
  };

  /**
   * Cambia la etiqueta en caliente (p. ej. FULLSCREEN ↔ VENTANA en el botón
   * de pantalla completa del menú, Fase 7). No toca el feedback de presión.
   */
  setLabel(text: string): void {
    this.label.setText(text);
  }

  destroy(): void {
    this.container.destroy();
  }
}
