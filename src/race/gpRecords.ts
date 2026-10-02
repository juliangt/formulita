/**
 * gpRecords — récords del GRAN PREMIO por pista × dificultad (issue #14, V4).
 *
 * Qué se recuerda del jugador, POR CADA combinación pista × dificultad:
 * - **Mejor posición** (menor es mejor: 1 = ganador).
 * - **Mejor vuelta** en ms (menor es mejor; `null` = todavía ninguna).
 *
 * Persistencia (mismo patrón declarado del mute en `AudioManager`, clave
 * PROPIA y VERSIONADA `formulita.gp.v1`): es progreso del modo GRAN PREMIO,
 * no se mezcla con el save de la BATALLA ni con otras claves del repo. Todo
 * acceso al storage va envuelto en try/catch y DEGRADA sin lanzar:
 * - JSON corrupto, shape inesperado o campos inválidos → se descartan solos
 *   (el parseo defensivo reconstruye solo lo reconocible).
 * - Storage ausente (sin `window`, tests) o que falla al leer → récords vacíos.
 * - Storage que falla al escribir (modo privado, cuota) → el resultado rige
 *   IGUALMENTE para esta sesión vía el `GpRecords` devuelto (espejo en
 *   memoria del caller); no se reintenta.
 *
 * Puro: sin Phaser, sin escenas — el storage es INYECTADO (contracto
 * `Storage`), así que es testeable directo con Vitest con un fake.
 *
 * Nota de contrato: `saveGpResult` recibe el resultado completo de la carrera
 * (incluido `totalMs`), pero SOLO posición y mejor vuelta son récord: el
 * tiempo total depende del ritmo de los rivales (seed/parrilla), no es una
 * marca estable del jugador.
 */

import { parseCpuDifficulty, type CpuDifficulty } from './results';
import { getTrackById, type TrackId } from './tracks';

/** Clave versionada de los récords del GRAN PREMIO en el storage. */
export const GP_RECORDS_STORAGE_KEY = 'formulita.gp.v1';

/** Récord del jugador en UNA combinación pista × dificultad. */
export interface GpRecord {
  /** Mejor posición alcanzada (1 = ganador; menor es mejor). */
  readonly bestPosition: number;
  /** Mejor vuelta (ms; `null` = todavía no registró ninguna). */
  readonly bestLapMs: number | null;
}

/** Récords agrupados por pista y, dentro de cada pista, por dificultad. */
export interface GpRecords {
  readonly [trackId: string]: Readonly<Partial<Record<CpuDifficulty, GpRecord>>>;
}

/** Resultado de UNA carrera del GRAN PREMIO (lo que llega de los resultados). */
export interface GpRaceResult {
  /** Posición final del jugador (1-based; menor es mejor). */
  readonly position: number;
  /** Mejor vuelta de la carrera (ms; 0/inválido = ninguna válida). */
  readonly bestLapMs: number;
  /**
   * Tiempo total de la carrera (ms). Viaja por completitud del resultado
   * pero NO es récord: depende del ritmo de los rivales (seed/parrilla).
   */
  readonly totalMs: number;
}

/** Lo que devuelve `saveGpResult`: récords actualizados + qué fue récord. */
export interface GpSaveOutcome {
  /** Récords DESPUÉS de aplicar el resultado (persistidos o solo en memoria). */
  readonly records: GpRecords;
  /** true si la posición de esta carrera superó la mejor guardada. */
  readonly positionRecord: boolean;
  /** true si la mejor vuelta de esta carrera superó la guardada. */
  readonly lapRecord: boolean;
}

/** Dificultades reconocidas del modo (cualquier otra clave se descarta). */
const GP_DIFFICULTIES: readonly CpuDifficulty[] = ['easy', 'normal', 'hard'];

/**
 * Storage default para los récords: localStorage del navegador, o `null` si
 * no existe/acceso bloqueado (misma red defensiva que el mute del audio).
 */
export function defaultGpStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Coacciona UNA fila de récord cruda: null si es basura. `bestPosition` debe
 * ser entero ≥ 1 (ancla de la fila: sin posición no hay récord que guardar);
 * `bestLapMs` debe ser finito > 0 o está ausente (`null`).
 */
function parseGpRecord(raw: unknown): GpRecord | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const bestPosition =
    typeof record.bestPosition === 'number' &&
    Number.isInteger(record.bestPosition) &&
    record.bestPosition >= 1
      ? Math.floor(record.bestPosition)
      : null;
  if (bestPosition === null) {
    return null;
  }
  const bestLapMs =
    typeof record.bestLapMs === 'number' &&
    Number.isFinite(record.bestLapMs) &&
    record.bestLapMs > 0
      ? Math.floor(record.bestLapMs)
      : null;
  return { bestPosition, bestLapMs };
}

/**
 * Lee los récords persistidos. Defensivo en CADA capa: storage ausente o
 * roto, JSON corrupto, shape inesperado (array, número, string), pista
 * desconocida, dificultad inválida o fila malformada — todo se descarta sin
 * lanzar y lo reconocible se reconstruye.
 */
export function loadGpRecords(storage: Storage | null): GpRecords {
  if (!storage) {
    return {};
  }
  try {
    const raw = storage.getItem(GP_RECORDS_STORAGE_KEY);
    if (raw === null) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    const source = parsed as Record<string, unknown>;
    const records: Record<string, Partial<Record<CpuDifficulty, GpRecord>>> = {};
    for (const [trackId, byDifficulty] of Object.entries(source)) {
      // Pista desconocida (o de otra build): se descarta, no se reconstruye.
      if (!getTrackById(trackId)) {
        continue;
      }
      if (typeof byDifficulty !== 'object' || byDifficulty === null) {
        continue;
      }
      const bucket = byDifficulty as Record<string, unknown>;
      let entry: Partial<Record<CpuDifficulty, GpRecord>> | null = null;
      for (const difficulty of GP_DIFFICULTIES) {
        const record = parseGpRecord(bucket[difficulty]);
        if (record) {
          entry = entry ?? {};
          entry[difficulty] = record;
        }
      }
      if (entry) {
        records[trackId] = entry;
      }
    }
    return records;
  } catch {
    return {};
  }
}

/**
 * Aplica el resultado de una carrera a los récords de `trackId × difficulty`
 * y persiste el mapa actualizado (best-effort: si el storage falla, el mapa
 * devuelto rige igualmente en memoria). Devuelve qué fue récord:
 * - **Posición**: solo si es ESTRICTAMENTE menor que la guardada (repetir el
 *   mejor puesto no es récord nuevo).
 * - **Vuelta**: solo si es ESTRICTAMENTE menor que la guardada (y válida
 *   > 0; una carrera sin vuelta válida nunca la pisa).
 *
 * Pista desconocida o primer resultado sin posición válida no toca nada (la
 * posición es el ancla del récord: en la práctica el payload siempre viaja
 * coerccionada ≥ 1).
 */
export function saveGpResult(
  storage: Storage | null,
  trackId: TrackId,
  difficulty: CpuDifficulty,
  result: GpRaceResult,
): GpSaveOutcome {
  const records = loadGpRecords(storage);
  if (!getTrackById(trackId)) {
    return { records, positionRecord: false, lapRecord: false };
  }
  const cleanDifficulty = parseCpuDifficulty(difficulty);
  const position =
    Number.isInteger(result.position) && result.position >= 1
      ? Math.floor(result.position)
      : null;
  const bestLapMs =
    Number.isFinite(result.bestLapMs) && result.bestLapMs > 0
      ? Math.floor(result.bestLapMs)
      : null;
  const previous = records[trackId]?.[cleanDifficulty] ?? null;

  const positionRecord =
    position !== null && (previous === null || position < previous.bestPosition);
  const lapRecord =
    bestLapMs !== null &&
    (previous === null || previous.bestLapMs === null || bestLapMs < previous.bestLapMs);

  // Sin nada que cambiar (basura en la primera carga o resultados peores),
  // no se reescribe el storage: los récords quedan como están.
  if (!positionRecord && !lapRecord) {
    return { records, positionRecord: false, lapRecord: false };
  }

  // La posición es el ANCLA del récord: sin récord previo y sin posición
  // válida no hay fila que crear (una vuelta sin puesto no se puede guardar).
  const next: GpRecord | null =
    previous === null
      ? position !== null
        ? { bestPosition: position, bestLapMs }
        : null
      : {
          bestPosition: positionRecord ? (position as number) : previous.bestPosition,
          bestLapMs: lapRecord ? (bestLapMs as number) : previous.bestLapMs,
        };
  if (next === null) {
    return { records, positionRecord: false, lapRecord: false };
  }
  const updated: Record<string, Record<string, GpRecord>> = {
    ...(records as Record<string, Record<string, GpRecord>>),
    [trackId]: {
      ...((records[trackId] ?? {}) as Record<string, GpRecord>),
      [cleanDifficulty]: next,
    },
  };
  if (storage) {
    try {
      storage.setItem(GP_RECORDS_STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // Modo privado / cuota: los récords rigen igualmente vía el retorno.
    }
  }
  return { records: updated, positionRecord, lapRecord };
}
