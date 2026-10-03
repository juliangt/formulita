import { describe, expect, it } from 'vitest';
import { CIRCUIT } from '../../config/balance';
import { GAME_WIDTH, GAME_HEIGHT } from '../../config/gameConfig';
import {
  computeRaceTouchLayout,
  circuitInputFromState,
  RACE_KEY_BINDINGS,
} from '../../race/raceControls';
import { CircuitPhysics } from '../../race/circuitPhysics';
import type { CarState } from '../../race/circuitPhysics';
import { TrackPath } from '../../race/trackPath';
import { computeTouchButtonLayout } from '../../systems/TouchButton';
import { computeSteerJoystickRect } from '../../systems/SteerJoystick';
import type { IInputState } from '../../systems/InputSystem';

/**
 * Tests del puente input → física de la RaceScene (issue #9, V1): el mapeo
 * puro `IInputState` → `CircuitInput` (issue #20: gas MANUAL — el throttle
 * pasa tal cual del estado fusionado; issue #37: el giro sale de
 * `steerDirection`, eje analógico del joystick o fórmula binaria del
 * teclado), las teclas de la carrera y el layout táctil (joystick + GAS +
 * FRENO).
 *
 * Issue #20 (Fase 2): además el PUENTE COMPLETO — el `CircuitInput` que
 * produce `circuitInputFromState` entra a `CircuitPhysics.step` y mueve la
 * velocidad en la dirección esperada (sin gas desacelera por coastDrag, con
 * gas acelera). La física en sí vive en `circuitPhysics.test.ts`; acá sólo
 * se valida que el jugador llega pisado hasta ella.
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

  it('mapea el giro binario (teclado): izquierda −1, derecha +1, ambos se cancelan', () => {
    expect(circuitInputFromState(state({ left: true })).steer).toBe(-1);
    expect(circuitInputFromState(state({ right: true })).steer).toBe(1);
    expect(circuitInputFromState(state({ left: true, right: true })).steer).toBe(0);
    expect(circuitInputFromState(state({})).steer).toBe(0);
  });

  it('el eje analógico del joystick (issue #37) pasa tal cual: giro proporcional', () => {
    expect(circuitInputFromState(state({ steerAxis: -1 })).steer).toBe(-1);
    expect(circuitInputFromState(state({ steerAxis: 1 })).steer).toBe(1);
    // Medio deslizo = medio giro (la física lo escala al turn rate).
    expect(circuitInputFromState(state({ steerAxis: 0.5 })).steer).toBeCloseTo(0.5, 12);
    expect(circuitInputFromState(state({ steerAxis: -0.25 })).steer).toBeCloseTo(-0.25, 12);
    // Eje en zona muerta (0): cae a la fórmula binaria, como el teclado.
    expect(circuitInputFromState(state({ steerAxis: 0, right: true })).steer).toBe(1);
    expect(circuitInputFromState(state({ steerAxis: 0 })).steer).toBe(0);
  });

  it('pasa el freno tal cual (la física le da prioridad sobre el gas)', () => {
    expect(circuitInputFromState(state({ brake: true })).brake).toBe(true);
    expect(circuitInputFromState(state({})).brake).toBe(false);
  });
});

describe('circuitInputFromState → CircuitPhysics — el puente completo (issue #20)', () => {
  // Anillo amplio como pista (mismo criterio que circuitPhysics.test.ts): en
  // tramos cortos el auto queda sobre el asfalto y la integración sólo mide
  // el longitudinal.
  const DT = 1 / 60;
  const RADIUS = 10000;
  const ring = new TrackPath(
    Array.from({ length: 16 }, (_, i) => {
      const theta = (2 * Math.PI * i) / 16;
      return { x: Math.cos(theta) * RADIUS, y: Math.sin(theta) * RADIUS };
    }),
  );
  const physics = new CircuitPhysics(ring, 375);

  /** Avanza `seconds` con el input que produce el estado de jugador dado. */
  function drive(v0: number, seconds: number, input: IInputState): number {
    const s = ring.sample(100);
    const car: CarState = { x: s.x, y: s.y, heading: s.angle, speed: v0 };
    const circuit = circuitInputFromState(input);
    const steps = Math.round(seconds / DT);
    for (let i = 0; i < steps; i += 1) {
      physics.step(car, DT, circuit);
    }
    return car.speed;
  }

  it('sin gas ni freno la física DESACELERA por coastDrag (fin del auto-acelerado)', () => {
    const v0 = 400;
    const coasted = drive(v0, 0.5, state({}));
    expect(coasted).toBeLessThan(v0);
    // La baja es exactamente el roce de CIRCUIT: ni la frenada a fondo ni un
    // acelerador fantasma — coastDrag × tiempo.
    expect(coasted).toBeCloseTo(v0 - CIRCUIT.coastDrag * 0.5, 5);
  });

  it('con gas pisado la física ACELERA hacia maxSpeed', () => {
    const v0 = 300;
    const accelerated = drive(v0, 0.5, state({ throttle: true }));
    expect(accelerated).toBeGreaterThan(v0);
    // Sube por la aceleración de CIRCUIT, con techo en la punta del jugador.
    expect(accelerated).toBeCloseTo(
      Math.min(v0 + CIRCUIT.acceleration * 0.5, CIRCUIT.maxSpeed),
      5,
    );
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

describe('computeRaceTouchLayout — joystick + GAS + FRENO (issue #37)', () => {
  it('el joystick ocupa el footprint de los viejos ◀ ▶ y GAS/FRENO sus casillas del modo BATALLA', () => {
    const race = computeRaceTouchLayout(GAME_WIDTH, GAME_HEIGHT);
    const full = computeTouchButtonLayout(GAME_WIDTH, GAME_HEIGHT);
    expect(race.joystick).toEqual(computeSteerJoystickRect(GAME_WIDTH, GAME_HEIGHT));
    // El GAS ocupa SU casilla del modo batalla: esquina abajo-derecha, donde
    // llega el pulgar derecho (el freno queda a su lado, hacia el centro).
    expect(race.throttle).toEqual(full.throttle);
    expect(race.brake).toEqual(full.brake);
    expect(race.throttle.x).toBeGreaterThan(race.brake.x);
  });

  it('joystick y botones quedan dentro del lienzo y sin superponerse', () => {
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
