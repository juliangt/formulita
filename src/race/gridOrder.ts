/**
 * gridOrder — parrilla de salida determinista (issue #9, V0).
 *
 * Función pura de (roster, seed, pista) ⇒ casillas: ordena el roster por
 * peerId (canonización), lo mezcla con Fisher–Yates sembrado con `mulberry32`
 * (el MISMO PRNG de `net/roomRng`, que es puro y type-only en sus imports:
 * no arrastra red ni Phaser) y mapea el orden a casillas de 2 columnas
 * escalonadas detrás de la meta. Todos los clientes con el mismo roster y la
 * misma seed calculan EXACTAMENTE la misma parrilla, sin negociación.
 *
 * Casillas: la pole (índice 0) es la más cercana a la meta; cada fila aloja 2
 * autos en laterales ±`CIRCUIT.gridLateralOffsetPx` y cada fila queda
 * `CIRCUIT.gridRowStepPx` de arco detrás de la anterior.
 */

import { CIRCUIT } from '../config/balance';
import { mulberry32 } from '../net/roomRng';
import type { TrackPath } from './trackPath';

/** Mínimo del roster para la parrilla (un peer con peerId). */
export interface GridPlayer {
  peerId: string;
}

/** Casilla de parrilla asignada a un jugador. */
export interface GridSlot {
  /** 0 = pole (más cerca de la meta), 1, 2… en orden de fila. */
  index: number;
  peerId: string;
  /**
   * Coordenada de arco de la casilla. SIN pista: offset NEGATIVO respecto de
   * la meta (px detrás de la línea). CON pista: s absoluto envuelto a
   * [0, totalLength) (siempre detrás de la meta).
   */
  s: number;
  /** Lateral respecto del eje (px; − izquierda, + derecha). */
  lateral: number;
  /** Coordenadas de mundo (sólo si se pasó `TrackPath`). */
  x?: number;
  y?: number;
  /** Orientación de la casilla (sólo con pista; tangente del eje). */
  angle?: number;
}

/**
 * Asigna la parrilla. Misma (players, seed) ⇒ misma parrilla siempre; la
 * pista es opcional y sólo agrega las coordenadas de mundo de cada casilla.
 */
export function assignGridOrder(
  players: readonly GridPlayer[],
  seed: number,
  path?: TrackPath,
): GridSlot[] {
  // Canonización: el orden de llegada del roster no afecta el resultado.
  const sorted = [...players].sort((a, b) => (a.peerId < b.peerId ? -1 : a.peerId > b.peerId ? 1 : 0));
  // Fisher–Yates con mulberry32: misma seed ⇒ misma permutación.
  const rng = mulberry32(seed);
  for (let i = sorted.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = sorted[i];
    sorted[i] = sorted[j];
    sorted[j] = tmp;
  }

  return sorted.map((player, index) => {
    const row = Math.floor(index / 2);
    const column = index % 2;
    const behindPx = CIRCUIT.gridStartOffsetPx + row * CIRCUIT.gridRowStepPx;
    const lateral = column === 0
      ? -CIRCUIT.gridLateralOffsetPx
      : CIRCUIT.gridLateralOffsetPx;
    if (!path) {
      return { index, peerId: player.peerId, s: -behindPx, lateral };
    }
    const s = ((path.totalLength - behindPx) % path.totalLength + path.totalLength)
      % path.totalLength;
    const sample = path.sample(s);
    return {
      index,
      peerId: player.peerId,
      s,
      lateral,
      x: sample.x + Math.cos(sample.angle + Math.PI / 2) * lateral,
      y: sample.y + Math.sin(sample.angle + Math.PI / 2) * lateral,
      angle: sample.angle,
    };
  });
}
