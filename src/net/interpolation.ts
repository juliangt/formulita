/**
 * interpolation.ts — buffer de snapshots para interpolar estados remotos.
 *
 * El stream de estado llega a 10 Hz y el mundo corre a 60 FPS: pintar el auto
 * rival en el último estado recibido produce teletransportes de ~36 px cada
 * 100 ms. La solución estándar es RENDERIZAR EN EL PASADO: se dibuja en
 * `t − GHOST_INTERPOLATION_MS` (un intervalo entero del stream), donde
 * SIEMPRE hay dos snapshots entre los que interpolar linealmente.
 *
 * `SnapshotBuffer` es 100% puro (sin Phaser, sin red): acumula snapshots
 * timestamped por jugador y resuelve `renderAt(t)`:
 *
 * - t entre dos snapshots → interpolación lineal (posición continua).
 * - t más viejo que el buffer → el PRIMER snapshot (clamp, nunca hacia atrás).
 * - t más nuevo que el último → extrapolación con la velocidad de los dos
 *   últimos, ACOTADA a `maxExtrapolationMs`: pasado el techo el punto se
 *   congela (sin teletransporte ni vuelos por la pista).
 *
 * Los snapshots fuera de orden (t ≤ último conocido) se descartan: la red
 * en malla puede entregar desordenado, y aceptarlos rompería la monotonía.
 *
 * GENERALIZACIÓN (issue #9, V2): la clase es GENÉRICA sobre la forma del
 * snapshot (`P extends TimestampedSample`) y interpola/extrapola TODOS sus
 * campos numéricos salvo `t`. Con el default `GhostSnapshot {t, distance, x}`
 * el comportamiento es EXACTAMENTE el de la BATALLA (#1, sin tocar nada);
 * la carrera en circuito usa el mismo buffer con `{t, progress, o}` — el
 * progreso desenrollado `lap × L + s` es monótono (no envuelve en la meta),
 * así que la interpolación lineal también es válida ahí.
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

/** Contrato mínimo de un snapshot interpolable: su marca de tiempo. */
export interface TimestampedSample {
  readonly t: number;
}

/** El snapshot sin su marca de tiempo (lo que devuelve `renderAt`). */
export type SnapshotFields<P extends TimestampedSample> = Omit<P, 't'>;

/** Opciones del buffer (todas con default de balance). */
export interface SnapshotBufferOptions {
  /** Snapshots conservados (los viejos se descartan; default 20 ≈ 2 s). */
  readonly capacity?: number;
  /** Techo de extrapolación en ms (default: un intervalo del stream). */
  readonly maxExtrapolationMs?: number;
}

/** Claves numéricas interpolables de un snapshot (todas menos `t`). */
function numericKeys(sample: TimestampedSample): string[] {
  return Object.keys(sample).filter((key) => key !== 't');
}

/** Mezcla lineal de TODOS los campos numéricos de a→b a fracción `ratio`. */
function blendFields<P extends TimestampedSample>(a: P, b: P, ratio: number): SnapshotFields<P> {
  const out: Record<string, number> = {};
  const sourceA = a as unknown as Record<string, unknown>;
  const sourceB = b as unknown as Record<string, unknown>;
  for (const key of numericKeys(a)) {
    const va = typeof sourceA[key] === 'number' ? (sourceA[key] as number) : 0;
    const vb = typeof sourceB[key] === 'number' ? (sourceB[key] as number) : 0;
    out[key] = va + (vb - va) * ratio;
  }
  return out as SnapshotFields<P>;
}

export class SnapshotBuffer<P extends TimestampedSample = GhostSnapshot> {
  private readonly capacity: number;
  private readonly maxExtrapolationMs: number;
  private snapshots: P[] = [];

  constructor(options: SnapshotBufferOptions = {}) {
    this.capacity = Math.max(2, Math.floor(options.capacity ?? SNAPSHOT_BUFFER_SIZE));
    this.maxExtrapolationMs = Math.max(0, options.maxExtrapolationMs ?? GHOST_MAX_EXTRAPOLATION_MS);
  }

  /** Cantidad de snapshots acumulados (para tests/debug). */
  get size(): number {
    return this.snapshots.length;
  }

  /** Último snapshot recibido (null si nunca llegó ninguno). */
  get latest(): P | null {
    return this.snapshots.length > 0 ? this.snapshots[this.snapshots.length - 1] : null;
  }

  /** Descarta todo el historial (reinicio de carrera). */
  clear(): void {
    this.snapshots = [];
  }

  /**
   * Registra un snapshot. Fuera de orden (t ≤ último) o con algún campo no
   * numérico finito: se descarta — la monotonía del buffer es lo que hace a
   * la interpolación confiable.
   */
  push(sample: P): void {
    for (const value of Object.values(sample)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return;
      }
    }
    const last = this.latest;
    if (last && sample.t <= last.t) {
      return;
    }
    this.snapshots.push(sample);
    if (this.snapshots.length > this.capacity) {
      this.snapshots.shift();
    }
  }

  /**
   * Estado para renderizar en el instante `t` (ms, sin `t` en el resultado):
   * interpolación entre los snapshots que rodean t, clamp al primero si t es
   * más viejo, extrapolación acotada si es más nuevo. `null` sin datos.
   */
  renderAt(t: number): SnapshotFields<P> | null {
    if (this.snapshots.length === 0 || !Number.isFinite(t)) {
      return null;
    }

    // t anterior a todo el buffer → clamp al primer snapshot (nunca atrás).
    const first = this.snapshots[0];
    if (t <= first.t) {
      return blendFields(first, first, 0);
    }

    // t posterior al último → extrapolación con la velocidad de los dos
    // últimos, con techo: entre el último snapshot y t hay a lo sumo
    // maxExtrapolationMs de proyección.
    const last = this.snapshots[this.snapshots.length - 1];
    if (t >= last.t) {
      const cappedT = Math.min(t, last.t + this.maxExtrapolationMs);
      if (this.snapshots.length === 1 || cappedT === last.t) {
        return blendFields(last, last, 0);
      }
      const previous = this.snapshots[this.snapshots.length - 2];
      return blendFields(previous, last, 1 + (cappedT - last.t) / (last.t - previous.t));
    }

    // t está dentro del buffer: interpolar entre los dos que lo rodean.
    for (let i = 0; i < this.snapshots.length - 1; i += 1) {
      const a = this.snapshots[i];
      const b = this.snapshots[i + 1];
      if (t >= a.t && t <= b.t) {
        return blendFields(a, b, (t - a.t) / (b.t - a.t));
      }
    }
    // Inalcanzable (t > first y < last garantiza un par), pero defensivo:
    return blendFields(last, last, 0);
  }
}
