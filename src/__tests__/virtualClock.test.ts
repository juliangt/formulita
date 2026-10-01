import { describe, expect, it } from 'vitest';
import { BASE_SPEED, FIXED_VIRTUAL_STEP, MAX_SPEED, MIN_SPEED, VIRTUAL_SPEED } from '../config/balance';
import { VirtualClock } from '../systems/VirtualClock';

/**
 * Tests del VirtualClock (M0 — pista determinista): convierte el avance real
 * (dt × velocidad) en pasos virtuales fijos a velocidad constante, sin
 * perder distancia. La propiedad clave del multijugador: la MISMA distancia
 * recorrida produce los MISMOS pasos virtuales, sin importar el perfil de
 * velocidad ni el tamaño de los frames de cada dispositivo.
 */

/** Distancia que vale un paso virtual (px). */
const STEP_DISTANCE = VIRTUAL_SPEED * FIXED_VIRTUAL_STEP;

/** Corre una sesión de frames y devuelve los pasos totales consumidos. */
function runFrames(frames: ReadonlyArray<{ dt: number; speed: number }>): number {
  const clock = new VirtualClock();
  let steps = 0;
  for (const frame of frames) {
    clock.addFrame(frame.dt, frame.speed);
    steps += clock.consumeSteps();
  }
  return steps;
}

describe('VirtualClock — acumulación a paso fijo', () => {
  it('distancia exacta de k pasos emite exactamente k pasos', () => {
    const clock = new VirtualClock();
    clock.addFrame(FIXED_VIRTUAL_STEP, VIRTUAL_SPEED * 5); // 1 paso-tiempo a ×5
    expect(clock.consumeSteps()).toBe(5);
    expect(clock.consumeSteps()).toBe(0); // ya consumidos
    expect(clock.pending).toBeLessThan(1e-9);
  });

  it('el resto fraccionario NO se pierde entre frames', () => {
    const clock = new VirtualClock();
    // Cuartos de paso: 0.25 → 0.5 → 0.75 → 1.0 (paso al 4º frame).
    clock.addFrame(FIXED_VIRTUAL_STEP / 4, VIRTUAL_SPEED);
    expect(clock.consumeSteps()).toBe(0);
    expect(clock.pending).toBeCloseTo(STEP_DISTANCE * 0.25, 6);

    clock.addFrame(FIXED_VIRTUAL_STEP / 4, VIRTUAL_SPEED);
    expect(clock.consumeSteps()).toBe(0);

    clock.addFrame(FIXED_VIRTUAL_STEP / 4, VIRTUAL_SPEED);
    expect(clock.consumeSteps()).toBe(0);

    clock.addFrame(FIXED_VIRTUAL_STEP / 4, VIRTUAL_SPEED);
    expect(clock.consumeSteps()).toBe(1);
    expect(clock.pending).toBeLessThan(1e-9);
  });

  it('restos diminutos acumulados terminan completando su paso', () => {
    const clock = new VirtualClock();
    // 300 frames de un diezmilésimo de paso = 0.03 pasos… hasta que sí.
    let total = 0;
    for (let i = 0; i < 10000; i += 1) {
      clock.addFrame(FIXED_VIRTUAL_STEP / 10000, VIRTUAL_SPEED);
      total += clock.consumeSteps();
    }
    expect(total).toBe(1); // 10000 × 1/10000 = exactamente 1 paso
  });

  it('muchos frames chicos = pocos frames grandes (misma distancia, ±1 paso)', () => {
    const distance = STEP_DISTANCE * 37 + STEP_DISTANCE * 0.7;
    // Un frame gigante a velocidad constante.
    const oneBig = runFrames([{ dt: distance / 800, speed: 800 }]);
    // 4000 frames chicos a otra velocidad (misma distancia total).
    const manySmall = runFrames(
      Array.from({ length: 4000 }, () => ({
        dt: distance / 4000 / 460,
        speed: 460,
      })),
    );
    expect(Math.abs(oneBig - manySmall)).toBeLessThanOrEqual(1);
    expect(oneBig).toBe(37);
  });
});

describe('VirtualClock — LA propiedad clave: misma distancia ⇒ mismos pasos', () => {
  it('a fondo vs frenando: perfiles de velocidad distintos, pasos iguales', () => {
    const totalDistance = 60000; // px (≈ toda la rampa de dificultad)

    // Perfil A: acelera de MIN_SPEED a punta de turbo y mantiene.
    const accelerating = new VirtualClock();
    let distanceA = 0;
    let frames = 0;
    while (distanceA < totalDistance) {
      const speed = Math.min(MIN_SPEED + frames * 6, MAX_SPEED * 2);
      accelerating.addFrame(1 / 60, speed);
      accelerating.consumeSteps();
      distanceA = accelerating.distance;
      frames += 1;
    }

    // Perfil B: arranca a fondo y frena a fondo en oleadas (mucho más lento
    // en promedio → muchos más frames para la misma distancia).
    const braking = new VirtualClock();
    let distanceB = 0;
    frames = 0;
    while (distanceB < totalDistance) {
      const burst = Math.sin(frames / 240) > 0.5 ? MAX_SPEED : MIN_SPEED;
      braking.addFrame(1 / 60, burst);
      braking.consumeSteps();
      distanceB = braking.distance;
      frames += 1;
    }

    const expectedSteps = Math.floor(totalDistance / STEP_DISTANCE);
    expect(Math.abs(accelerating.totalSteps - braking.totalSteps)).toBeLessThanOrEqual(1);
    expect(accelerating.totalSteps).toBeGreaterThan(expectedSteps - 2);
    expect(accelerating.totalSteps).toBeLessThan(expectedSteps + 2);
  });

  it('frames de tamaños irregulares (framerate distinto) no driftan', () => {
    // Dos sesiones de la MISMA duración total y velocidad: una con frames
    // parejos, otra con dt erráticos (240 Hz, lag spikes de 110 ms…). El
    // reparto de la distancia en pasos no puede depender del framerate.
    const totalSeconds = 5.001; // 720 px/s × 5.001 s = 300.06 pasos ( lejos del borde )
    const speed = 720;

    const even = new VirtualClock();
    for (let i = 0; i < 300; i += 1) {
      even.addFrame(totalSeconds / 300, speed);
      even.consumeSteps();
    }

    const erratic = new VirtualClock();
    const pattern = [1 / 240, 1 / 240, 1 / 60, 0.11, 1 / 60, 1 / 30, 0.004, 1 / 120];
    let remaining = totalSeconds;
    let i = 0;
    while (remaining > 1e-9) {
      const dt = Math.min(pattern[i % pattern.length], remaining);
      erratic.addFrame(dt, speed);
      erratic.consumeSteps();
      remaining -= dt;
      i += 1;
    }

    expect(even.totalSteps).toBe(Math.floor((speed * totalSeconds) / STEP_DISTANCE));
    expect(Math.abs(even.totalSteps - erratic.totalSteps)).toBeLessThanOrEqual(1);
  });

  it('dt=0, negativo, NaN o Infinity: no-op estricto (sin pasos ni distancia)', () => {
    const clock = new VirtualClock();
    clock.addFrame(0, 500);
    clock.addFrame(-1 / 60, 500);
    clock.addFrame(Number.NaN, 500);
    clock.addFrame(Number.POSITIVE_INFINITY, 500);
    clock.addFrame(1 / 60, 0);
    clock.addFrame(1 / 60, -300);
    clock.addFrame(1 / 60, Number.NaN);
    clock.addFrame(1 / 60, Number.POSITIVE_INFINITY);

    expect(clock.distance).toBe(0);
    expect(clock.pending).toBe(0);
    expect(clock.consumeSteps()).toBe(0);
    expect(clock.totalSteps).toBe(0);
  });

  it('consumeSteps con acumulador vacío es 0 y no muta nada', () => {
    const clock = new VirtualClock();
    expect(clock.consumeSteps()).toBe(0);
    clock.addFrame(FIXED_VIRTUAL_STEP / 3, VIRTUAL_SPEED);
    expect(clock.consumeSteps()).toBe(0);
    expect(clock.totalSteps).toBe(0);
  });
});

describe('VirtualClock — contabilidad y reset', () => {
  it('pasos × distancia de paso + resto = distancia total (nada se pierde)', () => {
    const clock = new VirtualClock();
    // Distancia "fea" a velocidad variable.
    clock.addFrame(0.023, 457.3);
    clock.addFrame(0.011, 912.7);
    clock.addFrame(0.05, 88.1);
    clock.consumeSteps();

    const accounted = clock.totalSteps * STEP_DISTANCE + clock.pending;
    expect(Math.abs(accounted - clock.distance)).toBeLessThan(1e-6);
  });

  it('totalSteps acumula entre consumes y get distance refleja lo andado', () => {
    const clock = new VirtualClock();
    clock.addFrame(1, BASE_SPEED);
    expect(clock.totalSteps).toBe(0); // aún sin consumir
    expect(clock.consumeSteps()).toBe(Math.floor(1 / FIXED_VIRTUAL_STEP)); // 1 s / (1/30)
    expect(clock.totalSteps).toBe(30); // 1 s virtual a paso 1/30

    clock.addFrame(1, BASE_SPEED);
    expect(clock.consumeSteps()).toBe(30);
    expect(clock.totalSteps).toBe(60);
    expect(clock.distance).toBeCloseTo(BASE_SPEED * 2, 6);
  });

  it('reset devuelve el reloj a cero', () => {
    const clock = new VirtualClock();
    clock.addFrame(5, 800);
    clock.consumeSteps();
    expect(clock.totalSteps).toBeGreaterThan(0);

    clock.reset();
    expect(clock.distance).toBe(0);
    expect(clock.pending).toBe(0);
    expect(clock.totalSteps).toBe(0);
  });
});
