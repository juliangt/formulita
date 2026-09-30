import { describe, expect, it } from 'vitest';
import { DIFFICULTY, PLAYER_START_Y, SPAWN, laneCenterX } from '../config/balance';
import { ENTITY_DEFINITIONS, closingSpeed } from '../entities/entityTypes';
import { DifficultySystem } from '../systems/DifficultySystem';
import { SpawnScheduler, type SpawnRequest, type WavePattern } from '../systems/SpawnSystem';

/**
 * Tests del SpawnScheduler (Fase 4): scheduler 100% puro (dt/velocidad/
 * dificultad inyectados, rng semillado). Cubre la garantía de pasabilidad
 * (nunca se bloquean todos los carriles), el ritmo según velocidad y
 * densidad, los pesos por tipo y el desbloqueo de patrones por dificultad.
 */

const DT = 1 / 60;

const LEVEL_1_PATTERNS: readonly WavePattern[] = ['coin-line', 'single-rival', 'scattered-hazards'];
const ALL_PATTERNS: readonly WavePattern[] = [
  ...LEVEL_1_PATTERNS,
  'coin-zigzag',
  'rival-duo',
  'slalom',
  'blocked-gap',
];

/** Params literales (sin DifficultySystem) para tests enfocados. */
const EASY = { ratio: 0, rivalSpeedFactor: 1, spawnDensity: 1, patternLevel: 1 } as const;
const DENSE = { ratio: 1, rivalSpeedFactor: 1, spawnDensity: 2.2, patternLevel: 1 } as const;

/** Generador determinístico (mulberry32) para tests reproducibles. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function isBlocking(kind: SpawnRequest['kind']): boolean {
  const family = ENTITY_DEFINITIONS[kind].family;
  return family === 'rival' || family === 'hazard';
}

/** Registro de una oleada spawnneada. */
interface WaveLog {
  pattern: WavePattern;
  requests: SpawnRequest[];
}

interface SimStats {
  frames: number;
  waveLog: WaveLog[];
  kinds: Map<SpawnRequest['kind'], number>;
  blockedSamples: number;
}

/**
 * Simula `seconds` de carrera frame a frame, verificando en TODO frame la
 * garantía de pasabilidad y devolviendo el contenido spawnneado.
 */
function simulate(options: {
  seed: number;
  seconds: number;
  difficulty: DifficultySystem;
  speedAt: (frame: number) => number;
}): SimStats {
  const scheduler = new SpawnScheduler({ rng: mulberry32(options.seed) });
  const stats: SimStats = {
    frames: 0,
    waveLog: [],
    kinds: new Map(),
    blockedSamples: 0,
  };

  const frames = Math.round(options.seconds / DT);
  for (let frame = 0; frame < frames; frame += 1) {
    const speed = options.speedAt(frame);
    const before = scheduler.blockedLanes;

    // Invariante de pasabilidad en TODO frame: jamás están ocupados todos.
    expect(before.length).toBeLessThan(SPAWN.laneCount);

    const requests = scheduler.update(DT, speed, options.difficulty.params);
    options.difficulty.update(DT, speed);
    stats.frames += 1;
    stats.blockedSamples += before.length;

    if (requests.length > 0 && scheduler.lastWavePattern) {
      // El snapshot `before` es previo al tick (puede vencer ocupaciones por
      // distancia), así que la invariante observable por frame es: los
      // bloqueos de la oleada no saturan la pista y no duplican carriles
      // (salvo el slalom, que alterna A-B-A por diseño).
      const waveBlockingLanes = new Set<number>();
      for (const request of requests) {
        if (!isBlocking(request.kind)) {
          continue;
        }
        if (scheduler.lastWavePattern !== 'slalom') {
          expect(waveBlockingLanes.has(request.lane)).toBe(false);
        }
        waveBlockingLanes.add(request.lane);
      }
      // La garantía dura: en TODO instante queda al menos un carril libre.
      expect(scheduler.blockedLanes.length).toBeLessThan(SPAWN.laneCount);

      stats.waveLog.push({ pattern: scheduler.lastWavePattern, requests });
      for (const request of requests) {
        stats.kinds.set(request.kind, (stats.kinds.get(request.kind) ?? 0) + 1);
      }
    }
  }

  return stats;
}

describe('SpawnScheduler — timing', () => {
  it('no spawnea antes de initialWaveDelay y dispara la primera oleada después', () => {
    const scheduler = new SpawnScheduler({ rng: mulberry32(1) });

    // 1.0 s de 1.1: nada.
    for (let i = 0; i < 60; i += 1) {
      expect(scheduler.update(DT, 300, EASY)).toEqual([]);
    }
    expect(scheduler.timeToNextWave).toBeCloseTo(SPAWN.initialWaveDelay - 1.0, 5);

    // 0.2 s más: la primera oleada ya disparó.
    let fired = false;
    for (let i = 0; i < 12 && !fired; i += 1) {
      fired = scheduler.update(DT, 300, EASY).length > 0;
    }
    expect(fired).toBe(true);
  });

  it('dt inválido (NaN, 0, negativo) es un no-op estricto', () => {
    const scheduler = new SpawnScheduler({ rng: mulberry32(1) });

    scheduler.update(Number.NaN, 300, EASY);
    scheduler.update(0, 300, EASY);
    scheduler.update(-DT, 300, EASY);

    expect(scheduler.timeToNextWave).toBe(SPAWN.initialWaveDelay);
    expect(scheduler.blockedLanes).toEqual([]);
  });
});

describe('SpawnScheduler — pedidos bien formados', () => {
  it('todo request tiene x = centro de su carril e y sobre la línea de spawn', () => {
    const difficulty = new DifficultySystem();
    const { waveLog } = simulate({
      seed: 7,
      seconds: 60,
      difficulty,
      speedAt: (frame) => 510 + 330 * Math.sin(frame / 900),
    });

    expect(waveLog.length).toBeGreaterThan(0);
    for (const wave of waveLog) {
      for (const request of wave.requests) {
        expect(request.lane).toBeGreaterThanOrEqual(0);
        expect(request.lane).toBeLessThan(SPAWN.laneCount);
        expect(request.x).toBeCloseTo(laneCenterX(request.lane, SPAWN.laneCount), 6);
        expect(request.y).toBeLessThanOrEqual(SPAWN.spawnY + 1e-6);
      }
    }
  });

  it('las oleadas coin-line son monedas en un carril, espaciadas por coinGap', () => {
    const difficulty = new DifficultySystem();
    const { waveLog } = simulate({
      seed: 11,
      seconds: 90,
      difficulty,
      speedAt: () => 300,
    });

    const coinLines = waveLog.filter((wave) => wave.pattern === 'coin-line');
    expect(coinLines.length).toBeGreaterThan(0);

    for (const wave of coinLines) {
      // La oleada puede traer además un pickup de bonus; las monedas van juntas.
      const coins = wave.requests.filter((request) => request.kind === 'coin');
      const lanes = new Set(coins.map((request) => request.lane));
      expect(lanes.size).toBe(1); // un solo carril
      expect(coins.length).toBeGreaterThanOrEqual(SPAWN.coinLineMin);
      expect(coins.length).toBeLessThanOrEqual(SPAWN.coinLineMax);

      // Espaciado uniforme (la línea se extiende hacia arriba).
      const ys = coins.map((request) => request.y).sort((a, b) => b - a);
      for (let i = 1; i < ys.length; i += 1) {
        expect(ys[i - 1] - ys[i]).toBeCloseTo(SPAWN.coinGap, 6);
      }
    }
  });
});

describe('SpawnScheduler — garantía de pasabilidad', () => {
  it('60 s de carrera a velocidad variable: jamás se saturan los 4 carriles', () => {
    const difficulty = new DifficultySystem();
    const stats = simulate({
      seed: 42,
      seconds: 60,
      difficulty,
      speedAt: (frame) => 510 + 330 * Math.sin(frame / 900),
    });

    expect(stats.waveLog.length).toBeGreaterThan(10); // la simulación produjo contenido
    expect(stats.blockedSamples).toBeGreaterThan(0); // hubo carriles ocupados
  });

  it('5 minutos a dificultad máxima con frenadas: la garantía sigue en pie', () => {
    const difficulty = new DifficultySystem();
    difficulty.advance(DIFFICULTY.maxDistance); // dificultad máxima de arranque

    const stats = simulate({
      seed: 99,
      seconds: 300,
      difficulty,
      speedAt: (frame) => {
        // Punta con turbo/DRS simulada y frenadas recurrentes.
        const burst = Math.sin(frame / 300) > 0.7 ? 1.9 : 1;
        return Math.max(160, 420 * burst);
      },
    });

    expect(stats.waveLog.length).toBeGreaterThan(100);
  });
});

describe('SpawnScheduler — pesos por tipo', () => {
  it('la mezcla de rivales y hazards aproxima los pesos de entityTypes', () => {
    const difficulty = new DifficultySystem();
    difficulty.advance(DIFFICULTY.maxDistance); // todos los patrones desbloqueados

    const { kinds } = simulate({
      seed: 2026,
      seconds: 600,
      difficulty,
      speedAt: (frame) => 380 + 300 * Math.abs(Math.sin(frame / 700)),
    });

    const totalRivals =
      (kinds.get('rivalBlue') ?? 0) + (kinds.get('rivalGreen') ?? 0) + (kinds.get('rivalYellow') ?? 0);
    expect(totalRivals).toBeGreaterThan(80);

    const blueRatio = (kinds.get('rivalBlue') ?? 0) / totalRivals;
    const greenRatio = (kinds.get('rivalGreen') ?? 0) / totalRivals;
    const yellowRatio = (kinds.get('rivalYellow') ?? 0) / totalRivals;
    const rivalTotalWeight = 4 + 3 + 2;
    expect(Math.abs(blueRatio - 4 / rivalTotalWeight)).toBeLessThan(0.08);
    expect(Math.abs(greenRatio - 3 / rivalTotalWeight)).toBeLessThan(0.08);
    expect(Math.abs(yellowRatio - 2 / rivalTotalWeight)).toBeLessThan(0.08);

    const totalHazards = (kinds.get('debris') ?? 0) + (kinds.get('oil') ?? 0);
    expect(totalHazards).toBeGreaterThan(40);
    const debrisRatio = (kinds.get('debris') ?? 0) / totalHazards;
    expect(Math.abs(debrisRatio - 6 / 10)).toBeLessThan(0.1);
  });

  it('los pickups aparecen con la probabilidad de balance (ni 0 ni avalancha)', () => {
    const difficulty = new DifficultySystem();
    const { kinds, waveLog } = simulate({
      seed: 314,
      seconds: 300,
      difficulty,
      speedAt: () => 420,
    });

    const waves = waveLog.length;
    expect(waves).toBeGreaterThan(100);
    const pickups = (kinds.get('turbo') ?? 0) + (kinds.get('drs') ?? 0);
    // Cota amplia y estable: cientos de oleadas a pickupChance 0.16.
    expect(pickups).toBeGreaterThan(waves * 0.05);
    expect(pickups).toBeLessThan(waves * 0.35);
    expect(kinds.get('turbo') ?? 0).toBeGreaterThan(0);
    expect(kinds.get('drs') ?? 0).toBeGreaterThan(0);
  });
});

describe('SpawnScheduler — ritmo según velocidad y densidad', () => {
  it('a mayor velocidad, el intervalo entre oleadas es menor', () => {
    const slow = new SpawnScheduler({ rng: mulberry32(5) });
    const fast = new SpawnScheduler({ rng: mulberry32(5) });

    // Misma semilla y misma dificultad: la primera oleada es idéntica en ambas
    // (dispara donde dispare la acumulación float, se detecta por frame).
    let slowFiredAt = -1;
    let fastFiredAt = -1;
    for (let frame = 0; frame < 300 && (slowFiredAt < 0 || fastFiredAt < 0); frame += 1) {
      if (slowFiredAt < 0 && slow.update(DT, 180, EASY).length > 0) {
        slowFiredAt = frame;
      }
      if (fastFiredAt < 0 && fast.update(DT, 800, EASY).length > 0) {
        fastFiredAt = frame;
      }
    }

    expect(slowFiredAt).toBeGreaterThanOrEqual(0);
    expect(fastFiredAt).toBeGreaterThanOrEqual(0);
    expect(slow.lastWavePattern).toBe(fast.lastWavePattern);
    // Tras la misma oleada, a velocidad alta el próximo intervalo es menor.
    expect(slow.timeToNextWave).toBeGreaterThan(fast.timeToNextWave);
  });

  it('a mayor densidad (dificultad), el intervalo entre oleadas es menor', () => {
    const low = new SpawnScheduler({ rng: mulberry32(6) });
    const high = new SpawnScheduler({ rng: mulberry32(6) });

    let lowFiredAt = -1;
    let highFiredAt = -1;
    for (let frame = 0; frame < 300 && (lowFiredAt < 0 || highFiredAt < 0); frame += 1) {
      if (lowFiredAt < 0 && low.update(DT, 300, EASY).length > 0) {
        lowFiredAt = frame;
      }
      if (highFiredAt < 0 && high.update(DT, 300, DENSE).length > 0) {
        highFiredAt = frame;
      }
    }

    expect(lowFiredAt).toBeGreaterThanOrEqual(0);
    expect(highFiredAt).toBeGreaterThanOrEqual(0);
    expect(low.lastWavePattern).toBe(high.lastWavePattern);
    // Tras la misma oleada, la densidad 2.2 acorta el próximo intervalo.
    expect(low.timeToNextWave).toBeGreaterThan(high.timeToNextWave);
  });

  it('en equilibrio, a dificultad máxima spawnea más contenido que a base', () => {
    const low = simulate({
      seed: 77,
      seconds: 120,
      difficulty: new DifficultySystem(),
      speedAt: () => 420,
    });
    const highDifficulty = new DifficultySystem();
    highDifficulty.advance(DIFFICULTY.maxDistance);
    const high = simulate({
      seed: 77,
      seconds: 120,
      difficulty: highDifficulty,
      speedAt: () => 420,
    });

    const count = (stats: SimStats) =>
      stats.waveLog.reduce((sum, wave) => sum + wave.requests.length, 0);
    expect(count(high)).toBeGreaterThan(count(low));
  });
});

describe('SpawnScheduler — variedad de patrones según dificultad', () => {
  it('en nivel 1 solo aparecen los patrones básicos', () => {
    const scheduler = new SpawnScheduler({ rng: mulberry32(2026) });
    const seen = new Set<WavePattern>();

    for (let frame = 0; frame < 60 * 180; frame += 1) {
      scheduler.update(DT, 420, EASY);
      if (scheduler.lastWavePattern) {
        seen.add(scheduler.lastWavePattern);
      }
    }

    expect(seen.size).toBeGreaterThan(0);
    for (const pattern of seen) {
      expect(LEVEL_1_PATTERNS, `${pattern} no es de nivel 1`).toContain(pattern);
    }
  });

  it('a dificultad máxima se desbloquean los patrones avanzados', () => {
    const difficulty = new DifficultySystem();
    difficulty.advance(DIFFICULTY.maxDistance);

    const { waveLog } = simulate({
      seed: 555,
      seconds: 300,
      difficulty,
      speedAt: () => 420,
    });

    const patterns = new Set(waveLog.map((wave) => wave.pattern));
    for (const pattern of patterns) {
      expect(ALL_PATTERNS).toContain(pattern);
    }
    // Nivel 1 sigue apareciendo y algún patrón avanzado también.
    expect(patterns.size).toBeGreaterThanOrEqual(4);
    expect([...patterns].some((pattern) => !LEVEL_1_PATTERNS.includes(pattern))).toBe(true);
  });
});

describe('SpawnScheduler — reset', () => {
  it('limpia ocupaciones y timer de oleadas', () => {
    const scheduler = new SpawnScheduler({ rng: mulberry32(8) });
    const difficulty = new DifficultySystem();

    for (let frame = 0; frame < 60 * 30; frame += 1) {
      scheduler.update(DT, 300, difficulty.params);
    }

    scheduler.reset();

    expect(scheduler.blockedLanes).toEqual([]);
    expect(scheduler.timeToNextWave).toBe(SPAWN.initialWaveDelay);
    expect(scheduler.lastWavePattern).toBeNull();
  });
});

describe('SpawnScheduler — coherencia con el modelo de cierre', () => {
  it('el vencimiento de ocupaciones usa closingSpeed: la dificultad bloquea más rato', () => {
    const base = closingSpeed('rivalBlue', 300, 1);
    const max = closingSpeed('rivalBlue', 300, 1 + DIFFICULTY.rivalSpeedBonus);

    // A mayor dificultad el rival avanza más rápido, así que el jugador le
    // gana terreno más despacio: su carril queda ocupado MÁS tiempo (y en
    // compensación la densidad de oleados sube con spawnDensity).
    expect(max).toBeLessThan(base);
    expect(max).toBeGreaterThanOrEqual(SPAWN.rivalMinClosing);
    expect(base).toBeGreaterThan(SPAWN.rivalMinClosing);
    // Y la distancia que modela el scheduler es hasta la posición del auto.
    expect(PLAYER_START_Y - SPAWN.spawnY).toBeGreaterThan(0);
  });
});
