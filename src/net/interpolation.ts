/**
 * interpolation.ts — buffer de snapshots para interpolar fantasmas (M2).
 *
 * El stream `state` llega a 10 Hz y el mundo corre a 60 FPS: pintar el auto
 * rival en el último estado recibido produce teletransportes de ~36 px cada
 * 100 ms. La solución estándar es RENDERIZAR EN EL PASADO: se dibuja en
 * `t − GHOST_INTERPOLATION_MS` (un intervalo entero del stream), donde
 * SIEMPRE hay dos snapshots entre los que interpolar linealmente.
 *
 * `SnapshotBuffer` es 100% puro (sin Phaser, sin red): acumula estados
 * {t, distance, x} por jugador y resuelve `renderAt(t)`:
 *
 * - t entre dos snapshots → interpolación lineal (posición continua).
 * - t más viejo que el buffer → el PRIMER snapshot (clamp, nunca hacia atrás).
 * - t más nuevo que el último → extrapolación con la velocidad de los dos
 *   últimos, ACOTADA a `maxExtrapolationMs`: pasado el techo el punto se
 *   congela (sin teletransporte ni vuelos por la pista).
 *
 * Los snapshots fuera de orden (t ≤ último conocido) se descartan: la red
 * en malla puede entregar desordenado, y aceptarlos rompería la monotonía.
 */

import { GHOST_MAX_EXTRAPOLATION_MS, SNAPSHOT_BUFFER_SIZE } from '../config/balance';

/** Un estado muestreado del stream de un rival (todo en px, t en ms). */
export interface GhostSnapshot {
  /** Marca de tiempo del snapshot (ms del reloj local de recepción). */
  readonly t: number;
  /** Distancia recorrida por el rival (px). */
  readonly distance: number;
  /** Posición lateral del rival (px). */
  readonly x: number;
}

/** Posición interpolada para renderizar (mismas unidades que el snapshot). */
export interface InterpolatedPoint {
  readonly distance: number;
  readonly x: number;
}

/** Opciones del buffer (todas con default de balance). */
export interface SnapshotBufferOptions {
  /** Snapshots conservados (los viejos se descartan; default 20 ≈ 2 s). */
  readonly capacity?: number;
  /** Techo de extrapolación en ms (default: un intervalo del stream). */
  readonly maxExtrapolationMs?: number;
}

export class SnapshotBuffer {
  private readonly capacity: number;
  private readonly maxExtrapolationMs: number;
  private snapshots: GhostSnapshot[] = [];

  constructor(options: SnapshotBufferOptions = {}) {
    this.capacity = Math.max(2, Math.floor(options.capacity ?? SNAPSHOT_BUFFER_SIZE));
    this.maxExtrapolationMs = Math.max(0, options.maxExtrapolationMs ?? GHOST_MAX_EXTRAPOLATION_MS);
  }

  /** Cantidad de snapshots acumulados (para tests/debug). */
  get size(): number {
    return this.snapshots.length;
  }

  /** Último snapshot recibido (null si nunca llegó ninguno). */
  get latest(): GhostSnapshot | null {
    return this.snapshots.length > 0 ? this.snapshots[this.snapshots.length - 1] : null;
  }

  /** Descarta todo el historial (reinicio de carrera). */
  clear(): void {
    this.snapshots = [];
  }

  /**
   * Registra un snapshot. Fuera de orden (t ≤ último) o con campos no
   * finitos: se descarta — la monotonía del buffer es lo que hace a la
   * interpolación confiable.
   */
  push(snapshot: GhostSnapshot): void {
    if (
      !Number.isFinite(snapshot.t) ||
      !Number.isFinite(snapshot.distance) ||
      !Number.isFinite(snapshot.x)
    ) {
      return;
    }
    const last = this.latest;
    if (last && snapshot.t <= last.t) {
      return;
    }
    this.snapshots.push(snapshot);
    if (this.snapshots.length > this.capacity) {
      this.snapshots.shift();
    }
  }

  /**
   * Posición para renderizar en el instante `t` (ms):
   * interpolación entre los snapshots que rodean t, clamp al primero si t es
   * más viejo, extrapolación acotada si es más nuevo. `null` sin datos.
   */
  renderAt(t: number): InterpolatedPoint | null {
    if (this.snapshots.length === 0 || !Number.isFinite(t)) {
      return null;
    }

    // t anterior a todo el buffer → clamp al primer snapshot (nunca atrás).
    const first = this.snapshots[0];
    if (t <= first.t) {
      return { distance: first.distance, x: first.x };
    }

    // t posterior al último → extrapolación con la velocidad de los dos
    // últimos, con techo: entre el último snapshot y t hay a lo sumo
    // maxExtrapolationMs de proyección.
    const last = this.snapshots[this.snapshots.length - 1];
    if (t >= last.t) {
      const cappedT = Math.min(t, last.t + this.maxExtrapolationMs);
      if (this.snapshots.length === 1 || cappedT === last.t) {
        return { distance: last.distance, x: last.x };
      }
      const previous = this.snapshots[this.snapshots.length - 2];
      return extrapolate(previous, last, cappedT);
    }

    // t está dentro del buffer: interpolar entre los dos que lo rodean.
    for (let i = 0; i < this.snapshots.length - 1; i += 1) {
      const a = this.snapshots[i];
      const b = this.snapshots[i + 1];
      if (t >= a.t && t <= b.t) {
        return interpolate(a, b, t);
      }
    }
    // Inalcanzable (t > first y < last garantiza un par), pero defensivo:
    return { distance: last.distance, x: last.x };
  }
}

/** Interpolación lineal a->b en el instante t. */
function interpolate(a: GhostSnapshot, b: GhostSnapshot, t: number): InterpolatedPoint {
  const span = b.t - a.t;
  if (span <= 0) {
    return { distance: b.distance, x: b.x };
  }
  const ratio = (t - a.t) / span;
  return {
    distance: a.distance + (b.distance - a.distance) * ratio,
    x: a.x + (b.x - a.x) * ratio,
  };
}

/** Extrapolación lineal desde b, con la pendiente de a->b, hasta cappedT. */
function extrapolate(a: GhostSnapshot, b: GhostSnapshot, cappedT: number): InterpolatedPoint {
  const span = b.t - a.t;
  if (span <= 0) {
    return { distance: b.distance, x: b.x };
  }
  const ratio = (cappedT - b.t) / span;
  return {
    distance: b.distance + (b.distance - a.distance) * ratio,
    x: b.x + (b.x - a.x) * ratio,
  };
}
