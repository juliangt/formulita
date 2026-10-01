import { describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import { SPAWN } from '../config/balance';
import { DifficultySystem } from '../systems/DifficultySystem';
import { SpawnScheduler, SpawnSystem } from '../systems/SpawnSystem';

/**
 * Tests de la inyección del SpawnSystem (M0 — pista determinista): el
 * multijugador pasa su PROPIO scheduler (alimentado por VirtualClock a paso
 * fijo) y una fuente de rng por entidad; sin opciones, el sistema arma el
 * scheduler default (rng = Math.random) y no asigna rng a nada — el modo de
 * un jugador no cambia en absoluto.
 *
 * La clase es un adaptador Phaser (grupos arcade + pools): se prueba con una
 * escena stub que solo provee `physics.add.group()`, manteniendo la carrera
 * por debajo de `initialWaveDelay` para no instanciar sprites (eso es
 * render/física real y se verifica corriendo el juego).
 */

const DT = 1 / 60;

/** Escena mínima: registra cuántas entidades llegaron a los grupos arcade. */
function createSceneStub(): { scene: Phaser.Scene; stats: { groupAddCount: number } } {
  const stats = { groupAddCount: 0 };
  const scene = {
    physics: {
      add: {
        group: vi.fn(() => ({
          add: () => {
            stats.groupAddCount += 1;
          },
        })),
      },
    },
  } as unknown as Phaser.Scene;
  return { scene, stats };
}

function createDeps(): { deps: { speedProvider: () => number; difficulty: DifficultySystem }; difficulty: DifficultySystem } {
  const difficulty = new DifficultySystem();
  return { deps: { speedProvider: () => 420, difficulty }, difficulty };
}

describe('SpawnSystem — scheduler inyectable', () => {
  it('el scheduler inyectado es EL que usa el sistema (se puede espiar)', () => {
    const { scene } = createSceneStub();
    const { deps, difficulty } = createDeps();
    const scheduler = new SpawnScheduler();
    const spy = vi.spyOn(scheduler, 'update');

    const system = new SpawnSystem(scene, deps, { scheduler });
    expect(system.scheduler).toBe(scheduler);

    system.update(DT);

    // El update del sistema delega 1:1 en el scheduler inyectado, con el dt,
    // la velocidad del proveedor y los params de la dificultad.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(DT, 420, difficulty.params);
  });

  it('la velocidad y los params fluyen del proveedor/dificultad en cada frame', () => {
    const { scene } = createSceneStub();
    let speed = 300;
    const difficulty = new DifficultySystem();
    const system = new SpawnSystem(
      scene,
      { speedProvider: () => speed, difficulty },
      { scheduler: new SpawnScheduler() },
    );
    const spy = vi.spyOn(system.scheduler, 'update');

    system.update(DT);
    speed = 900;
    difficulty.advance(75000); // rampa saturada entre frames
    system.update(DT);

    expect(spy).toHaveBeenNthCalledWith(1, DT, 300, expect.objectContaining({ spawnDensity: 1 }));
    expect(spy).toHaveBeenNthCalledWith(2, DT, 900, expect.objectContaining({ patternLevel: 3 }));
  });

  it('sin opciones: scheduler default, sin spawns y sin entidades creadas', () => {
    const { scene, stats } = createSceneStub();
    const { deps } = createDeps();

    const system = new SpawnSystem(scene, deps);

    // Default = SpawnScheduler recién creado (rng Math.random, sin rng por
    // entidad): mismo estado observable que uno fresco.
    expect(system.scheduler).toBeInstanceOf(SpawnScheduler);
    const fresh = new SpawnScheduler();
    expect(system.scheduler.timeToNextWave).toBe(fresh.timeToNextWave);
    expect(system.scheduler.blockedLanes).toEqual(fresh.blockedLanes);
    expect(system.scheduler.lastWavePattern).toBe(fresh.lastWavePattern);
    expect(system.scheduler.timeToNextWave).toBe(SPAWN.initialWaveDelay);

    // El update fluye igual que siempre: 1 s de carrera (< initialWaveDelay)
    // descuenta el timer de la primera oleada sin spawnear nada.
    for (let frame = 0; frame < 60; frame += 1) {
      system.update(DT);
    }
    expect(system.scheduler.timeToNextWave).toBeCloseTo(SPAWN.initialWaveDelay - 1.0, 5);
    expect(system.scheduler.blockedLanes).toEqual([]);
    expect(stats.groupAddCount).toBe(0); // ninguna entidad llegó a los grupos
  });

  it('con opciones parciales (solo entityRng) el scheduler sigue siendo default', () => {
    const { scene } = createSceneStub();
    const { deps } = createDeps();
    const entityRng = vi.fn();

    const system = new SpawnSystem(scene, deps, { entityRng });

    expect(system.scheduler).toBeInstanceOf(SpawnScheduler);
    // Sin rivales spawnneados (carrera corta), la fuente jamás se consulta.
    system.update(0.5);
    expect(entityRng).not.toHaveBeenCalled();
  });

  it('reset() devuelve el scheduler del sistema a la carrera nueva', () => {
    const { scene } = createSceneStub();
    const { deps } = createDeps();
    const system = new SpawnSystem(scene, deps);

    // 1.0 s de carrera: el timer baja (aún sin disparar la primera oleada,
    // que instanciaría sprites de Phaser reales).
    for (let frame = 0; frame < 60; frame += 1) {
      system.update(DT);
    }
    expect(system.scheduler.timeToNextWave).toBeLessThan(SPAWN.initialWaveDelay);

    system.reset();

    expect(system.scheduler.timeToNextWave).toBe(SPAWN.initialWaveDelay);
    expect(system.scheduler.blockedLanes).toEqual([]);
    expect(system.scheduler.lastWavePattern).toBeNull();
  });

  it('setEnabled(false) congela el pipeline (comportamiento preexistente)', () => {
    const { scene } = createSceneStub();
    const { deps } = createDeps();
    const system = new SpawnSystem(scene, deps, { scheduler: new SpawnScheduler() });
    const spy = vi.spyOn(system.scheduler, 'update');

    system.setEnabled(false);
    system.update(DT);

    expect(spy).not.toHaveBeenCalled();
    expect(system.isRunning).toBe(false);
  });
});
