import { describe, expect, it, vi } from 'vitest';
import {
  NullSteerJoystickVisual,
  SteerJoystick,
  computeSteerJoystickRect,
  steerAxisForFinger,
  type SteerJoystickVisual,
} from '../systems/SteerJoystick';
import { TOUCH_HUD } from '../config/balance';

/**
 * Tests del joystick deslizable (issue #37): la lógica es PURA (sin Phaser,
 * mismo criterio que TouchButton) — tracking por pointerId con la invariante
 * de `PointerTracker`, hit-test por coordenadas, eje continuo [−1, 1] con
 * zona muerta, y feedback al visual inyectado.
 */

/** Rect de prueba: 272×124 (el footprint real de la zona en 720×1280). */
const RECT = { x: 40, y: 1112, width: 272, height: 124 };
const CENTER_X = RECT.x + RECT.width / 2; // 176
const CENTER_Y = RECT.y + RECT.height / 2;

/** Fake de visual que graba knob, presión y destroy. */
function makeFakeVisual() {
  const knobCalls: number[] = [];
  const pressedCalls: boolean[] = [];
  const visual: SteerJoystickVisual = {
    setKnob: (ratio: number) => knobCalls.push(ratio),
    setPressed: (pressed: boolean) => pressedCalls.push(pressed),
    destroy: vi.fn(),
  };
  return { knobCalls, pressedCalls, visual, destroy: visual.destroy };
}

describe('steerAxisForFinger (mapeo puro x → eje)', () => {
  it('el centro exacto da 0', () => {
    expect(steerAxisForFinger(CENTER_X, RECT, 0)).toBe(0);
  });

  it('es lineal y proporcional a la distancia al centro (issue #37)', () => {
    // A un cuarto del recorrido → −0.5; a un medio → −1 (sin zona muerta).
    expect(steerAxisForFinger(CENTER_X - RECT.width / 4, RECT, 0)).toBeCloseTo(-0.5, 12);
    expect(steerAxisForFinger(CENTER_X - RECT.width / 2, RECT, 0)).toBe(-1);
    expect(steerAxisForFinger(CENTER_X + RECT.width / 4, RECT, 0)).toBeCloseTo(0.5, 12);
    expect(steerAxisForFinger(CENTER_X + RECT.width / 2, RECT, 0)).toBe(1);
  });

  it('dedos que se salen de la zona clampean a ±1', () => {
    expect(steerAxisForFinger(RECT.x - 500, RECT, 0)).toBe(-1);
    expect(steerAxisForFinger(RECT.x + RECT.width + 500, RECT, 0)).toBe(1);
  });

  it('la zona muerta mantiene el eje en 0 y re-escala el resto del recorrido', () => {
    const dz = TOUCH_HUD.joystickDeadzonePx;

    // Dentro de la zona muerta: 0 (a un px del borde inclusive).
    expect(steerAxisForFinger(CENTER_X + dz, RECT, dz)).toBe(0);
    expect(steerAxisForFinger(CENTER_X - dz, RECT, dz)).toBe(0);

    // Recién salido: un valor chico pero no nulo (el ramp arranca en el borde).
    const justOut = steerAxisForFinger(CENTER_X + dz + 1, RECT, dz);
    expect(justOut).toBeGreaterThan(0);
    expect(justOut).toBeLessThan(0.1);

    // Y el tope sigue siendo ±1: la zona muerta NO acorta el recorrido útil.
    expect(steerAxisForFinger(CENTER_X + RECT.width / 2, RECT, dz)).toBe(1);
  });

  it('zona muerta degenerada (mayor o igual al semirrecorrido) lo anula todo: eje 0', () => {
    expect(steerAxisForFinger(RECT.x, RECT, RECT.width)).toBe(0);
    expect(steerAxisForFinger(RECT.x + RECT.width, RECT, RECT.width / 2)).toBe(0);
  });
});

describe('computeSteerJoystickRect (720×1280)', () => {
  it('ocupa el footprint de los viejos ◀ ▶: fila de abajo a la izquierda', () => {
    const zone = computeSteerJoystickRect(720, 1280);
    const { buttonSize, gap, marginX, marginBottom } = TOUCH_HUD;

    expect(zone.x).toBe(marginX);
    expect(zone.width).toBe(buttonSize * 2 + gap);
    expect(zone.height).toBe(buttonSize);
    expect(zone.y + zone.height).toBe(1280 - marginBottom);
    expect(zone.x + zone.width).toBeLessThanOrEqual(720);
  });

  it('respeta otros tamaños de lienzo sin salirse', () => {
    const zone = computeSteerJoystickRect(1080, 1920);
    expect(zone.x).toBeGreaterThanOrEqual(0);
    expect(zone.y).toBeGreaterThanOrEqual(0);
    expect(zone.x + zone.width).toBeLessThanOrEqual(1080);
    expect(zone.y + zone.height).toBeLessThanOrEqual(1920);
  });
});

describe('SteerJoystick — apoyar, deslizar y soltar', () => {
  it('press ubica el eje según la x del dedo y avisa al visual (knob + presión)', () => {
    const fake = makeFakeVisual();
    const joystick = new SteerJoystick({ rect: RECT, visual: fake.visual, deadzonePx: 14 });

    expect(joystick.press(7, CENTER_X)).toBe(true);
    expect(joystick.isPressed).toBe(true);
    expect(joystick.steerAxis).toBe(0); // centro = zona muerta
    expect(fake.pressedCalls).toEqual([true]);
    expect(fake.knobCalls).toEqual([0]);
  });

  it('move del dueño desliza el knob: el eje sigue al dedo', () => {
    const fake = makeFakeVisual();
    const joystick = new SteerJoystick({ rect: RECT, visual: fake.visual });

    joystick.press(7, CENTER_X);
    joystick.move(7, RECT.x);
    expect(joystick.steerAxis).toBe(-1);
    joystick.move(7, RECT.x + RECT.width);
    expect(joystick.steerAxis).toBe(1);
    expect(fake.knobCalls).toEqual([0, -1, 1]);
  });

  it('release del dueño vuelve a neutro: eje 0 y knob al centro', () => {
    const fake = makeFakeVisual();
    const joystick = new SteerJoystick({ rect: RECT, visual: fake.visual });

    joystick.press(7, RECT.x + RECT.width);
    expect(joystick.release(7)).toBe(true);

    expect(joystick.isPressed).toBe(false);
    expect(joystick.steerAxis).toBe(0);
    expect(fake.pressedCalls).toEqual([true, false]);
    expect(fake.knobCalls).toEqual([1, 0]);
  });

  it('press salta ABSOLUTO a la x del dedo (no hay que "agarrar" el knob)', () => {
    const fake = makeFakeVisual();
    const joystick = new SteerJoystick({ rect: RECT, visual: fake.visual });

    // El dedo apoya directamente cerca del tope izquierdo: giro completo ya.
    joystick.press(7, CENTER_X - RECT.width / 2 + 5);
    expect(joystick.steerAxis).toBeCloseTo(-1 + 5 / (RECT.width / 2), 5);
  });

  it('al soltar con el dedo fuera de la zona, el eje NO queda colgado (pasa por release igual)', () => {
    const fake = makeFakeVisual();
    const joystick = new SteerJoystick({ rect: RECT, visual: fake.visual });

    joystick.press(7, RECT.x);
    // El up llega con otra x (el dedo se deslizó fuera): el release es por id.
    expect(joystick.release(7)).toBe(true);
    expect(joystick.steerAxis).toBe(0);
  });
});

describe('SteerJoystick — invariante multi-touch (PointerTracker)', () => {
  it('REGLA CLAVE: otro dedo no roba la zona ni mueve el eje', () => {
    const fake = makeFakeVisual();
    const joystick = new SteerJoystick({ rect: RECT, visual: fake.visual });

    joystick.press(7, RECT.x);
    expect(joystick.press(8, RECT.x + RECT.width)).toBe(false);
    expect(joystick.move(8, RECT.x + RECT.width)).toBe(false);

    expect(joystick.steerAxis).toBe(-1); // el dueño (7) no fue movido
    expect(fake.pressedCalls).toEqual([true]); // el id 8 no duplicó feedback
  });

  it('soltar con otro id NO libera la zona ni el eje', () => {
    const fake = makeFakeVisual();
    const joystick = new SteerJoystick({ rect: RECT, visual: fake.visual });

    joystick.press(7, RECT.x);
    expect(joystick.release(8)).toBe(false);

    expect(joystick.isPressed).toBe(true);
    expect(joystick.steerAxis).toBe(-1);
    expect(fake.pressedCalls).toEqual([true]);
  });

  it('re-presionar con el MISMO id es idempotente (y reposiciona el knob)', () => {
    const joystick = new SteerJoystick({ rect: RECT });

    expect(joystick.press(7, RECT.x)).toBe(true);
    expect(joystick.press(7, RECT.x + RECT.width)).toBe(true);
    expect(joystick.pressedBy).toBe(7);
    expect(joystick.steerAxis).toBe(1);
  });

  it('tras soltar, otro pointer puede tomar la zona', () => {
    const joystick = new SteerJoystick({ rect: RECT });

    joystick.press(7, RECT.x);
    joystick.release(7);

    expect(joystick.press(8, RECT.x + RECT.width)).toBe(true);
    expect(joystick.steerAxis).toBe(1);
  });

  it('forceRelease suelta sin importar el dueño y vuelve a neutro', () => {
    const fake = makeFakeVisual();
    const joystick = new SteerJoystick({ rect: RECT, visual: fake.visual });

    joystick.press(7, RECT.x);
    joystick.forceRelease();

    expect(joystick.isPressed).toBe(false);
    expect(joystick.steerAxis).toBe(0);
    expect(fake.pressedCalls).toEqual([true, false]);
    expect(fake.knobCalls).toEqual([-1, 0]);
  });

  it('move sin zona presionada es un no-op seguro', () => {
    const joystick = new SteerJoystick({ rect: RECT });

    expect(joystick.move(7, CENTER_X)).toBe(false);
    expect(joystick.steerAxis).toBe(0);
  });
});

describe('SteerJoystick — hit-test', () => {
  it('contains: dentro sí, fuera no y respeta el padding de tolerancia', () => {
    const joystick = new SteerJoystick({ rect: RECT, hitPadding: 12 });

    expect(joystick.contains(CENTER_X, CENTER_Y)).toBe(true);
    expect(joystick.contains(RECT.x, RECT.y)).toBe(true); // esquina interna (borde inclusive)
    expect(joystick.contains(RECT.x + RECT.width - 1, RECT.y + RECT.height - 1)).toBe(true);
    expect(joystick.contains(RECT.x + RECT.width + 11, CENTER_Y)).toBe(true); // dentro del padding
    expect(joystick.contains(RECT.x + RECT.width + 12, CENTER_Y)).toBe(false); // borde exclusivo
    expect(joystick.contains(CENTER_X, RECT.y - 13)).toBe(false);
  });

  it('sin padding el hit-test es exacto al rect', () => {
    const joystick = new SteerJoystick({ rect: RECT });

    expect(joystick.contains(RECT.x - 1, CENTER_Y)).toBe(false);
    expect(joystick.contains(RECT.x + RECT.width, CENTER_Y)).toBe(false);
    expect(joystick.contains(RECT.x + RECT.width - 0.5, CENTER_Y)).toBe(true);
  });

  it('el press FUERA de la zona no cambia nada (la fuente hace el contains antes)', () => {
    const joystick = new SteerJoystick({ rect: RECT });

    // press no valida posición (responsabilidad de la fuente), pero un id
    // distinto sigue sin robar: la invariante es del tracker.
    joystick.press(1, CENTER_X);
    expect(joystick.press(2, CENTER_X)).toBe(false);
  });
});

describe('SteerJoystick — ciclo de vida', () => {
  it('destroy fuerza la liberación y destruye el visual una sola vez', () => {
    const fake = makeFakeVisual();
    const joystick = new SteerJoystick({ rect: RECT, visual: fake.visual });

    joystick.press(7, RECT.x);
    joystick.destroy();

    expect(joystick.isPressed).toBe(false);
    expect(joystick.steerAxis).toBe(0);
    expect(fake.destroy).toHaveBeenCalledTimes(1);
  });

  it('destroy sin uso también es seguro', () => {
    const fake = makeFakeVisual();
    const joystick = new SteerJoystick({ rect: RECT, visual: fake.visual });

    expect(() => joystick.destroy()).not.toThrow();
    expect(fake.pressedCalls).toEqual([]);
  });

  it('NullSteerJoystickVisual es un visual operable', () => {
    const visual: SteerJoystickVisual = new NullSteerJoystickVisual();

    expect(() => {
      visual.setKnob(0.5);
      visual.setPressed(true);
      visual.setPressed(false);
      visual.destroy();
    }).not.toThrow();
  });

  it('sin visual explícito usa el nulo: no explota con feedback', () => {
    const joystick = new SteerJoystick({ rect: RECT });

    expect(() => {
      joystick.press(1, RECT.x);
      joystick.move(1, CENTER_X);
      joystick.release(1);
      joystick.destroy();
    }).not.toThrow();
  });
});
