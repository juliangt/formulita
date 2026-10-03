/**
 * KeyboardSource — fuente de input por teclado (Fase 2).
 *
 * Mapeo del plan: ← → o A / D doblan · Espacio acelera · Shift turbo ·
 * Z freno · X DRS.
 *
 * El acceso al plugin de teclado de Phaser se abstrae en la interfaz mínima
 * `KeyboardPluginLike` (inyectable): los tests usan un fake sin runtime de
 * Phaser y `Phaser.Input.Keyboard.KeyboardPlugin` la satisface estructuralmente.
 *
 * Estrategia de captura: se registran las teclas en `attach` y se libera en
 * `detach` (idempotentes); `getState()` consulta `isDown` — el mismo modelo
 * de polling que usaba PlayerCar en Fase 1, ahora encapsulado detrás de
 * `IInputSource` (sustituible por TouchSource sin tocar a los consumidores).
 */

import type Phaser from 'phaser';
import type { IInputSource, IInputState } from './InputSystem';

/** Interfaz mínima de una tecla que KeyboardSource necesita (`Phaser.Input.Keyboard.Key` la satisface). */
export interface KeyLike {
  /** `true` mientras la tecla esté presionada. */
  readonly isDown: boolean;
}

/**
 * Interfaz mínima del plugin de teclado de Phaser (`scene.input.keyboard`).
 * Abstraída para testear sin Phaser real; el plugin real la satisface.
 */
export interface KeyboardPluginLike {
  /** Registra (o devuelve la ya registrada) una tecla por su nombre de KeyCodes ('LEFT', 'SPACE'…). */
  addKey(key: string | number): KeyLike;
  /** Libera una tecla registrada (por objeto o por código). */
  removeKey(key: string | number | KeyLike): unknown;
}

/** Acciones de input binarias = claves booleanas de `IInputState` (el eje
 * analógico `steerAxis` no va por teclas). */
type InputAction = Exclude<keyof IInputState, 'steerAxis'>;

/**
 * Mapeo acción → nombres de KeyCodes de Phaser. Cubre las 6 acciones del
 * estado: `satisfies` garantiza en compilación que ninguna quede sin teclas.
 */
export const KEYBOARD_BINDINGS = {
  left: ['LEFT', 'A'],
  right: ['RIGHT', 'D'],
  throttle: ['SPACE'],
  brake: ['Z'],
  turbo: ['SHIFT'],
  drs: ['X'],
} as const satisfies Record<InputAction, readonly string[]>;

const ACTIONS: readonly InputAction[] = Object.keys(KEYBOARD_BINDINGS) as InputAction[];

/** Fuente de input por teclado (implementa `IInputSource`). */
export class KeyboardSource implements IInputSource {
  readonly name = 'keyboard';

  private readonly keyboard: KeyboardPluginLike | null;
  private readonly keysByAction = new Map<InputAction, KeyLike[]>();
  private attached = false;

  /**
   * @param keyboard plugin de teclado de Phaser, o `null` si la escena no
   *   tiene (headless): la fuente queda inerte y reporta estado neutro.
   */
  constructor(keyboard: KeyboardPluginLike | null) {
    this.keyboard = keyboard;
  }

  /** Fábrica ergonómica desde una escena de Phaser. */
  static fromScene(scene: Phaser.Scene): KeyboardSource {
    return new KeyboardSource(scene.input.keyboard ?? null);
  }

  /** Registra todas las teclas del mapeo. Idempotente. */
  attach(): void {
    if (this.attached) {
      return;
    }
    const keyboard = this.keyboard;
    if (!keyboard) {
      return;
    }
    this.attached = true;
    for (const action of ACTIONS) {
      this.keysByAction.set(
        action,
        KEYBOARD_BINDINGS[action].map((code) => keyboard.addKey(code)),
      );
    }
  }

  /** Libera las teclas y limpia el estado (ningún flag queda colgado). Idempotente. */
  detach(): void {
    if (!this.attached) {
      return;
    }
    this.attached = false;
    for (const keys of this.keysByAction.values()) {
      for (const key of keys) {
        this.keyboard?.removeKey(key);
      }
    }
    this.keysByAction.clear();
  }

  /** Estado leído por polling de `isDown` (todo `false` si está desconectada). */
  getState(): IInputState {
    const isDown = (action: InputAction): boolean =>
      this.keysByAction.get(action)?.some((key) => key.isDown) ?? false;

    return {
      left: isDown('left'),
      right: isDown('right'),
      throttle: isDown('throttle'),
      brake: isDown('brake'),
      turbo: isDown('turbo'),
      drs: isDown('drs'),
    };
  }
}
