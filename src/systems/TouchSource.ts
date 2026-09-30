/**
 * TouchSource — HUD táctil translúcido como fuente de input (Fase 2).
 *
 * Layout (abajo del plan): abajo-izquierda ◀ ▶ para doblar; abajo-derecha
 * GAS / BRK / TURBO / DRS. Multi-touch REAL: `TouchSource` observa los
 * eventos de pointer de la escena (uno por dedo) y cada `TouchButton`
 * trackea el `pointerId` que lo presionó → doblar + acelerar a la vez.
 *
 * Los botones NO roban eventos del juego: no hay objetos interactivos de
 * Phaser (nada que capture/bloquee el canvas); TouchSource escucha los
 * eventos de escena (`pointerdown` / `pointerup` / `pointerupoutside`, que
 * Phaser emite por cada pointer) y hace hit-test manual por coordenadas.
 * `pointerupoutside` cubre soltar el dedo fuera del canvas.
 *
 * Implementa `IInputSource` (Liskov): intercambiable con KeyboardSource.
 * Para tests, el emisor de eventos de Phaser se abstrae en la interfaz
 * mínima `PointerEventEmitter` (inyectable) y los visuales en
 * `TouchButtonVisualFactory`: toda la lógica se testea sin runtime real.
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
import type { IInputSource, IInputState } from './InputSystem';
import { TOUCH_HUD } from '../config/balance';
import { PixelButton, type PixelButtonStyle } from '../ui/PixelButton';
import { TEXTURE_KEYS } from './TextureFactory';

/** Nombres de los eventos de pointer del InputPlugin que se observan. */
export type PointerEventName = 'pointerdown' | 'pointerup' | 'pointerupoutside';

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
  left: { icon: TEXTURE_KEYS.hudArrowLeft, tint: 0x3c6cd6 },
  right: { icon: TEXTURE_KEYS.hudArrowRight, tint: 0x3c6cd6 },
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
  /** Fábrica de visuales. Default: `PixelButton` sobre la escena (o visual nulo si no hay escena). */
  readonly visualFactory?: TouchButtonVisualFactory;
}

/** Fuente de input táctil (implementa `IInputSource`). */
export class TouchSource implements IInputSource {
  readonly name = 'touch';

  private readonly buttons: readonly TouchButton[];
  private readonly emitter: PointerEventEmitter | null;
  private attached = false;

  /**
   * @param scene escena dueña del HUD, o `null` en tests headless.
   * @param options tamaño del lienzo + (opcional) emitter y fábrica de visuales.
   */
  constructor(scene: Phaser.Scene | null, options: TouchSourceOptions) {
    const layout = computeTouchButtonLayout(options.width, options.height);

    const factory: TouchButtonVisualFactory =
      options.visualFactory ??
      (scene
        ? (action, rect) => new PixelButton(scene, rect, ACTION_STYLES[action])
        : (_action, _rect) => new NullTouchButtonVisual());

    this.buttons = ALL_TOUCH_ACTIONS.map((action) => {
      const rect: TouchButtonRect = layout[action];
      return new TouchButton({
        action,
        rect,
        visual: factory(action, rect),
        hitPadding: TOUCH_HUD.hitPadding,
      });
    });

    this.emitter = options.emitter !== undefined ? options.emitter : (scene?.input ?? null);
  }

  /** Registra los 3 listeners de pointer en el emisor. Idempotente. */
  attach(): void {
    if (this.attached || !this.emitter) {
      return;
    }
    this.attached = true;
    this.emitter.on('pointerdown', this.onPointerDown);
    this.emitter.on('pointerup', this.onPointerUp);
    this.emitter.on('pointerupoutside', this.onPointerUp);
  }

  /** Quita los listeners y suelta todos los botones (nada queda colgado). Idempotente. */
  detach(): void {
    if (!this.attached) {
      return;
    }
    this.attached = false;
    this.emitter?.off('pointerdown', this.onPointerDown);
    this.emitter?.off('pointerup', this.onPointerUp);
    this.emitter?.off('pointerupoutside', this.onPointerUp);
    for (const button of this.buttons) {
      button.forceRelease();
    }
  }

  /** Desconecta y destruye los visuales (shutdown de la escena). */
  destroy(): void {
    this.detach();
    for (const button of this.buttons) {
      button.destroy();
    }
  }

  /** Estado de los botones (press multi-touch: cada botón recuerda su dedo). */
  getState(): IInputState {
    const pressed = (action: TouchButtonAction): boolean =>
      this.buttons.find((button) => button.action === action)?.isPressed ?? false;

    return {
      left: pressed('left'),
      right: pressed('right'),
      throttle: pressed('throttle'),
      brake: pressed('brake'),
      turbo: pressed('turbo'),
      drs: pressed('drs'),
    };
  }

  /** pointerdown: hit-test manual; solo los botones bajo el dedo se presionan. */
  private readonly onPointerDown = (pointer: PointerLike): void => {
    for (const button of this.buttons) {
      if (button.contains(pointer.x, pointer.y)) {
        button.press(pointer.id);
      }
    }
  };

  /** pointerup / pointerupoutside: suelta SOLO al botón cuyo dueño es ese pointer. */
  private readonly onPointerUp = (pointer: PointerLike): void => {
    for (const button of this.buttons) {
      button.release(pointer.id);
    }
  };
}
