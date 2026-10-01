import { describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import { FIXED_VIRTUAL_STEP, VIRTUAL_SPEED } from '../config/balance';
import { mulberry32 } from '../net/roomRng';
import { DifficultySystem } from '../systems/DifficultySystem';
import { SpawnScheduler, SpawnSystem } from '../systems/SpawnSystem';
import { VirtualClock } from '../systems/VirtualClock';

/**
 * Tests M1 de las rutas virtuales del SpawnSystem: `consumeGenerationSteps`
 * (generación por pasos fijos de reloj virtual, lo que GameScene usa en
 * multi) y `updateMovement` (presentación por frame real sin generar). El
 * modo solo sigue usando `update(dt)` — cubierto por los tests existentes.
 */

const DT = 1 / 60;

/** Escena mínima (mismo stub que spawnSystemInjection.test.ts). */
function createSceneStub(): Phaser.Scene {
  return {
    physics: {
      add: {
        group: vi.fn(() => ({ add: () => undefined })),
      },
    },
  } as unknown as Phaser.Scene;
}

describe('SpawnSystem — consumeGenerationSteps (multi)', () => {
  it('conduce al scheduler con N pasos fijos a VIRTUAL_SPEED', () => {
    const scene = createSceneStub();
    const difficulty = new DifficultySystem();
    const scheduler = new SpawnScheduler();
    const spy = vi.spyOn(scheduler, 'update');

    const system = new SpawnSystem(scene, { speedProvider: () => 500, difficulty }, { scheduler });
    system.consumeGenerationSteps(3, difficulty.params);

    expect(spy).toHaveBeenCalledTimes(3);
    for (let call = 1; call <= 3; call += 1) {
      expect(spy).toHaveBeenNthCalledWith(call, FIXED_VIRTUAL_STEP, VIRTUAL_SPEED, difficulty.params);
    }
  });

  it('pasos nulos/fraccionarios/negativos no tocan el scheduler', () => {
    const scene = createSceneStub();
    const difficulty = new DifficultySystem();
    const scheduler = new SpawnScheduler();
    const spy = vi.spyOn(scheduler, 'update');

    const system = new SpawnSystem(scene, { speedProvider: () => 500, difficulty }, { scheduler });
    system.consumeGenerationSteps(0, difficulty.params);
    system.consumeGenerationSteps(-4, difficulty.params);
    system.consumeGenerationSteps(2.7, difficulty.params); // 2 pasos enteros

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('con setEnabled(false) la generación virtual también se congela', () => {
    const scene = createSceneStub();
    const difficulty = new DifficultySystem();
    const scheduler = new SpawnScheduler();
    const spy = vi.spyOn(scheduler, 'update');

    const system = new SpawnSystem(scene, { speedProvider: () => 500, difficulty }, { scheduler });
    system.setEnabled(false);
    system.consumeGenerationSteps(5, difficulty.params);

    expect(spy).not.toHaveBeenCalled();
  });

  it('integración con VirtualClock: misma distancia ⇒ mismos pasos de generación', () => {
    // Réplica del cableado de GameScene multi (reloj → pasos → sistema →
    // dificultad, en ese orden). La carrera se mantiene por debajo de la
    // primera oleada (initialWaveDelay virtual): lo que se prueba es la
    // CADENCIA de pasos, no el spawn (el dispatch real de sprites es
    // render/física y ya está cubierto por los tests de inyección; la
    // determinación de la pista a larga distancia la clava trackDeterminism).
    const runClient = (speedAt: (frame: number) => number): number[] => {
      const scene = createSceneStub();
      const difficulty = new DifficultySystem();
      const scheduler = new SpawnScheduler({ rng: mulberry32(4242) });
      const system = new SpawnSystem(scene, { speedProvider: () => 0, difficulty }, { scheduler });
      const spy = vi.spyOn(scheduler, 'update');

      const clock = new VirtualClock();
      let frame = 0;
      while (clock.distance < 300 && frame < 10000) {
        clock.addFrame(DT, speedAt(frame));
        let steps = clock.consumeSteps();
        while (steps > 0) {
          system.consumeGenerationSteps(1, difficulty.params);
          difficulty.update(FIXED_VIRTUAL_STEP, VIRTUAL_SPEED);
          steps -= 1;
        }
        frame += 1;
      }
      return [spy.mock.calls.length, clock.totalSteps, difficulty.distance];
    };

    const fast = runClient(() => 1008);
    const slow = runClient((f) => (Math.floor(f / 3) % 2 === 0 ? 190 : 1000));

    // Misma distancia ⇒ mismos pasos (± el corte del último frame) y la
    // dificultad virtual avanzó exactamente pasos × STEP_DISTANCE.
    expect(fast[0]).toBeGreaterThan(0);
    expect(Math.abs(fast[0] - slow[0])).toBeLessThanOrEqual(1);
    expect(fast[1]).toBe(fast[0]);
    expect(slow[1]).toBe(slow[0]);
    expect(Math.abs(fast[2] - slow[2])).toBeLessThan(20);
  });

  it('updateMovement() mueve por frame SIN generar oleadas', () => {
    const scene = createSceneStub();
    const difficulty = new DifficultySystem();
    const scheduler = new SpawnScheduler();
    const spy = vi.spyOn(scheduler, 'update');

    const system = new SpawnSystem(scene, { speedProvider: () => 500, difficulty }, { scheduler });
    system.updateMovement();

    expect(spy).not.toHaveBeenCalled(); // cero generación
  });

  it('update(dt) con dt = 0 es generación nula (no-op estricto del scheduler)', () => {
    const scene = createSceneStub();
    const difficulty = new DifficultySystem();
    const scheduler = new SpawnScheduler();
    const spy = vi.spyOn(scheduler, 'update');

    const system = new SpawnSystem(scene, { speedProvider: () => 500, difficulty }, { scheduler });
    system.update(0);

    expect(spy).toHaveBeenCalledWith(0, 500, difficulty.params);
    expect(scheduler.timeToNextWave).toBeGreaterThan(0); // no venció nada
  });
});
