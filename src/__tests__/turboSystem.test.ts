import { describe, expect, it } from 'vitest';
import {
  TURBO_DRAIN_PER_SECOND,
  TURBO_MAX,
  TURBO_MULTIPLIER,
  TURBO_REGEN_PER_SECOND,
} from '../config/balance';
import { TurboSystem } from '../systems/TurboSystem';

/**
 * Tests del TurboSystem (Fase 3): activación con medidor, drenaje por dt,
 * corte automático al vaciarse (con latch anti-flicker), recarga pasiva y
 * refill del pickup. Lógica pura: dt inyectado (1/60), sin Phaser.
 */

const DT = 1 / 60;

/** Simula `seconds` de ticks con dt fijo, con el turbo pedido o no. */
function tick(turbo: TurboSystem, seconds: number, wants = false): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i += 1) {
    turbo.update(DT, wants);
  }
}

describe('TurboSystem — estado inicial', () => {
  it('arranca con el medidor lleno, inactivo y multiplicador 1', () => {
    const turbo = new TurboSystem();

    expect(turbo.levelValue).toBe(TURBO_MAX);
    expect(turbo.isActive).toBe(false);
    expect(turbo.speedMultiplier).toBe(1);
    expect(turbo.isEmptyLatch).toBe(false);
  });
});

describe('TurboSystem — activación y drenaje', () => {
  it('se activa con el flag del input y multiplica ×1.6', () => {
    const turbo = new TurboSystem();
    turbo.update(DT, true);

    expect(turbo.isActive).toBe(true);
    expect(turbo.speedMultiplier).toBe(TURBO_MULTIPLIER);
  });

  it('drena TURBO_DRAIN_PER_SECOND por segundo mientras está activo', () => {
    const turbo = new TurboSystem();
    tick(turbo, 0.5, true);

    expect(turbo.levelValue).toBeCloseTo(TURBO_MAX - TURBO_DRAIN_PER_SECOND * 0.5);
  });

  it('no regenera mientras está activo', () => {
    const turbo = new TurboSystem();
    tick(turbo, 1, true);

    expect(turbo.levelValue).toBeCloseTo(TURBO_MAX - TURBO_DRAIN_PER_SECOND); // no 76
  });

  it('se corta solo al vaciarse (≈3.5 s de uso total) y baja el multiplicador', () => {
    const turbo = new TurboSystem();
    tick(turbo, 3.4, true);

    expect(turbo.isActive).toBe(true); // aún queda medidor

    tick(turbo, 0.3, true); // supera los ~3.57 s de drenaje total

    expect(turbo.isActive).toBe(false);
    expect(turbo.speedMultiplier).toBe(1);
    expect(turbo.isEmptyLatch).toBe(true);
    // cortado: el medidor quedó al fondo (solo gotea la recarga del latch)
    expect(turbo.levelValue).toBeLessThan(TURBO_REGEN_PER_SECOND);
  });
});

describe('TurboSystem — latch anti-flicker', () => {
  it('no reactiva sin medidor, aunque el botón siga presionado', () => {
    const turbo = new TurboSystem();
    tick(turbo, 4, true); // se vacía con el botón presionado
    tick(turbo, 1, true); // el jugador no lo suelta

    expect(turbo.isActive).toBe(false);
    expect(turbo.levelValue).toBeLessThan(TURBO_MAX);
  });

  it('mientras dura el latch regenera lento pero no activa', () => {
    const turbo = new TurboSystem();
    tick(turbo, 4, true); // vaciado + latch

    const level = turbo.levelValue;
    tick(turbo, 1, true);

    expect(turbo.isActive).toBe(false);
    expect(turbo.levelValue).toBeCloseTo(level + TURBO_REGEN_PER_SECOND);
  });

  it('soltar el botón desarma el latch: puede reactivar cuando hay medidor', () => {
    const turbo = new TurboSystem();
    tick(turbo, 4, true); // vaciado + latch
    tick(turbo, 1, false); // regenera a ~12 sin latch

    turbo.update(DT, true);

    expect(turbo.isActive).toBe(true);
  });
});

describe('TurboSystem — recarga pasiva', () => {
  it('regenera TURBO_REGEN_PER_SECOND por segundo cuando no está activo', () => {
    const turbo = new TurboSystem();
    tick(turbo, 1, true); // baja a 72
    tick(turbo, 1, false);

    expect(turbo.levelValue).toBeCloseTo(TURBO_MAX - TURBO_DRAIN_PER_SECOND + TURBO_REGEN_PER_SECOND);
  });

  it('la recarga no supera TURBO_MAX', () => {
    const turbo = new TurboSystem();
    tick(turbo, 100, false);

    expect(turbo.levelValue).toBe(TURBO_MAX);
  });
});

describe('TurboSystem — refill (pickup de Fase 4)', () => {
  it('refill suma al medidor y desarma el latch', () => {
    const turbo = new TurboSystem();
    tick(turbo, 4, true); // vaciado + latch (con regeneración residual mínima)

    expect(turbo.isEmptyLatch).toBe(true);

    const level = turbo.levelValue;
    turbo.refill(50);

    expect(turbo.levelValue).toBeCloseTo(level + 50);
    expect(turbo.isEmptyLatch).toBe(false);

    turbo.update(DT, true); // el botón sigue presionado: reactiva al momento

    expect(turbo.isActive).toBe(true);
  });

  it('refill hace clamp al tope del medidor', () => {
    const turbo = new TurboSystem();
    turbo.refill(1000);

    expect(turbo.levelValue).toBe(TURBO_MAX);
  });

  it('refill con cantidad inválida (NaN, 0, negativa) es un no-op', () => {
    const turbo = new TurboSystem();
    tick(turbo, 1, true); // drena exactamente a 72 y queda activo

    turbo.refill(Number.NaN);
    turbo.refill(0);
    turbo.refill(-10);

    expect(turbo.levelValue).toBeCloseTo(TURBO_MAX - TURBO_DRAIN_PER_SECOND);
    expect(turbo.isActive).toBe(true); // el refill no apaga un turbo activo
  });
});

describe('TurboSystem — reset y defensas de dt', () => {
  it('reset deja el medidor lleno, inactivo y sin latch', () => {
    const turbo = new TurboSystem();
    tick(turbo, 2, true);

    turbo.reset();

    expect(turbo.levelValue).toBe(TURBO_MAX);
    expect(turbo.isActive).toBe(false);
    expect(turbo.isEmptyLatch).toBe(false);
  });

  it('dt NaN, negativo o infinito es un no-op', () => {
    const turbo = new TurboSystem();

    turbo.update(Number.NaN, true);
    turbo.update(-1, true);
    turbo.update(Number.POSITIVE_INFINITY, true);

    expect(turbo.levelValue).toBe(TURBO_MAX);
    expect(turbo.isActive).toBe(false);
  });

  it('un dt gigante se acota: un tick drena como mucho 0.25 s', () => {
    const turbo = new TurboSystem();

    turbo.update(10, true);

    expect(turbo.levelValue).toBeCloseTo(TURBO_MAX - TURBO_DRAIN_PER_SECOND * 0.25);
    expect(turbo.isActive).toBe(true);
  });
});
