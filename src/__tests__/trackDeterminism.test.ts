import { describe, expect, it } from 'vitest';
import { DIFFICULTY, FIXED_VIRTUAL_STEP, MAX_SPEED, MIN_SPEED, VIRTUAL_SPEED } from '../config/balance';
import { ENTITY_DEFINITIONS } from '../entities/entityTypes';
import { deriveRng, hashStringToSeed, mulberry32 } from '../net/roomRng';
import { DifficultySystem } from '../systems/DifficultySystem';
import { SpawnScheduler } from '../systems/SpawnSystem';
import { VirtualClock } from '../systems/VirtualClock';

/**
 * EL test estrella de M0 (pista determinista): dos "sesiones" headless con
 * la misma seed de sala que recorren la MISMA distancia con perfiles de
 * velocidad reales DISTINTOS (una acelera a fondo, otra frena en oleadas,
 * otra va constante con framerate errático) generan EXACTAMENTE la misma
 * pista — misma secuencia de pedidos de spawn (kind/lane/x/y) a la misma
 * distancia acumulada, misma rampa de dificultad y mismas semillas por
 * rival. Y con otra seed, la pista difiere.
 *
 * El cableado es el que usará GameScene en multijugador (M1/M2):
 *
 *   por frame real:  clock.addFrame(dt, speedReal)
 *   por paso fijo:   scheduler.update(FIXED_VIRTUAL_STEP, VIRTUAL_SPEED, params)
 *                    difficulty.update(FIXED_VIRTUAL_STEP, VIRTUAL_SPEED)
 *
 * El scheduler NO se toca: sigue recibiendo update(dt, speed, difficulty),
 * solo que ahora dt es tiempo virtual y speed la constante VIRTUAL_SPEED.
 */

/** dt real de las sesiones "normales" (60 fps). */
const REAL_DT = 1 / 60;

/** Distancia que vale un paso virtual (px). */
const STEP_DISTANCE = VIRTUAL_SPEED * FIXED_VIRTUAL_STEP;

/** Kinds válidos para validar las entradas del log. */
const ENTITY_KIND_KEYS: readonly string[] = Object.keys(ENTITY_DEFINITIONS);

/**
 * Distancia total a recorrer: cruza DIFFICULTY.maxDistance para que la rampa
 * sature y se desbloqueen TODOS los patrones (nivel 3 incluido).
 */
const TOTAL_DISTANCE = 80000;

/**
 * Los perfiles con frames grandes frenan su loop con overshoot distinto, así
 * que el último trecho de pasos puede no estar en ambas sesiones: se compara
 * el log hasta esta distancia de seguridad (muy por debajo del overshoot
 * máximo de un frame: 0.11 s × 1008 px/s ≈ 111 px ≈ 9.3 pasos).
 */
const SAFE_DISTANCE = TOTAL_DISTANCE - 20 * STEP_DISTANCE;

/** Una oleada registrada: requests + distancia virtual al dispararse. */
interface WaveRecord {
  readonly atDistance: number;
  readonly entries: string[];
}

/** Sesión completa: log plano de oleadas (comparable con toEqual). */
interface SessionLog {
  waves: WaveRecord[];
  patterns: Set<string>;
  virtualSteps: number;
}

/**
 * Corre una sesión headless hasta acumular TOTAL_DISTANCE px reales.
 * `frameAt` describe la experiencia real del jugador (velocidad y dt de ese
 * cliente): es LO ÚNICO que varía entre sesiones con la misma seed.
 */
function runSession(
  seed: number,
  frameAt: (frame: number) => { dt: number; speed: number },
): SessionLog {
  const scheduler = new SpawnScheduler({ rng: mulberry32(seed) });
  const clock = new VirtualClock();
  const difficulty = new DifficultySystem();
  const log: SessionLog = { waves: [], patterns: new Set(), virtualSteps: 0 };

  // Espejo del contador global de spawns del SpawnSystem (seeds por rival).
  let spawnIndex = 0;

  let frame = 0;
  while (clock.distance < TOTAL_DISTANCE && frame < 500000) {
    const { dt, speed } = frameAt(frame);
    clock.addFrame(dt, speed);

    let steps = clock.consumeSteps();
    while (steps > 0) {
      // Orden de GameScene: el scheduler consume los params del frame previo.
      const requests = scheduler.update(FIXED_VIRTUAL_STEP, VIRTUAL_SPEED, difficulty.params);
      difficulty.update(FIXED_VIRTUAL_STEP, VIRTUAL_SPEED);
      log.virtualSteps += 1;
      steps -= 1;

      if (requests.length > 0) {
        const atDistance = log.virtualSteps * STEP_DISTANCE;
        // Espejo del dispatch real: cada pedido avanza el contador global
        // ANTES de adquirir, así que el rival i-ésimo del pool de la sala
        // usa la semilla (seed, spawnIndex + i).
        const entries = requests.map((request, requestIndex) => {
          const base = `${request.kind}|lane${request.lane}|x${request.x}|y${request.y}`;
          if (ENTITY_DEFINITIONS[request.kind].family !== 'rival') {
            return base;
          }
          // El rival recibe su rng sembrado por índice de spawn (como hará
          // SpawnSystem con entityRng): se registra su primer draw para
          // verificar que también es idéntico entre sesiones.
          const roll = deriveRng(seed, spawnIndex + requestIndex)();
          return `${base}|r${roll.toFixed(9)}`;
        });
        spawnIndex += requests.length;
        log.waves.push({ atDistance, entries });
        if (scheduler.lastWavePattern) {
          log.patterns.add(scheduler.lastWavePattern);
        }
      }
    }
    frame += 1;
  }

  return log;
}

/** Log plano "entrada por entrada" hasta SAFE_DISTANCE (prefijo comparable). */
function flatLog(log: SessionLog): string[] {
  const flat: string[] = [];
  for (const wave of log.waves) {
    if (wave.atDistance > SAFE_DISTANCE) {
      break;
    }
    flat.push(`@${wave.atDistance.toFixed(2)}`, ...wave.entries);
  }
  return flat;
}

/** Perfil A: acelera de MIN_SPEED a punta de turbo y la mantiene. */
function accelerateProfile(frame: number): { dt: number; speed: number } {
  return { dt: REAL_DT, speed: Math.min(MIN_SPEED + frame * 6, MAX_SPEED * 2) };
}

/** Perfil B: rafagas de punta y frenadas a fondo (mucho más lento en total). */
function brakeProfile(frame: number): { dt: number; speed: number } {
  const burst = Math.sin(frame / 240) > 0.5 ? MAX_SPEED : MIN_SPEED;
  return { dt: REAL_DT, speed: burst };
}

/** Perfil C: velocidad constante pero framerate errático (lag spikes). */
const ERRATIC_DTS = [1 / 240, 1 / 240, 1 / 60, 0.11, 1 / 60, 1 / 30, 0.004, 1 / 120];
function choppyFpsProfile(frame: number): { dt: number; speed: number } {
  return { dt: ERRATIC_DTS[frame % ERRATIC_DTS.length], speed: MAX_SPEED };
}

describe('M0 — pista determinista por seed y distancia', () => {
  const roomSeed = hashStringToSeed('monaco-2026');
  const otherSeed = hashStringToSeed('spa-2026');

  it('la seed de la sala es un uint32 y las salas difieren', () => {
    expect(roomSeed).not.toBe(otherSeed);
    expect(Number.isInteger(roomSeed)).toBe(true);
    expect(roomSeed).toBeGreaterThanOrEqual(0);
    expect(roomSeed).toBeLessThan(2 ** 32);
  });

  it('misma seed + perfiles de velocidad distintos ⇒ MISMA pista', () => {
    const accelerating = runSession(roomSeed, accelerateProfile);
    const braking = runSession(roomSeed, brakeProfile);
    const choppy = runSession(roomSeed, choppyFpsProfile);

    // Las tres sesiones recorrieron la misma distancia… con perfiles MUY
    // distintos (frames y velocidades diferentes de punta a punta).
    expect(accelerating.virtualSteps).toBeGreaterThan(0);
    expect(braking.virtualSteps).toBeGreaterThan(0);
    expect(choppy.virtualSteps).toBeGreaterThan(0);

    const logA = flatLog(accelerating);
    const logB = flatLog(braking);
    const logC = flatLog(choppy);

    // …y produjeron exactamente las mismas oleadas en las mismas distancias.
    expect(logA).toEqual(logB);
    expect(logA).toEqual(logC);

    // El log es sustancial: muchas oleadas con contenido variado (la carrera
    // cruza toda la rampa de dificultad).
    const waveCount = logA.filter((line) => line.startsWith('@')).length;
    expect(waveCount).toBeGreaterThan(60);
    expect(accelerating.patterns.size).toBeGreaterThanOrEqual(4);
  });

  it('las oleadas registradas cruzan la saturación de dificultad (nivel 3)', () => {
    // La distancia virtual al final de la zona comparable supera maxDistance:
    // la rampa satura dentro del tramo comparado (patrones de nivel máximo
    // desbloqueados).
    expect(SAFE_DISTANCE).toBeGreaterThan(DIFFICULTY.maxDistance);
    const ramp = new DifficultySystem();
    ramp.advance(SAFE_DISTANCE);
    expect(ramp.patternLevel).toBe(DIFFICULTY.maxPatternLevel);

    // Y la pista comparada efectivamente usa variedad más allá del nivel 1
    // (el muro `blocked-gap` exige los 4 carriles libres y es esquivo con la
    // pista densa del tope, así que no se exige su presencia).
    const log = runSession(roomSeed, accelerateProfile);
    const beyondLevel1 = [...log.patterns].filter(
      (pattern) => pattern !== 'coin-line' && pattern !== 'single-rival' && pattern !== 'scattered-hazards',
    );
    expect(beyondLevel1.length).toBeGreaterThan(0);
  });

  it('los rivales de la misma oleada llevan seeds idénticas entre sesiones', () => {
    // Ya cubierto por el campo |r…| del log plano; este test lo explicita:
    // el MISMO rival (mismo índice de spawn) esquivará igual en ambos clientes.
    const a = runSession(roomSeed, accelerateProfile);
    const b = runSession(roomSeed, brakeProfile);

    const rollsA = a.waves.flatMap((wave) => wave.entries.filter((e) => e.includes('|r')).map((e) => e.split('|r')[1]));
    const rollsB = b.waves.flatMap((wave) => wave.entries.filter((e) => e.includes('|r')).map((e) => e.split('|r')[1]));

    expect(rollsA.length).toBeGreaterThan(10);
    expect(rollsA).toEqual(rollsB);
  });

  it('seeds distintas ⇒ pistas distintas', () => {
    const monaco = flatLog(runSession(roomSeed, accelerateProfile));
    const spa = flatLog(runSession(otherSeed, accelerateProfile));

    // Ambas carreras tienen contenido (misma distancia y ritmo base), pero
    // el sorteo diverge: carriles, kinds y semillas de rivales no coinciden.
    expect(monaco.length).toBeGreaterThan(100);
    expect(spa.length).toBeGreaterThan(100);
    expect(spa).not.toEqual(monaco);
  });

  it('los pedidos siguen bien formados en el pipeline virtual', () => {
    const log = runSession(roomSeed, brakeProfile);
    for (const wave of log.waves) {
      expect(wave.entries.length).toBeGreaterThan(0);
      for (const entry of wave.entries) {
        const [kind, lane, x] = entry.split('|');
        expect(ENTITY_KIND_KEYS).toContain(kind);
        expect(Number(lane.replace('lane', ''))).toBeGreaterThanOrEqual(0);
        expect(Number(x.replace('x', ''))).toBeGreaterThan(0);
      }
    }
  });
});
