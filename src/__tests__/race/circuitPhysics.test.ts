import { describe, expect, it } from 'vitest';
import { CIRCUIT } from '../../config/balance';
import {
  CircuitPhysics,
  defaultCircuitInput,
  turnRateAtSpeed,
} from '../../race/circuitPhysics';
import type { CarState } from '../../race/circuitPhysics';
import { TrackPath } from '../../race/trackPath';

/**
 * Tests de la física arcade de circuito (issue #9, V0): clamp de velocidad,
 * pasto que recorta el techo, giro que decae con la velocidad, freno, avance
 * auto-acelerado y defensas contra dt inválido. dt inyectado, sin Phaser.
 *
 * Se usa un anillo amplio como pista: en los tramos cortos que simulan los
 * tests el auto se mantiene sobre el asfalto, así el clamp de velocidad se
 * valida sin interferencia del pasto (que tiene sus propios tests con
 * estados colocados a propósito fuera del eje). Issue #18: el anillo y el
 * ancho escalan ×2.5 con el mundo (R=10000, W=375) — a la nueva punta
 * (750 px/s) el auto sin girar se aparta del eje d²/2R: con la escala vieja
 * salía del asfalto durante el tick largo de 1.5 s.
 */

const DT = 1 / 60;
const RADIUS = 10000;
const gentle = new TrackPath(
  Array.from({ length: 16 }, (_, i) => {
    const theta = (2 * Math.PI * i) / 16;
    return { x: Math.cos(theta) * RADIUS, y: Math.sin(theta) * RADIUS };
  }),
);
const WIDTH = 375;
const physics = new CircuitPhysics(gentle, WIDTH);

/** Estado parado sobre el eje de la pista en s. */
function stateAtS(s: number, speed = 0, heading?: number): CarState {
  const sample = gentle.sample(s);
  return {
    x: sample.x,
    y: sample.y,
    heading: heading ?? sample.angle,
    speed,
  };
}

/** Punto del mundo a `lateral` px del eje (lado positivo de `project`). */
function stateAtLateral(s: number, lateral: number, speed = 0): CarState {
  const sample = gentle.sample(s);
  const nx = -Math.sin(sample.angle);
  const ny = Math.cos(sample.angle);
  return {
    x: sample.x + nx * lateral,
    y: sample.y + ny * lateral,
    heading: sample.angle,
    speed,
  };
}

/** Simula `seconds` de ticks a velocidad de reacción. */
function tick(state: CarState, seconds: number, input = defaultCircuitInput()): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i += 1) {
    physics.step(state, DT, input);
  }
}

describe('CircuitPhysics — velocidad', () => {
  it('auto-acelera: sin input explícito el acelerador viene pisado', () => {
    const state = stateAtS(100);
    physics.step(state, DT);
    expect(state.speed).toBeGreaterThan(0);
  });

  it('el acelerador satura en CIRCUIT.maxSpeed', () => {
    const state = stateAtS(100);
    tick(state, 1.5, { throttle: true, brake: false, steer: 0 });
    expect(state.speed).toBeCloseTo(CIRCUIT.maxSpeed, 5);
  });

  it('el freno frena fuerte: maxSpeed → 0 con brakeDeceleration', () => {
    const state = stateAtS(100, CIRCUIT.maxSpeed);
    tick(state, 0.5, { throttle: false, brake: true, steer: 0 });
    expect(state.speed).toBe(0);
  });

  it('el freno gana si se pisa junto con el acelerador', () => {
    const state = stateAtS(100, CIRCUIT.maxSpeed);
    tick(state, 0.25, { throttle: true, brake: true, steer: 0 });
    expect(state.speed).toBeLessThan(CIRCUIT.maxSpeed * 0.5);
  });

  it('sin input el roce decae la velocidad hacia 0', () => {
    const state = stateAtS(100, CIRCUIT.maxSpeed);
    tick(state, 0.5, { throttle: false, brake: false, steer: 0 });
    const expected = CIRCUIT.maxSpeed - CIRCUIT.coastDrag * 0.5;
    expect(state.speed).toBeCloseTo(expected, 5);
  });

  it('avanza en la dirección del heading', () => {
    const state = stateAtS(100, 200);
    const before = { x: state.x, y: state.y };
    const heading = state.heading;
    physics.step(state, DT);
    const moved = Math.hypot(state.x - before.x, state.y - before.y);
    // La velocidad del paso es la de entrada más la aceleración del frame.
    const expectedSpeed = Math.min(200 + CIRCUIT.acceleration * DT, CIRCUIT.maxSpeed);
    expect(moved).toBeCloseTo(expectedSpeed * DT, 4);
    expect(moved).toBeGreaterThan(200 * DT);
    expect(state.heading).toBeCloseTo(heading, 12);
  });
});

describe('CircuitPhysics — pasto', () => {
  it('fuera de pista el techo se recorta a maxSpeed × grassMaxSpeedFactor', () => {
    // Lateral muy por fuera de widthPx / 2, a punta de velocidad.
    const state = stateAtLateral(400, WIDTH, CIRCUIT.maxSpeed);
    expect(state.speed).toBe(CIRCUIT.maxSpeed);
    physics.step(state, DT);
    const ceiling = CIRCUIT.maxSpeed * CIRCUIT.grassMaxSpeedFactor;
    expect(state.speed).toBeLessThanOrEqual(ceiling + 1e-9);
  });

  it('en el pasto el acelerador no puede pasar del techo recortado', () => {
    const state = stateAtLateral(400, WIDTH, 0);
    tick(state, 1.5);
    expect(state.speed).toBeCloseTo(CIRCUIT.maxSpeed * CIRCUIT.grassMaxSpeedFactor, 5);
  });

  it('volver al asfalto restaura el techo de velocidad', () => {
    const grass = stateAtLateral(400, WIDTH, CIRCUIT.maxSpeed * CIRCUIT.grassMaxSpeedFactor);
    physics.step(grass, DT);
    expect(grass.speed).toBeCloseTo(CIRCUIT.maxSpeed * CIRCUIT.grassMaxSpeedFactor, 5);
    const asphalt = stateAtS(400, CIRCUIT.maxSpeed * CIRCUIT.grassMaxSpeedFactor);
    tick(asphalt, 1.5);
    expect(asphalt.speed).toBeCloseTo(CIRCUIT.maxSpeed, 5);
  });
});

describe('CircuitPhysics — giro', () => {
  it('turnRateAtSpeed decae de turnRateBase a turnRateAtMaxSpeed', () => {
    expect(turnRateAtSpeed(0)).toBeCloseTo(CIRCUIT.turnRateBase, 10);
    expect(turnRateAtSpeed(CIRCUIT.maxSpeed)).toBeCloseTo(CIRCUIT.turnRateAtMaxSpeed, 10);
    const mid = turnRateAtSpeed(CIRCUIT.maxSpeed / 2);
    expect(mid).toBeGreaterThan(CIRCUIT.turnRateAtMaxSpeed);
    expect(mid).toBeLessThan(CIRCUIT.turnRateBase);
  });

  it('a más velocidad, menos giro para el mismo input', () => {
    const slow = stateAtS(100, 60);
    const fast = stateAtS(100, CIRCUIT.maxSpeed);
    const input = { throttle: true, brake: false, steer: 1 as const };
    physics.step(slow, DT, input);
    physics.step(fast, DT, input);
    const baseHeading = gentle.sample(100).angle;
    const slowDelta = Math.abs(slow.heading - baseHeading);
    const fastDelta = Math.abs(fast.heading - baseHeading);
    expect(slowDelta).toBeGreaterThan(fastDelta);
  });

  it('steer se sanea: cualquier valor fuera de -1|0|1 no gira', () => {
    const state = stateAtS(100, CIRCUIT.maxSpeed);
    const heading = state.heading;
    physics.step(state, DT, { throttle: true, brake: false, steer: 7 as unknown as -1 | 0 | 1 });
    expect(state.heading).toBe(heading);
  });
});

describe('CircuitPhysics — defensas', () => {
  it('dt no finito es no-op estricto', () => {
    const state = stateAtS(100, 200);
    const snapshot = { ...state };
    physics.step(state, Number.NaN);
    physics.step(state, Number.POSITIVE_INFINITY);
    expect(state).toEqual(snapshot);
  });

  it('dt <= 0 es no-op estricto', () => {
    const state = stateAtS(100, 200);
    const snapshot = { ...state };
    physics.step(state, 0);
    physics.step(state, -DT);
    expect(state).toEqual(snapshot);
  });

  it('velocidad corrupta (NaN) arranca desde 0 sin propagar NaN', () => {
    const state = stateAtS(100, Number.NaN);
    physics.step(state, DT);
    expect(Number.isFinite(state.speed)).toBe(true);
    expect(Number.isFinite(state.x)).toBe(true);
    expect(Number.isFinite(state.y)).toBe(true);
  });

  it('dt gigante se acota al paso máximo (anti-espiral de la muerte)', () => {
    const state = stateAtS(100, 0);
    physics.step(state, 10);
    // Con dt acotado a MAX_DT=0.25 no puede saturar la velocidad en un paso.
    expect(state.speed).toBeLessThan(CIRCUIT.maxSpeed);
  });
});
