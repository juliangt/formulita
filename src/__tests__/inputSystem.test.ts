import { describe, expect, it, vi } from 'vitest';
import {
  EMPTY_INPUT_STATE,
  InputSystem,
  NullInputSource,
  mergeInputStates,
  steerDirection,
  type IInputSource,
  type IInputState,
} from '../systems/InputSystem';

/**
 * Tests del InputSystem (Fase 2): estado vacío, fusión OR de N fuentes y el
 * ciclo attach/detach. Lógica pura: las fuentes son fakes, sin Phaser.
 */

/** Fuente fake con estado mutable y contadores de attach/detach. */
function makeFakeSource(
  name: string,
  initial: Partial<IInputState> = {},
): IInputSource & { state: IInputState; attachCount: number; detachCount: number } {
  const fake = {
    name,
    state: { ...EMPTY_INPUT_STATE, ...initial } as IInputState,
    attachCount: 0,
    detachCount: 0,
    attach(): void {
      fake.attachCount += 1;
    },
    detach(): void {
      fake.detachCount += 1;
    },
    getState(): IInputState {
      return fake.state;
    },
  };
  return fake;
}

function pressOf(state: IInputState): string {
  return Object.entries(state)
    .filter(([, value]) => value)
    .map(([key]) => key)
    .sort()
    .join(',');
}

describe('EMPTY_INPUT_STATE', () => {
  it('tiene las 6 acciones en false', () => {
    expect(EMPTY_INPUT_STATE).toEqual({
      left: false,
      right: false,
      throttle: false,
      brake: false,
      turbo: false,
      drs: false,
    });
  });
});

describe('mergeInputStates', () => {
  it('sin estados devuelve el estado neutro', () => {
    expect(mergeInputStates([])).toEqual(EMPTY_INPUT_STATE);
  });

  it('fusión con OR de flags de 2 fuentes', () => {
    const merged = mergeInputStates([
      { ...EMPTY_INPUT_STATE, left: true },
      { ...EMPTY_INPUT_STATE, throttle: true, drs: true },
    ]);

    expect(pressOf(merged)).toBe('drs,left,throttle');
  });

  it('fusión de 3 fuentes suma todas las acciones activas', () => {
    const merged = mergeInputStates([
      { ...EMPTY_INPUT_STATE, left: true },
      { ...EMPTY_INPUT_STATE, right: true, turbo: true },
      { ...EMPTY_INPUT_STATE, brake: true },
    ]);

    expect(pressOf(merged)).toBe('brake,left,right,turbo');
  });

  it('un flag encendido en varias fuentes sigue siendo true (idempotente)', () => {
    const merged = mergeInputStates([
      { ...EMPTY_INPUT_STATE, throttle: true },
      { ...EMPTY_INPUT_STATE, throttle: true },
    ]);

    expect(merged.throttle).toBe(true);
  });

  it('no muta los estados entrantes', () => {
    const a: IInputState = { ...EMPTY_INPUT_STATE, left: true };
    const b: IInputState = { ...EMPTY_INPUT_STATE, right: true };

    mergeInputStates([a, b]);

    expect(a).toEqual({ ...EMPTY_INPUT_STATE, left: true });
    expect(b).toEqual({ ...EMPTY_INPUT_STATE, right: true });
  });

  it('devuelve un objeto nuevo (mutarlo no toca al estado base)', () => {
    const merged = mergeInputStates([]);
    merged.left = true;

    expect(EMPTY_INPUT_STATE.left).toBe(false);
  });
});

describe('steerDirection', () => {
  it('sin input devuelve 0', () => {
    expect(steerDirection(EMPTY_INPUT_STATE)).toBe(0);
  });

  it('izquierda → -1, derecha → 1', () => {
    expect(steerDirection({ ...EMPTY_INPUT_STATE, left: true })).toBe(-1);
    expect(steerDirection({ ...EMPTY_INPUT_STATE, right: true })).toBe(1);
  });

  it('ambos lados presionados se cancelan', () => {
    expect(steerDirection({ ...EMPTY_INPUT_STATE, left: true, right: true })).toBe(0);
  });
});

describe('InputSystem', () => {
  it('implementa IInputSource con nombre propio', () => {
    const system: IInputSource = new InputSystem();

    expect(system.name).toBe('input-system');
    expect(typeof system.attach).toBe('function');
    expect(typeof system.detach).toBe('function');
    expect(typeof system.getState).toBe('function');
  });

  it('sin fuentes reporta el estado neutro', () => {
    expect(new InputSystem().getState()).toEqual(EMPTY_INPUT_STATE);
  });

  it('fusión dinámica: cambia el estado de una fuente y se refleja', () => {
    const keyboard = makeFakeSource('keyboard');
    const touch = makeFakeSource('touch', { throttle: true });
    const system = new InputSystem([keyboard, touch]);

    expect(pressOf(system.getState())).toBe('throttle');

    keyboard.state.left = true;
    touch.state.throttle = false;

    expect(pressOf(system.getState())).toBe('left');
  });

  it('attach conecta todas las fuentes y es idempotente', () => {
    const a = makeFakeSource('a');
    const b = makeFakeSource('b');
    const system = new InputSystem([a, b]);

    system.attach();
    system.attach();

    expect(a.attachCount).toBe(1);
    expect(b.attachCount).toBe(1);
  });

  it('detach desconecta todas las fuentes y es idempotente', () => {
    const a = makeFakeSource('a');
    const system = new InputSystem([a]);

    system.detach();
    system.detach();

    expect(a.detachCount).toBe(0); // nunca se conectó: no hay de qué desconectar

    system.attach();
    system.detach();
    system.detach();

    expect(a.detachCount).toBe(1);
  });

  it('addSource con el sistema ya conectado conecta la fuente al momento', () => {
    const system = new InputSystem();
    system.attach();

    const late = makeFakeSource('late');
    system.addSource(late);

    expect(late.attachCount).toBe(1);
    late.state.turbo = true;
    expect(system.getState().turbo).toBe(true);
  });

  it('addSource con el sistema desconectado NO conecta la fuente todavía', () => {
    const system = new InputSystem();
    const late = makeFakeSource('late');

    system.addSource(late);

    expect(late.attachCount).toBe(0);

    system.attach();
    expect(late.attachCount).toBe(1);
  });

  it('removeSource desconecta la fuente y la saca de la fusión', () => {
    const a = makeFakeSource('a', { left: true });
    const b = makeFakeSource('b', { right: true });
    const system = new InputSystem([a, b]);

    system.removeSource(a);

    expect(a.detachCount).toBe(1);
    expect(system.getState().left).toBe(false);
    expect(system.getState().right).toBe(true);
  });

  it('removeSource con una fuente desconocida no falla ni toca a las demás', () => {
    const a = makeFakeSource('a');
    const unknown = makeFakeSource('unknown');
    const system = new InputSystem([a]);

    expect(() => system.removeSource(unknown)).not.toThrow();
    expect(a.attachCount).toBe(0);
    expect(a.detachCount).toBe(0);
  });

  it('fuente compuesta (Liskov): un InputSystem puede ser fuente de otro', () => {
    const innerFake = makeFakeSource('inner');
    const inner = new InputSystem([innerFake]);
    const outer = new InputSystem([inner, makeFakeSource('other', { brake: true })]);

    expect(innerFake.attachCount).toBe(0);

    // El ciclo de vida se propaga a través de la composición…
    outer.attach();
    expect(innerFake.attachCount).toBe(1);

    // …y el fusor externo consume el interno como una fuente más.
    innerFake.state.drs = true;
    expect(pressOf(outer.getState())).toBe('brake,drs');

    outer.detach();
    expect(innerFake.detachCount).toBe(1);
  });

  it('detach deja el estado en neutro aunque las fuentes sigan "presionadas"', () => {
    const source = makeFakeSource('a', { turbo: true });
    const system = new InputSystem([source]);
    system.attach();

    source.state.throttle = true;
    system.detach();

    // El fake sigue reportando su estado interno; al reconectar vuelve a fluir.
    system.attach();
    expect(pressOf(system.getState())).toBe('throttle,turbo');
  });
});

describe('NullInputSource', () => {
  it('siempre reporta estado neutro y es segura de conectar/desconectar', () => {
    const source = new NullInputSource();

    expect(() => {
      source.attach();
      source.detach();
    }).not.toThrow();
    expect(source.getState()).toEqual(EMPTY_INPUT_STATE);
  });

  it('puede usarse como cualquier otra fuente en el InputSystem', () => {
    const system = new InputSystem([new NullInputSource(), makeFakeSource('a', { left: true })]);

    expect(system.getState().left).toBe(true);
  });
});

describe('contrato IInputSource', () => {
  it('todas las fuentes comparten la misma interfaz (fusión homogénea)', () => {
    const sources: IInputSource[] = [
      makeFakeSource('fake'),
      new NullInputSource(),
      new InputSystem(),
    ];

    for (const source of sources) {
      expect(typeof source.name).toBe('string');
      expect(source.getState()).toEqual(EMPTY_INPUT_STATE);
    }
  });

  it('getState es consulta pura: se puede leer sin attach y no conecta nada', () => {
    const spy = vi.fn();
    const source = makeFakeSource('observed');
    const originalGetState = source.getState.bind(source);
    source.getState = () => {
      spy();
      return originalGetState();
    };
    const system = new InputSystem([source]);

    expect(system.getState()).toEqual(EMPTY_INPUT_STATE);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(source.attachCount).toBe(0);
  });
});
