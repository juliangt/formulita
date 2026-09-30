import { describe, expect, it } from 'vitest';
import {
  BASE_SPEED,
  DRS_MULTIPLIER,
  DRS_SPEED_THRESHOLD,
  MAX_SPEED,
  MIN_SPEED,
  TURBO_MAX,
  TURBO_MULTIPLIER,
} from '../config/balance';
import { SpeedSystem, composeEffectiveSpeed } from '../systems/SpeedSystem';
import { TurboSystem } from '../systems/TurboSystem';
import { DrsSystem } from '../systems/DrsSystem';

/**
 * Test de integración de los tres sistemas de Fase 3 compuestos como en
 * GameScene: SpeedSystem (autónomo) + TurboSystem + DrsSystem, con la
 * velocidad final = Speed × turbo × DRS vía `composeEffectiveSpeed`.
 * Simulación de ticks de dt fijo (1/60), sin Phaser ni reloj real.
 */

const DT = 1 / 60;
/** Punta teórica: MAX × turbo × DRS. */
const TOP_SPEED = MAX_SPEED * TURBO_MULTIPLIER * DRS_MULTIPLIER;

/** Entrada completa que GameScene lee del InputSystem y reparte. */
interface RaceInput {
  throttle: boolean;
  brake: boolean;
  turbo: boolean;
  drs: boolean;
}

/** Arnes de carrera: la misma composición que hace GameScene, en limpio. */
class RaceHarness {
  readonly speed = new SpeedSystem();
  readonly turbo = new TurboSystem();
  readonly drs = new DrsSystem(() => this.speed.speed);

  /** Última velocidad compuesta (lo que scrollearía la pista). */
  effective = BASE_SPEED;

  /** Un frame de juego, en el mismo orden que GameScene.update. */
  step(input: RaceInput): number {
    this.speed.update(DT, input);
    this.turbo.update(DT, input.turbo);
    this.drs.update(DT, input.drs);
    this.effective = composeEffectiveSpeed(
      this.speed.speed,
      this.turbo.speedMultiplier,
      this.drs.speedMultiplier,
    );
    return this.effective;
  }

  /** `seconds` de frames con la misma entrada. */
  tick(seconds: number, input: RaceInput): void {
    const steps = Math.round(seconds / DT);
    for (let i = 0; i < steps; i += 1) {
      this.step(input);
    }
  }
}

const IDLE: RaceInput = { throttle: false, brake: false, turbo: false, drs: false };
const FULL_THROTTLE: RaceInput = { ...IDLE, throttle: true };

describe('integración Fase 3 — velocidad compuesta', () => {
  it('sin input la carrera avanza a la base (autonomía)', () => {
    const race = new RaceHarness();
    race.tick(5, IDLE);

    expect(race.effective).toBe(BASE_SPEED);
  });

  it('a fondo sin ayudas: la punta es MAX_SPEED (420 px/s)', () => {
    const race = new RaceHarness();
    race.tick(5, FULL_THROTTLE);

    expect(race.speed.speed).toBe(MAX_SPEED);
    expect(race.effective).toBe(MAX_SPEED);
  });

  it('el turbo multiplica ×1.6 la velocidad del SpeedSystem en el mismo frame', () => {
    const race = new RaceHarness();

    race.step({ ...FULL_THROTTLE, turbo: true });

    expect(race.turbo.isActive).toBe(true);
    expect(race.effective).toBeCloseTo(race.speed.speed * TURBO_MULTIPLIER);
    expect(race.effective).toBeGreaterThan(MAX_SPEED); // pega el empujón al instante
  });

  it('turbo + DRS juntos alcanzan la punta teórica de 840 px/s', () => {
    const race = new RaceHarness();

    // Acelera hasta el tope con turbo (sube por encima del umbral DRS).
    race.tick(2, { ...FULL_THROTTLE, turbo: true });
    race.step({ ...FULL_THROTTLE, turbo: true }); // suelta → aprieta (flanco DRS)
    race.step({ ...FULL_THROTTLE, turbo: true, drs: true });

    expect(race.drs.isActive).toBe(true);
    expect(race.speed.speed).toBe(MAX_SPEED);
    expect(race.effective).toBeCloseTo(TOP_SPEED); // 420 × 1.6 × 1.25 = 840
  });

  it('el DRS se activa apenas la velocidad supera el umbral de recta', () => {
    const race = new RaceHarness();

    race.step(FULL_THROTTLE);
    race.tick(0.1, FULL_THROTTLE); // 300 + 100*0.1 = 310 → aún bajo 315
    race.step({ ...FULL_THROTTLE, drs: true });

    expect(race.drs.isActive).toBe(false);

    race.step({ ...FULL_THROTTLE, drs: false });
    race.step({ ...FULL_THROTTLE, drs: true }); // 320 > 315 con flanco nuevo

    expect(race.drs.isActive).toBe(true);
    expect(race.effective).toBeCloseTo(race.speed.speed * DRS_MULTIPLIER);
  });

  it('el DRS dura 3 s y el turbo se drena en ≈3.57 s manteniendo todo', () => {
    const race = new RaceHarness();

    // Acelera con turbo hasta superar el umbral de DRS (315 px/s).
    race.tick(0.5, { ...FULL_THROTTLE, turbo: true });

    // DRS con flanco nuevo y el medidor de turbo aún con holgura.
    race.step({ ...FULL_THROTTLE, turbo: true, drs: false });
    race.step({ ...FULL_THROTTLE, turbo: true, drs: true });

    expect(race.drs.isActive).toBe(true);

    // A los 3 s el DRS se corta solo (el turbo sigue activo: le queda medidor).
    race.tick(3, { ...FULL_THROTTLE, turbo: true, drs: true });

    expect(race.drs.isActive).toBe(false);
    expect(race.drs.state).toBe('cooldown');
    expect(race.turbo.isActive).toBe(true);
    expect(race.effective).toBeCloseTo(race.speed.speed * TURBO_MULTIPLIER);

    // El turbo se agota poco después (~3.57 s de drenaje total) y la punta
    // vuelve a la velocidad pura del SpeedSystem. Con el botón mantenido,
    // el medidor queda al fondo (solo gotea la recarga del latch).
    race.tick(1, { ...FULL_THROTTLE, turbo: true });

    expect(race.turbo.isActive).toBe(false);
    expect(race.turbo.isEmptyLatch).toBe(true);
    expect(race.turbo.levelValue).toBeLessThan(10);
    expect(race.effective).toBeCloseTo(race.speed.speed);
  });

  it('frenar a fondo con turbo activo respeta el piso MIN_SPEED sin NaN', () => {
    const race = new RaceHarness();
    race.tick(1, { ...FULL_THROTTLE, turbo: true }); // sube con turbo

    race.tick(2, { brake: true, turbo: true, throttle: true, drs: false });

    expect(race.speed.speed).toBe(MIN_SPEED);
    expect(race.effective).toBeCloseTo(MIN_SPEED * TURBO_MULTIPLIER);
  });

  it('60 s de caos determinista: sin NaN, sin velocidades imposibles', () => {
    const race = new RaceHarness();
    // Patrón periódico que pasa por todos los caminos de los tres sistemas.
    const pattern: RaceInput[] = [
      FULL_THROTTLE,
      { ...FULL_THROTTLE, turbo: true },
      { ...FULL_THROTTLE, turbo: true, drs: true },
      IDLE,
      { ...IDLE, brake: true, turbo: true },
      { throttle: true, brake: true, turbo: true, drs: true },
      { ...FULL_THROTTLE, drs: true },
    ];

    for (let frame = 0; frame < 60 * 60; frame += 1) {
      const effective = race.step(pattern[frame % pattern.length]);

      expect(Number.isFinite(effective)).toBe(true);
      expect(effective).toBeGreaterThanOrEqual(MIN_SPEED);
      expect(effective).toBeLessThanOrEqual(TOP_SPEED);
      expect(Number.isFinite(race.speed.speed)).toBe(true);
      expect(race.speed.speed).toBeGreaterThanOrEqual(MIN_SPEED);
      expect(race.speed.speed).toBeLessThanOrEqual(MAX_SPEED);
      expect(Number.isFinite(race.turbo.levelValue)).toBe(true);
      expect(race.turbo.levelValue).toBeGreaterThanOrEqual(0);
      expect(race.turbo.levelValue).toBeLessThanOrEqual(TURBO_MAX);
      expect(race.drs.state).toMatch(/^(off|ready|active|cooldown)$/);
    }
  });

  it('el umbral de DRS consumido por la escena coincide con el del balance', () => {
    // La composición real usa el default del DrsSystem: 75% de MAX_SPEED.
    const race = new RaceHarness();
    race.tick(2, FULL_THROTTLE); // 420 > 315

    expect(race.speed.speed).toBeGreaterThan(MAX_SPEED * DRS_SPEED_THRESHOLD);
  });
});
