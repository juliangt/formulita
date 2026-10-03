/**
 * InputSystem — controles unificados (Fase 2).
 *
 * Abstracciones del plan (principios L e I):
 * - `IInputState`: el estado de input del juego en un instante (solo flags).
 *   Los sistemas de Fase 3+ consumen ESTE estado, no eventos sueltos.
 * - `IInputSource`: una fuente de input intercambiable (teclado, táctil o la
 *   que venga). Cualquier implementación es sustituible por otra (Liskov).
 * - `InputSystem`: fusiona N fuentes en un único `IInputState` con OR por
 *   flag (teclado y táctil pueden coexistir y hasta apretar a la vez).
 *
 * El fusor no depende de Phaser: `KeyboardSource` / `TouchSource` aíslan los
 * detalles de hardware y esto queda 100% testeable con fuentes fakes.
 */

/** Estado de input del juego: qué acciones están activas en este instante. */
export interface IInputState {
  /** Girar a la izquierda. */
  left: boolean;
  /** Girar a la derecha. */
  right: boolean;
  /** Acelerador. */
  throttle: boolean;
  /** Freno. */
  brake: boolean;
  /** Turbo. */
  turbo: boolean;
  /** DRS. */
  drs: boolean;
  /**
   * Eje analógico de giro (issue #37): −1 izquierda … +1 derecha. Las fuentes
   * binarias (teclado) no lo reportan; el joystick deslizable lo reporta
   * SIEMPRE que está en uso (0 en reposo o zona muerta). Cuando es distinto
   * de 0, `steerDirection` lo prefiere sobre los flags.
   */
  steerAxis?: number;
}

/** Estado sin ninguna acción activa (base para clones y defaults). */
export const EMPTY_INPUT_STATE: Readonly<IInputState> = Object.freeze({
  left: false,
  right: false,
  throttle: false,
  brake: false,
  turbo: false,
  drs: false,
});

/**
 * Fuente de input: conecta/desconecta su captura y reporta su estado.
 * `attach`/`detach` deben ser idempotentes y `detach` debe dejar el estado
 * en neutro (ningún flag puede quedar colgado tras desconectar).
 */
export interface IInputSource {
  /** Nombre identificatorio de la fuente (debug y tests). */
  readonly name: string;
  /** Conecta la fuente (registra listeners / keys). Idempotente. */
  attach(): void;
  /** Desconecta la fuente y limpia su estado. Idempotente. */
  detach(): void;
  /** Estado actual de la fuente. */
  getState(): IInputState;
}

/** Fuente nula: no captura nada y siempre reporta estado neutro. */
export class NullInputSource implements IInputSource {
  readonly name = 'null';

  attach(): void {}

  detach(): void {}

  getState(): IInputState {
    return { ...EMPTY_INPUT_STATE };
  }
}

/**
 * Fusión pura de N estados: OR flag a flag. Cualquier fuente que pida una
 * acción la enciende en el estado fusionado. No muta los estados entrantes.
 * El eje analógico fusiona por MAYOR MAGNITUD (el giro más pronunciado gana,
 * el mismo espíritu del OR de flags); fuentes sin eje no participan.
 */
export function mergeInputStates(states: readonly IInputState[]): IInputState {
  const merged: IInputState = { ...EMPTY_INPUT_STATE };
  let bestAxis = 0;
  for (const state of states) {
    merged.left = merged.left || state.left;
    merged.right = merged.right || state.right;
    merged.throttle = merged.throttle || state.throttle;
    merged.brake = merged.brake || state.brake;
    merged.turbo = merged.turbo || state.turbo;
    merged.drs = merged.drs || state.drs;
    const axis = state.steerAxis;
    if (typeof axis === 'number' && Number.isFinite(axis) && Math.abs(axis) > Math.abs(bestAxis)) {
      bestAxis = axis;
    }
  }
  if (bestAxis !== 0) {
    merged.steerAxis = bestAxis;
  }
  return merged;
}

/**
 * Dirección de giro pedida: continua en [−1, 1] (issue #37).
 *
 * El eje analógico del joystick tiene prioridad cuando está activo (≠ 0):
 * el deslizo modula el giro de forma proporcional. Sin eje (o centrado en
 * zona muerta) se usa la fórmula binaria de siempre: −1 izquierda, 1 derecha,
 * 0 nada — ambos lados a la vez se cancelan (comportamiento de Fase 1, y así
 * sigue girando el teclado).
 */
export function steerDirection(state: IInputState): number {
  const axis = state.steerAxis;
  if (typeof axis === 'number' && Number.isFinite(axis) && axis !== 0) {
    return Math.min(Math.max(axis, -1), 1);
  }
  return (state.left ? -1 : 0) + (state.right ? 1 : 0);
}

/**
 * InputSystem — gestor de fuentes y fusión en un único `IInputState`.
 *
 * Implementa `IInputSource` como fuente compuesta: quien consume input
 * (PlayerCar hoy, SpeedSystem mañana) recibe UNA `IInputSource` y no sabe
 * cuántas fuentes hay detrás (inversión de dependencias).
 */
export class InputSystem implements IInputSource {
  readonly name = 'input-system';

  private readonly sources: IInputSource[];
  private attached = false;

  constructor(sources: readonly IInputSource[] = []) {
    this.sources = [...sources];
  }

  /** Agrega una fuente; si el sistema ya está conectado, la conecta al momento. */
  addSource(source: IInputSource): this {
    this.sources.push(source);
    if (this.attached) {
      source.attach();
    }
    return this;
  }

  /** Quita una fuente y la desconecta. No falla si no estaba. */
  removeSource(source: IInputSource): this {
    const index = this.sources.indexOf(source);
    if (index !== -1) {
      this.sources.splice(index, 1);
      source.detach();
    }
    return this;
  }

  /** Conecta todas las fuentes. Idempotente. */
  attach(): void {
    if (this.attached) {
      return;
    }
    this.attached = true;
    for (const source of this.sources) {
      source.attach();
    }
  }

  /** Desconecta todas las fuentes (deja los estados en neutro). Idempotente. */
  detach(): void {
    if (!this.attached) {
      return;
    }
    this.attached = false;
    for (const source of this.sources) {
      source.detach();
    }
  }

  /** Estado fusionado de todas las fuentes (OR por flag). */
  getState(): IInputState {
    return mergeInputStates(this.sources.map((source) => source.getState()));
  }
}
