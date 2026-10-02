/**
 * rivalRoster — los 7 rivales CPU del GRAN PREMIO (issue #14, V1).
 *
 * `buildRivalRoster(seed, difficulty)` es determinista: la MISMA (seed,
 * dificultad) devuelve EXACTAMENTE los mismos rivales (mismas personalidades,
 * mismos nombres, mismos colores, mismas seeds derivadas) — la misma carrera
 * es reproducible de punta a punta cuando la seed viaja (REINTENTAR regenera;
 * el modo nunca cruza la red).
 *
 * Personalidad: cada rival tiene desvíos PROPIOS sobre el preset de
 * dificultad de `RACE_AI`:
 * - `speedScale` = 1 ± speedPct (multiplica el cap de recta Y la escala de
 *   línea — el rival rápido es rápido en todo, no sólo en las rectas);
 * - `lineOffsetPx` = ± desvío lateral (SU trazada sobre la línea común);
 * - `aggression` (0–1): cuánto recorta su margen de frenada (frenan tarde).
 *
 * Nombres y paleta fijos (índices en `MULTIPLAYER.palette`, SIN el 0: ese es
 * el rojo F1 del jugador) — 7 colores distintos de alto contraste, el mismo
 * criterio de asignación por función pura del multi (#9).
 *
 * Puro: sin Phaser, sin red, sin reloj. El RNG es `mulberry32`/`hashStringToSeed`
 * de `net/roomRng` (el MISMO PRNG de la parrilla y de la generación).
 */

import { MULTIPLAYER, RACE_AI } from '../../config/balance';
import { hashStringToSeed, mulberry32 } from '../../net/roomRng';
import type { CpuDifficulty } from '../results';
import type { AiDriverConfig } from './aiDriver';

/** Un rival CPU del roster. */
export interface Rival {
  /** peerId canónico en la parrilla (mismo contrato que el multi). */
  readonly peerId: string;
  /** Nombre visible en la etiqueta del auto. */
  readonly name: string;
  /** Índice en `MULTIPLAYER.palette` (distinto por rival, nunca el 0). */
  readonly paletteIndex: number;
  /** Color resuelto de la paleta (0xrrggbb; listo para `PlayerInfo`). */
  readonly color: number;
  /** Multiplicador de velocidad personal (≈1 ± `RACE_AI.speedPctSpread`). */
  readonly speedScale: number;
  /** Agresividad 0–1: recorta el margen de frenada (frena más tarde). */
  readonly aggression: number;
  /** Offset lateral propio sobre la línea de carrera (px, ±). */
  readonly lineOffsetPx: number;
  /** Seed propia derivada de la seed de carrera (reproducible por rival). */
  readonly seed: number;
}

/**
 * Nombres de los 7 rivales (orden fijo; la personalidad viaja con el nombre
 * vía la seed del hash — mismo nombre ⇒ misma personalidad para una seed).
 */
const RIVAL_NAMES: readonly string[] = [
  'ALONSITO',
  'MAXVELOZ',
  'SCHUMIKA',
  'LECLERVO',
  'NORRITO',
  'PIASTRINO',
  'SARGUINI',
];

/** Primer índice de paleta de los rivales (el 0 es el rojo del jugador). */
const FIRST_RIVAL_PALETTE_INDEX = 1;

/** Guardas del multiplicador personal (configs basura nunca rompen la escala). */
const SPEED_SCALE_MIN = 0.8;
const SPEED_SCALE_MAX = 1.2;

/**
 * Construye el roster de rivales. Determinista por (seed, difficulty).
 * El orden del roster es el de `RIVAL_NAMES` (canónico, sin mezclar: las
 * casillas de parrilla las asigna `assignGridOrder` con su propia seed).
 */
export function buildRivalRoster(seed: number, difficulty: CpuDifficulty): Rival[] {
  const baseSeed = hashStringToSeed(`${seed >>> 0}:${difficulty}`);
  const rivals: Rival[] = [];
  for (let i = 0; i < RACE_AI.rivalCount; i += 1) {
    const name = RIVAL_NAMES[i % RIVAL_NAMES.length];
    const rng = mulberry32((baseSeed ^ hashStringToSeed(name)) >>> 0);
    const speedPct = (rng() * 2 - 1) * RACE_AI.speedPctSpread;
    const aggression = rng();
    const lineOffsetPx = (rng() * 2 - 1) * RACE_AI.lineOffsetSpreadPx;
    const seedRng = mulberry32((baseSeed ^ hashStringToSeed(`seed:${name}`)) >>> 0);
    const rivalSeed = Math.floor(seedRng() * 0x7fffffff);

    const paletteIndex = FIRST_RIVAL_PALETTE_INDEX + (i % RIVAL_NAMES.length);
    rivals.push({
      peerId: `rival-${i}`,
      name,
      paletteIndex,
      color: MULTIPLAYER.palette[paletteIndex],
      speedScale: Math.min(Math.max(1 + speedPct, SPEED_SCALE_MIN), SPEED_SCALE_MAX),
      aggression,
      lineOffsetPx,
      seed: rivalSeed,
    });
  }
  return rivals;
}

/**
 * Config del `AiDriver` de un rival: preset de dificultad × personalidad.
 * ÚNICO lugar donde se resuelven los presets (RaceScene sólo consume) — así
 * el orden de ritmo por dificultad es testeable sin escena.
 */
export function rivalDriverConfig(rival: Rival, difficulty: CpuDifficulty): AiDriverConfig {
  const fraction = RACE_AI.targetSpeedFraction[difficulty] ?? RACE_AI.targetSpeedFraction.normal;
  const lineScale = RACE_AI.lineSpeedScale[difficulty] ?? RACE_AI.lineSpeedScale.normal;
  return {
    targetSpeedFraction: Math.min(Math.max(fraction * rival.speedScale, 0), 1),
    lineSpeedScale: Math.max(lineScale * rival.speedScale, 0),
    lineOffsetPx: rival.lineOffsetPx,
    lookAheadPx: RACE_AI.lookAheadPx,
    steerDeadzoneRad: RACE_AI.steerDeadzoneRad,
    // Agresividad: recorta el margen de frenada (frena más tarde).
    brakeMarginSpeedPx:
      RACE_AI.brakeMarginSpeedPx * (1 - rival.aggression * RACE_AI.aggressionBrakeGain),
  };
}
