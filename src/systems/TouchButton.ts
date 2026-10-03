/**
 * TouchButton — lógica de los botones táctiles del HUD (Fase 2).
 *
 * Módulo 100% libre de Phaser (lógica pura, testeable con fakes):
 * - `PointerTracker`: tracking multi-touch real. Cada botón recuerda el
 *   `pointerId` del dedo que lo presionó; NO depende del `activePointer`
 *   único de Phaser. Un `pointerup` de OTRO id no lo suelta y un dedo nuevo
 *   no le roba un botón ya presionado → permite doblar con el pulgar
 *   izquierdo mientras se acelera con el derecho (aceptación de Fase 2).
 * - `TouchButton`: botón = tracker + hit-test por coordenadas + visual
 *   inyectado (`TouchButtonVisual`). Los botones hacen hit-test manual sobre
 *   los eventos de pointer de la escena, así NO roban eventos al resto del
 *   juego (ningún objeto interactivo bloquea el canvas).
 * - `computeTouchButtonLayout`: layout puro de los 4 botones del cluster
 *   derecho (el giro va por `SteerJoystick` desde el issue #37).
 *
 * Decisión de ubicación (documentada): el plan lista `TouchButton` bajo
 * `systems/` y `PixelButton` bajo `ui/` — se respeta: la lógica de tracking
 * vive acá (systems = lógica pura y testeable) y la presentación 8-bit
 * (panel + glifo + feedback de presión) vive en `ui/PixelButton`.
 */

import { TOUCH_HUD } from '../config/balance';

/** Acciones que puede representar un botón táctil (= claves de IInputState).
 * El giro NO va más por botones (issue #37): lo lleva el `SteerJoystick`. */
export type TouchButtonAction = 'throttle' | 'brake' | 'turbo' | 'drs';

/** Todas las acciones, en orden estable de construcción. */
export const ALL_TOUCH_ACTIONS: readonly TouchButtonAction[] = [
  'throttle',
  'brake',
  'turbo',
  'drs',
];

/**
 * Mínimo que TouchButton necesita de un pointer de Phaser (id + posición en
 * coordenadas de juego). Los tests emulan pointers con este shape.
 */
export interface PointerLike {
  readonly id: number;
  readonly x: number;
  readonly y: number;
}

/** Rectángulo de un botón en coordenadas de juego (esquina superior izquierda + tamaño). */
export interface TouchButtonRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Capa visual de un botón: la lógica le informa los cambios de presión. */
export interface TouchButtonVisual {
  /** El botón pasó a presionado (`true`) o liberado (`false`). */
  setPressed(pressed: boolean): void;
  /** Libera recursos (la lógica destruye el visual al desmontar el HUD). */
  destroy(): void;
}

/** Visual nulo: HUD headless / tests sin presentación. */
export class NullTouchButtonVisual implements TouchButtonVisual {
  setPressed(_pressed: boolean): void {}

  destroy(): void {}
}

/** Fábrica de visuales por acción (inyectable: PixelButton en producción, fakes en tests). */
export type TouchButtonVisualFactory = (
  action: TouchButtonAction,
  rect: TouchButtonRect,
) => TouchButtonVisual;

/**
 * PointerTracker — invariante multi-touch de UN botón: pertenece al pointer
 * que lo presionó hasta que ese mismo pointer lo suelta (o se fuerza).
 */
export class PointerTracker {
  private pointerId: number | null = null;

  /** `true` mientras algún pointer tenga el botón presionado. */
  get isPressed(): boolean {
    return this.pointerId !== null;
  }

  /** Id del pointer dueño del botón, o `null` si está libre. */
  get pressedBy(): number | null {
    return this.pointerId;
  }

  /**
   * Intenta presionar con `pointerId`.
   * @returns `true` si el botón quedó presionado por ese pointer: el mismo id
   *   re-presionando es idempotente; otro id NO roba un botón ya presionado.
   */
  press(pointerId: number): boolean {
    if (this.pointerId === null || this.pointerId === pointerId) {
      this.pointerId = pointerId;
      return true;
    }
    return false;
  }

  /**
   * Intenta soltar con `pointerId`.
   * @returns `true` si el botón quedó liberado en esta llamada: SOLO suelta
   *   si el id coincide con el dueño (soltar con otro id no lo suelta).
   */
  release(pointerId: number): boolean {
    if (this.pointerId !== null && this.pointerId === pointerId) {
      this.pointerId = null;
      return true;
    }
    return false;
  }

  /** Fuerza la liberación sin importar el dueño (detach, escena apagada…). */
  forceRelease(): boolean {
    const wasPressed = this.isPressed;
    this.pointerId = null;
    return wasPressed;
  }
}

/** Config de construcción de un `TouchButton`. */
export interface TouchButtonConfig {
  readonly action: TouchButtonAction;
  /** Rectángulo del botón (esquina superior izquierda + tamaño, en px de juego). */
  readonly rect: TouchButtonRect;
  /** Visual inyectado (`PixelButton` en producción). Default: nulo. */
  readonly visual?: TouchButtonVisual;
  /** Margen extra del hit-test en px (dedos imprecisos). Default 0. */
  readonly hitPadding?: number;
}

/** Botón táctil del HUD: tracker + hit-test + visual. Lógica pura, sin Phaser. */
export class TouchButton {
  readonly action: TouchButtonAction;
  readonly rect: TouchButtonRect;

  private readonly visual: TouchButtonVisual;
  private readonly hitPadding: number;
  private readonly tracker = new PointerTracker();

  constructor(config: TouchButtonConfig) {
    this.action = config.action;
    this.rect = config.rect;
    this.visual = config.visual ?? new NullTouchButtonVisual();
    this.hitPadding = config.hitPadding ?? 0;
  }

  /** `true` mientras el botón esté presionado por algún pointer. */
  get isPressed(): boolean {
    return this.tracker.isPressed;
  }

  /**
   * Hit-test por coordenadas (con el padding de tolerancia configurado).
   * Se hace manual desde TouchSource: así el botón no es un objeto
   * interactivo de Phaser y no roba eventos al resto del juego.
   */
  contains(x: number, y: number): boolean {
    const pad = this.hitPadding;
    const { x: rx, y: ry, width, height } = this.rect;
    return (
      x >= rx - pad && x < rx + width + pad && y >= ry - pad && y < ry + height + pad
    );
  }

  /** `pointerdown` dentro del botón. @returns `true` si quedó presionado por ese pointer. */
  press(pointerId: number): boolean {
    if (this.tracker.press(pointerId)) {
      this.visual.setPressed(true);
      return true;
    }
    return false;
  }

  /** `pointerup` del pointer indicado. Solo suelta si ES el pointer dueño. */
  release(pointerId: number): boolean {
    if (this.tracker.release(pointerId)) {
      this.visual.setPressed(false);
      return true;
    }
    return false;
  }

  /** Suelta el botón sin importar quién lo presionó (detach de la fuente). */
  forceRelease(): void {
    if (this.tracker.forceRelease()) {
      this.visual.setPressed(false);
    }
  }

  /** Libera el botón y destruye su visual (shutdown del HUD). */
  destroy(): void {
    this.forceRelease();
    this.visual.destroy();
  }
}

/**
 * Layout puro de los 4 botones táctiles del HUD sobre un lienzo de
 * `width × height` (resolución base 720×1280):
 * - abajo-izquierda: ZONA DEL JOYSTICK (issue #37, `computeSteerJoystickRect`
 *   en `systems/SteerJoystick`) — ocupa el footprint de los viejos ◀ ▶.
 * - abajo-derecha: grilla 2×2 con BRK/TURBO arriba y GAS/DRS abajo
 *   (GAS en la esquina inferior derecha, donde llega el pulgar derecho).
 */
export function computeTouchButtonLayout(
  width: number,
  height: number,
): Record<TouchButtonAction, TouchButtonRect> {
  const { buttonSize: size, gap, marginX, marginBottom } = TOUCH_HUD;

  const bottomY = height - marginBottom - size;
  const topY = bottomY - gap - size;
  const rightOuterX = width - marginX - size;
  const rightInnerX = rightOuterX - gap - size;

  return {
    throttle: { x: rightOuterX, y: bottomY, width: size, height: size },
    brake: { x: rightInnerX, y: bottomY, width: size, height: size },
    turbo: { x: rightOuterX, y: topY, width: size, height: size },
    drs: { x: rightInnerX, y: topY, width: size, height: size },
  };
}
