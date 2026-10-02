import { describe, expect, it } from 'vitest';
import { GAME_WIDTH, GAME_HEIGHT } from '../../config/gameConfig';
import {
  computeRaceTouchLayout,
  circuitInputFromState,
  RACE_KEY_BINDINGS,
} from '../../race/raceControls';
import { computeTouchButtonLayout } from '../../systems/TouchButton';
import type { IInputState } from '../../systems/InputSystem';

/**
 * Tests del puente input → física de la RaceScene (issue #9, V1): el mapeo
 * puro `IInputState` → `CircuitInput` (issue #20: gas MANUAL — el throttle
 * pasa tal cual del estado fusionado), las teclas de la carrera y el layout
 * táctil heredado del modo BATALLA (◀ ▶ + GAS + FRENO).
 */

function state(partial: Partial<IInputState>): IInputState {
  return {
    left: false,
    right: false,
    throttle: false,
    brake: false,
    turbo: false,
    drs: false,
    ...partial,
  };
}

describe('circuitInputFromState — IInputState → CircuitInput', () => {
  it('el throttle es la acción del jugador: pasa tal cual del estado (issue #20)', () => {
    // Sin gas el puente NO lo pisa: la física desacelera por coastDrag.
    expect(circuitInputFromState(state({})).throttle).toBe(false);
    // Gas pisado (tecla W/↑ o botón GAS) llega a la física.
    expect(circuitInputFromState(state({ throttle: true })).throttle).toBe(true);
    // Gas + freno a la vez: el puente pasa ambos (prioriza la física del freno).
    expect(circuitInputFromState(state({ throttle: true, brake: true })).brake).toBe(true);
  });

  it('mapea el giro binario: izquierda −1, derecha +1, ambos se cancelan', () => {
    expect(circuitInputFromState(state({ left: true })).steer).toBe(-1);
    expect(circuitInputFromState(state({ right: true })).steer).toBe(1);
    expect(circuitInputFromState(state({ left: true, right: true })).steer).toBe(0);
    expect(circuitInputFromState(state({})).steer).toBe(0);
  });

  it('pasa el freno tal cual (la física le da prioridad sobre el gas)', () => {
    expect(circuitInputFromState(state({ brake: true })).brake).toBe(true);
    expect(circuitInputFromState(state({})).brake).toBe(false);
  });
});

describe('RACE_KEY_BINDINGS — teclado de la carrera', () => {
  it('girar: flechas o A/D; frenar: abajo, S o espacio; gas: W o flecha arriba (issue #20)', () => {
    expect(RACE_KEY_BINDINGS.left).toEqual(['LEFT', 'A']);
    expect(RACE_KEY_BINDINGS.right).toEqual(['RIGHT', 'D']);
    expect(RACE_KEY_BINDINGS.brake).toContain('DOWN');
    expect(RACE_KEY_BINDINGS.brake).toContain('S');
    expect(RACE_KEY_BINDINGS.brake).toContain('SPACE');
    expect(RACE_KEY_BINDINGS.throttle).toEqual(['W', 'UP']);
  });

  it('no existen bindings de turbo/drs (no existen en el circuito)', () => {
    expect(Object.keys(RACE_KEY_BINDINGS).sort()).toEqual(['brake', 'left', 'right', 'throttle']);
  });
});

describe('computeRaceTouchLayout — ◀ ▶ + GAS + FRENO', () => {
  it('reutiliza las casillas ◀ ▶, GAS y del freno del layout del modo BATALLA', () => {
    const race = computeRaceTouchLayout(GAME_WIDTH, GAME_HEIGHT);
    const full = computeTouchButtonLayout(GAME_WIDTH, GAME_HEIGHT);
    expect(race.left).toEqual(full.left);
    expect(race.right).toEqual(full.right);
    // El GAS ocupa SU casilla del modo batalla: esquina abajo-derecha, donde
    // llega el pulgar derecho (el freno queda a su lado, hacia el centro).
    expect(race.throttle).toEqual(full.throttle);
    expect(race.brake).toEqual(full.brake);
    expect(race.throttle.x).toBeGreaterThan(race.brake.x);
  });

  it('los cuatro botones quedan dentro del lienzo y sin superponerse', () => {
    const race = computeRaceTouchLayout(GAME_WIDTH, GAME_HEIGHT);
    const rects = Object.values(race);
    for (const rect of rects) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(GAME_WIDTH);
      expect(rect.y + rect.height).toBeLessThanOrEqual(GAME_HEIGHT);
    }
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i];
        const b = rects[j];
        const overlap =
          a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
        expect(overlap).toBe(false);
      }
    }
  });
});
