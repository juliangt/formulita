/**
 * results — payloads de carrera en circuito (issue #9, V1).
 *
 * Mismo criterio que `GameOverData`/`MultiGameOverData`: los datos viajan
 * como INIT DATA DE ESCENA (`scene.start(KEY, payload)`) y el receptor los
 * parsea de forma defensiva. Dos contratos:
 *
 * - `parseRaceSceneInit`: lo que MenuScene (y el REINTENTAR de resultados)
 *   le pasa a RaceScene: `{ trackId, mode: 'practice' }`. Un id desconocido
 *   degrada a la primera pista (MÓNACO) — mismo espíritu defensivo que el
 *   resto del parseo de init data.
 * - `parseRacePracticeResults`: lo que RaceScene le pasa a GameOverScene al
 *   terminar la carrera de práctica. Devuelve `null` si el payload no es de
 *   esta rama (la pantalla de resultados mantiene su comportamiento previo).
 *
 * Puro: sin Phaser, sin escenas — testeable directo con Vitest.
 */

import { TRACKS, getTrackById, type TrackId } from './tracks';

/** Modo de la RaceScene. V1 sólo tiene práctica local; V2 agregará 'multi'. */
export type RaceMode = 'practice';

/** Init data de RaceScene (parseado defensivo en `parseRaceSceneInit`). */
export interface RaceSceneInit {
  trackId: TrackId;
  mode: RaceMode;
}

/** Primera pista del registro (default de la escena). */
export function defaultTrackId(): TrackId {
  return TRACKS[0].id;
}

/**
 * Parseo defensivo del init data de RaceScene. Acepta `{trackId, mode}`;
 * omisiones o basura degradan a `{ trackId: default, mode: 'practice' }` —
 * la escena siempre puede arrancar.
 */
export function parseRaceSceneInit(raw: unknown): RaceSceneInit {
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const trackId =
    typeof record.trackId === 'string' && getTrackById(record.trackId)
      ? (record.trackId as TrackId)
      : defaultTrackId();
  // V1 sólo tiene práctica local: cualquier valor degrada al único modo.
  const mode: RaceMode = 'practice';
  return { trackId, mode };
}

/** Resultados de la carrera de práctica (payload RaceScene → GameOverScene). */
export interface RacePracticeResultsData {
  mode: RaceMode;
  trackId: TrackId;
  /** Nombre visible de la pista (ya viene resuelto de TRACKS). */
  trackName: string;
  /** Vueltas completadas válidas. */
  laps: number;
  /** Mejor vuelta de la carrera (ms; 0 si ninguna). */
  bestLapMs: number;
  /** Tiempo total desde el GO! (ms). */
  totalMs: number;
}

/**
 * Arma el payload de resultados a partir del id de pista (resuelve el nombre
 * contra el registro; id desconocido → nombre vacío, el parseo del receptor
 * es defensivo igualmente).
 */
export function racePracticeResultsPayload(
  trackId: TrackId,
  laps: number,
  bestLapMs: number,
  totalMs: number,
): RacePracticeResultsData {
  const trackName = getTrackById(trackId)?.name ?? '';
  return {
    mode: 'practice',
    trackId,
    trackName,
    laps: Number.isFinite(laps) ? Math.max(0, Math.floor(laps)) : 0,
    bestLapMs: Number.isFinite(bestLapMs) && bestLapMs > 0 ? Math.floor(bestLapMs) : 0,
    totalMs: Number.isFinite(totalMs) && totalMs > 0 ? Math.floor(totalMs) : 0,
  };
}

/**
 * Parseo defensivo del payload de resultados de práctica. Devuelve `null`
 * cuando el payload corresponde a otra rama de GameOverScene (modo solo
 * clásico o multi): así la pantalla decide su rama con un solo chequeo.
 */
export function parseRacePracticeResults(raw: unknown): RacePracticeResultsData | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (record.mode !== 'practice') {
    return null;
  }
  const trackId =
    typeof record.trackId === 'string' && getTrackById(record.trackId)
      ? (record.trackId as TrackId)
      : defaultTrackId();
  return {
    mode: 'practice',
    trackId,
    trackName: typeof record.trackName === 'string' ? record.trackName : '',
    laps: typeof record.laps === 'number' && Number.isFinite(record.laps)
      ? Math.max(0, Math.floor(record.laps))
      : 0,
    bestLapMs: typeof record.bestLapMs === 'number' && Number.isFinite(record.bestLapMs)
      ? Math.max(0, Math.floor(record.bestLapMs))
      : 0,
    totalMs: typeof record.totalMs === 'number' && Number.isFinite(record.totalMs)
      ? Math.max(0, Math.floor(record.totalMs))
      : 0,
  };
}
