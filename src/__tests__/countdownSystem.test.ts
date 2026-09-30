import { describe, expect, it } from 'vitest';
import { COUNTDOWN } from '../config/balance';
import { CountdownSystem } from '../systems/CountdownSystem';

/**
 * Tests del CountdownSystem (Fase 7): secuencia 3-2-1-GO!, duraciones de los
 * tramos, fin de cuenta (label null → el mundo arranca), skip/reset y las
 * defensas de dt compartidas con el resto de los sistemas puros. Sin Phaser:
 * dt inyectado.
 */

describe('CountdownSystem — estado inicial', () => {
  it('arranca en "3", sin terminar, con elapsed 0', () => {
    const countdown = new CountdownSystem();

    expect(countdown.label).toBe('3');
    expect(countdown.isFinished).toBe(false);
    expect(countdown.elapsedSeconds).toBe(0);
    expect(countdown.totalSeconds).toBeCloseTo(COUNTDOWN.stepSeconds * 3 + COUNTDOWN.goSeconds);
  });
});

describe('CountdownSystem — secuencia de labels', () => {
  // Duraciones exactas en binario (0.25/0.125) para asertar los límites de
  // los tramos sin ruido de punto flotante. Cada update ≤ MAX_DT (0.25).
  const STEP = 0.25;
  const GO = 0.125;

  function newCountdown(): CountdownSystem {
    return new CountdownSystem(STEP, GO);
  }

  it('avanza 3 → 2 → 1 → GO! con los límites exactos de cada tramo', () => {
    const countdown = newCountdown();

    // A la mitad del primer tramo sigue "3".
    countdown.update(STEP * 0.5);
    expect(countdown.label).toBe('3');

    // Justo al cumplir el primer paso ya muestra "2".
    countdown.update(STEP * 0.5);
    expect(countdown.label).toBe('2');

    countdown.update(STEP * 0.5);
    expect(countdown.label).toBe('2');
    countdown.update(STEP * 0.5);
    expect(countdown.label).toBe('1');

    countdown.update(STEP * 0.5);
    expect(countdown.label).toBe('1');
    countdown.update(STEP * 0.5);
    expect(countdown.label).toBe('GO!');
  });

  it('termina tras el GO!: label null e isFinished true', () => {
    const countdown = newCountdown();
    countdown.skip();
    expect(countdown.isFinished).toBe(true);
    expect(countdown.label).toBeNull();

    const fresh = newCountdown();
    fresh.update(STEP); // completa "3"
    fresh.update(STEP); // completa "2"
    fresh.update(STEP); // completa "1"
    expect(fresh.label).toBe('GO!');
    fresh.update(GO); // completa el GO!
    expect(fresh.isFinished).toBe(true);
    expect(fresh.label).toBeNull();
  });

  it('la cuenta completa con pasos chiquitos recorre TODOS los labels en orden', () => {
    const countdown = new CountdownSystem();
    const seen: string[] = [];

    let guard = 0;
    while (!countdown.isFinished && guard < 5000) {
      const label = countdown.label;
      if (label !== null && seen[seen.length - 1] !== label) {
        seen.push(label);
      }
      countdown.update(1 / 60);
      guard += 1;
    }

    expect(seen).toEqual(['3', '2', '1', 'GO!']);
    expect(countdown.isFinished).toBe(true);
    expect(countdown.label).toBeNull();
  });
});

describe('CountdownSystem — skip, reset y clamp', () => {
  it('skip termina la cuenta al instante', () => {
    const countdown = new CountdownSystem();
    countdown.update(0.1);
    countdown.skip();

    expect(countdown.isFinished).toBe(true);
    expect(countdown.elapsedSeconds).toBe(countdown.totalSeconds);
    expect(countdown.label).toBeNull();
  });

  it('reset vuelve al inicio', () => {
    const countdown = new CountdownSystem();
    countdown.skip();
    countdown.reset();

    expect(countdown.isFinished).toBe(false);
    expect(countdown.elapsedSeconds).toBe(0);
    expect(countdown.label).toBe('3');
  });

  it('un dt gigante se acota: un tick no salta la cuenta completa', () => {
    const countdown = new CountdownSystem();

    countdown.update(60); // hitch gigante (pestaña en background, GC…)

    expect(countdown.isFinished).toBe(false);
    expect(countdown.elapsedSeconds).toBeCloseTo(0.25); // MAX_DT
  });

  it('update no hace nada después de terminar', () => {
    const countdown = new CountdownSystem();
    countdown.skip();

    countdown.update(1);
    countdown.update(Number.NaN);

    expect(countdown.elapsedSeconds).toBe(countdown.totalSeconds);
    expect(countdown.label).toBeNull();
  });
});

describe('CountdownSystem — defensas de dt y config', () => {
  it('dt NaN, cero o negativo es un no-op', () => {
    const countdown = new CountdownSystem();

    countdown.update(Number.NaN);
    countdown.update(0);
    countdown.update(-0.5);

    expect(countdown.elapsedSeconds).toBe(0);
    expect(countdown.label).toBe('3');
  });

  it('acepta duraciones custom (tests / ajustes de balance)', () => {
    // Cada update respeta el clamp MAX_DT = 0.25.
    const countdown = new CountdownSystem(0.2, 0.1);

    expect(countdown.totalSeconds).toBeCloseTo(0.7);
    countdown.update(0.2);
    expect(countdown.label).toBe('2');
    countdown.update(0.2);
    expect(countdown.label).toBe('1');
    countdown.update(0.2);
    expect(countdown.label).toBe('GO!');
    countdown.update(0.1);
    expect(countdown.isFinished).toBe(true);
  });

  it('config degenerada (NaN, 0, negativa) cae a los defaults', () => {
    const degenerate = new CountdownSystem(Number.NaN, 0);

    expect(degenerate.totalSeconds).toBeCloseTo(COUNTDOWN.stepSeconds * 3 + COUNTDOWN.goSeconds);
    expect(new CountdownSystem(-1, -2).totalSeconds).toBeCloseTo(
      COUNTDOWN.stepSeconds * 3 + COUNTDOWN.goSeconds,
    );
  });

  it('duraciones positivas chiquitas se respetan con piso mínimo (0.05 s)', () => {
    const tiny = new CountdownSystem(0.01, 0.01);

    expect(tiny.totalSeconds).toBeCloseTo(0.2);
  });
});
