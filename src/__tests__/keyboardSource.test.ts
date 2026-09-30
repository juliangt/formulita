import { describe, expect, it } from 'vitest';
import {
  KEYBOARD_BINDINGS,
  KeyboardSource,
  type KeyLike,
  type KeyboardPluginLike,
} from '../systems/KeyboardSource';
import type { IInputSource } from '../systems/InputSystem';

/**
 * Tests de KeyboardSource (Fase 2) con un FAKE del plugin de teclado de
 * Phaser (interfaz mínima inyectable `KeyboardPluginLike`): sin runtime real.
 */

type KeyCode = (typeof KEYBOARD_BINDINGS)[keyof typeof KEYBOARD_BINDINGS][number];

/** Fake del plugin de teclado: crea teclas conmutables y registra todo. */
function makeFakeKeyboard() {
  interface FakeKey {
    code: KeyCode;
    isDown: boolean;
  }
  const created: FakeKey[] = [];
  const removed: FakeKey[] = [];

  const plugin: KeyboardPluginLike = {
    addKey(key: string | number): KeyLike {
      const existing = created.find((candidate) => candidate.code === key);
      if (existing) {
        return existing;
      }
      const fakeKey: FakeKey = { code: key as KeyCode, isDown: false };
      created.push(fakeKey);
      return fakeKey;
    },
    removeKey(key: string | number | KeyLike): void {
      const fakeKey = created.find((candidate) => candidate === key);
      if (fakeKey) {
        removed.push(fakeKey);
      }
    },
  };

  return {
    plugin,
    created,
    removed,
    press(code: KeyCode): void {
      this.find(code).isDown = true;
    },
    release(code: KeyCode): void {
      this.find(code).isDown = false;
    },
    find(code: KeyCode): FakeKey {
      const key = created.find((candidate) => candidate.code === code);
      if (!key) {
        throw new Error(`Tecla ${code} no registrada por el fake`);
      }
      return key;
    },
  };
}

/** Teclas que el plan asigna a cada acción. */
const ALL_KEY_CODES: readonly KeyCode[] = [
  ...KEYBOARD_BINDINGS.left,
  ...KEYBOARD_BINDINGS.right,
  ...KEYBOARD_BINDINGS.throttle,
  ...KEYBOARD_BINDINGS.brake,
  ...KEYBOARD_BINDINGS.turbo,
  ...KEYBOARD_BINDINGS.drs,
];

describe('KEYBOARD_BINDINGS', () => {
  it('mapea el teclado del plan: ←→/A-D, Espacio, Shift, Z, X', () => {
    expect(KEYBOARD_BINDINGS.left).toEqual(['LEFT', 'A']);
    expect(KEYBOARD_BINDINGS.right).toEqual(['RIGHT', 'D']);
    expect(KEYBOARD_BINDINGS.throttle).toEqual(['SPACE']);
    expect(KEYBOARD_BINDINGS.brake).toEqual(['Z']);
    expect(KEYBOARD_BINDINGS.turbo).toEqual(['SHIFT']);
    expect(KEYBOARD_BINDINGS.drs).toEqual(['X']);
  });

  it('cubre las 6 acciones del IInputState y no repite teclas', () => {
    expect(Object.keys(KEYBOARD_BINDINGS).sort()).toEqual(
      ['brake', 'drs', 'left', 'right', 'throttle', 'turbo'].sort(),
    );
    expect(new Set(ALL_KEY_CODES).size).toBe(ALL_KEY_CODES.length);
  });
});

describe('KeyboardSource', () => {
  it('implementa IInputSource', () => {
    const source: IInputSource = new KeyboardSource(null);

    expect(source.name).toBe('keyboard');
  });

  it('attach registra exactamente las 8 teclas del mapeo', () => {
    const fake = makeFakeKeyboard();
    const source = new KeyboardSource(fake.plugin);

    source.attach();

    expect(fake.created.map((key) => key.code).sort()).toEqual([...ALL_KEY_CODES].sort());
  });

  it('attach es idempotente (no duplica teclas)', () => {
    const fake = makeFakeKeyboard();
    const source = new KeyboardSource(fake.plugin);

    source.attach();
    source.attach();

    expect(fake.created).toHaveLength(ALL_KEY_CODES.length);
  });

  it('getState en reposo devuelve todo false', () => {
    const fake = makeFakeKeyboard();
    const source = new KeyboardSource(fake.plugin);
    source.attach();

    expect(source.getState()).toEqual({
      left: false,
      right: false,
      throttle: false,
      brake: false,
      turbo: false,
      drs: false,
    });
  });

  it('A y LEFT encienden left', () => {
    const fake = makeFakeKeyboard();
    const source = new KeyboardSource(fake.plugin);
    source.attach();

    fake.press('A');
    expect(source.getState().left).toBe(true);
    expect(source.getState().right).toBe(false);

    fake.release('A');
    fake.press('LEFT');
    expect(source.getState().left).toBe(true);

    fake.release('LEFT');
    expect(source.getState().left).toBe(false);
  });

  it('D y RIGHT encienden right', () => {
    const fake = makeFakeKeyboard();
    const source = new KeyboardSource(fake.plugin);
    source.attach();

    fake.press('D');
    expect(source.getState().right).toBe(true);

    fake.release('D');
    fake.press('RIGHT');
    expect(source.getState().right).toBe(true);
  });

  it('Espacio = acelerador, Shift = turbo, Z = freno, X = DRS', () => {
    const fake = makeFakeKeyboard();
    const source = new KeyboardSource(fake.plugin);
    source.attach();

    fake.press('SPACE');
    expect(source.getState().throttle).toBe(true);

    fake.press('SHIFT');
    expect(source.getState().turbo).toBe(true);

    fake.press('Z');
    expect(source.getState().brake).toBe(true);

    fake.press('X');
    expect(source.getState().drs).toBe(true);

    // Acciones independientes: siguen todas activas a la vez.
    const state = source.getState();
    expect(state.throttle && state.turbo && state.brake && state.drs).toBe(true);
  });

  it('detach libera las teclas y limpia el estado (aunque el fake siga presionando)', () => {
    const fake = makeFakeKeyboard();
    const source = new KeyboardSource(fake.plugin);
    source.attach();
    fake.press('A');
    fake.press('SPACE');

    source.detach();

    expect(fake.removed).toHaveLength(fake.created.length);
    expect(source.getState()).toEqual({
      left: false,
      right: false,
      throttle: false,
      brake: false,
      turbo: false,
      drs: false,
    });
  });

  it('detach es idempotente y attach re-registra tras desconectar', () => {
    const fake = makeFakeKeyboard();
    const source = new KeyboardSource(fake.plugin);

    source.attach();
    source.detach();
    source.detach();
    expect(fake.removed).toHaveLength(fake.created.length);

    source.attach();
    fake.press('RIGHT');
    expect(source.getState().right).toBe(true);
  });

  it('sin teclado (null, escena headless) no conecta nada y reporta estado neutro', () => {
    const source = new KeyboardSource(null);

    expect(() => source.attach()).not.toThrow();
    expect(source.getState()).toEqual({
      left: false,
      right: false,
      throttle: false,
      brake: false,
      turbo: false,
      drs: false,
    });
  });
});
