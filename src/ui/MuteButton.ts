/**
 * MuteButton — botón de silencio con ícono pixel procedural (Fase 6).
 *
 * Presentación 8-bit con las mismas primitivas que MenuButton (panel +
 * contenedor interactivo con hit area propio) y los glifos de altavoz
 * horneados por TextureFactory (`hud-audio-on` / `hud-audio-off`).
 *
 * Patrón de conexión (el bus es el desacoplador): el botón NO conoce el
 * AudioManager. Al activarse EMITE `mute` por el bus de sesión y se
 * repinta escuchando ese mismo evento — así el estado de la UI y el del
 * motor de audio quedan sincronizados por un único canal (el AudioManager
 * aplica y persiste el mute; cualquier otro oyente también se entera).
 * El estado INICIAL lo pasa la escena como primitiva (`initiallyMuted`,
 * leído del `ISfxEngine` resuelto del registry): la UI nunca toca el motor.
 *
 * Orden de emisión al activar: primero `mute` (el AudioManager lo aplica) y
 * después `ui-click`, de modo que el click de confirmación suene al
 * REACTIVAR el audio y quede silencio al silenciar.
 */

import Phaser from 'phaser';
import { MUTE_BUTTON } from '../config/balance';
import { EventBus, type GameEvents } from '../core/EventBus';
import { TEXTURE_KEYS } from '../systems/TextureFactory';

/** Estilo del botón de mute. */
export interface MuteButtonConfig {
  /** X del centro del botón. */
  readonly x: number;
  /** Y del centro del botón. */
  readonly y: number;
  /** Bus de sesión por el que se emite `mute` / `ui-click`. */
  readonly bus: EventBus<GameEvents>;
  /** Estado inicial (lo pasa la escena desde el ISfxEngine del registry). */
  readonly initiallyMuted: boolean;
  /** Lado del botón cuadrado (px). */
  readonly size?: number;
  /** Profundidad en la escena. */
  readonly depth?: number;
}

/** Tinte del panel (gris azulado neutro, neutro tanto muted como activo). */
const PANEL_TINT = 0x525868;

/** Alfas de reposo: atenuado cuando está silenciado. */
const ALPHA_ON = 0.95;
const ALPHA_OFF = 0.55;

/** Grosor del borde oscuro alrededor del panel (igual que MenuButton). */
const BORDER_PX = 4;

export class MuteButton {
  readonly container: Phaser.GameObjects.Container;

  private readonly bus: EventBus<GameEvents>;
  private readonly icon: Phaser.GameObjects.Image;
  private muted: boolean;
  private pressed = false;

  constructor(scene: Phaser.Scene, config: MuteButtonConfig) {
    const { x, y, bus, initiallyMuted, size = MUTE_BUTTON.size, depth = 0 } = config;
    this.bus = bus;
    this.muted = initiallyMuted;

    this.container = scene.add.container(x, y).setDepth(depth);

    const border = scene.add.rectangle(0, 0, size + BORDER_PX * 2, size + BORDER_PX * 2, 0x0c0c14);
    // El panel está horneado al tamaño de los botones táctiles: se ajusta al
    // lado de ESTE botón.
    const panel = scene.add
      .image(0, 0, TEXTURE_KEYS.hudPanel)
      .setTint(PANEL_TINT)
      .setDisplaySize(size, size);
    this.icon = scene.add.image(0, 0, TEXTURE_KEYS.hudAudioOn);
    this.container.add([border, panel, this.icon]);

    // Hit area explícito (los Container no computan bounds de sus hijos).
    const hit = size + BORDER_PX * 2;
    this.container.setSize(hit, hit);
    this.container.setInteractive(
      new Phaser.Geom.Rectangle(-hit / 2, -hit / 2, hit, hit),
      Phaser.Geom.Rectangle.Contains,
    );
    if (this.container.input) {
      this.container.input.cursor = 'pointer';
    }

    // Patrón táctil de MenuButton: la acción dispara solo si el pointer
    // sigue sobre el botón al soltar.
    this.container.on('pointerdown', this.handleDown);
    this.container.on('pointerup', this.handleUp);
    this.container.on('pointerupoutside', this.handleRelease);
    this.container.on('pointerout', this.handleRelease);

    // Sincronización: el repintado vive en el evento del bus (el propio emit
    // del botón vuelve por acá, y cambios externos también repintan).
    this.unsubscribe = bus.on('mute', (muted) => this.applyState(muted));

    this.applyState(initiallyMuted);
  }

  private readonly unsubscribe: () => void;

  /** Desuscribe del bus y destruye los game objects (ciclo del widget). */
  destroy(): void {
    this.unsubscribe();
    this.container.destroy();
  }

  /** Repinta el glifo y la opacidad según el estado de mute. */
  private applyState(muted: boolean): void {
    this.muted = muted;
    this.icon.setTexture(muted ? TEXTURE_KEYS.hudAudioOff : TEXTURE_KEYS.hudAudioOn);
    this.container.setAlpha(muted ? ALPHA_OFF : ALPHA_ON);
  }

  private handleDown = (): void => {
    this.pressed = true;
    this.container.setScale(0.92);
  };

  /** Suelta y dispara el toggle solo si el pointer sigue sobre el botón. */
  private handleUp = (): void => {
    const wasPressed = this.pressed;
    this.handleRelease();
    if (!wasPressed) {
      return;
    }
    // 1) El mute (AudioManager lo aplica y persiste; este botón se repinta
    // por su propia suscripción a `mute`). 2) El click de confirmación.
    this.bus.emit('mute', !this.muted);
    this.bus.emit('ui-click', undefined);
  };

  /** Suelta sin accionar (el dedo se deslizó fuera o se soltó afuera). */
  private handleRelease = (): void => {
    this.pressed = false;
    this.container.setScale(1);
  };
}
