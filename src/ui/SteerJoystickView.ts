/**
 * SteerJoystickView — presentación 8-bit del joystick deslizable (issue #37).
 *
 * Implementa `SteerJoystickVisual` (la interfaz de `systems/SteerJoystick`):
 * SOLO presentación — el tracking de `pointerId`, el hit-test y el eje viven
 * en la lógica pura, alimentada por `TouchSource` / `RaceTouchControls` con
 * los eventos de pointer de la escena (mismo reparto que PixelButton con
 * TouchButton: nada interactivo de Phaser, el HUD no roba eventos).
 *
 * Look: pista = panel procedural tintable (`hudPanel`) estirada al rect con
 * marca central; knob = panel más claro con los glifos ◀ ▶ (los mismos que
 * tenían los botones que reemplaza, ahora como hint de "deslizá a los
 * lados"). Feedback de presión según `TOUCH_HUD`: alpha + escala.
 * La carrera usa dos cámaras: RaceScene ajusta el `container` igual que hace
 * con los PixelButton (scrollFactor 0 + filtro de cámara).
 */

import Phaser from 'phaser';
import { TOUCH_HUD } from '../config/balance';
import { TEXTURE_KEYS } from '../systems/TextureFactory';
import type { TouchButtonRect } from '../systems/TouchButton';
import type { SteerJoystickVisual } from '../systems/SteerJoystick';

/** Tinte de la pista: el azul de los botones ◀ ▶ que reemplaza (continuidad). */
const TRACK_TINT = 0x3c6cd6;
/** Tinte del knob: claro para destacar sobre la pista. */
const KNOB_TINT = 0xd8dce4;

/** Vista del joystick deslizable (visual puro del `SteerJoystick`). */
export class SteerJoystickView implements SteerJoystickVisual {
  readonly container: Phaser.GameObjects.Container;

  private readonly knob: Phaser.GameObjects.Container;
  private readonly knobTravel: number;

  constructor(scene: Phaser.Scene, rect: TouchButtonRect) {
    // Contenedor centrado en el rect de la zona; la lógica NO lo toca.
    this.container = scene.add
      .container(rect.x + rect.width / 2, rect.y + rect.height / 2)
      .setDepth(TOUCH_HUD.depth);

    // Pista: panel compartido estirado al rect (el borde horneado escala con él).
    const track = scene.add.image(0, 0, TEXTURE_KEYS.hudPanel).setTint(TRACK_TINT);
    track.setDisplaySize(rect.width, rect.height);

    // Marca central: referencia visual del punto de giro nulo.
    const notch = scene.add.rectangle(0, 0, 6, rect.height * 0.5, 0xf2f2f2, 0.6);

    // Knob: panel claro con los hints ◀ ▶ a tamaño natural (42×48 c/u).
    this.knob = scene.add.container(0, 0);
    const knobPanel = scene.add
      .image(0, 0, TEXTURE_KEYS.hudPanel)
      .setTint(KNOB_TINT)
      .setDisplaySize(TOUCH_HUD.joystickKnobSize, TOUCH_HUD.joystickKnobSize);
    const arrowLeft = scene.add
      .image(-knobPanel.displayWidth / 4, 0, TEXTURE_KEYS.hudArrowLeft)
      .setTint(0x1c1c24);
    const arrowRight = scene.add
      .image(knobPanel.displayWidth / 4, 0, TEXTURE_KEYS.hudArrowRight)
      .setTint(0x1c1c24);
    this.knob.add([knobPanel, arrowLeft, arrowRight]);

    this.container.add([track, notch, this.knob]);

    // Recorrido del knob: del centro al tope de la pista.
    this.knobTravel = (rect.width - TOUCH_HUD.joystickKnobSize) / 2;

    this.setKnob(0);
    this.setPressed(false);
  }

  /** Mueve el knob en ratio −1..1 (−1 = tope izquierda). */
  setKnob(ratio: number): void {
    const clamped = Math.min(Math.max(ratio, -1), 1);
    this.knob.setX(clamped * this.knobTravel);
  }

  /** Feedback de presión: opaco y levemente encogido (como los botones). */
  setPressed(pressed: boolean): void {
    this.container.setAlpha(pressed ? TOUCH_HUD.pressedAlpha : TOUCH_HUD.baseAlpha);
    this.container.setScale(pressed ? TOUCH_HUD.pressedScale : 1);
  }

  destroy(): void {
    this.container.destroy();
  }
}
