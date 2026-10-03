/**
 * SteerJoystick — lógica del joystick horizontal deslizable (issue #37).
 *
 * Hermano de `TouchButton` (mismo criterio: lógica pura sin Phaser, testeable
 * con fakes): una ZONA horizontal donde el dedo se apoya y DESLIZA de
 * izquierda a derecha. Modelo ABSOLUTO — al apoyar, el knob salta a la x del
 * dedo (clamp al recorrido) y `pointermove` lo sigue: el giro es proporcional
 * a la distancia al centro, con zona muerta (micro-desvíos no doblan). Al
 * soltar —aunque sea fuera del canvas— vuelve a 0 y el knob al centro.
 *
 * Multi-touch REAL: un solo pointer dueño, con la MISMA invariante de
 * `PointerTracker` que los botones (otro dedo no roba la zona; soltar con
 * otro id no la libera). Los `pointermove` de dedos que no son el dueño se
 * ignoran. El hit-test sigue siendo manual por coordenadas desde la fuente:
 * nada interactivo de Phaser roba eventos al juego.
 *
 * La zona ocupa el MISMO footprint que los botones ◀ ▶ que reemplaza, así el
 * cluster derecho (GAS/BRK/TURBO/DRS) no se mueve (ver
 * `computeSteerJoystickRect`).
 */

import { TOUCH_HUD } from '../config/balance';
import { PointerTracker, type TouchButtonRect } from './TouchButton';

/** Visual del joystick: la lógica le informa knob y presión. */
export interface SteerJoystickVisual {
  /** Posición del knob en ratio −1 (tope izquierda) … +1 (tope derecha). */
  setKnob(ratio: number): void;
  /** La zona pasó a presionada (`true`) o liberada (`false`). */
  setPressed(pressed: boolean): void;
  /** Libera recursos (la lógica destruye el visual al desmontar el HUD). */
  destroy(): void;
}

/** Visual nulo: HUD headless / tests sin presentación. */
export class NullSteerJoystickVisual implements SteerJoystickVisual {
  setKnob(_ratio: number): void {}

  setPressed(_pressed: boolean): void {}

  destroy(): void {}
}

/** Config de construcción de un `SteerJoystick`. */
export interface SteerJoystickConfig {
  /** Rectángulo de la zona (esquina superior izquierda + tamaño, px de juego). */
  readonly rect: TouchButtonRect;
  /** Visual inyectado (`SteerJoystickView` en producción). Default: nulo. */
  readonly visual?: SteerJoystickVisual;
  /** Zona muerta en px alrededor del centro. Default 0. */
  readonly deadzonePx?: number;
  /** Margen extra del hit-test en px (dedos imprecisos). Default 0. */
  readonly hitPadding?: number;
}

/**
 * Eje puro (−1..1) para una x de dedo sobre la pista del joystick:
 * lineal desde el borde de la zona muerta hasta el tope del recorrido, 0
 * dentro de la zona muerta. El clamp acota dedos que se salen de la zona.
 */
export function steerAxisForFinger(
  x: number,
  rect: TouchButtonRect,
  deadzonePx: number,
): number {
  const half = rect.width / 2;
  const offset = Math.min(Math.max(x - (rect.x + half), -half), half);
  const deadzone = Math.min(Math.max(deadzonePx, 0), half);
  const distance = Math.abs(offset);
  if (distance <= deadzone || half - deadzone <= 0) {
    return 0;
  }
  return (offset < 0 ? -1 : 1) * ((distance - deadzone) / (half - deadzone));
}

/** Rectángulo de la zona del joystick sobre un lienzo `width × height`:
 * el footprint exacto de los ex-botones ◀ ▶ (fila de abajo a la izquierda,
 * 2 × buttonSize + gap de ancho, buttonSize de alto). */
export function computeSteerJoystickRect(_width: number, height: number): TouchButtonRect {
  const { buttonSize: size, gap, marginX, marginBottom } = TOUCH_HUD;
  return {
    x: marginX,
    y: height - marginBottom - size,
    width: size * 2 + gap,
    height: size,
  };
}

/**
 * Joystick deslizable del HUD: tracker + hit-test + eje + visual. Lógica
 * pura, sin Phaser. La fuente (TouchSource / RaceTouchControls) lo alimenta
 * con los eventos de pointer y lee `steerAxis` para el `IInputState`.
 */
export class SteerJoystick {
  readonly rect: TouchButtonRect;

  private readonly visual: SteerJoystickVisual;
  private readonly deadzonePx: number;
  private readonly hitPadding: number;
  private readonly tracker = new PointerTracker();
  private axis = 0;

  constructor(config: SteerJoystickConfig) {
    this.rect = config.rect;
    this.visual = config.visual ?? new NullSteerJoystickVisual();
    this.deadzonePx = config.deadzonePx ?? 0;
    this.hitPadding = config.hitPadding ?? 0;
  }

  /** `true` mientras el dedo dueño tenga la zona apoyada. */
  get isPressed(): boolean {
    return this.tracker.isPressed;
  }

  /** Id del pointer dueño de la zona, o `null` si está libre. */
  get pressedBy(): number | null {
    return this.tracker.pressedBy;
  }

  /** Eje actual (−1..1; 0 en reposo o zona muerta). */
  get steerAxis(): number {
    return this.axis;
  }

  /** Hit-test por coordenadas (con el padding de tolerancia configurado). */
  contains(x: number, y: number): boolean {
    const pad = this.hitPadding;
    const { x: rx, y: ry, width, height } = this.rect;
    return (
      x >= rx - pad && x < rx + width + pad && y >= ry - pad && y < ry + height + pad
    );
  }

  /**
   * `pointerdown` dentro de la zona: toma ownership (un dueño a la vez) y
   * ubica el knob en la x del dedo. @returns `true` si quedó presionado.
   */
  press(pointerId: number, x: number): boolean {
    if (!this.tracker.press(pointerId)) {
      return false;
    }
    this.visual.setPressed(true);
    this.applyFinger(x);
    return true;
  }

  /**
   * `pointermove`: SOLO el dedo dueño desliza el knob. @returns `true` si
   * este pointer era el dueño y el eje cambió.
   */
  move(pointerId: number, x: number): boolean {
    if (this.tracker.pressedBy !== pointerId) {
      return false;
    }
    this.applyFinger(x);
    return true;
  }

  /** `pointerup` / `pointerupoutside`: solo suelta si ES el pointer dueño. */
  release(pointerId: number): boolean {
    if (!this.tracker.release(pointerId)) {
      return false;
    }
    this.reset();
    return true;
  }

  /** Suelta la zona sin importar quién la presionó (detach de la fuente). */
  forceRelease(): void {
    if (this.tracker.forceRelease()) {
      this.reset();
    }
  }

  /** Libera la zona y destruye el visual (shutdown del HUD). */
  destroy(): void {
    this.forceRelease();
    this.visual.destroy();
  }

  /** Recalcula el eje para la x del dedo y mueve el knob del visual. */
  private applyFinger(x: number): void {
    this.axis = steerAxisForFinger(x, this.rect, this.deadzonePx);
    this.visual.setKnob(this.axis);
  }

  /** Neutro: eje 0, knob al centro, sin presión. */
  private reset(): void {
    this.axis = 0;
    this.visual.setKnob(0);
    this.visual.setPressed(false);
  }
}
