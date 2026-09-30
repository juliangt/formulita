import { describe, expect, it, vi } from 'vitest';
import {
  ALL_TOUCH_ACTIONS,
  NullTouchButtonVisual,
  PointerTracker,
  TouchButton,
  computeTouchButtonLayout,
  type TouchButtonRect,
  type TouchButtonVisual,
} from '../systems/TouchButton';
import { TOUCH_HUD } from '../config/balance';

/**
 * Tests del botón táctil (Fase 2): el tracking multi-touch por pointerId es
 * LÓGICA PURA — se testea con fake de pointer events, sin Phaser real.
 */

describe('PointerTracker (tracking por pointerId)', () => {
  it('empieza libre y press con un id lo presiona', () => {
    const tracker = new PointerTracker();

    expect(tracker.isPressed).toBe(false);
    expect(tracker.pressedBy).toBeNull();

    expect(tracker.press(7)).toBe(true);
    expect(tracker.isPressed).toBe(true);
    expect(tracker.pressedBy).toBe(7);
  });

  it('REGLA CLAVE: presionar con id 7 y soltar con otro id NO lo suelta', () => {
    const tracker = new PointerTracker();
    tracker.press(7);

    expect(tracker.release(8)).toBe(false);
    expect(tracker.isPressed).toBe(true);
    expect(tracker.pressedBy).toBe(7);
  });

  it('solo el pointer dueño lo suelta', () => {
    const tracker = new PointerTracker();
    tracker.press(7);

    expect(tracker.release(7)).toBe(true);
    expect(tracker.isPressed).toBe(false);
    expect(tracker.pressedBy).toBeNull();
  });

  it('otro dedo no roba un botón ya presionado', () => {
    const tracker = new PointerTracker();
    tracker.press(7);

    expect(tracker.press(8)).toBe(false);
    expect(tracker.pressedBy).toBe(7);
  });

  it('re-presionar con el mismo id es idempotente', () => {
    const tracker = new PointerTracker();

    expect(tracker.press(7)).toBe(true);
    expect(tracker.press(7)).toBe(true);
    expect(tracker.pressedBy).toBe(7);
  });

  it('tras soltar, otro pointer puede tomarlo', () => {
    const tracker = new PointerTracker();
    tracker.press(7);
    tracker.release(7);

    expect(tracker.press(8)).toBe(true);
    expect(tracker.pressedBy).toBe(8);
  });

  it('forceRelease libera sin importar el dueño y devuelve si estaba presionado', () => {
    const free = new PointerTracker();
    expect(free.forceRelease()).toBe(false);

    const held = new PointerTracker();
    held.press(42);
    expect(held.forceRelease()).toBe(true);
    expect(held.isPressed).toBe(false);
  });
});

/** Fake de visual que graba las llamadas a setPressed. */
function makeFakeVisual() {
  const calls: boolean[] = [];
  const visual: TouchButtonVisual = {
    setPressed: (pressed: boolean) => calls.push(pressed),
    destroy: vi.fn(),
  };
  return { calls, visual, destroy: visual.destroy };
}

/** Rect de prueba: 100×100 por defecto, en la esquina indicada. */
function rect(x: number, y: number, width = 100, height = 100): TouchButtonRect {
  return { x, y, width, height };
}

describe('TouchButton', () => {
  it('press avisa al visual y release del dueño lo devuelve a reposo', () => {
    const fake = makeFakeVisual();
    const button = new TouchButton({ action: 'throttle', rect: rect(0, 0), visual: fake.visual });

    button.press(7);
    expect(button.isPressed).toBe(true);
    expect(fake.calls).toEqual([true]);

    button.release(7);
    expect(button.isPressed).toBe(false);
    expect(fake.calls).toEqual([true, false]);
  });

  it('release con OTRO id no cambia el visual (botón sigue presionado)', () => {
    const fake = makeFakeVisual();
    const button = new TouchButton({ action: 'left', rect: rect(0, 0), visual: fake.visual });

    button.press(7);
    button.release(8);

    expect(button.isPressed).toBe(true);
    expect(fake.calls).toEqual([true]);
  });

  it('press de otro id no roba el botón ni duplica el feedback', () => {
    const fake = makeFakeVisual();
    const button = new TouchButton({ action: 'right', rect: rect(0, 0), visual: fake.visual });

    button.press(7);
    button.press(8);

    expect(button.isPressed).toBe(true);
    expect(fake.calls).toEqual([true]);
  });

  it('forceRelease resetea el visual', () => {
    const fake = makeFakeVisual();
    const button = new TouchButton({ action: 'turbo', rect: rect(0, 0), visual: fake.visual });

    button.press(7);
    button.forceRelease();

    expect(button.isPressed).toBe(false);
    expect(fake.calls).toEqual([true, false]);
  });

  it('destroy fuerza la liberación y destruye el visual una sola vez en estado', () => {
    const fake = makeFakeVisual();
    const button = new TouchButton({ action: 'drs', rect: rect(0, 0), visual: fake.visual });

    button.press(7);
    button.destroy();

    expect(button.isPressed).toBe(false);
    expect(fake.calls).toEqual([true, false]);
    expect(fake.destroy).toHaveBeenCalledTimes(1);
  });

  it('contains: dentro sí, fuera no y respeta el padding de tolerancia', () => {
    // Rect 100×100 en (200, 300).
    const button = new TouchButton({ action: 'left', rect: rect(200, 300), hitPadding: 12 });

    expect(button.contains(250, 350)).toBe(true);
    expect(button.contains(200, 300)).toBe(true); // esquina interna (borde inclusive)
    expect(button.contains(299, 399)).toBe(true);
    expect(button.contains(311, 411)).toBe(true); // hasta el borde + padding (exclusivo)
    expect(button.contains(100, 350)).toBe(false);
    expect(button.contains(250, 100)).toBe(false);
    expect(button.contains(312, 350)).toBe(false); // el borde + padding es exclusivo
    expect(button.contains(250, 412)).toBe(false);
  });

  it('sin padding el hit-test es exacto al rect', () => {
    const button = new TouchButton({ action: 'left', rect: rect(0, 0, 50, 50) });

    expect(button.contains(50, 50)).toBe(false); // borde externo exclusivo
    expect(button.contains(49.9, 49.9)).toBe(true);
  });

  it('sin visual explícito usa el nulo: no explota con feedback', () => {
    const button = new TouchButton({ action: 'left', rect: rect(0, 0) });

    expect(() => {
      button.press(1);
      button.release(1);
      button.destroy();
    }).not.toThrow();
  });

  it('NullTouchButtonVisual es un visual operable', () => {
    const visual: TouchButtonVisual = new NullTouchButtonVisual();

    expect(() => {
      visual.setPressed(true);
      visual.setPressed(false);
      visual.destroy();
    }).not.toThrow();
  });
});

describe('ALL_TOUCH_ACTIONS', () => {
  it('lista las 6 acciones del HUD en orden estable', () => {
    expect(ALL_TOUCH_ACTIONS).toEqual([
      'left',
      'right',
      'throttle',
      'brake',
      'turbo',
      'drs',
    ]);
  });
});

describe('computeTouchButtonLayout (720×1280)', () => {
  const layout = computeTouchButtonLayout(720, 1280);

  function rects(): TouchButtonRect[] {
    return ALL_TOUCH_ACTIONS.map((action) => layout[action]);
  }

  function overlap(a: TouchButtonRect, b: TouchButtonRect): boolean {
    return (
      a.x < b.x + b.width &&
      a.x + a.width > b.x &&
      a.y < b.y + b.height &&
      a.y + a.height > b.y
    );
  }

  it('devuelve un rect por cada acción', () => {
    expect(Object.keys(layout).sort()).toEqual([...ALL_TOUCH_ACTIONS].sort());
  });

  it('todos los botones quedan dentro del lienzo', () => {
    for (const r of rects()) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.width).toBeLessThanOrEqual(720);
      expect(r.y + r.height).toBeLessThanOrEqual(1280);
    }
  });

  it('los 6 botones tienen el tamaño del balance y no se superponen', () => {
    for (const r of rects()) {
      expect(r.width).toBe(TOUCH_HUD.buttonSize);
      expect(r.height).toBe(TOUCH_HUD.buttonSize);
    }
    const list = rects();
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        expect(overlap(list[i], list[j]), `botones ${i} y ${j} se superponen`).toBe(false);
      }
    }
  });

  it('◀ y ▶ viven en el cluster inferior izquierdo', () => {
    expect(layout.left.x).toBe(TOUCH_HUD.marginX);
    expect(layout.right.x).toBeGreaterThan(layout.left.x);
    expect(layout.left.y).toBe(layout.right.y);
    expect(layout.left.y + layout.left.height).toBe(1280 - TOUCH_HUD.marginBottom);
  });

  it('los botones de acción viven en el cluster inferior derecho (GAS en la esquina)', () => {
    expect(layout.throttle.x + layout.throttle.width).toBe(720 - TOUCH_HUD.marginX);
    expect(layout.brake.x).toBeLessThan(layout.throttle.x);
    expect(layout.turbo.y).toBeLessThan(layout.throttle.y);
    expect(layout.drs.y).toBe(layout.turbo.y);
    expect(layout.drs.x).toBe(layout.brake.x);
  });

  it('el layout respeta otros tamaños de lienzo sin salirse', () => {
    const other = computeTouchButtonLayout(1080, 1920);
    for (const action of ALL_TOUCH_ACTIONS) {
      const r = other[action];
      expect(r.x + r.width).toBeLessThanOrEqual(1080);
      expect(r.y + r.height).toBeLessThanOrEqual(1920);
    }
  });
});
