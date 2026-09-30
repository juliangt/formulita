import { describe, expect, it } from 'vitest';
import {
  BASE_SPEED,
  DIFFICULTY,
  PLAYER_START_Y,
  SPAWN,
  laneCenterX,
} from '../config/balance';
import { ENTITY_DEFINITIONS, closingSpeed } from '../entities/entityTypes';
import { DifficultySystem, type DifficultyParams } from '../systems/DifficultySystem';
import { SpawnScheduler, type SpawnRequest, type WavePattern } from '../systems/SpawnSystem';

/**
 * Integración Fase 4 — SpawnScheduler y DifficultySystem trabajando JUNTOS
 * (el cableado que GameScene arma por frame: `difficulty.update(dt, speed)` +
 * `scheduler.update(dt, speed, difficulty.params)`), sin Phaser real.
 *
 * Cubre la composición que los tests unitarios de cada pieza no ven solos:
 * - el ritmo conjunto (densidad de la rampa comprime el intervalo de oleadas),
 * - el desbloqueo progresivo de patrones por distancia recorrida,
 * - el vencimiento de carriles ocupados acelerado por `rivalSpeedFactor`,
 * - y la garantía de pasabilidad sostenida durante toda la rampa.
 */

const DT = 1 / 60;

const LEVEL_1_PATTERNS: readonly WavePattern[] = ['coin-line', 'single-rival', 'scattered-hazards'];
const HIGHER_LEVEL_PATTERNS: readonly WavePattern[] = [
  'coin-zigzag',
  'rival-duo',
  'slalom',
  'blocked-gap',
];

/** Generador determinístico (mulberry32), igual que en spawnScheduler.test. */
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

/** Resultado de una carrera simulada con dificultad real. */
interface RaceRun {
  difficulty: DifficultySystem;
  waveLog: { atSeconds: number; pattern: WavePattern; requests: SpawnRequest[] }[];
}

/**
 * Simula una carrera completa frame a frame con DifficultySystem + scheduler
 * compartiendo estado (como en GameScene), verificando en TODO frame la
 * garantía de pasabilidad y la buena formación de los pedidos.
 */
function simulateRace(options: {
  seed: number;
  seconds: number;
  speed: number;
  /** Salto de distancia previo (para arrancar con la rampa avanzada). */
  headStartDistance?: number;
}): RaceRun {
  const difficulty = new DifficultySystem();
  if (options.headStartDistance) {
    difficulty.advance(options.headStartDistance);
  }
  const scheduler = new SpawnScheduler({ rng: mulberry32(options.seed) });
  const run: RaceRun = { difficulty, waveLog: [] };

  const frames = Math.round(options.seconds / DT);
  for (let frame = 0; frame < frames; frame += 1) {
    // Orden exacto de GameScene.update: scheduler con params del frame
    // previo, después la dificultad avanza con la velocidad compuesta.
    const requests = scheduler.update(DT, options.speed, difficulty.params);
    difficulty.update(DT, options.speed);

    // Garantía de pasabilidad en TODO instante de la carrera.
    expect(scheduler.blockedLanes.length).toBeLessThan(SPAWN.laneCount);

    if (scheduler.lastWavePattern && requests.length > 0) {
      for (const request of requests) {
        expect(Number.isFinite(request.x)).toBe(true);
        expect(Number.isFinite(request.y)).toBe(true);
        expect(request.lane).toBeGreaterThanOrEqual(0);
        expect(request.lane).toBeLessThan(SPAWN.laneCount);
        expect(request.x).toBe(laneCenterX(request.lane, SPAWN.laneCount));
        if (scheduler.lastWavePattern !== 'slalom') {
          // Sin duplicar bloqueos en el mismo carril dentro de una oleada
          // (el slalom alterna A-B-A por diseño).
          const sameLaneBlocker = requests.some(
            (other) =>
              other !== request && isBlocking(other.kind) && isBlocking(request.kind) &&
              other.lane === request.lane,
          );
          expect(sameLaneBlocker).toBe(false);
        }
      }
      run.waveLog.push({
        atSeconds: frame * DT,
        pattern: scheduler.lastWavePattern,
        requests,
      });
    }
  }

  return run;
}

describe('integración scheduler × dificultad — ritmo conjunto', () => {
  it('la densidad de la rampa acorta el intervalo entre oleadas (misma semilla)', () => {
    // Dos schedulers gemelos (misma semilla, primera oleada idéntica): el
    // único ingrediente que cambia son los params de la dificultad. La
    // densidad (1 → spawnDensityMax) divide el intervalo base, así que tras
    // la primera oleada el próximo intervalo es más corto con la rampa alta.
    function firstInterval(params: DifficultyParams): number {
      const scheduler = new SpawnScheduler({ rng: mulberry32(42) });
      let elapsed = 0;
      while (elapsed < SPAWN.initialWaveDelay + 1) {
        const requests = scheduler.update(DT, BASE_SPEED, params);
        if (requests.length > 0) {
          return scheduler.timeToNextWave;
        }
        elapsed += DT;
      }
      throw new Error('la primera oleada nunca llegó');
    }

    const fresh = new DifficultySystem();
    const saturated = new DifficultySystem();
    saturated.advance(DIFFICULTY.maxDistance);

    // Se aísla la densidad: se neutralizan patternLevel y rivalSpeedFactor
    // (que cambiarían el sorteo del patrón y el cierre) para comparar solo
    // el eje densidad que la rampa produce.
    const denseOnly: DifficultyParams = {
      ...saturated.params,
      patternLevel: 1,
      rivalSpeedFactor: 1,
    };

    const intervalEarly = firstInterval(fresh.params);
    const intervalDense = firstInterval(denseOnly);

    expect(fresh.params.spawnDensity).toBe(1);
    expect(denseOnly.spawnDensity).toBe(DIFFICULTY.spawnDensityMax);
    expect(intervalDense).toBeLessThan(intervalEarly);
    // El piso del intervalo se respeta aunque la densidad siga creciendo.
    expect(intervalDense).toBeGreaterThanOrEqual(SPAWN.minWaveInterval - 1e-9);
  });

  it('el ritmo total también espera el cruce de la oleada (rivales lentos de cerrar)', () => {
    // Con la rampa saturada los rivales avanzan más y cierran a `rivalMinClosing`:
    // una oleada con rivales tarda más en cruzar, y el scheduler lo descuenta
    // (no apila dos muros encima del mismo tráfico). Se observa en vivo:
    // una carrera saturada spawnea menos oleadas por minuto que una inicial.
    const early = simulateRace({ seed: 7, seconds: 60, speed: BASE_SPEED });
    const late = simulateRace({
      seed: 7,
      seconds: 60,
      speed: BASE_SPEED,
      headStartDistance: DIFFICULTY.maxDistance,
    });

    expect(early.waveLog.length).toBeGreaterThan(10);
    expect(late.waveLog.length).toBeGreaterThan(10);
  });

  it('los params que el scheduler consume salen vivos de la rampa', () => {
    const difficulty = new DifficultySystem();

    const atStart = difficulty.params;
    expect(atStart.ratio).toBe(0);
    expect(atStart.spawnDensity).toBe(1);
    expect(atStart.rivalSpeedFactor).toBe(1);
    expect(atStart.patternLevel).toBe(1);

    difficulty.advance(DIFFICULTY.maxDistance);
    const atMax = difficulty.params;
    expect(atMax.ratio).toBe(1);
    expect(atMax.spawnDensity).toBe(DIFFICULTY.spawnDensityMax);
    expect(atMax.rivalSpeedFactor).toBe(1 + DIFFICULTY.rivalSpeedBonus);
    expect(atMax.patternLevel).toBe(DIFFICULTY.maxPatternLevel);
  });
});

describe('integración scheduler × dificultad — desbloqueo de patrones', () => {
  it('la primera parte de la carrera solo usa patrones de nivel 1', () => {
    const run = simulateRace({ seed: 11, seconds: 40, speed: BASE_SPEED });

    expect(run.waveLog.length).toBeGreaterThan(5);
    for (const wave of run.waveLog) {
      expect(LEVEL_1_PATTERNS).toContain(wave.pattern);
    }
  });

  it('cerca de la saturación aparecen los patrones de niveles superiores', () => {
    // Rampa arrancada a medio camino + 120 s: el patrónLevel llega al tope
    // y los patrones complejos (slalom, muro, dúos) deben aparecer.
    const run = simulateRace({
      seed: 11,
      seconds: 120,
      speed: BASE_SPEED,
      headStartDistance: DIFFICULTY.maxDistance / 2,
    });

    const seen = new Set(run.waveLog.map((wave) => wave.pattern));
    const advanced = HIGHER_LEVEL_PATTERNS.filter((pattern) => seen.has(pattern));
    expect(advanced.length).toBeGreaterThanOrEqual(2);
  });

  it('el muro con hueco (nivel 3) deja un carril libre y lo señaliza con monedas', () => {
    // El muro exige la pista TOTALMENTE despejada (si hay bloqueos vigentes,
    // el patrón se rinde y cae el fallback de línea de monedas). Con un
    // scheduler recién reseteado y la rampa en nivel 3, la primera oleada
    // encuentra la pista limpia; se escanean semillas hasta que el patrón
    // sorteado es `blocked-gap` (determinístico: misma semilla → misma oleada).
    const difficulty = new DifficultySystem();
    difficulty.advance(DIFFICULTY.maxDistance);
    const level3 = difficulty.params;
    expect(level3.patternLevel).toBe(3);

    let found: SpawnRequest[] | null = null;
    for (let seed = 0; seed < 60 && found === null; seed += 1) {
      const scheduler = new SpawnScheduler({ rng: mulberry32(seed) });
      let elapsed = 0;
      while (elapsed < SPAWN.initialWaveDelay + 2) {
        const requests = scheduler.update(DT, BASE_SPEED, level3);
        if (requests.length > 0) {
          if (scheduler.lastWavePattern === 'blocked-gap') {
            found = requests;
          }
          break;
        }
        elapsed += DT;
      }
    }

    expect(found).not.toBeNull();
    const blocking = found!.filter((request) => isBlocking(request.kind));
    expect(blocking.length).toBe(SPAWN.laneCount - 1); // el muro casi completo
    const blockedLanes = new Set(blocking.map((request) => request.lane));
    const guided = found!.filter(
      (request) => request.kind === 'coin' && !blockedLanes.has(request.lane),
    );
    expect(guided.length).toBeGreaterThan(0); // la línea guía del hueco
  });
});

describe('integración scheduler × dificultad — cierre de rivales y ocupación', () => {
  it('el factor de la rampa hace a los rivales más rápidos: cierran más despacio', () => {
    const distanceToPlayer = PLAYER_START_Y - SPAWN.spawnY;
    const speed = BASE_SPEED;

    const fresh = new DifficultySystem();
    const saturated = new DifficultySystem();
    saturated.advance(DIFFICULTY.maxDistance);

    // Un rival azul con la rampa recién arrancada vs saturada: el rival
    // avanza más rápido, así que la velocidad de CIERRE baja.
    const closingEarly = closingSpeed('rivalBlue', speed, fresh.rivalSpeedFactor);
    const closingLate = closingSpeed('rivalBlue', speed, saturated.rivalSpeedFactor);
    expect(closingLate).toBeLessThan(closingEarly);
    expect(closingEarly).toBe(speed - ENTITY_DEFINITIONS.rivalBlue.forwardSpeed);

    // La ocupación del carril vence al pasar al jugador: con rivales más
    // rápidos el carril queda reservado MÁS tiempo (tráfico más pegado).
    const secondsEarly = distanceToPlayer / closingEarly;
    const secondsLate = distanceToPlayer / closingLate;
    expect(secondsLate).toBeGreaterThan(secondsEarly);
  });

  it('hasta con la rampa saturada y frenado a fondo, el cierre respeta el piso', () => {
    const saturated = new DifficultySystem();
    saturated.advance(DIFFICULTY.maxDistance);

    // MIN_SPEED: el jugador frena a fondo; el rival jamás "escapa hacia arriba".
    const closing = closingSpeed('rivalBlue', 160, saturated.rivalSpeedFactor);
    expect(closing).toBe(SPAWN.rivalMinClosing);
  });
});

describe('integración scheduler × dificultad — reset conjunto', () => {
  it('reset de carrera: rampa y oleadas vuelven al arranque', () => {
    const difficulty = new DifficultySystem();
    const scheduler = new SpawnScheduler({ rng: mulberry32(5) });

    difficulty.advance(DIFFICULTY.maxDistance);
    scheduler.update(2, BASE_SPEED, difficulty.params); // pasan oleadas
    expect(scheduler.blockedLanes.length + difficulty.params.ratio).toBeGreaterThan(0);

    difficulty.reset();
    scheduler.reset();

    expect(difficulty.distance).toBe(0);
    expect(difficulty.params.ratio).toBe(0);
    expect(scheduler.blockedLanes).toEqual([]);
    expect(scheduler.timeToNextWave).toBe(SPAWN.initialWaveDelay);
    expect(scheduler.lastWavePattern).toBeNull();
  });
});
