/**
 * raceRemote — reconstrucción de autos remotos del circuito (issue #9, V2).
 *
 * El wire viaja en coordenadas de PISTA (`rstate {s, o, v, lap}`): la
 * posición de mundo la reconstruye CADA cliente con su TrackPath local
 * (determinista), así no viaja ni un float de mundo por la red.
 *
 * La clave es interpolar el progreso DESENROLLADO `lap × L + s`: ese escalar
 * es MONÓTONO (cruzar la meta NO lo envuelve — sube de lap 0 a lap 1 con la
 * misma `s`), así la interpolación lineal del `SnapshotBuffer` es válida en
 * la meta. Sólo al RECONSTRUIR la posición se re-envuelve `s = progress mod L`.
 *
 * Puro: TrackPath es geometría pura — testeable headless con Vitest.
 */

import type { TrackPath } from './trackPath';

/**
 * Snapshot del stream de un auto remoto (por peer, en su `SnapshotBuffer`):
 * `progress` es el progreso desenrollado (px, monótono) y `o` el lateral
 * (px, con signo respecto del eje).
 */
export interface RaceRemoteSample {
  /** Marca de tiempo de recepción (ms del reloj local). */
  readonly t: number;
  /** Progreso desenrollado `lap × L + s` (px). */
  readonly progress: number;
  /** Offset lateral con signo (px). */
  readonly o: number;
}

/** Progreso desenrollado desde (lap, s): `lap × L + s` (defensa no finitos). */
export function unrollProgress(lap: number, s: number, lapLength: number): number {
  const length = Number.isFinite(lapLength) && lapLength > 0 ? lapLength : 1;
  const cleanLap = Number.isFinite(lap) && lap > 0 ? Math.floor(lap) : 0;
  const cleanS = Number.isFinite(s) && s > 0 ? s : 0;
  return cleanLap * length + cleanS;
}

/**
 * Re-envuelve un progreso desenrollado a (lap, s) con `s ∈ [0, L)`.
 * CORRECCIÓN FLOAT: `lap × L + s` puede redondear por debajo del múltiplo
 * exacto de L (p. ej. 3L con L irracional-ish), dejando `s ≈ L` con un lap
 * de menos; un margen relativo minúsculo (1e-9 de L) re-encuadra esos casos
 * al cruce de meta exacto (lap+1, s=0).
 */
export function wrapProgress(
  progress: number,
  lapLength: number,
): { lap: number; s: number } {
  const length = Number.isFinite(lapLength) && lapLength > 0 ? lapLength : 1;
  const clean = Number.isFinite(progress) && progress > 0 ? progress : 0;
  const lap = Math.floor(clean / length);
  const s = clean % length;
  // s puede caer a una épsilon de L (o de 0) por el redondeo de lap × L + s.
  // En el borde, el lap correcto es el COCIENTE REDONDEADO (clean está a una
  // épsilon del múltiplo exacto de L, venga por arriba o por abajo).
  if (length - s <= length * WRAP_EPSILON_RATIO) {
    return { lap: Math.round(clean / length), s: 0 };
  }
  if (s < length * WRAP_EPSILON_RATIO) {
    return { lap, s: 0 };
  }
  return { lap, s };
}

/** Margen relativo de la corrección float de la envoltura (fracción de L). */
const WRAP_EPSILON_RATIO = 1e-9;

/** Posición reconstruida de un auto remoto: {x, y, heading} del mundo. */
export interface RemoteWorldPosition {
  readonly x: number;
  readonly y: number;
  /** Orientación del auto (radianes; la tangente del eje en s). */
  readonly angle: number;
}

/**
 * Reconstruye la posición de mundo de un auto remoto a partir de su
 * progreso desenrollado y su lateral: `sample(progress mod L)` desplazado
 * `lateral` px sobre la normal (perpendicular a la tangente). Continua a
 * través de la meta: progreso L−1 y L+1 caen a ambos lados de s=0.
 */
export function sampleFromProgress(
  path: TrackPath,
  progress: number,
  lateral: number,
): RemoteWorldPosition {
  const { s } = wrapProgress(progress, path.totalLength);
  const sample = path.sample(s);
  const normal = sample.angle + Math.PI / 2;
  const offset = Number.isFinite(lateral) ? lateral : 0;
  return {
    x: sample.x + Math.cos(normal) * offset,
    y: sample.y + Math.sin(normal) * offset,
    angle: sample.angle,
  };
}
