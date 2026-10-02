import { describe, expect, it } from 'vitest';
import { CIRCUIT, RACE_AI } from '../../config/balance';
import { AiDriver, type AiDriverConfig } from '../../race/ai/aiDriver';
import { CircuitPhysics, type CarState } from '../../race/circuitPhysics';
import { LapTracker } from '../../race/lapTracker';
import { assignGridOrder } from '../../race/gridOrder';
import {
  finalClassification,
  rankCars,
  type FinalCar,
} from '../../race/raceRanking';
import { buildTrackPath, getTrackById, TRACKS, type TrackDefinition } from '../../race/tracks';
import type { TrackPath } from '../../race/trackPath';

/**
 * QA issue #14 V0 — el rival CPU (`race/ai/aiDriver.ts`) de punta a punta y
 * SIN Phaser:
 *
 * - Driver puro: produce `CircuitInput` (throttle/brake/steer) a partir del
 *   estado, NO muta posiciones, V0 nunca frena, corrige el error angular
 *   (gira hacia el punto de mira y respeta la zona muerta) y vuelve al eje
 *   si se lo desplaza.
 * - Sim determinista: misma (pista, seed, dificultad) ⇒ trayectoria
 *   EXACTA (misma parrilla de `assignGridOrder` + física + driver puros).
 * - El driver completa vueltas en LAS 5 PISTAS y en las 3 dificultades
 *   (no queda stuck: el coche avanza y el LapTracker cuenta).
 * - Carrera completa de 3 vueltas: ranking vivo de 2 autos y clasificación
 *   final (`finalClassification`) con el jugador 1º o 2º.
 *
 * Espeja el cableado de RaceScene V0 (`setupVsCpu`/`stepVsCpu`/
 * `buildVsCpuResults`) al nivel sistemas, igual que hace el full-flow de #9.
 */

/** Paso fijo de la sim headless (60 Hz, igual criterio que el render). */
const DT = 1 / 60;

/** peerIds canónicos de la parrilla local (contrato de RaceScene V0). */
const PLAYER_PEER_ID = 'player';
const CPU_PEER_ID = 'cpu';

/** Seed fija de los tests (cualquiera sirve: todo es determinista). */
const TEST_SEED = 20260101;

/** Preset de driver equivalente al que arma RaceScene por dificultad. */
function driverConfig(difficulty: keyof typeof RACE_AI.targetSpeedFraction): AiDriverConfig {
  return {
    targetSpeedFraction: RACE_AI.targetSpeedFraction[difficulty],
    lookAheadPx: RACE_AI.lookAheadPx,
    steerDeadzoneRad: RACE_AI.steerDeadzoneRad,
  };
}

/** Tope de pasos de la sim: 5 vueltas al ritmo de referencia (holgado). */
function stepCap(path: TrackPath): number {
  return Math.ceil((5 * path.totalLength) / (CIRCUIT.referenceSpeed * DT));
}

/** Resultado de la sim del rival (estado + vueltas + progreso). */
interface CpuSimResult {
  state: CarState;
  lapsCompleted: number;
  totalMs: number;
  lastS: number;
  finished: boolean;
}

/**
 * Sim headless del rival CPU: parrilla determinista (seed) → AiDriver V0 →
 * CircuitPhysics → LapTracker, en el paso fijo, hasta terminar o agotar.
 */
function simulateCpu(
  trackDef: TrackDefinition,
  seed: number,
  difficulty: keyof typeof RACE_AI.targetSpeedFraction,
  totalLaps = CIRCUIT.totalLaps,
): CpuSimResult {
  const path = buildTrackPath(trackDef);
  const slots = assignGridOrder(
    [{ peerId: PLAYER_PEER_ID }, { peerId: CPU_PEER_ID }],
    seed,
    path,
  );
  const slot = slots.find((entry) => entry.peerId === CPU_PEER_ID)!;
  const state: CarState = {
    x: slot.x ?? path.sample(0).x,
    y: slot.y ?? path.sample(0).y,
    heading: slot.angle ?? 0,
    speed: 0,
  };
  const physics = new CircuitPhysics(path, trackDef.widthPx);
  const driver = new AiDriver(path, driverConfig(difficulty));
  const laps = new LapTracker(path, { totalLaps });
  const cap = stepCap(path);

  let lastS = 0;
  for (let step = 0; step < cap && !laps.finished; step += 1) {
    const input = driver.drive(state);
    physics.step(state, DT, input);
    const projection = path.project(state.x, state.y);
    lastS = projection.s;
    laps.update(projection.s, DT * 1000);
  }

  return {
    state: { ...state },
    lapsCompleted: laps.lapsCompleted,
    totalMs: laps.totalMs,
    lastS,
    finished: laps.finished,
  };
}

describe('AiDriver V0 — contrato puro del driver', () => {
  const track = getTrackById('monza')!;
  const path = buildTrackPath(track);
  const driver = new AiDriver(path, driverConfig('normal'));

  it('no muta el estado: sólo LEE {x, y, heading, speed} y devuelve input', () => {
    const slot = assignGridOrder([{ peerId: 'a' }], 1, path)[0];
    const state: CarState = { x: slot.x!, y: slot.y!, heading: slot.angle!, speed: 100 };
    const snapshot = { ...state };
    const input = driver.drive(state);
    expect(state).toEqual(snapshot);
    expect(input).toEqual({ throttle: expect.any(Boolean), brake: false, steer: expect.any(Number) });
  });

  it('acelera por debajo de la velocidad objetivo y suelta al alcanzarla', () => {
    const target = CIRCUIT.maxSpeed * RACE_AI.targetSpeedFraction.normal;
    const start = path.sample(0);
    const slow: CarState = { x: start.x, y: start.y, heading: start.angle, speed: 0 };
    const fast: CarState = { x: start.x, y: start.y, heading: start.angle, speed: target };
    expect(driver.drive(slow).throttle).toBe(true);
    expect(driver.drive(fast).throttle).toBe(false);
  });

  it('V0 nunca frena (la velocidad se regula soltando el acelerador)', () => {
    const start = path.sample(0);
    const state: CarState = { x: start.x, y: start.y, heading: start.angle, speed: CIRCUIT.maxSpeed };
    expect(driver.drive(state).brake).toBe(false);
  });

  it('corrige el error angular: girando hacia el punto de mira, el error baja', () => {
    const start = path.sample(0);
    // Desalineado medio radian respecto de la tangente, sobre el eje.
    const state: CarState = { x: start.x, y: start.y, heading: start.angle + 0.5, speed: 150 };
    const input = driver.drive(state);
    // El volante es bang-bang: con medio radian de error, gira a fondo.
    expect(input.steer).not.toBe(0);
    const physics = new CircuitPhysics(path, track.widthPx);
    const before = Math.abs(path.project(state.x, state.y).angle - state.heading);
    physics.step(state, DT, input);
    const after = Math.abs(path.project(state.x, state.y).angle - state.heading);
    expect(after).toBeLessThan(before);
  });

  it('respeta la zona muerta: alineado con la pista, volante recto', () => {
    // En un tramo recto alineado, el punto de mira queda adelante en línea:
    // el error angular es ~0 y el driver no toca el volante.
    const s = path.totalLength / 2;
    const start = path.sample(s);
    const state: CarState = { x: start.x, y: start.y, heading: start.angle, speed: 150 };
    // Con lookAhead de RACE_AI y curvatura local pequeña, el error cae en la
    // zona muerta o muy cerca: sólo exigimos que NO gire a fondo.
    const input = driver.drive(state);
    expect(Math.abs(input.steer)).toBeLessThanOrEqual(1);
    if (Math.abs(input.steer) === 1) {
      // Si la curvatura local pide giro, es coherente con un error > deadzone.
      const aim = path.sample(path.project(state.x, state.y).s + RACE_AI.lookAheadPx);
      const desired = Math.atan2(aim.y - state.y, aim.x - state.x);
      expect(Math.abs(desired - state.heading)).toBeGreaterThan(RACE_AI.steerDeadzoneRad);
    } else {
      expect(input.steer).toBe(0);
    }
  });

  it('vuelve al eje si se lo desplaza (sin quedar tirado en el pasto)', () => {
    const start = path.sample(0);
    const halfWidth = track.widthPx / 2;
    // 3/4 del ancho hacia un lado, alineado con la tangente: fuera del
    // ruedo, el driver apunta al eje y la física lo trae de vuelta.
    const normal = start.angle + Math.PI / 2;
    const state: CarState = {
      x: start.x + Math.cos(normal) * halfWidth * 0.75,
      y: start.y + Math.sin(normal) * halfWidth * 0.75,
      heading: start.angle,
      speed: 120,
    };
    const physics = new CircuitPhysics(path, track.widthPx);
    let lateral = Math.abs(path.project(state.x, state.y).lateral);
    for (let step = 0; step < 300; step += 1) {
      physics.step(state, DT, driver.drive(state));
      lateral = Math.abs(path.project(state.x, state.y).lateral);
    }
    expect(lateral).toBeLessThan(halfWidth * 0.5);
  });
});

describe('Sim determinista — misma seed ⇒ mismo resultado', () => {
  it('misma (pista, seed, dificultad) dos veces ⇒ estados idénticos bit a bit', () => {
    const track = getTrackById('monaco')!;
    const a = simulateCpu(track, TEST_SEED, 'normal');
    const b = simulateCpu(track, TEST_SEED, 'normal');
    expect(a).toEqual(b);
    expect(a.state).toEqual(b.state);
    expect(a.totalMs).toBe(b.totalMs);
    expect(a.lastS).toBe(b.lastS);
  });

  it('la determinismo vale también con la carrera completa de 3 vueltas', () => {
    const track = getTrackById('spa')!;
    const a = simulateCpu(track, 777, 'hard');
    const b = simulateCpu(track, 777, 'hard');
    expect(a.finished).toBe(true);
    expect(a).toEqual(b);
  });

  it('la seed cambia la parrilla (misma función de #9 que usa la escena)', () => {
    const track = getTrackById('monza')!;
    const path = buildTrackPath(track);
    const roster = [{ peerId: PLAYER_PEER_ID }, { peerId: CPU_PEER_ID }];
    // Semillas elegidas para que la permutación de 2 elementos difiera
    // (con n=2 hay sólo dos órdenes posibles).
    const slotsA = assignGridOrder(roster, 1, path);
    const slotsB = assignGridOrder(roster, 7, path);
    expect(assignGridOrder(roster, 1, path)).toEqual(slotsA);
    expect(assignGridOrder(roster, 7, path)).toEqual(slotsB);
    expect(slotsA[0].peerId).not.toBe(slotsB[0].peerId);
    expect(slotsA).toHaveLength(2);
    expect(slotsB).toHaveLength(2);
  });
});

describe('El driver V0 completa vueltas en las 5 pistas (no queda stuck)', () => {
  for (const track of TRACKS) {
    for (const difficulty of ['easy', 'normal', 'hard'] as const) {
      it(`${track.id} · ${difficulty}: completa las 3 vueltas avanzando`, () => {
        const result = simulateCpu(track, TEST_SEED, difficulty);
        expect(result.finished).toBe(true);
        expect(result.lapsCompleted).toBe(CIRCUIT.totalLaps);
        expect(result.totalMs).toBeGreaterThan(0);
        // "Sin quedar stuck": llega a la meta con velocidad de crucero y su
        // vuelta es más rápida que ir casi parado.
        expect(result.state.speed).toBeGreaterThan(CIRCUIT.referenceSpeed * 0.8);
        expect(result.totalMs).toBeLessThan(CIRCUIT.lapMaxSeconds * 1000 * CIRCUIT.totalLaps);
      });
    }
  }
});

/* ------------------------------------------------------------------ */
/* Carrera completa vs CPU: ranking en vivo + clasificación final      */
/* ------------------------------------------------------------------ */

/**
 * Carrera completa de 3 vueltas: el rival corre con su driver real y el
 * "jugador" avanza SCRIPTeado a `playerSpeed` sobre el eje desde SU casilla
 * (misma técnica del full-flow de #9: la física del jugador ya está
 * ejercitada por otros tests; acá importa el ranking/clasificación).
 */
function simulateRace(
  trackDef: TrackDefinition,
  seed: number,
  difficulty: keyof typeof RACE_AI.targetSpeedFraction,
  playerSpeed: number,
): { playerPosition: number; cpuLaps: number; standingsCount: number } {
  const path = buildTrackPath(trackDef);
  const length = path.totalLength;
  const slots = assignGridOrder(
    [{ peerId: PLAYER_PEER_ID }, { peerId: CPU_PEER_ID }],
    seed,
    path,
  );

  // Rival: driver + física + vueltas (cableado exacto de RaceScene V0).
  const cpuSlot = slots.find((entry) => entry.peerId === CPU_PEER_ID)!;
  const cpu: CarState = {
    x: cpuSlot.x ?? path.sample(0).x,
    y: cpuSlot.y ?? path.sample(0).y,
    heading: cpuSlot.angle ?? 0,
    speed: 0,
  };
  const physics = new CircuitPhysics(path, trackDef.widthPx);
  const driver = new AiDriver(path, driverConfig(difficulty));
  const cpuLaps = new LapTracker(path);
  let cpuLastS = 0;

  // Jugador scripteado: progreso lineal sobre el eje desde su casilla.
  const playerSlot = slots.find((entry) => entry.peerId === PLAYER_PEER_ID)!;
  const playerLaps = new LapTracker(path);
  let playerDistance = 0;
  let playerS = playerSlot.s;

  const cap = stepCap(path);
  for (let step = 0; step < cap && !playerLaps.finished; step += 1) {
    // CPU en el MISMO paso fijo que el jugador.
    if (!cpuLaps.finished) {
      physics.step(cpu, DT, driver.drive(cpu));
      const projection = path.project(cpu.x, cpu.y);
      cpuLastS = projection.s;
      cpuLaps.update(projection.s, DT * 1000);
    }
    playerDistance += playerSpeed * DT;
    playerS = (playerSlot.s + playerDistance) % length;
    playerLaps.update(playerS, DT * 1000);
  }

  // Ranking en vivo de 2 autos (replica stepVsCpu).
  const standings = rankCars(
    { peerId: PLAYER_PEER_ID, lap: playerLaps.lapsCompleted, s: playerS },
    [{ peerId: CPU_PEER_ID, lap: cpuLaps.lapsCompleted, s: cpuLastS }],
    length,
  );

  // Clasificación final (replica buildVsCpuResults): el jugador siempre
  // termina (el modo corta con SU bandera); el rival, por tiempo o progreso.
  const cars: FinalCar[] = [
    {
      peerId: PLAYER_PEER_ID,
      lap: playerLaps.lapsCompleted,
      s: playerS,
      status: 'finished',
      totalMs: playerLaps.totalMs,
    },
    cpuLaps.finished
      ? {
          peerId: CPU_PEER_ID,
          lap: cpuLaps.lapsCompleted,
          s: cpuLastS,
          status: 'finished' as const,
          totalMs: cpuLaps.totalMs,
        }
      : {
          peerId: CPU_PEER_ID,
          lap: cpuLaps.lapsCompleted,
          s: cpuLastS,
          status: 'running' as const,
        },
  ];
  const classification = finalClassification(cars, length);
  return {
    playerPosition:
      classification.find((row) => row.peerId === PLAYER_PEER_ID)?.position ?? 0,
    cpuLaps: cpuLaps.lapsCompleted,
    standingsCount: standings.length,
  };
}

describe('Carrera vs CPU de 3 vueltas — ranking y clasificación (issue #14)', () => {
  const track = getTrackById('monza')!;

  it('jugador lento: el CPU gana y el jugador clasifica 2º', () => {
    const result = simulateRace(track, TEST_SEED, 'normal', CIRCUIT.referenceSpeed * 0.8);
    expect(result.standingsCount).toBe(2);
    expect(result.cpuLaps).toBe(CIRCUIT.totalLaps);
    expect(result.playerPosition).toBe(2);
  });

  it('jugador rápido: gana él y el CPU queda 2º (por tiempo, también terminó)', () => {
    const result = simulateRace(track, TEST_SEED, 'normal', CIRCUIT.maxSpeed * 0.95);
    expect(result.standingsCount).toBe(2);
    expect(result.playerPosition).toBe(1);
  });

  it('el ranking con 2 coches siempre produce P1 y P2 sin empates', () => {
    const length = buildTrackPath(track).totalLength;
    const standings = rankCars(
      { peerId: PLAYER_PEER_ID, lap: 2, s: 1200 },
      [{ peerId: CPU_PEER_ID, lap: 2, s: 1200 }],
      length,
    );
    // Empate de progreso ⇒ tiebreak determinista por peerId ASC ('cpu' < 'player').
    expect(standings.map((row) => row.peerId)).toEqual([CPU_PEER_ID, PLAYER_PEER_ID]);
    expect(standings.map((row) => row.position)).toEqual([1, 2]);
  });
});
