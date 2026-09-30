import { describe, expect, it } from 'vitest';
import {
  DRS_COOLDOWN_SECONDS,
  DRS_DURATION_SECONDS,
  DRS_MULTIPLIER,
  DRS_SPEED_THRESHOLD,
  MAX_SPEED,
} from '../config/balance';
import { DrsSystem } from '../systems/DrsSystem';

/**
 * Tests del DrsSystem (Fase 3): umbral de recta, activación por flanco,
 * duración de 3 s, desactivación por velocidad, cooldown de 8 s y reset del
 * cooldown (pickup de Fase 4). Lógica pura: dt inyectado (1/60) y velocidad
 * provista por un closure mutable — sin Phaser.
 */

const DT = 1 / 60;
const THRESHOLD = MAX_SPEED * DRS_SPEED_THRESHOLD; // 315 px/s
const BELOW_THRESHOLD = 300; // velocidad base de crucero, bajo el umbral

/** Soporte mutable de velocidad: el "SpeedSystem" fake del test. */
function makeHarness(speed = MAX_SPEED): { ref: { value: number }; drs: DrsSystem } {
  const ref = { value: speed };
  return { ref, drs: new DrsSystem(() => ref.value) };
}

/** Simula `seconds` de ticks con dt fijo y el flag de DRS indicado. */
function tick(drs: DrsSystem, seconds: number, wants = false): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i += 1) {
    drs.update(DT, wants);
  }
}

/** Secuencia estándar de activación: suelta → presiona (flanco). */
function activate(drs: DrsSystem): void {
  drs.update(DT, false);
  drs.update(DT, true);
}

describe('DrsSystem — umbral de velocidad', () => {
  it('bajo el umbral está en off y no activa ni con presión nueva', () => {
    const { drs } = makeHarness(BELOW_THRESHOLD);

    expect(drs.state).toBe('off');

    activate(drs);

    expect(drs.state).toBe('off');
    expect(drs.isActive).toBe(false);
  });

  it('exactamente en el umbral NO activa (el plan pide estrictamente mayor)', () => {
    const { drs } = makeHarness(THRESHOLD);

    expect(drs.state).toBe('off');

    activate(drs);

    expect(drs.state).toBe('off');
  });

  it('sobre el umbral está ready (listo, esperando la presión)', () => {
    const { drs } = makeHarness(THRESHOLD + 1);

    drs.update(DT, false);

    expect(drs.state).toBe('ready');
    expect(drs.speedMultiplier).toBe(1);
  });
});

describe('DrsSystem — activación y duración', () => {
  it('activa con presión nueva sobre el umbral y multiplica ×1.25', () => {
    const { drs } = makeHarness();

    activate(drs);

    expect(drs.state).toBe('active');
    expect(drs.isActive).toBe(true);
    expect(drs.speedMultiplier).toBe(DRS_MULTIPLIER);
  });

  it('la activación es por flanco: mantener presionado de antemano no activa', () => {
    const { drs } = makeHarness();

    drs.update(DT, true); // "ya venía presionado" desde el arranque

    expect(drs.state).toBe('ready'); // no activó: no hay flanco
  });

  it('dura DRS_DURATION_SECONDS y después entra en cooldown solo', () => {
    const { drs } = makeHarness();

    activate(drs);
    tick(drs, DRS_DURATION_SECONDS - DT); // consume casi toda la duración

    expect(drs.state).toBe('active');

    drs.update(DT, false); // el tick que agota los 3 s

    expect(drs.state).toBe('cooldown');
    expect(drs.speedMultiplier).toBe(1);
    expect(drs.cooldownSeconds).toBeCloseTo(DRS_COOLDOWN_SECONDS);
  });

  it('se desactiva al bajar del umbral aunque no se haya agotado la duración', () => {
    const harness = makeHarness();

    activate(harness.drs);
    harness.ref.value = BELOW_THRESHOLD; // se frena bajo el umbral
    harness.drs.update(DT, false);

    expect(harness.drs.state).toBe('cooldown');
    expect(harness.drs.isActive).toBe(false);
  });

  it('al quedar exactamente en el umbral también se desactiva (corte estricto)', () => {
    const harness = makeHarness();

    activate(harness.drs);
    harness.ref.value = THRESHOLD;
    harness.drs.update(DT, false);

    expect(harness.drs.state).toBe('cooldown');
  });
});

describe('DrsSystem — cooldown', () => {
  it('bloquea la reactivación durante DRS_COOLDOWN_SECONDS', () => {
    const { drs } = makeHarness();

    activate(drs);
    tick(drs, DRS_DURATION_SECONDS + DT); // agota y entra en cooldown
    activate(drs); // intento de reactivar apenas entra en cooldown

    expect(drs.state).toBe('cooldown');

    tick(drs, DRS_COOLDOWN_SECONDS / 2); // la mitad del cooldown consumida
    activate(drs); // nuevo intento, sigue enfriando

    expect(drs.state).toBe('cooldown');
    expect(drs.cooldownSeconds).toBeGreaterThan(0);
  });

  it('tras DRS_COOLDOWN_SECONDS vuelve a ready (sin reactivarse solo)', () => {
    const { drs } = makeHarness();

    activate(drs);
    tick(drs, DRS_DURATION_SECONDS + DT); // agota y entra en cooldown
    tick(drs, DRS_COOLDOWN_SECONDS, true); // manteniendo el botón presionado

    expect(drs.state).toBe('ready'); // idle, NO activo: falta el flanco
    expect(drs.isActive).toBe(false);
    expect(drs.cooldownRatio).toBe(0);
    expect(drs.cooldownSeconds).toBe(0);
  });

  it('soltar y volver a presionar tras el cooldown reactiva', () => {
    const { drs } = makeHarness();

    activate(drs);
    tick(drs, DRS_DURATION_SECONDS + DRS_COOLDOWN_SECONDS + DT);
    activate(drs);

    expect(drs.state).toBe('active');
  });

  it('expone el progreso del cooldown (1 → recién entra, 0.5 a mitad, 0 al final)', () => {
    const { drs } = makeHarness();

    activate(drs);
    tick(drs, DRS_DURATION_SECONDS + DT);

    expect(drs.cooldownRatio).toBeCloseTo(1);

    tick(drs, DRS_COOLDOWN_SECONDS / 2);

    expect(drs.cooldownRatio).toBeCloseTo(0.5);
    // entra al cooldown un tick después del agotado → mitad menos un dt
    expect(drs.cooldownSeconds).toBeCloseTo(DRS_COOLDOWN_SECONDS / 2, 1);

    tick(drs, DRS_COOLDOWN_SECONDS / 2 + DT);

    expect(drs.cooldownRatio).toBe(0);
  });
});

describe('DrsSystem — resetCooldown (pickup de Fase 4)', () => {
  it('saca del cooldown al instante', () => {
    const { drs } = makeHarness();

    activate(drs);
    tick(drs, DRS_DURATION_SECONDS + DT); // cooldown en curso

    drs.resetCooldown();

    expect(drs.state).toBe('ready');
    expect(drs.cooldownSeconds).toBe(0);

    activate(drs);

    expect(drs.state).toBe('active'); // reactiva sin esperar el cooldown
  });

  it('si está activo restaura la duración completa', () => {
    const { drs } = makeHarness();

    activate(drs);
    tick(drs, DRS_DURATION_SECONDS - 1); // queda 1 s

    drs.resetCooldown();

    tick(drs, DRS_DURATION_SECONDS - DT); // habría expirado sin el reset

    expect(drs.state).toBe('active');

    drs.update(DT, false); // agota la duración restaurada

    expect(drs.state).toBe('cooldown');
  });
});

describe('DrsSystem — reset y defensas de dt', () => {
  it('reset deja idle, sin cooldown ni duración', () => {
    const { drs } = makeHarness();

    activate(drs);
    tick(drs, DRS_DURATION_SECONDS + DT);

    drs.reset();

    expect(drs.state).toBe('ready'); // idle sobre el umbral
    expect(drs.isActive).toBe(false);
    expect(drs.cooldownRatio).toBe(0);
  });

  it('dt NaN, negativo o infinito es un no-op', () => {
    const { drs } = makeHarness();

    drs.update(Number.NaN, true);
    drs.update(-1, true);
    drs.update(Number.POSITIVE_INFINITY, true);

    expect(drs.state).toBe('ready');
    expect(drs.isActive).toBe(false);
  });

  it('una velocidad no finita del proveedor se trata como bajo el umbral', () => {
    const { drs } = makeHarness(Number.NaN);

    expect(drs.state).toBe('off');
  });
});
