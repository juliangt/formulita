import { describe, expect, it } from 'vitest';
import {
  TouchSource,
  type PointerEventName,
} from '../systems/TouchSource';
import {
  ALL_TOUCH_ACTIONS,
  computeTouchButtonLayout,
  type PointerLike,
  type TouchButtonAction,
  type TouchButtonRect,
  type TouchButtonVisual,
} from '../systems/TouchButton';
import type { IInputSource, IInputState } from '../systems/InputSystem';
import { TOUCH_HUD } from '../config/balance';

/**
 * Tests del TouchSource (Fase 2): HUD táctil multi-touch con FAKE de pointer
 * events y FAKE de visuales — toda la lógica (attach/detach, tracking de
 * pointerId por botón, estado fusionado) se prueba sin runtime de Phaser.
 */

const WIDTH = 720;
const HEIGHT = 1280;
const LAYOUT = computeTouchButtonLayout(WIDTH, HEIGHT);

/** Centro de un botón: dónde "toca el dedo" en los tests. */
function center(action: TouchButtonAction): { x: number; y: number } {
  const r: TouchButtonRect = LAYOUT[action];
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

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

/** Fuente armada con todos los fakes + su layout para apuntar los toques. */
function makeSource() {
  const emitter = makeFakeEmitter();
  const visuals = makeFakeVisualFactory();
  const source = new TouchSource(null, {
    width: WIDTH,
    height: HEIGHT,
    emitter: emitter.emitter,
    visualFactory: visuals.factory,
  });
  return { source, emitter, visuals };
}

function pointerAt(action: TouchButtonAction, id: number): PointerLike {
  return { id, ...center(action) };
}

describe('TouchSource — construcción', () => {
  it('implementa IInputSource (Liskov: intercambiable con KeyboardSource)', () => {
    const { source } = makeSource();
    const asSource: IInputSource = source;

    expect(asSource.name).toBe('touch');
    expect(asSource.getState()).toEqual({
      left: false,
      right: false,
      throttle: false,
      brake: false,
      turbo: false,
      drs: false,
    });
  });

  it('construye un visual por cada una de las 6 acciones, con su rect del layout', () => {
    const { visuals } = makeSource();

    expect(visuals.records.map((record) => record.action)).toEqual([...ALL_TOUCH_ACTIONS]);
    for (const record of visuals.records) {
      expect(record.rect).toEqual(LAYOUT[record.action]);
    }
  });
});

describe('TouchSource — attach / detach', () => {
  it('attach registra exactamente los 3 eventos de pointer', () => {
    const { source, emitter } = makeSource();

    source.attach();

    expect(emitter.onCalls).toEqual(['pointerdown', 'pointerup', 'pointerupoutside']);
  });

  it('attach es idempotente (no duplica listeners)', () => {
    const { source, emitter } = makeSource();

    source.attach();
    source.attach();

    expect(emitter.onCalls).toHaveLength(3);
  });

  it('detach quita los mismos 3 listeners con los mismos handlers', () => {
    const { source, emitter } = makeSource();

    source.attach();
    source.detach();

    expect(emitter.offCalls).toEqual(['pointerdown', 'pointerup', 'pointerupoutside']);
  });

  it('detach deja el estado en neutro aunque hubiera botones presionados', () => {
    const { source, emitter } = makeSource();
    source.attach();

    emitter.emit('pointerdown', pointerAt('left', 7));
    emitter.emit('pointerdown', pointerAt('throttle', 8));
    expect(source.getState().left).toBe(true);

    source.detach();

    expect(source.getState()).toEqual({
      left: false,
      right: false,
      throttle: false,
      brake: false,
      turbo: false,
      drs: false,
    });

    // Los listeners ya no están: emitir tras el detach no cambia nada.
    emitter.emit('pointerdown', pointerAt('right', 9));
    expect(source.getState().right).toBe(false);
  });

  it('detach + attach vuelve a escuchar (ciclo de vida de escena)', () => {
    const { source, emitter } = makeSource();

    source.attach();
    source.detach();
    source.attach();

    expect(emitter.onCalls).toHaveLength(6);
    emitter.emit('pointerdown', pointerAt('right', 3));
    expect(source.getState().right).toBe(true);
  });

  it('sin attach los eventos del emisor NO afectan el estado', () => {
    const { source, emitter } = makeSource();

    emitter.emit('pointerdown', pointerAt('left', 1));

    expect(source.getState().left).toBe(false);
  });
});

describe('TouchSource — multi-touch real (tracking por pointerId)', () => {
  it('un dedo presiona ◀ (id 7) y otro el acelerador (id 8): doblar + acelerar a la vez', () => {
    const { source, emitter } = makeSource();
    source.attach();

    emitter.emit('pointerdown', pointerAt('left', 7));
    emitter.emit('pointerdown', pointerAt('throttle', 8));

    const state = source.getState();
    expect(state.left).toBe(true);
    expect(state.throttle).toBe(true);
    expect(state.right).toBe(false);
  });

  it('soltar con OTRO id no suelta el botón (solo el dueño lo libera)', () => {
    const { source, emitter } = makeSource();
    source.attach();

    emitter.emit('pointerdown', pointerAt('left', 7));
    emitter.emit('pointerdown', pointerAt('throttle', 8));

    emitter.emit('pointerup', { id: 8, x: 0, y: 0 }); // id 8 soltó el throttle

    const afterWrongUp = source.getState();
    expect(afterWrongUp.left).toBe(true); // 7 sigue con ◀
    expect(afterWrongUp.throttle).toBe(false); // 8 era el dueño del GAS

    emitter.emit('pointerup', pointerAt('left', 7));
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

  it('un toque fuera de todos los botones no enciende nada', () => {
    const { source, emitter } = makeSource();
    source.attach();

    emitter.emit('pointerdown', { id: 2, x: WIDTH / 2, y: 600 });

    expect(source.getState()).toEqual({
      left: false,
      right: false,
      throttle: false,
      brake: false,
      turbo: false,
      drs: false,
    });
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

  it('los 6 botones pueden estar presionados a la vez (6 pointers)', () => {
    const { source, emitter } = makeSource();
    source.attach();

    ALL_TOUCH_ACTIONS.forEach((action, index) => {
      emitter.emit('pointerdown', pointerAt(action, index + 1));
    });

    const state = source.getState();
    expect(
      state.left && state.right && state.throttle && state.brake && state.turbo && state.drs,
    ).toBe(true);

    ALL_TOUCH_ACTIONS.forEach((action, index) => {
      emitter.emit('pointerup', pointerAt(action, index + 1));
    });
    expect(source.getState().left).toBe(false);
  });
});

describe('TouchSource — feedback visual (TouchButtonVisual)', () => {
  it('press enciende el visual; release del dueño lo apaga', () => {
    const { source, emitter, visuals } = makeSource();
    source.attach();

    emitter.emit('pointerdown', pointerAt('left', 7));
    emitter.emit('pointerup', pointerAt('left', 7));

    const record = visuals.records.find((candidate) => candidate.action === 'left');
    if (!record) {
      throw new Error('falta el visual de left');
    }
    expect(record.pressedCalls).toEqual([true, false]);
  });

  it('release con otro id NO toca el visual (sigue presionado)', () => {
    const { source, emitter, visuals } = makeSource();
    source.attach();

    emitter.emit('pointerdown', pointerAt('throttle', 7));
    emitter.emit('pointerup', { id: 99, x: 0, y: 0 });

    const record = visuals.records.find((candidate) => candidate.action === 'throttle');
    if (!record) {
      throw new Error('falta el visual de throttle');
    }
    expect(record.pressedCalls).toEqual([true]);
    expect(source.getState().throttle).toBe(true);
  });

  it('destroy desconecta, suelta todo y destruye los visuales (idempotente)', () => {
    const { source, emitter, visuals } = makeSource();
    source.attach();
    emitter.emit('pointerdown', pointerAt('turbo', 3));

    source.destroy();

    expect(source.getState().turbo).toBe(false);
    expect(visuals.records.every((record) => record.destroyed)).toBe(true);
    expect(() => source.destroy()).not.toThrow();
  });
});

describe('TouchSource — estado vs IInputState', () => {
  it('getState devuelve exactamente las claves del IInputState', () => {
    const { source } = makeSource();
    const state: IInputState = source.getState();

    expect(Object.keys(state).sort()).toEqual(
      ['brake', 'drs', 'left', 'right', 'throttle', 'turbo'].sort(),
    );
  });
});
