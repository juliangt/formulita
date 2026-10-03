/**
 * raceControls — puente puro entre el input del juego y la física de
 * circuito (issue #9, V1).
 *
 * La RaceScene comparte con GameScene el stack de input (`IInputState`
 * fusionado por `InputSystem`, teclado + táctil), pero el CONSUMIDOR cambia:
 * `CircuitPhysics` espera un `CircuitInput` {throttle, brake, steer}. Acá
 * vive ese mapeo, las teclas de la carrera y el layout táctil, todo puro y
 * testeable sin Phaser (mismo criterio que KeyboardSource/TouchButton).
 *
 * Issue #20 — GAS MANUAL: el acelerador ya no viene pisado por defecto; el
 * jugador controla el gas (tecla W/↑ o botón GAS táctil) y con él sus
 * frenadas y trazadas. Sin gas pisado el auto desacelera por el roce
 * (`CIRCUIT.coastDrag`); el freno conserva prioridad sobre el gas.
 *
 * Issue #37 — GIRO ANALÓGICO: el steer sale de `steerDirection` (compartido
 * con `PlayerCar`): eje continuo [−1, 1] cuando el joystick táctil está en
 * uso, fórmula binaria de siempre con el teclado. La física lo escala al
 * turn rate, así la mitad de deslizo es la mitad de giro.
 *
 * Teclado de carrera: W/↑ acelera; ←→ o A/D giran; ↓, S o ESPACIO frenan.
 * Táctil: JOYSTICK deslizable abajo-izquierda (issue #37) y GAS + FRENO
 * abajo-derecha en SUS casillas del layout de botones (gas en la esquina,
 * donde llega el pulgar derecho).
 */

import {
  computeTouchButtonLayout,
  type TouchButtonRect,
} from '../systems/TouchButton';
import {
  computeSteerJoystickRect,
} from '../systems/SteerJoystick';
import type { KeyLike, KeyboardPluginLike } from '../systems/KeyboardSource';
import { steerDirection, type IInputState } from '../systems/InputSystem';
import type { CircuitInput } from './circuitPhysics';

/**
 * Estado fusionado `IInputState` → `CircuitInput` de la física. El acelerador
 * es la acción del jugador (issue #20: gas manual — sin pisarlo el auto
 * desacelera por `CIRCUIT.coastDrag`); el freno gana sobre el gas en la
 * física y el giro sale de `steerDirection`: eje analógico del joystick si
 * está activo, si no la fórmula binaria (teclado).
 */
export function circuitInputFromState(state: IInputState): CircuitInput {
  return {
    throttle: state.throttle,
    brake: state.brake,
    steer: steerDirection(state),
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

/** Acciones táctiles de la carrera con botón: GAS + FRENO. El giro va por
 * el joystick deslizable (issue #37), que no es un botón. */
export type RaceTouchAction = 'throttle' | 'brake';

export const RACE_TOUCH_ACTIONS: readonly RaceTouchAction[] = ['throttle', 'brake'];

/** Layout táctil de la carrera: zona del joystick + GAS y FRENO. */
export interface RaceTouchLayout {
  /** Zona del joystick deslizable (abajo-izquierda, issue #37). */
  readonly joystick: TouchButtonRect;
  /** Botón GAS (esquina inferior derecha, donde llega el pulgar derecho). */
  readonly throttle: TouchButtonRect;
  /** Botón FRENO (a la izquierda del GAS). */
  readonly brake: TouchButtonRect;
}

/**
 * Layout táctil de la carrera: reutiliza el layout de botones del modo
 * BATALLA (`computeTouchButtonLayout`) para GAS + FRENO en SUS casillas
 * (gas en la esquina exterior, donde llega el pulgar derecho; freno a su
 * lado) y agrega la zona del joystick deslizable, que ocupa el footprint de
 * los viejos ◀ ▶. Las casillas turbo/drs quedan libres.
 */
export function computeRaceTouchLayout(width: number, height: number): RaceTouchLayout {
  const buttons = computeTouchButtonLayout(width, height);
  return {
    joystick: computeSteerJoystickRect(width, height),
    throttle: buttons.throttle,
    brake: buttons.brake,
  };
}
