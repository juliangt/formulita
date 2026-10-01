/**
 * RaceSystems.ts — construcción de los sistemas de carrera POR MODO (M1).
 *
 * Función pura extraída de GameScene para que el cableado del multijugador
 * sea testeable sin bootear la escena (siguiendo la convención del repo):
 *
 * - SOLO (init null): DifficultySystem fresco y NADA más — GameScene crea el
 *   SpawnSystem sin opciones, exactamente como antes (bit a bit igual).
 * - MULTI (init válido): además scheduler SEMBRADO (`mulberry32(seed)`),
 *   reloj virtual (pista como función pura de la distancia) y rng por
 *   entidad (`deriveRng(seed, spawnIndex)`), el cableado del test estrella
 *   de M0.
 */

import type { MultiplayerInit } from '../net/protocol';
import { deriveRng, mulberry32 } from '../net/roomRng';
import { DifficultySystem } from './DifficultySystem';
import { SpawnScheduler, type EntityRngSource } from './SpawnSystem';
import { VirtualClock } from './VirtualClock';

/** Sistemas que GameScene arma en create() según el modo. */
export interface RaceSystems {
  /** Rampa de dificultad (siempre presente). */
  readonly difficulty: DifficultySystem;
  /** Scheduler propio de la sala — solo multi (sembrado por seed). */
  readonly scheduler?: SpawnScheduler;
  /** Reloj virtual de generación — solo multi. */
  readonly virtualClock?: VirtualClock;
  /** Semillas por entidad — solo multi. */
  readonly entityRng?: EntityRngSource;
}

/**
 * Construye los sistemas de la carrera para el init data dado. `null` (o un
 * init solo) = modo de un jugador: difficulty fresca y nada inyectado, para
 * que el SpawnSystem use sus defaults exactos de siempre.
 */
export function buildRaceSystems(init: MultiplayerInit | null): RaceSystems {
  const difficulty = new DifficultySystem();
  if (!init) {
    return { difficulty };
  }
  const { seed } = init;
  return {
    difficulty,
    scheduler: new SpawnScheduler({ rng: mulberry32(seed) }),
    virtualClock: new VirtualClock(),
    entityRng: (_family, spawnIndex) => deriveRng(seed, spawnIndex),
  };
}
