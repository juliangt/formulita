import { describe, expect, it } from 'vitest';
import { FIXED_VIRTUAL_STEP, VIRTUAL_SPEED } from '../config/balance';
import { parseMultiplayerInit } from '../net/protocol';
import { hashStringToSeed } from '../net/roomRng';
import { DifficultySystem } from '../systems/DifficultySystem';
import { buildRaceSystems, shouldPersistProgress } from '../systems/RaceSystems';
import { SpawnScheduler } from '../systems/SpawnSystem';
import { VirtualClock } from '../systems/VirtualClock';

/**
 * Tests de buildRaceSystems (M1): la construcción por modo que usa GameScene
 * en create(). Sin bootear la escena se verifica que:
 *
 * - SOLO (init null): difficulty fresca y NADA inyectado (el SpawnSystem
 *   queda con sus defaults de siempre — bit a bit igual al juego actual).
 * - MULTI: scheduler sembrado por seed + reloj virtual + rng por entidad,
 *   y el cableado produce la MISMA pista para la misma seed.
 */

const MULTI_INIT = parseMultiplayerInit({
  mode: 'multi',
  seed: 987654321,
  players: [
    { peerId: 'a', name: 'Ana', color: 1 },
    { peerId: 'b', name: 'Beto', color: 2 },
  ],
  myPeerId: 'a',
  roomWord: 'PARRILLA',
});

if (!MULTI_INIT) {
  throw new Error('el init multi de fixture debería parsear');
}

describe('buildRaceSystems — modo solo (default)', () => {
  it('devuelve difficulty fresca y ningún sistema multi', () => {
    const race = buildRaceSystems(null);

    expect(race.difficulty).toBeInstanceOf(DifficultySystem);
    expect(race.difficulty.distance).toBe(0);
    expect(race.scheduler).toBeUndefined();
    expect(race.virtualClock).toBeUndefined();
    expect(race.entityRng).toBeUndefined();
  });

  it('init multi INVÁLIDO (parseo → null) se comporta como solo', () => {
    // Así degrada GameScene: payload corrupto ⇒ carrera solo normal.
    const race = buildRaceSystems(parseMultiplayerInit({ mode: 'multi' }));
    expect(race.scheduler).toBeUndefined();
    expect(race.virtualClock).toBeUndefined();
  });
});

describe('buildRaceSystems — modo multi', () => {
  it('construye scheduler sembrado + reloj virtual + rng por entidad', () => {
    const race = buildRaceSystems(MULTI_INIT);

    expect(race.difficulty).toBeInstanceOf(DifficultySystem);
    expect(race.scheduler).toBeInstanceOf(SpawnScheduler);
    expect(race.virtualClock).toBeInstanceOf(VirtualClock);
    expect(typeof race.entityRng).toBe('function');
    // Scheduler fresco (esperando la primera oleada como siempre).
    expect(race.scheduler?.timeToNextWave).toBeGreaterThan(0);
  });

  it('misma seed ⇒ MISMA pista (dos builds, dos loops idénticos)', () => {
    const log = (race: ReturnType<typeof buildRaceSystems>): string[] => {
      const scheduler = race.scheduler!;
      const difficulty = race.difficulty;
      const waves: string[] = [];
      // 25 s virtuales a VIRTUAL_SPEED (~9000 px) cruzan varias oleadas.
      const totalSteps = Math.round(25 / FIXED_VIRTUAL_STEP);
      for (let step = 0; step < totalSteps; step += 1) {
        const requests = scheduler.update(FIXED_VIRTUAL_STEP, VIRTUAL_SPEED, difficulty.params);
        difficulty.update(FIXED_VIRTUAL_STEP, VIRTUAL_SPEED);
        for (const request of requests) {
          waves.push(`${request.kind}|${request.lane}|${request.x}|${request.y.toFixed(2)}`);
        }
      }
      return waves;
    };

    const first = log(buildRaceSystems(MULTI_INIT));
    const second = log(buildRaceSystems(MULTI_INIT));

    expect(first.length).toBeGreaterThan(10); // hay pista de sobra para comparar
    expect(first).toEqual(second);
  });

  it('seed distinta ⇒ pista distinta', () => {
    const run = (seed: number): string[] => {
      const race = buildRaceSystems(parseMultiplayerInit({ ...MULTI_INIT, seed })!);
      const scheduler = race.scheduler!;
      const difficulty = race.difficulty;
      const waves: string[] = [];
      const totalSteps = Math.round(25 / FIXED_VIRTUAL_STEP);
      for (let step = 0; step < totalSteps; step += 1) {
        for (const request of scheduler.update(FIXED_VIRTUAL_STEP, VIRTUAL_SPEED, difficulty.params)) {
          waves.push(`${request.kind}|${request.lane}`);
        }
        difficulty.update(FIXED_VIRTUAL_STEP, VIRTUAL_SPEED);
      }
      return waves;
    };

    const first = run(MULTI_INIT.seed);
    const second = run(hashStringToSeed('otra-carrera'));
    expect(first.length).toBeGreaterThan(10);
    expect(second).not.toEqual(first);
  });

  it('entityRng es determinista por (seed, spawnIndex) e independiente del índice', () => {
    const raceA = buildRaceSystems(MULTI_INIT);
    const raceB = buildRaceSystems(MULTI_INIT);

    // Mismo índice ⇒ mismo stream en ambos builds.
    expect(raceA.entityRng!('rival', 5)()).toBe(raceB.entityRng!('rival', 5)());
    expect(raceA.entityRng!('rival', 0)()).toBe(raceB.entityRng!('rival', 0)());
    // Índices distintos ⇒ streams distintos (sin colisiones triviales).
    expect(raceA.entityRng!('rival', 0)()).not.toBe(raceA.entityRng!('rival', 1)());
    // La familia no cambia la semilla (el índice manda).
    expect(raceA.entityRng!('coin', 7)()).toBe(raceB.entityRng!('rival', 7)());
  });
});

describe('shouldPersistProgress — el save es del modo solo (límite v1 §9)', () => {
  it('la carrera SOLO persiste monedas/récords; la multi NUNCA', () => {
    // isMulti es exactamente `multiInit !== null` (el campo con el que
    // GameScene decide todo lo demás por modo).
    expect(shouldPersistProgress(false)).toBe(true);
    expect(shouldPersistProgress(true)).toBe(false);
  });
});
