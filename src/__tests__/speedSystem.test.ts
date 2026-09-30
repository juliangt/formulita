import { describe, expect, it } from 'vitest';
import {
  BASE_SPEED,
  DRS_SPEED_THRESHOLD,
  MAX_SPEED,
  MIN_SPEED,
  SPEED_ACCELERATION,
  SPEED_COAST_DRAG,
  TURBO_MULTIPLIER,
  DRS_MULTIPLIER,
} from '../config/balance';
import { SpeedSystem, composeEffectiveSpeed } from '../systems/SpeedSystem';

/**
 * Tests del SpeedSystem (Fase 3): autonomía de la base, aceleración/freno
 * con clamps, coast hacia la base y defensas contra dt inválidos. Lógica
 * pura: dt inyectado (1/60), sin Phaser.
 */

const DT = 1 / 60;
const IDLE = { throttle: false, brake: false };
const THROTTLE = { throttle: true, brake: false };
const BRAKE = { throttle: false, brake: true };

/** Simula `seconds` de ticks con dt fijo. */
function tick(system: SpeedSystem, seconds: number, input = IDLE): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i += 1) {
    system.update(DT, input);
  }
}

describe('SpeedSystem — estado inicial y autonomía', () => {
  it('arranca a la velocidad base', () => {
    expect(new SpeedSystem().speed).toBe(BASE_SPEED);
  });

  it('avanza sola: sin input mantiene la velocidad (base autónoma)', () => {
    const system = new SpeedSystem();
    tick(system, 10);

    expect(system.speed).toBe(BASE_SPEED);
  });

  it('constructor con velocidad inválida (NaN/Infinity) vuelve a la base', () => {
    expect(new SpeedSystem(Number.NaN).speed).toBe(BASE_SPEED);
    expect(new SpeedSystem(Number.POSITIVE_INFINITY).speed).toBe(BASE_SPEED);
  });

  it('constructor con velocidad fuera de rango hace clamp', () => {
    expect(new SpeedSystem(9999).speed).toBe(MAX_SPEED);
    expect(new SpeedSystem(-50).speed).toBe(MIN_SPEED);
  });
});

describe('SpeedSystem — acelerador y freno', () => {
  it('el acelerador suma SPEED_ACCELERATION por segundo', () => {
    const system = new SpeedSystem();
    tick(system, 1, THROTTLE);

    expect(system.speed).toBeCloseTo(BASE_SPEED + SPEED_ACCELERATION);
  });

  it('el acelerador no supera MAX_SPEED nunca', () => {
    const system = new SpeedSystem();
    let observedMax = 0;
    for (let i = 0; i < 60 * 30; i += 1) {
      system.update(DT, THROTTLE);
      observedMax = Math.max(observedMax, system.speed);
    }

    expect(system.speed).toBe(MAX_SPEED);
    expect(observedMax).toBeCloseTo(MAX_SPEED, 6);
  });

  it('llega a MAX_SPEED y se queda clavada', () => {
    const system = new SpeedSystem();
    tick(system, 5, THROTTLE);
    tick(system, 5, THROTTLE);

    expect(system.speed).toBe(MAX_SPEED);
  });

  it('el freno resta SPEED_BRAKE_DECELERATION por segundo hasta MIN_SPEED', () => {
    const system = new SpeedSystem();
    tick(system, 1, BRAKE);

    expect(system.speed).toBe(MIN_SPEED); // 300 - 260 → clamp en 160
  });

  it('frenando desde MAX_SPEED llega a MIN_SPEED y no baja más', () => {
    const system = new SpeedSystem();
    tick(system, 5, THROTTLE);
    tick(system, 5, BRAKE);

    expect(system.speed).toBe(MIN_SPEED);
  });

  it('el freno gana si se pisa junto con el acelerador', () => {
    const system = new SpeedSystem();
    system.update(DT, { throttle: true, brake: true });

    expect(system.speed).toBeLessThan(BASE_SPEED);
  });
});

describe('SpeedSystem — coast hacia la base', () => {
  it('desde MAX_SPEED vuelve sola a BASE_SPEED a SPEED_COAST_DRAG por segundo', () => {
    const system = new SpeedSystem();
    tick(system, 2, THROTTLE); // 300 + 100*1.2 = 420
    tick(system, 1, IDLE); // -60

    expect(system.speed).toBeCloseTo(MAX_SPEED - SPEED_COAST_DRAG);

    tick(system, 3, IDLE); // 120 px de exceso / 60 px/s = 2 s exactos

    expect(system.speed).toBe(BASE_SPEED);
  });

  it('desde MIN_SPEED vuelve sola a subir hasta la base (sin sobrepasar)', () => {
    const system = new SpeedSystem();
    tick(system, 2, BRAKE);
    tick(system, 5, IDLE);

    expect(system.speed).toBe(BASE_SPEED);
  });
});

describe('SpeedSystem — reset y defensas de dt', () => {
  it('reset vuelve a la base desde cualquier estado', () => {
    const system = new SpeedSystem();
    tick(system, 5, THROTTLE);

    system.reset();

    expect(system.speed).toBe(BASE_SPEED);
  });

  it('dt NaN, negativo o infinito es un no-op', () => {
    const system = new SpeedSystem();

    system.update(Number.NaN, THROTTLE);
    expect(system.speed).toBe(BASE_SPEED);

    system.update(-1, THROTTLE);
    expect(system.speed).toBe(BASE_SPEED);

    system.update(Number.POSITIVE_INFINITY, THROTTLE);
    expect(system.speed).toBe(BASE_SPEED);
  });

  it('un dt gigante se acota: un tick avanza como mucho 0.25 s de aceleración', () => {
    const system = new SpeedSystem();

    system.update(5, THROTTLE); // pestañeo de pestaña / hitch

    expect(system.speed).toBeCloseTo(BASE_SPEED + SPEED_ACCELERATION * 0.25);
  });
});

describe('composeEffectiveSpeed — composición turbo × DRS', () => {
  it('sin multiplicadores devuelve la velocidad del SpeedSystem', () => {
    expect(composeEffectiveSpeed(BASE_SPEED, 1, 1)).toBe(BASE_SPEED);
  });

  it('compone turbo × DRS sobre la velocidad base', () => {
    expect(composeEffectiveSpeed(MAX_SPEED, TURBO_MULTIPLIER, 1)).toBeCloseTo(
      MAX_SPEED * TURBO_MULTIPLIER,
    );
    expect(composeEffectiveSpeed(MAX_SPEED, TURBO_MULTIPLIER, DRS_MULTIPLIER)).toBeCloseTo(
      MAX_SPEED * TURBO_MULTIPLIER * DRS_MULTIPLIER,
    );
  });

  it('hace clamp de la punta (nunca aceleración infinita)', () => {
    const ceiling = MAX_SPEED * TURBO_MULTIPLIER * DRS_MULTIPLIER;

    expect(composeEffectiveSpeed(99999, TURBO_MULTIPLIER, DRS_MULTIPLIER)).toBeCloseTo(ceiling);
    expect(composeEffectiveSpeed(MAX_SPEED, 10, 10)).toBeCloseTo(ceiling);
  });

  it('hace clamp del piso (MIN_SPEED) y sana NaN/valores inválidos', () => {
    expect(composeEffectiveSpeed(1, 1, 1)).toBe(MIN_SPEED);
    expect(composeEffectiveSpeed(Number.NaN, 1, 1)).toBe(BASE_SPEED);
    expect(composeEffectiveSpeed(MAX_SPEED, Number.NaN, 0.5)).toBe(MAX_SPEED); // mult inválido → 1
    expect(composeEffectiveSpeed(MAX_SPEED, 1, Number.POSITIVE_INFINITY)).toBe(MAX_SPEED);
  });
});

describe('SpeedSystem — umbral de DRS coherente', () => {
  it('el umbral (75% de MAX_SPEED) está entre la base y el máximo', () => {
    const threshold = MAX_SPEED * DRS_SPEED_THRESHOLD;

    expect(threshold).toBeGreaterThan(BASE_SPEED);
    expect(threshold).toBeLessThan(MAX_SPEED);
  });
});
