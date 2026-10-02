/**
 * lapTracker — vueltas, sectores y anti-corte (issue #9, V0).
 *
 * Consume SOLO el avance propio: por frame, la coordenada de arco `s` (la da
 * `TrackPath.project`) y el delta de tiempo. Reglas:
 *
 * - La vuelta cuenta ÚNICAMENTE al cruzar la meta (envoltura s = L → 0 con
 *   avance hacia adelante) habiendo pisado TODOS los sectores EN ORDEN desde
 *   el último cruce. El orden se verifica con un puntero de sector que sólo
 *   avanza cuando el sector actual coincide con el esperado; un contador de
 *   avances debe llegar exactamente a `sectorCount` al cruzar.
 * - Cortar por el pasto salta sectores: el puntero no avanza y el contador no
 *   llega ⇒ el atajo NO suma vuelta (y el cruce reinicia el intento).
 * - Retroceder sobre la meta no cuenta ni reinicia: sólo la envoltura hacia
 *   adelante es un cruce. Re-pisar sectores hacia atrás no avanza el puntero.
 * - La vuelta 1 arranca en el primer update (semáforo en verde); la parrilla
 *   está DETRÁS de la línea, así que el PRIMER cruce (parrilla → meta) NO
 *   completa vuelta: el auto arranca en el último sector con el puntero
 *   esperando el sector 0, llega con 0 sectores pisados y el cruce sólo
 *   REINICIA el intento — es la puesta en marcha de la vuelta 1. Cada vuelta
 *   válida exige pisar los 8 sectores EN ORDEN después de ese primer cruce.
 *
 * Timing: vuelta actual, última vuelta y mejor vuelta, en ms, acumulados con
 * los `deltaMs` de cada update. Los eventos `onLapCompleted`/`onRaceFinished`
 * son el gancho de V1/V2 (HUD, sync multijugador).
 */

import { CIRCUIT } from '../config/balance';
import type { TrackPath } from './trackPath';

/** Datos del evento de vuelta completada. */
export interface LapCompletedEvent {
  /** Número de vuelta completada (1-based). */
  lap: number;
  /** Tiempo de la vuelta que acaba de completarse (ms). */
  lapMs: number;
  /** Mejor vuelta acumulada hasta ahora (ms). */
  bestLapMs: number;
  /** Tiempo total desde el arranque (ms). */
  totalMs: number;
}

export interface LapTrackerOptions {
  /** Vueltas de la carrera (default `CIRCUIT.totalLaps`). */
  totalLaps?: number;
}

export class LapTracker {
  /** Evento al completar una vuelta válida (V1/V2: HUD, broadcast). */
  onLapCompleted: ((event: LapCompletedEvent) => void) | null = null;

  /** Evento al completar la última vuelta (fin de carrera para este auto). */
  onRaceFinished: ((event: LapCompletedEvent) => void) | null = null;

  private readonly totalLaps: number;
  private readonly sectorCount: number;

  /** Última `s` vista (null hasta el primer update). */
  private lastS: number | null = null;
  /** Próximo sector esperado (avanza sólo en orden). */
  private nextSector = 0;
  /** Sectores pisados EN ORDEN desde el último cruce de meta. */
  private sectorsStepped = 0;

  private completedLaps = 0;
  private currentLapMsValue = 0;
  private lastLapMsValue = 0;
  private bestLapMsValue = 0;
  private totalMsValue = 0;
  private finishedFlag = false;

  constructor(
    private readonly path: TrackPath,
    options: LapTrackerOptions = {},
  ) {
    this.totalLaps = Math.max(1, Math.floor(options.totalLaps ?? CIRCUIT.totalLaps));
    this.sectorCount = Math.max(1, path.sectorWindows.length);
  }

  /** Vueltas completadas válidas. */
  get lapsCompleted(): number {
    return this.completedLaps;
  }

  /** Vuelta en curso (1-based; queda en `totalLaps` al terminar). */
  get currentLap(): number {
    return Math.min(this.completedLaps + 1, this.totalLaps);
  }

  /** ms de la vuelta en curso (se resetea en cada cruce válido). */
  get currentLapMs(): number {
    return this.currentLapMsValue;
  }

  /** ms de la última vuelta completada (0 si no hay ninguna). */
  get lastLapMs(): number {
    return this.lastLapMsValue;
  }

  /** ms de la mejor vuelta completada (0 si no hay ninguna). */
  get bestLapMs(): number {
    return this.bestLapMsValue;
  }

  /** ms totales acumulados desde el primer update. */
  get totalMs(): number {
    return this.totalMsValue;
  }

  /** true al completar `totalLaps` vueltas válidas. */
  get finished(): boolean {
    return this.finishedFlag;
  }

  /**
   * Consume el avance del frame: `s` en unidades de arco (envuelta por
   * `project` a [0, L)) y `deltaMs` del frame. `s`/`deltaMs` no finitos son
   * no-op (defensa contra proyecciones corruptas).
   */
  update(s: number, deltaMs: number): void {
    if (!Number.isFinite(s) || !Number.isFinite(deltaMs)) {
      return;
    }
    const wrapped = ((s % this.path.totalLength) + this.path.totalLength)
      % this.path.totalLength;
    const delta = Math.max(0, deltaMs);
    this.totalMsValue += delta;

    if (this.lastS !== null) {
      const raw = wrapped - this.lastS;
      const length = this.path.totalLength;
      // Envoltura hacia adelante = cruce de meta (avanzando).
      const crossedForward = raw < -length / 2;
      // Envoltura hacia atrás = retroceso sobre la meta: no cuenta.
      const crossedBackward = raw > length / 2;
      if (crossedForward) {
        this.handleLineCrossing();
      } else if (!crossedBackward) {
        this.markSector(wrapped);
      }
    }
    this.lastS = wrapped;

    if (!this.finishedFlag) {
      this.currentLapMsValue += delta;
    }
  }

  /** Reinicia todo (arranque de carrera / restart). */
  reset(): void {
    this.lastS = null;
    this.nextSector = 0;
    this.sectorsStepped = 0;
    this.completedLaps = 0;
    this.currentLapMsValue = 0;
    this.lastLapMsValue = 0;
    this.bestLapMsValue = 0;
    this.totalMsValue = 0;
    this.finishedFlag = false;
  }

  /** Cruce de meta hacia adelante: valida sectores y cierra vuelta. */
  private handleLineCrossing(): void {
    const completedAllSectors = this.sectorsStepped === this.sectorCount;
    // El intento (válido o cortado) siempre recomienza acá.
    this.nextSector = 0;
    this.sectorsStepped = 0;

    if (!completedAllSectors || this.finishedFlag) {
      return;
    }

    this.completedLaps += 1;
    const lapMs = this.currentLapMsValue;
    this.currentLapMsValue = 0;
    this.lastLapMsValue = lapMs;
    if (this.bestLapMsValue === 0 || lapMs < this.bestLapMsValue) {
      this.bestLapMsValue = lapMs;
    }
    const event: LapCompletedEvent = {
      lap: this.completedLaps,
      lapMs,
      bestLapMs: this.bestLapMsValue,
      totalMs: this.totalMsValue,
    };
    this.onLapCompleted?.(event);
    if (this.completedLaps >= this.totalLaps) {
      this.finishedFlag = true;
      this.onRaceFinished?.(event);
    }
  }

  /** Marca el sector actual si coincide con el esperado (avance en orden). */
  private markSector(s: number): void {
    const index = this.path.sectorIndexOf(s);
    if (index === this.nextSector) {
      this.nextSector = (this.nextSector + 1) % this.sectorCount;
      this.sectorsStepped += 1;
    }
  }
}
