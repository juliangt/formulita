/**
 * TouchSource — HUD táctil translúcido como fuente de input (Fase 2).
 *
 * Layout: abajo-izquierda el JOYSTICK DESLIZABLE de dirección (issue #37 —
 * reemplazó a los botones ◀ ▶); abajo-derecha GAS / BRK / TURBO / DRS.
 * Multi-touch REAL: `TouchSource` observa los eventos de pointer de la escena
 * (uno por dedo) y cada control trackea el `pointerId` que lo presionó →
 * doblar (deslizando) + acelerar a la vez. El joystick además consume
 * `pointermove` para seguir al dedo con el eje analógico (−1..1).
 *
 * Los controles NO roban eventos del juego: no hay objetos interactivos de
 * Phaser (nada que capture/bloquee el canvas); TouchSource escucha los
 * eventos de escena (`pointerdown` / `pointermove` / `pointerup` /
 * `pointerupoutside`, que Phaser emite por cada pointer) y hace hit-test
 * manual por coordenadas. `pointerupoutside` cubre soltar el dedo fuera del
 * canvas.
 *
 * Implementa `IInputSource` (Liskov): intercambiable con KeyboardSource.
 * El estado reporta el eje analógico en `steerAxis` Y los flags `left`/
 * `right` derivados de él, para que cualquier consumidor binario siga
 * funcionando. Para tests, el emisor de eventos de Phaser se abstrae en la
 * interfaz mínima `PointerEventEmitter` (inyectable) y los visuales en
 * fábricas inyectables: toda la lógica se testea sin runtime real.
 */

import Phaser from 'phaser';
import {
  ALL_TOUCH_ACTIONS,
  NullTouchButtonVisual,
  TouchButton,
  computeTouchButtonLayout,
  type PointerLike,
  type TouchButtonAction,
  type TouchButtonRect,
  type TouchButtonVisualFactory,
} from './TouchButton';
import {
  NullSteerJoystickVisual,
  SteerJoystick,
  computeSteerJoystickRect,
  type SteerJoystickVisual,
} from './SteerJoystick';
import type { IInputSource, IInputState } from './InputSystem';
import { TOUCH_HUD } from '../config/balance';
import { PixelButton, type PixelButtonStyle } from '../ui/PixelButton';
import { SteerJoystickView } from '../ui/SteerJoystickView';

/** Nombres de los eventos de pointer del InputPlugin que se observan. */
export type PointerEventName = 'pointerdown' | 'pointermove' | 'pointerup' | 'pointerupoutside';

/**
 * Interfaz mínima del InputPlugin de Phaser que TouchSource necesita
 * (`Phaser.Input.InputPlugin` la satisface estructuralmente).
 */
export interface PointerEventEmitter {
  on(event: PointerEventName, handler: (pointer: PointerLike) => void): unknown;
  off(event: PointerEventName, handler: (pointer: PointerLike) => void): unknown;
}

/** Estilo 8-bit de cada acción: glifo + color de panel. */
const ACTION_STYLES: Record<TouchButtonAction, PixelButtonStyle> = {
  throttle: { label: 'GAS', tint: 0x3c9e52 },
  brake: { label: 'BRK', tint: 0xd63c3c },
  turbo: { label: 'TURBO', tint: 0xd8a72c, labelColor: '#1d1d24' },
  drs: { label: 'DRS', tint: 0x9aa0a8, labelColor: '#1d1d24' },
};

/** Opciones de construcción (todo inyectable para testear sin Phaser). */
export interface TouchSourceOptions {
  /** Ancho del lienzo de juego en px (720 en la resolución base). */
  readonly width: number;
  /** Alto del lienzo de juego en px (1280 en la resolución base). */
  readonly height: number;
  /**
   * Emisor de eventos de pointer. Default: `scene.input`. Pasar `null`
   * explícito deja la fuente sin escuchar (headless).
   */
  readonly emitter?: PointerEventEmitter | null;
  /** Fábrica de visuales de botones. Default: `PixelButton` sobre la escena (o visual nulo si no hay escena). */
  readonly visualFactory?: TouchButtonVisualFactory;
  /**
   * Fábrica del visual del joystick. Default: `SteerJoystickView` sobre la
   * escena (o visual nulo si no hay escena). Inyectable para tests.
   */
  readonly joystickVisualFactory?: (rect: TouchButtonRect) => SteerJoystickVisual;
}

/** Fuente de input táctil (implementa `IInputSource`). */
export class TouchSource implements IInputSource {
  readonly name = 'touch';

  private readonly buttons: readonly TouchButton[];
  private readonly joystick: SteerJoystick;
  private readonly emitter: PointerEventEmitter | null;
  private attached = false;

  /**
   * @param scene escena dueña del HUD, o `null` en tests headless.
   * @param options tamaño del lienzo + (opcional) emitter y fábricas de visuales.
   */
  constructor(scene: Phaser.Scene | null, options: TouchSourceOptions) {
    const layout = computeTouchButtonLayout(options.width, options.height);
    const joystickRect = computeSteerJoystickRect(options.width, options.height);

    const factory: TouchButtonVisualFactory =
      options.visualFactory ??
      (scene
        ? (action, rect) => new PixelButton(scene, rect, ACTION_STYLES[action])
        : (_action, _rect) => new NullTouchButtonVisual());

    const joystickFactory: (rect: TouchButtonRect) => SteerJoystickVisual =
      options.joystickVisualFactory ??
      (scene
        ? (rect) => new SteerJoystickView(scene, rect)
        : () => new NullSteerJoystickVisual());

    this.buttons = ALL_TOUCH_ACTIONS.map((action) => {
      const rect: TouchButtonRect = layout[action];
      return new TouchButton({
        action,
        rect,
        visual: factory(action, rect),
        hitPadding: TOUCH_HUD.hitPadding,
      });
    });

    this.joystick = new SteerJoystick({
      rect: joystickRect,
      visual: joystickFactory(joystickRect),
      deadzonePx: TOUCH_HUD.joystickDeadzonePx,
      hitPadding: TOUCH_HUD.hitPadding,
    });

    this.emitter = options.emitter !== undefined ? options.emitter : (scene?.input ?? null);
  }

  /** Registra los 4 listeners de pointer en el emisor. Idempotente. */
  attach(): void {
    if (this.attached || !this.emitter) {
      return;
    }
    this.attached = true;
    this.emitter.on('pointerdown', this.onPointerDown);
    this.emitter.on('pointermove', this.onPointerMove);
    this.emitter.on('pointerup', this.onPointerUp);
    this.emitter.on('pointerupoutside', this.onPointerUp);
  }

  /** Quita los listeners y suelta todos los controles (nada queda colgado). Idempotente. */
  detach(): void {
    if (!this.attached) {
      return;
    }
    this.attached = false;
    this.emitter?.off('pointerdown', this.onPointerDown);
    this.emitter?.off('pointermove', this.onPointerMove);
    this.emitter?.off('pointerup', this.onPointerUp);
    this.emitter?.off('pointerupoutside', this.onPointerUp);
    this.joystick.forceRelease();
    for (const button of this.buttons) {
      button.forceRelease();
    }
  }

  /** Desconecta y destruye los visuales (shutdown de la escena). */
  destroy(): void {
    this.detach();
    this.joystick.destroy();
    for (const button of this.buttons) {
      button.destroy();
    }
  }

  /**
   * Estado del HUD: el eje del joystick va en `steerAxis` y los flags
   * `left`/`right` se derivan de él (fuera de zona muerta) para que los
   * consumidores binarios sigan funcionando; el resto son los botones.
   */
  getState(): IInputState {
    const pressed = (action: TouchButtonAction): boolean =>
      this.buttons.find((button) => button.action === action)?.isPressed ?? false;
    const axis = this.joystick.steerAxis;

    return {
      left: axis < 0,
      right: axis > 0,
      throttle: pressed('throttle'),
      brake: pressed('brake'),
      turbo: pressed('turbo'),
      drs: pressed('drs'),
      steerAxis: axis,
    };
  }

  /** pointerdown: hit-test manual; solo los controles bajo el dedo se activan. */
  private readonly onPointerDown = (pointer: PointerLike): void => {
    if (this.joystick.contains(pointer.x, pointer.y)) {
      this.joystick.press(pointer.id, pointer.x);
    }
    for (const button of this.buttons) {
      if (button.contains(pointer.x, pointer.y)) {
        button.press(pointer.id);
      }
    }
  };

  /** pointermove: SOLO el joystick lo consume (el dueño desliza el knob). */
  private readonly onPointerMove = (pointer: PointerLike): void => {
    this.joystick.move(pointer.id, pointer.x);
  };

  /** pointerup / pointerupoutside: suelta SOLO los controles cuyo dueño es ese pointer. */
  private readonly onPointerUp = (pointer: PointerLike): void => {
    this.joystick.release(pointer.id);
    for (const button of this.buttons) {
      button.release(pointer.id);
    }
  };
}
