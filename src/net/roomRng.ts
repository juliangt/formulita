/**
 * roomRng — RNG determinista compartido por sala (M0, multijugador).
 *
 * El multijugador necesita que todos los clientes con la misma seed generen
 * EXACTAMENTE la misma pista: ni `Math.random` ni `Date.now` pueden aparecer
 * en el camino de generación. Este módulo centraliza las tres piezas puras
 * de azar reproducible:
 *
 * - `mulberry32(seed)`: PRNG estándar en [0, 1) a partir de una semilla de
 *   32 bits. Es el MISMO algoritmo que ya usaban los tests del scheduler,
 *   así producción y specs comparten secuencia.
 * - `deriveRng(seed, spawnIndex)`: semillas derivadas por entidad, para que
 *   cada rival spawnneado tenga su propio stream de azar sin interferir con
 *   el del scheduler. La derivación es un hash entero (multiplicación con
 *   constantes grandes + xor + shift, todo con `Math.imul` para mantener el
 *   código en 32 bits): determinista en cualquier dispositivo con IEEE 754.
 * - `hashStringToSeed(s)`: convierte una palabra clave (código de sala,
 *   nombre del host…) en semilla numérica, difiriendo por carácter.
 *
 * Todo es función pura sin estado compartido: crear, sembrar y descartar.
 */

import type { Rng } from '../systems/SpawnSystem';

export type { Rng } from '../systems/SpawnSystem';

/** Máscara de 32 bits sin signo. */
const UINT32_MASK = 0xffffffff;

/** Pasos intermedios del finalizador avalanche (murmu/hash-mix clásico). */
function finalizeHash(h: number): number {
  let x = h | 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return x >>> 0;
}

/**
 * PRNG mulberry32: devuelve un generador en [0, 1) sembrado con `seed`.
 * Misma seed → misma secuencia, en cualquier plataforma con `Math.imul`
 * (enteros de 32 bits exactos). La semilla se normaliza a uint32.
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) & UINT32_MASK;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Mezcla la seed de la sala con el índice de spawn (hash entero): dispersión
 * rápida y uniforme, sensible a ambos operandos, sin colisiones triviales
 * entre índices consecutivos.
 */
function mixEntitySeed(seed: number, spawnIndex: number): number {
  // El xor inicial con la constante áurea desacopla seeds pequeñas (0, 1…).
  let h = ((seed >>> 0) ^ 0x9e3779b9) | 0;
  // Se incorpora el índice ANTES del finalizador para que ambos operandos
  // atraviesen la mezcla completa (xor solo al final dejaría bits bajos
  // correlacionados entre índices vecinos).
  h = (h ^ Math.imul((spawnIndex >>> 0) + 0x9e3779b9, 0x85ebca6b)) | 0;
  return finalizeHash(h);
}

/**
 * RNG por entidad: cada spawn recibe un stream independiente derivado de
 * (seed de la sala, índice de spawn). Determinista y distinto por índice:
 * el rival #3 de una carrera es exactamente el mismo en todos los clientes.
 */
export function deriveRng(seed: number, spawnIndex: number): Rng {
  return mulberry32(mixEntitySeed(seed, spawnIndex));
}

/**
 * Convierte un string en semilla numérica (FNV-1a de 32 bits + finalizador
 * avalanche). Determinista y sensible a cada carácter (posición incluida):
 * "sala-1" y "sala-2" producen seeds no correlacionadas.
 */
export function hashStringToSeed(s: string): number {
  // Offset basis y primo de FNV-1a 32 bits.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return finalizeHash(h);
}

/**
 * Semilla uint32 aleatoria para una sala nueva (M1): la genera el ANFITRIÓN
 * al INICIAR y viaja en el payload `start`. Crypto si existe; fallback
 * mixto para entornos sin WebCrypto. Es la ÚNICA fuente de azar de la sala:
 * a partir de acá todo el pipeline es determinista (mulberry32/deriveRng).
 */
export function randomRoomSeed(): number {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const buffer = new Uint32Array(1);
    crypto.getRandomValues(buffer);
    return buffer[0] >>> 0;
  }
  return hashStringToSeed(`${Date.now()}-${Math.random()}`) >>> 0;
}
