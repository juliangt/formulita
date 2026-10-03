import { describe, expect, it } from 'vitest';
import { TouchSource, type PointerEventName } from '../systems/TouchSource';
import {
  ALL_TOUCH_ACTIONS,
  computeTouchButtonLayout,
  type PointerLike,
  type TouchButtonAction,
  type TouchButtonRect,
  type TouchButtonVisual,
} from '../systems/TouchButton';
import { computeSteerJoystickRect, type SteerJoystickVisual } from '../systems/SteerJoystick';
import type { IInputSource, IInputState } from '../systems/InputSystem';
import { TOUCH_HUD } from '../config/balance';

/**
 * Tests del TouchSource (Fase 2 + issue #37): HUD táctil multi-touch con
 * FAKE de pointer events y FAKE de visuales — toda la lógica (attach/detach,
 * tracking de pointerId por control, eje analógico del joystick, estado
 * fusionado) se prueba sin runtime de Phaser.
 */

const WIDTH = 720;
const HEIGHT = 1280;
const LAYOUT = computeTouchButtonLayout(WIDTH, HEIGHT);
const JOYSTICK = computeSteerJoystickRect(WIDTH, HEIGHT);

/** Centro de un botón: dónde "toca el dedo" en los tests. */
function center(action: TouchButtonAction): { x: number; y: number } {
  const r: TouchButtonRect = LAYOUT[action];
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/** x del centro de la zona del joystick. */
const JOYSTICK_CENTER_X = JOYSTICK.x + JOYSTICK.width / 2;
const JOYSTICK_CENTER_Y = JOYSTICK.y + JOYSTICK.height / 2;

type FakeHandler = (pointer: PointerLike) => void;

/** Fake del InputPlugin: graba on/off y permite emitir pointers manualmente. */
function makeFakeEmitter() {
  const handlers = new Map<PointerEventName, FakeHandler[]>();
  const onCalls: PointerEventName[] = [];
  const offCalls: PointerEventName[] = [];

  const emitter = {
    on(event: PointerEventName, handler: FakeHandler): unknown {
      onCalls.push(event);
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return emitter;
    },
    off(event: PointerEventName, handler: FakeHandler): unknown {
      offCalls.push(event);
      const list = handlers.get(event) ?? [];
      const index = list.indexOf(handler);
      if (index !== -1) {
        list.splice(index, 1);
      }
      return emitter;
    },
    emit(event: PointerEventName, pointer: PointerLike): void {
      for (const handler of [...(handlers.get(event) ?? [])]) {
        handler(pointer);
      }
    },
  };

  return { emitter, onCalls, offCalls, emit: emitter.emit.bind(emitter) };
}

interface FakeVisualRecord {
  action: TouchButtonAction;
  rect: TouchButtonRect;
  pressedCalls: boolean[];
  destroyed: boolean;
}

/** Fake de fábrica de visuales: crea un botón "fantasma" por acción. */
function makeFakeVisualFactory() {
  const records: FakeVisualRecord[] = [];
  const factory = (action: TouchButtonAction, rect: TouchButtonRect): TouchButtonVisual => {
    const record: FakeVisualRecord = {
      action,
      rect,
      pressedCalls: [],
      destroyed: false,
    };
    records.push(record);
    return {
      setPressed: (pressed: boolean) => record.pressedCalls.push(pressed),
      destroy: () => {
        record.destroyed = true;
      },
    };
  };
  return { records, factory };
}

interface FakeJoystickRecord {
  rect: TouchButtonRect;
  knobCalls: number[];
  pressedCalls: boolean[];
  destroyed: boolean;
}

/** Fake del visual del joystick: graba knob y presión. */
function makeFakeJoystickFactory() {
  const record: FakeJoystickRecord = {
    rect: { x: 0, y: 0, width: 0, height: 0 },
    knobCalls: [],
    pressedCalls: [],
    destroyed: false,
  };
  const factory = (rect: TouchButtonRect): SteerJoystickVisual => {
    record.rect = { ...rect };
    return {
      setKnob: (ratio: number) => record.knobCalls.push(ratio),
      setPressed: (pressed: boolean) => record.pressedCalls.push(pressed),
      destroy: () => {
        record.destroyed = true;
      },
    };
  };
  return { record, factory };
}

/** Fuente armada con todos los fakes + su layout para apuntar los toques. */
function makeSource() {
  const emitter = makeFakeEmitter();
  const visuals = makeFakeVisualFactory();
  const joystick = makeFakeJoystickFactory();
  const source = new TouchSource(null, {
    width: WIDTH,
    height: HEIGHT,
    emitter: emitter.emitter,
    visualFactory: visuals.factory,
    joystickVisualFactory: joystick.factory,
  });
  return { source, emitter, visuals, joystick };
}

function pointerAt(action: TouchButtonAction, id: number): PointerLike {
  return { id, ...center(action) };
}

const NEUTRAL_STATE = {
  left: false,
  right: false,
  throttle: false,
  brake: false,
  turbo: false,
  drs: false,
  steerAxis: 0,
};

describe('TouchSource — construcción', () => {
  it('implementa IInputSource (Liskov: intercambiable con KeyboardSource)', () => {
    const { source } = makeSource();
    const asSource: IInputSource = source;

    expect(asSource.name).toBe('touch');
    expect(asSource.getState()).toEqual(NEUTRAL_STATE);
  });

  it('construye un visual por cada uno de los 4 botones, con su rect del layout', () => {
    const { visuals } = makeSource();

    expect(visuals.records.map((record) => record.action)).toEqual([...ALL_TOUCH_ACTIONS]);
    for (const record of visuals.records) {
      expect(record.rect).toEqual(LAYOUT[record.action]);
    }
  });

  it('construye el visual del joystick sobre la zona deslizable (issue #37)', () => {
    const { joystick } = makeSource();

    expect(joystick.record.rect).toEqual(JOYSTICK);
  });
});

describe('TouchSource — attach / detach', () => {
  it('attach registra exactamente los 4 eventos de pointer (incluye pointermove del joystick)', () => {
    const { source, emitter } = makeSource();

    source.attach();

    expect(emitter.onCalls).toEqual([
      'pointerdown',
      'pointermove',
      'pointerup',
      'pointerupoutside',
    ]);
  });

  it('attach es idempotente (no duplica listeners)', () => {
    const { source, emitter } = makeSource();

    source.attach();
    source.attach();

    expect(emitter.onCalls).toHaveLength(4);
  });

  it('detach quita los mismos 4 listeners con los mismos handlers', () => {
    const { source, emitter } = makeSource();

    source.attach();
    source.detach();

    expect(emitter.offCalls).toEqual([
      'pointerdown',
      'pointermove',
      'pointerup',
      'pointerupoutside',
    ]);
  });

  it('detach deja el estado en neutro aunque hubiera controles presionados', () => {
    const { source, emitter } = makeSource();
    source.attach();

    emitter.emit('pointerdown', { id: 7, x: JOYSTICK.x, y: JOYSTICK_CENTER_Y });
    emitter.emit('pointerdown', pointerAt('throttle', 8));
    expect(source.getState().left).toBe(true);

    source.detach();

    expect(source.getState()).toEqual(NEUTRAL_STATE);

    // Los listeners ya no están: emitir tras el detach no cambia nada.
    emitter.emit('pointerdown', pointerAt('turbo', 9));
    expect(source.getState().turbo).toBe(false);
  });

  it('detach + attach vuelve a escuchar (ciclo de vida de escena)', () => {
    const { source, emitter } = makeSource();

    source.attach();
    source.detach();
    source.attach();

    expect(emitter.onCalls).toHaveLength(8);
    emitter.emit('pointerdown', pointerAt('turbo', 3));
    expect(source.getState().turbo).toBe(true);
  });

  it('sin attach los eventos del emisor NO afectan el estado', () => {
    const { source, emitter } = makeSource();

    emitter.emit('pointerdown', pointerAt('throttle', 1));

    expect(source.getState().throttle).toBe(false);
  });
});

describe('TouchSource — joystick deslizable (issue #37)', () => {
  it('apoyar el dedo a la izquierda del centro dobla a la izquierda (flag + eje)', () => {
    const { source, emitter } = makeSource();
    source.attach();

    emitter.emit('pointerdown', {
      id: 7,
      x: JOYSTICK.x + 10,
      y: JOYSTICK_CENTER_Y,
    });

    const state = source.getState();
    expect(state.left).toBe(true);
    expect(state.right).toBe(false);
    expect(state.steerAxis).toBeLessThan(0);
  });

  it('el eje es proporcional al deslizo: centro muerto, medio recorrido ≈ medio giro', () => {
    const { source, emitter } = makeSource();
    source.attach();

    // En el centro exacto: zona muerta → 0 (y sin flags).
    emitter.emit('pointerdown', { id: 7, x: JOYSTICK_CENTER_X, y: JOYSTICK_CENTER_Y });
    const centered = source.getState();
    expect(centered.steerAxis).toBe(0);
    expect(centered.left).toBe(false);
    expect(centered.right).toBe(false);

    // Medio recorrido hacia la derecha: giro proporcional intermedio.
    const half = JOYSTICK_CENTER_X + JOYSTICK.width / 4;
    emitter.emit('pointermove', { id: 7, x: half, y: JOYSTICK_CENTER_Y });
    const halfAxis = source.getState().steerAxis;
    expect(halfAxis).toBeGreaterThan(0);
    expect(halfAxis).toBeLessThan(1);

    // Al tope derecho: giro completo.
    emitter.emit('pointermove', { id: 7, x: JOYSTICK.x + JOYSTICK.width, y: JOYSTICK_CENTER_Y });
    const full = source.getState();
    expect(full.steerAxis).toBe(1);
    expect(full.right).toBe(true);
  });

  it('pointermove sigue al dedo; soltar (aunque sea fuera del canvas) vuelve a neutro', () => {
    const { source, emitter, joystick } = makeSource();
    source.attach();

    emitter.emit('pointerdown', { id: 7, x: JOYSTICK_CENTER_X, y: JOYSTICK_CENTER_Y });
    emitter.emit('pointermove', { id: 7, x: 0, y: JOYSTICK_CENTER_Y }); // clamp al tope izquierdo
    expect(source.getState().steerAxis).toBe(-1);

    emitter.emit('pointerupoutside', { id: 7, x: -20, y: -20 });
    expect(source.getState()).toEqual(NEUTRAL_STATE);
    expect(joystick.record.knobCalls).toEqual([0, -1, 0]);
  });

  it('el knob del visual sigue el eje y el feedback de presión avisa al visual', () => {
    const { source, emitter, joystick } = makeSource();
    source.attach();

    emitter.emit('pointerdown', { id: 7, x: JOYSTICK.x, y: JOYSTICK_CENTER_Y });
    emitter.emit('pointermove', { id: 7, x: JOYSTICK.x + JOYSTICK.width, y: JOYSTICK_CENTER_Y });
    emitter.emit('pointerup', { id: 7, x: JOYSTICK.x, y: JOYSTICK_CENTER_Y });

    expect(joystick.record.knobCalls).toEqual([-1, 1, 0]);
    expect(joystick.record.pressedCalls).toEqual([true, false]);
  });

  it('un dedo nuevo no roba la zona; el move de otro dedo se ignora', () => {
    const { source, emitter, joystick } = makeSource();
    source.attach();

    emitter.emit('pointerdown', { id: 7, x: JOYSTICK.x, y: JOYSTICK_CENTER_Y });
    // Otro dedo "toca" la zona y se mueve: el dueño sigue siendo 7.
    emitter.emit('pointerdown', { id: 8, x: JOYSTICK_CENTER_X, y: JOYSTICK_CENTER_Y });
    emitter.emit('pointermove', { id: 8, x: JOYSTICK.x + JOYSTICK.width, y: JOYSTICK_CENTER_Y });

    expect(source.getState().steerAxis).toBe(-1);
    expect(joystick.record.pressedCalls).toEqual([true]); // solo el press del dueño

    // Y soltar el id 8 NO libera la zona.
    emitter.emit('pointerup', { id: 8, x: 0, y: 0 });
    expect(source.getState().left).toBe(true);
  });

  it('deslizar fuera de la zona (mismo dedo) sigue moviendo el knob hasta el clamp', () => {
    const { source, emitter } = makeSource();
    source.attach();

    emitter.emit('pointerdown', { id: 7, x: JOYSTICK_CENTER_X, y: JOYSTICK_CENTER_Y });
    // El dedo se va MUY a la derecha: el eje clampea en +1 (no se pierde).
    emitter.emit('pointermove', { id: 7, x: WIDTH - 1, y: JOYSTICK_CENTER_Y });
    expect(source.getState().steerAxis).toBe(1);
    expect(source.getState().right).toBe(true);
  });

  it('la zona muerta central del balance deja el eje en 0', () => {
    const { source, emitter } = makeSource();
    source.attach();

    emitter.emit('pointerdown', {
      id: 7,
      x: JOYSTICK_CENTER_X + TOUCH_HUD.joystickDeadzonePx - 1,
      y: JOYSTICK_CENTER_Y,
    });

    const state = source.getState();
    expect(state.steerAxis).toBe(0);
    expect(state.left).toBe(false);
    expect(state.right).toBe(false);
  });
});

describe('TouchSource — multi-touch real (tracking por pointerId)', () => {
  it('un dedo desliza el joystick (id 7) y otro acelera (id 8): doblar + acelerar a la vez', () => {
    const { source, emitter } = makeSource();
    source.attach();

    emitter.emit('pointerdown', { id: 7, x: JOYSTICK.x, y: JOYSTICK_CENTER_Y });
    emitter.emit('pointerdown', pointerAt('throttle', 8));

    const state = source.getState();
    expect(state.left).toBe(true);
    expect(state.steerAxis).toBe(-1);
    expect(state.throttle).toBe(true);
    expect(state.right).toBe(false);
  });

  it('soltar con OTRO id no suelta el control (solo el dueño lo libera)', () => {
    const { source, emitter } = makeSource();
    source.attach();

    emitter.emit('pointerdown', { id: 7, x: JOYSTICK.x, y: JOYSTICK_CENTER_Y });
    emitter.emit('pointerdown', pointerAt('throttle', 8));

    emitter.emit('pointerup', { id: 8, x: 0, y: 0 }); // id 8 soltó el throttle

    const afterWrongUp = source.getState();
    expect(afterWrongUp.left).toBe(true); // 7 sigue con el joystick
    expect(afterWrongUp.steerAxis).toBe(-1);
    expect(afterWrongUp.throttle).toBe(false); // 8 era el dueño del GAS

    emitter.emit('pointerup', { id: 7, x: JOYSTICK.x, y: JOYSTICK_CENTER_Y });
    expect(source.getState().left).toBe(false);
  });

  it('pointerupoutside también libera al dueño (dedo suelto fuera del canvas)', () => {
    const { source, emitter } = makeSource();
    source.attach();

    emitter.emit('pointerdown', pointerAt('turbo', 5));
    expect(source.getState().turbo).toBe(true);

    emitter.emit('pointerupoutside', { id: 5, x: -10, y: -10 });
    expect(source.getState().turbo).toBe(false);
  });

  it('un dedo nuevo no roba un botón ya presionado', () => {
    const { source, emitter } = makeSource();
    source.attach();

    emitter.emit('pointerdown', pointerAt('brake', 11));

    // Otro dedo toca el MISMO botón: el dueño sigue siendo 11.
    emitter.emit('pointerdown', pointerAt('brake', 12));
    emitter.emit('pointerup', { id: 12, x: 0, y: 0 });

    expect(source.getState().brake).toBe(true);

    emitter.emit('pointerup', pointerAt('brake', 11));
    expect(source.getState().brake).toBe(false);
  });

  it('un toque fuera de todos los controles no enciende nada', () => {
    const { source, emitter } = makeSource();
    source.attach();

    emitter.emit('pointerdown', { id: 2, x: WIDTH / 2, y: 600 });

    expect(source.getState()).toEqual(NEUTRAL_STATE);
  });

  it('hit-test con padding: un toque al borde externo del botón también entra', () => {
    const { source, emitter } = makeSource();
    source.attach();

    const r = LAYOUT.drs;
    // Unos px por fuera del borde derecho del botón DRS (dentro del padding,
    // que sale del balance para que el test no dependa de su valor exacto).
    emitter.emit('pointerdown', {
      id: 9,
      x: r.x + r.width + (TOUCH_HUD.hitPadding - 2),
      y: r.y + r.height / 2,
    });

    expect(source.getState().drs).toBe(true);

    emitter.emit('pointerup', { id: 9, x: 0, y: 0 });
  });

  it('los 4 botones Y el joystick pueden estar activos a la vez (5 pointers)', () => {
    const { source, emitter } = makeSource();
    source.attach();

    ALL_TOUCH_ACTIONS.forEach((action, index) => {
      emitter.emit('pointerdown', pointerAt(action, index + 1));
    });
    emitter.emit('pointerdown', { id: 99, x: JOYSTICK.x, y: JOYSTICK_CENTER_Y });

    const state = source.getState();
    expect(state.throttle && state.brake && state.turbo && state.drs).toBe(true);
    expect(state.left).toBe(true);

    ALL_TOUCH_ACTIONS.forEach((action, index) => {
      emitter.emit('pointerup', pointerAt(action, index + 1));
    });
    emitter.emit('pointerup', { id: 99, x: JOYSTICK.x, y: JOYSTICK_CENTER_Y });
    expect(source.getState()).toEqual(NEUTRAL_STATE);
  });
});

describe('TouchSource — feedback visual (TouchButtonVisual)', () => {
  it('press enciende el visual; release del dueño lo apaga', () => {
    const { source, emitter, visuals } = makeSource();
    source.attach();

    emitter.emit('pointerdown', pointerAt('throttle', 7));
    emitter.emit('pointerup', pointerAt('throttle', 7));

    const record = visuals.records.find((candidate) => candidate.action === 'throttle');
    if (!record) {
      throw new Error('falta el visual de throttle');
    }
    expect(record.pressedCalls).toEqual([true, false]);
  });

  it('release con otro id NO toca el visual (sigue presionado)', () => {
    const { source, emitter, visuals } = makeSource();
    source.attach();

    emitter.emit('pointerdown', pointerAt('brake', 7));
    emitter.emit('pointerup', { id: 99, x: 0, y: 0 });

    const record = visuals.records.find((candidate) => candidate.action === 'brake');
    if (!record) {
      throw new Error('falta el visual de brake');
    }
    expect(record.pressedCalls).toEqual([true]);
    expect(source.getState().brake).toBe(true);
  });

  it('destroy desconecta, suelta todo y destruye los visuales (idempotente)', () => {
    const { source, emitter, visuals, joystick } = makeSource();
    source.attach();
    emitter.emit('pointerdown', pointerAt('turbo', 3));
    emitter.emit('pointerdown', { id: 4, x: JOYSTICK.x, y: JOYSTICK_CENTER_Y });

    source.destroy();

    const finalState = source.getState();
    expect(finalState.turbo).toBe(false);
    expect(finalState.steerAxis).toBe(0);
    expect(visuals.records.every((record) => record.destroyed)).toBe(true);
    expect(joystick.record.destroyed).toBe(true);
    expect(() => source.destroy()).not.toThrow();
  });
});

describe('TouchSource — estado vs IInputState', () => {
  it('getState devuelve exactamente las claves del IInputState (incluye el eje analógico)', () => {
    const { source } = makeSource();
    const state: IInputState = source.getState();

    expect(Object.keys(state).sort()).toEqual(
      ['brake', 'drs', 'left', 'right', 'steerAxis', 'throttle', 'turbo'].sort(),
    );
  });

  it('vi.mock no es necesario: el eje es un número finito y los flags son booleanos', () => {
    const { source } = makeSource();
    const state = source.getState();

    expect(typeof state.steerAxis).toBe('number');
    expect(Number.isFinite(state.steerAxis)).toBe(true);
  });
});

describe('TouchSource — visuales inyectables sin escena', () => {
  it('sin scene y sin fábricas explícitas usa visuales nulos: la lógica funciona igual', () => {
    const emitter = makeFakeEmitter();
    const source = new TouchSource(null, {
      width: WIDTH,
      height: HEIGHT,
      emitter: emitter.emitter,
    });
    source.attach();

    emitter.emit('pointerdown', { id: 7, x: JOYSTICK.x, y: JOYSTICK_CENTER_Y });
    const state = source.getState();

    expect(state.steerAxis).toBe(-1);
    expect(() => source.destroy()).not.toThrow();
  });

  it('el emitter null explícito deja la fuente sin escuchar (headless)', () => {
    const source = new TouchSource(null, {
      width: WIDTH,
      height: HEIGHT,
      emitter: null,
    });

    expect(() => {
      source.attach();
      source.detach();
      source.destroy();
    }).not.toThrow();
    expect(source.getState()).toEqual(NEUTRAL_STATE);
  });
});
