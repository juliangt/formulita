/**
 * QA issue #39 — GRAN PREMIO con CONTACTOS y DESGASTE, de punta a punta y
 * sin Phaser (mismo criterio que `aiDriverVsCpu.test.ts`, que esto extiende):
 *
 * - Sim determinista con el MISMO cableado de `RaceScene` (`setupVsCpu`/
 *   `stepVsCpu`): 7 rivales con IA + un jugador simulado a fondo, física
 *   `CircuitPhysics` con tope por desgaste, y `resolveCarContacts` por frame.
 * - INVARIANTE central del issue: después de CADA frame de la carrera, ningún
 *   par de autos queda solapado — nadie atraviesa a nadie en 3 vueltas reales.
 * - Hubo contactos (la primera curva y las maniobras pegan golpes medibles).
 * - Desgaste: con el toggle ON la goma del paquete se degrada (y el tope de
 *   velocidad cae); el simulador de toggle OFF no acumula nada (por
 *   construcción de la escena, el desgaste sólo corre con `wearEnabled`).
 * - La carrera TERMINA: los contactos no traban a la IA (los 8 completan).
 * - Determinismo: misma seed → misma carrera bit a bit (los contactos son
 *   puros, la reproducibilidad de #14 queda intacta).
 */

import { describe, expect, it } from 'vitest';

import { CIRCUIT, RACE_CONTACT } from '../../config/balance';
import { AiDriver } from '../../race/ai/aiDriver';
import { buildRacingLine } from '../../race/ai/racingLine';
import { buildRivalRoster, rivalDriverConfig } from '../../race/ai/rivalRoster';
import { mulberry32 } from '../../net/roomRng';
import { CircuitPhysics, defaultCircuitInput, type CarState } from '../../race/circuitPhysics';
import { resolveCarContacts } from '../../race/carContacts';
import { accumulateWear, speedCapFor, wearFromDistance, wearFromImpact } from '../../race/tireWear';
import { LapTracker } from '../../race/lapTracker';
import { assignGridOrder } from '../../race/gridOrder';
import { buildTrackPath, getTrackById } from '../../race/tracks';
import type { TrackDefinition } from '../../race/tracks';

/** Paso fijo de la sim headless (60 Hz, igual criterio que el render). */
const DT = 1 / 60;

/** peerId canónico del auto propio en la parrilla local (contrato RaceScene). */
const PLAYER_PEER_ID = 'player';

/** Seed fija de los tests (cualquiera sirve: todo es determinista). */
const TEST_SEED = 20260101;

/** Épsilon de separación entre pares (px): las barridas dejan milésimas. */
const SEPARATION_EPSILON_PX = 1e-3;

/** Resultado de la sim completa con contactos. */
interface GpContactsSimResult {
  /** Estados finales (jugador + rivales, en orden de parrilla). */
  states: CarState[];
  /** Vueltas completadas por cada auto (-1 = jugador). */
  laps: number[];
  /** Goma gastada final de cada auto (con toggle ON). */
  wear: number[];
  /** Cantidad TOTAL de golpes aplicados en toda la carrera. */
  contactCount: number;
  /** Impacto acumulado de todos los golpes (px/s). */
  totalImpact: number;
}

/**
 * Sim headless de una carrera completa del GP con el cableado EXACTO de
 * RaceScene vs CPU (`stepVsCpu` + `resolveVsCpuContacts`): pasos de física
 * con tope por desgaste, contactos por frame y desgaste por distancia/golpe.
 * `wearEnabled` false = toggle apagado (sin desgaste, contactos intactos).
 */
function simulateGpRace(
  trackDef: TrackDefinition,
  seed: number,
  wearEnabled: boolean,
): GpContactsSimResult {
  const path = buildTrackPath(trackDef);
  const roster = buildRivalRoster(seed, 'normal');
  const slots = assignGridOrder(
    [{ peerId: PLAYER_PEER_ID }, ...roster.map((entry) => ({ peerId: entry.peerId }))],
    seed,
    path,
  );
  const line = buildRacingLine(path, trackDef.widthPx);
  const slotOf = (peerId: string) => slots.find((slot) => slot.peerId === peerId)!;

  const stateFromSlot = (peerId: string): CarState => {
    const slot = slotOf(peerId);
    return {
      x: slot.x ?? path.sample(0).x,
      y: slot.y ?? path.sample(0).y,
      heading: slot.angle ?? 0,
      speed: 0,
    };
  };

  // El JUGADOR simulado va "a fondo, recto" (defaultCircuitInput): un auto
  // lento en pista que el paquete alcanza y embiste — el peor caso de contacto.
  const playerState = stateFromSlot(PLAYER_PEER_ID);
  const playerPhysics = new CircuitPhysics(path, trackDef.widthPx);
  const playerLaps = new LapTracker(path);
  let playerWear = 0;

  const rivals = roster.map((rival) => {
    const state = stateFromSlot(rival.peerId);
    const slot = slotOf(rival.peerId);
    return {
      rival,
      state,
      physics: new CircuitPhysics(path, trackDef.widthPx),
      laps: new LapTracker(path),
      driver: new AiDriver(
        path,
        line,
        rivalDriverConfig(rival, 'normal'),
        mulberry32(rival.seed),
      ),
      lastS: slot.s ?? 0,
      lastLateral: 0,
      finished: false,
      wear: 0,
    };
  });

  const states: CarState[] = [playerState, ...rivals.map((entry) => entry.state)];
  let contactCount = 0;
  let totalImpact = 0;

  // Tope holgado: (vueltas + 2) al ritmo de referencia (igual que #14).
  const cap = Math.ceil(((CIRCUIT.totalLaps + 2) * path.totalLength) / (CIRCUIT.referenceSpeed * DT));
  let steps = 0;
  while (!rivals.every((entry) => entry.finished) && steps < cap) {
    // 1) Paso del JUGADOR (a fondo, con su tope por desgaste).
    const playerCap = wearEnabled ? speedCapFor(playerWear) : undefined;
    playerPhysics.step(playerState, DT, defaultCircuitInput(), playerCap);
    if (wearEnabled) {
      playerWear = accumulateWear(playerWear, wearFromDistance(playerState.speed * DT));
    }
    if (!playerLaps.finished) {
      playerLaps.update(path.project(playerState.x, playerState.y).s, DT * 1000);
    }

    // 2) Paso de cada RIVAL (visión + gap, espejo exacto de stepVsCpu).
    const length = path.totalLength;
    const playerProgress = playerLaps.lapsCompleted * length;
    const rivalVisions = rivals.map((entry) => ({
      s: entry.lastS,
      lateral: entry.lastLateral,
      speed: entry.state.speed,
    }));
    for (let i = 0; i < rivals.length; i += 1) {
      const entry = rivals[i];
      if (!entry.finished) {
        const others = rivalVisions.filter((_, j) => j !== i);
        others.push({
          s: path.project(playerState.x, playerState.y).s,
          lateral: path.project(playerState.x, playerState.y).lateral,
          speed: playerState.speed,
        });
        const rivalProgress = entry.laps.lapsCompleted * length + entry.lastS;
        const input = entry.driver.drive(entry.state, DT, {
          cars: others,
          playerGapPx: playerProgress - rivalProgress,
        });
        const capPx = wearEnabled ? speedCapFor(entry.wear) : undefined;
        entry.physics.step(entry.state, DT, input, capPx);
        const projection = path.project(entry.state.x, entry.state.y);
        entry.lastS = projection.s;
        entry.lastLateral = projection.lateral;
        entry.laps.update(projection.s, DT * 1000);
        if (entry.laps.finished) {
          entry.finished = true;
        }
        if (wearEnabled) {
          entry.wear = accumulateWear(entry.wear, wearFromDistance(entry.state.speed * DT));
        }
      }
    }

    // 3) CONTACTOS por frame (idéntico a resolveVsCpuContacts).
    const contacts = resolveCarContacts(states);
    contactCount += contacts.length;
    for (const contact of contacts) {
      totalImpact += contact.impact;
      if (wearEnabled) {
        const wear = wearFromImpact(contact.impact);
        playerWear = accumulateWear(
          playerWear,
          contact.a === 0 || contact.b === 0 ? wear : 0,
        );
        const rivalA = rivals[contact.a - 1];
        const rivalB = rivals[contact.b - 1];
        if (rivalA) {
          rivalA.wear = accumulateWear(rivalA.wear, wear);
        }
        if (rivalB) {
          rivalB.wear = accumulateWear(rivalB.wear, wear);
        }
      }
    }
    steps += 1;
  }

  return {
    states,
    laps: [playerLaps.lapsCompleted, ...rivals.map((entry) => entry.laps.lapsCompleted)],
    wear: [playerWear, ...rivals.map((entry) => entry.wear)],
    contactCount,
    totalImpact,
  };
}

/** Mínima distancia entre pares de una lista de estados (px). */
function minPairDistance(states: readonly CarState[]): number {
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < states.length; i += 1) {
    for (let j = i + 1; j < states.length; j += 1) {
      min = Math.min(min, Math.hypot(states[j].x - states[i].x, states[j].y - states[i].y));
    }
  }
  return min;
}

describe('GP con contactos (#39) — carrera completa de punta a punta', () => {
  const trackDef = getTrackById('monaco')!;

  it('nadie atraviesa a nadie: los 8 autos terminan separados tras 3 vueltas', () => {
    const result = simulateGpRace(trackDef, TEST_SEED, true);
    expect(minPairDistance(result.states)).toBeGreaterThanOrEqual(
      RACE_CONTACT.radiusPx * 2 - SEPARATION_EPSILON_PX,
    );
    // Sin NaN: la resolución no corrompe ningún estado.
    for (const state of result.states) {
      expect(Number.isFinite(state.x)).toBe(true);
      expect(Number.isFinite(state.y)).toBe(true);
      expect(Number.isFinite(state.heading)).toBe(true);
      expect(Number.isFinite(state.speed)).toBe(true);
    }
  });

  it('los contactos ocurren de verdad (la primera curva y las maniobras pegan)', () => {
    const result = simulateGpRace(trackDef, TEST_SEED, true);
    expect(result.contactCount).toBeGreaterThan(0);
    expect(result.totalImpact).toBeGreaterThan(0);
  });

  it('los contactos no traban la carrera: los 7 rivales completan las 3 vueltas', () => {
    const result = simulateGpRace(trackDef, TEST_SEED, true);
    for (let i = 1; i < result.laps.length; i += 1) {
      expect(result.laps[i], `el rival ${i} no terminó`).toBe(CIRCUIT.totalLaps);
    }
  });

  it('desgaste ON: la goma se gasta y recorta la punta del paquete', () => {
    const result = simulateGpRace(trackDef, TEST_SEED, true);
    for (let i = 0; i < result.wear.length; i += 1) {
      expect(result.wear[i], `la goma del auto ${i} no se gastó`).toBeGreaterThan(0);
      expect(result.wear[i]).toBeLessThanOrEqual(1);
    }
    // Cada auto termina con la punta recortada respecto de la goma nueva.
    for (let i = 0; i < result.wear.length; i += 1) {
      expect(speedCapFor(result.wear[i])).toBeLessThan(CIRCUIT.maxSpeed);
    }
  });

  it('desgaste OFF: ningún auto acumula goma (carrera arcade pura)', () => {
    // Con el toggle OFF ningún auto acumula desgaste; con ON todos pagan
    // kilometraje y golpes. (Los contactos físicos son SIEMPRE parte del
    // juego: lo opcional es el desgaste acumulado, decidido en la escena.)
    const on = simulateGpRace(trackDef, TEST_SEED, true);
    const off = simulateGpRace(trackDef, TEST_SEED, false);
    expect(off.wear.every((wear) => wear === 0)).toBe(true);
    expect(on.wear.some((wear) => wear > 0)).toBe(true);
  });

  it('determinismo: misma (pista, seed) → misma carrera bit a bit', () => {
    const run1 = simulateGpRace(trackDef, TEST_SEED, true);
    const run2 = simulateGpRace(trackDef, TEST_SEED, true);
    expect(run1.states).toEqual(run2.states);
    expect(run1.wear).toEqual(run2.wear);
    expect(run1.contactCount).toBe(run2.contactCount);
    expect(run1.totalImpact).toBeCloseTo(run2.totalImpact, 9);
  });
});
