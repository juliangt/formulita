/**
 * raceControls — puente puro entre el input del juego y la física de
 * circuito (issue #9, V1).
 *
 * La RaceScene comparte con GameScene el stack de input (`IInputState`
 * fusionado por `InputSystem`, teclado + táctil), pero el CONSUMIDOR cambia:
 * `CircuitPhysics` espera un `CircuitInput` {throttle, brake, steer}. Acá
 * vive ese mapeo, las teclas de la carrera y el layout de los botones
 * táctiles, todo puro y testeable sin Phaser (mismo criterio que
 * KeyboardSource/TouchButton).
 *
 * Issue #20 — GAS MANUAL: el acelerador ya no viene pisado por defecto; el
 * jugador controla el gas (tecla W/↑ o botón GAS táctil) y con él sus
 * frenadas y trazadas. Sin gas pisado el auto desacelera por el roce
 * (`CIRCUIT.coastDrag`); el freno conserva prioridad sobre el gas.
 *
 * Teclado de carrera: W/↑ acelera; ←→ o A/D giran; ↓, S o ESPACIO frenan.
 * Táctil: ◀ ▶ abajo-izquierda (mismo layout del modo BATALLA) y GAS + FRENO
 * abajo-derecha en SUS casillas del layout de 6 botones (gas en la esquina,
 * donde llega el pulgar derecho).
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
 * es la acción del jugador (issue #20: gas manual — sin pisarlo el auto
 * desacelera por `CIRCUIT.coastDrag`); el freno gana sobre el gas en la
 * física y el giro se toma de la dirección pedida (ambos lados a la vez se
 * cancelan, comportamiento de Fase 1).
 */
export function circuitInputFromState(state: IInputState): CircuitInput {
  const steer = (state.left ? -1 : 0) + (state.right ? 1 : 0);
  return {
    throttle: state.throttle,
    brake: state.brake,
    steer: steer as -1 | 0 | 1,
  };
}

/**
 * Teclas de la carrera (nombres de KeyCodes de Phaser): gas, giro y freno.
 * Sin turbo ni DRS: no existen en el circuito.
 */
export const RACE_KEY_BINDINGS = {
  left: ['LEFT', 'A'],
  right: ['RIGHT', 'D'],
  throttle: ['W', 'UP'],
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

  /** Porción de `IInputState` que llena esta fuente (gas + giro + freno). */
  getState(): IInputState {
    const isDown = (action: RaceInputAction): boolean =>
      this.keysByAction.get(action)?.some((key) => key.isDown) ?? false;
    return {
      left: isDown('left'),
      right: isDown('right'),
      throttle: isDown('throttle'),
      brake: isDown('brake'),
      turbo: false,
      drs: false,
    };
  }
}

/** Acciones táctiles de la carrera: ◀ ▶ para girar y GAS + FRENO. */
export type RaceTouchAction = 'left' | 'right' | 'throttle' | 'brake';

export const RACE_TOUCH_ACTIONS: readonly RaceTouchAction[] = [
  'left',
  'right',
  'throttle',
  'brake',
];

/**
 * Layout táctil de la carrera: reutiliza el layout de 6 botones del modo
 * BATALLA (`computeTouchButtonLayout`) y se queda con ◀ ▶ (abajo-izquierda,
 * como siempre) y GAS + FRENO abajo-derecha en SUS casillas (gas en la
 * esquina exterior, donde llega el pulgar derecho; freno a su lado).
 * El resto de las casillas (turbo/drs) queda libre.
 */
export function computeRaceTouchLayout(
  width: number,
  height: number,
): Record<RaceTouchAction, TouchButtonRect> {
  const full = computeTouchButtonLayout(width, height);
  return {
    left: full.left,
    right: full.right,
    throttle: full.throttle,
    brake: full.brake,
  };
}
