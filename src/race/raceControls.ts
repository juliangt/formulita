/**
 * raceControls — puente puro entre el input del juego y la física de
 * circuito (issue #9, V1).
 *
 * La RaceScene comparte con GameScene el stack de input (`IInputState`
 * fusionado por `InputSystem`, teclado + táctil), pero el CONSUMIDOR cambia:
 * `CircuitPhysics` espera un `CircuitInput` auto-acelerado
 * (`throttle` siempre pisado, freno y giro explícitos). Acá vive ese mapeo,
 * las teclas de la carrera y el layout de los botones táctiles, todo puro y
 * testeable sin Phaser (mismo criterio que KeyboardSource/TouchButton).
 *
 * Teclado de carrera: ←→ o A/D giran; ↓, S o ESPACIO frenan (el acelerador
 * va pisado solo: no hay tecla de gas). Táctil: ◀ ▶ abajo-izquierda (mismo
 * layout del modo BATALLA) y FRENO abajo-derecha en la casilla del freno.
 */

import {
  computeTouchButtonLayout,
  type TouchButtonRect,
} from '../systems/TouchButton';
import type { KeyLike, KeyboardPluginLike } from '../systems/KeyboardSource';
import type { IInputState } from '../systems/InputSystem';
import type { CircuitInput } from './circuitPhysics';

/**
 * Estado fusionado `IInputState` → `CircuitInput` de la física. El acelerador
 * viene PISADO por defecto (auto-acelerado, ver `CIRCUIT`): frenar es la
 * acción explícita y el giro se toma de la dirección pedida (ambos lados a la
 * vez se cancelan, comportamiento de Fase 1).
 */
export function circuitInputFromState(state: IInputState): CircuitInput {
  const steer = (state.left ? -1 : 0) + (state.right ? 1 : 0);
  return {
    throttle: true,
    brake: state.brake,
    steer: steer as -1 | 0 | 1,
  };
}

/**
 * Teclas de la carrera (nombres de KeyCodes de Phaser): girar y frenar. Sin
 * throttle (auto-acelerado), turbo ni DRS: no existen en el circuito.
 */
export const RACE_KEY_BINDINGS = {
  left: ['LEFT', 'A'],
  right: ['RIGHT', 'D'],
  brake: ['DOWN', 'S', 'SPACE'],
} as const;

type RaceInputAction = keyof typeof RACE_KEY_BINDINGS;

const RACE_ACTIONS: readonly RaceInputAction[] = Object.keys(RACE_KEY_BINDINGS) as RaceInputAction[];

/**
 * Fuente de teclado de la carrera (implementa la parte de lectura de
 * `IInputSource` con el mismo modelo de polling que `KeyboardSource`):
 * registra las teclas en `attach`, las libera en `detach` y reporta flags
 * { left, right, brake } — el resto del estado queda en `false`.
 */
export class RaceKeyboardSource {
  readonly name = 'race-keyboard';

  private readonly keyboard: KeyboardPluginLike | null;
  private readonly keysByAction = new Map<RaceInputAction, KeyLike[]>();
  private attached = false;

  constructor(keyboard: KeyboardPluginLike | null) {
    this.keyboard = keyboard;
  }

  /** Registra las teclas del mapeo. Idempotente. */
  attach(): void {
    if (this.attached || !this.keyboard) {
      return;
    }
    const keyboard = this.keyboard;
    this.attached = true;
    for (const action of RACE_ACTIONS) {
      this.keysByAction.set(
        action,
        RACE_KEY_BINDINGS[action].map((code) => keyboard.addKey(code)),
      );
    }
  }

  /** Libera las teclas y limpia el estado. Idempotente. */
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

  /** Porción de `IInputState` que llena esta fuente (giro + freno). */
  getState(): IInputState {
    const isDown = (action: RaceInputAction): boolean =>
      this.keysByAction.get(action)?.some((key) => key.isDown) ?? false;
    return {
      left: isDown('left'),
      right: isDown('right'),
      throttle: false,
      brake: isDown('brake'),
      turbo: false,
      drs: false,
    };
  }
}

/** Acciones táctiles de la carrera: ◀ ▶ para girar y FRENO. */
export type RaceTouchAction = 'left' | 'right' | 'brake';

export const RACE_TOUCH_ACTIONS: readonly RaceTouchAction[] = ['left', 'right', 'brake'];

/**
 * Layout táctil de la carrera: reutiliza el layout de 6 botones del modo
 * BATALLA (`computeTouchButtonLayout`) y se queda con ◀ ▶ (abajo-izquierda,
 * como siempre) y la casilla del freno (abajo-derecha, donde estaba BRK).
 * El resto de las casillas queda libre (no hay GAS: auto-acelerado).
 */
export function computeRaceTouchLayout(
  width: number,
  height: number,
): Record<RaceTouchAction, TouchButtonRect> {
  const full = computeTouchButtonLayout(width, height);
  return {
    left: full.left,
    right: full.right,
    brake: full.brake,
  };
}
