/**
 * results — payloads de carrera en circuito (issue #9, V1/V2).
 *
 * Mismo criterio que `GameOverData`/`MultiGameOverData`: los datos viajan
 * como INIT DATA DE ESCENA (`scene.start(KEY, payload)`) y el receptor los
 * parsea de forma defensiva. Contratos:
 *
 * - `parseRaceSceneInit`: lo que MenuScene (y el REINTENTAR de resultados)
 *   le pasa a RaceScene en práctica: `{ trackId, mode: 'practice' }`, o lo
 *   que LobbyScene le pasa en multi (V2): `{ mode: 'race', trackId, seed,
 *   players, myPeerId }`, o lo del GRAN PREMIO vs CPU (#14): `{ mode:
 *   'vs-cpu', trackId, difficulty, seed }`. Un id desconocido degrada a la
 *   primera pista (MÓNACO) y un `race` inválido degrada a práctica — mismo
 *   espíritu defensivo que el resto del parseo de init data.
 * - `parseRacePracticeResults`: lo que RaceScene le pasa a GameOverScene al
 *   terminar la carrera de práctica. Devuelve `null` si el payload no es de
 *   esta rama (la pantalla de resultados mantiene su comportamiento previo).
 * - `parseRaceVsCpuResults` (#14): resultados del GRAN PREMIO vs CPU
 *   (posición final, rivales, dificultad), mismo patrón que la práctica.
 * - `parseRaceMultiResults` (V2): lo que RaceScene le pasa a GameOverScene
 *   al concluir la carrera MULTI (clasificación de `finalClassification`).
 * - `fastestRaceLap` (V4): elige la vuelta rápida de la carrera multi entre
 *   los `rfin` recibidos — viaja en el payload de resultados para el podio.
 *
 * Puro: sin Phaser, sin escenas — testeable directo con Vitest.
 */

import type { PlayerInfo } from '../net/protocol';
import { parsePlayerInfoList } from '../net/protocol';
import type { FinalStanding as RaceFinalStanding } from './raceRanking';
import { TRACKS, getTrackById, type TrackId } from './tracks';

/** Modo de la RaceScene: práctica local (V1), vs CPU (#14) o multi (V2). */
export type RaceMode = 'practice' | 'vs-cpu' | 'race';

/** Dificultad del rival CPU (issue #14). */
export type CpuDifficulty = 'easy' | 'normal' | 'hard';

/** Dificultad default del rival (V0 de #14 sólo usa esta). */
export const DEFAULT_CPU_DIFFICULTY: CpuDifficulty = 'normal';

/** Dificultades válidas, en orden de dificultad creciente. */
const CPU_DIFFICULTIES: readonly CpuDifficulty[] = ['easy', 'normal', 'hard'];

/** Etiquetas visibles de la dificultad (menú y resultados). */
export const CPU_DIFFICULTY_LABELS: Readonly<Record<CpuDifficulty, string>> = {
  easy: 'FÁCIL',
  normal: 'NORMAL',
  hard: 'DIFÍCIL',
};

/**
 * Coacciona una dificultad cruda: fuera del registro cae al default
 * (`'normal'`) sin lanzar — mismo espíritu defensivo que el resto del
 * parseo de init data.
 */
export function parseCpuDifficulty(raw: unknown): CpuDifficulty {
  return CPU_DIFFICULTIES.includes(raw as CpuDifficulty)
    ? (raw as CpuDifficulty)
    : DEFAULT_CPU_DIFFICULTY;
}

/** Init data de RaceScene (parseado defensivo en `parseRaceSceneInit`). */
export interface RaceSceneInit {
  trackId: TrackId;
  mode: RaceMode;
  /**
   * V2 — datos de la carrera multi, presentes SÓLO con `mode: 'race'`:
   * la práctica devuelve el MISMO shape de V1 (los tests del payload del
   * menú quedan intactos) y la escena trata la ausencia como práctica.
   */
  seed?: number;
  players?: PlayerInfo[];
  myPeerId?: string;
  /**
   * #14 — datos del vs CPU, presentes SÓLO con `mode: 'vs-cpu'`: la
   * dificultad del rival y la seed de la parrilla (inválidas → defaults,
   * la carrera vs CPU siempre puede arrancar sin red).
   */
  difficulty?: CpuDifficulty;
}

/** Primera pista del registro (default de la escena). */
export function defaultTrackId(): TrackId {
  return TRACKS[0].id;
}

/**
 * Parseo defensivo del init data de RaceScene. En práctica acepta
 * `{trackId, mode:'practice'}` (o nada); en multi (V2) acepta
 * `{mode:'race', trackId, seed, players, myPeerId}`. Omisiones o basura
 * degradan: pista desconocida → default; `race` incompleto → práctica —
 * la escena siempre puede arrancar (y un payload corrupto NUNCA la lanza
 * en modo multi sin datos de red).
 */
export function parseRaceSceneInit(raw: unknown): RaceSceneInit {
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const trackId =
    typeof record.trackId === 'string' && getTrackById(record.trackId)
      ? (record.trackId as TrackId)
      : defaultTrackId();

  // V2 — modo multi: sólo con el payload completo; cualquier hueco degrada
  // a práctica local (sin red, la carrera multi no tiene sentido).
  if (record.mode === 'race') {
    const players = parsePlayerInfoList(record.players);
    const seed = record.seed;
    const myPeerId = typeof record.myPeerId === 'string' ? record.myPeerId : '';
    if (players && typeof seed === 'number' && Number.isInteger(seed) && seed >= 0 && myPeerId) {
      return { trackId, mode: 'race', seed, players, myPeerId };
    }
  }

  // #14 — modo vs CPU: corre 100% local, así que SIEMPRE puede arrancar
  // (sin el gate "payload completo" del multi). Dificultad inválida →
  // default; seed inválida → 0 (parrilla fija).
  if (record.mode === 'vs-cpu') {
    const seed =
      typeof record.seed === 'number' && Number.isInteger(record.seed) && record.seed >= 0
        ? record.seed
        : 0;
    return { trackId, mode: 'vs-cpu', difficulty: parseCpuDifficulty(record.difficulty), seed };
  }

  return { trackId, mode: 'practice' };
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

/* ------------------------------------------------------------------ */
/* Resultados de la carrera VS CPU (issue #14)                         */
/* ------------------------------------------------------------------ */

/** Resultados de la carrera vs CPU (payload RaceScene → GameOverScene). */
export interface RaceVsCpuResultsData {
  mode: 'vs-cpu';
  trackId: TrackId;
  /** Nombre visible de la pista (ya viene resuelto de TRACKS). */
  trackName: string;
  /** Posición final del jugador (1-based). */
  position: number;
  /** Autos en la carrera, jugador incluido (2 en V0: jugador + 1 CPU). */
  totalCars: number;
  /** Dificultad del rival (viaja para el REINTENTAR y la pantalla). */
  difficulty: CpuDifficulty;
  /** Vueltas completadas válidas. */
  laps: number;
  /** Mejor vuelta de la carrera (ms; 0 si ninguna). */
  bestLapMs: number;
  /** Tiempo total desde el GO! (ms). */
  totalMs: number;
}

/**
 * Arma el payload de resultados vs CPU a partir del id de pista (resuelve el
 * nombre contra el registro), la posición final del jugador y los tiempos
 * propios del LapTracker. Inputs basura se sanean igual que en práctica.
 */
export function raceVsCpuResultsPayload(
  trackId: TrackId,
  position: number,
  totalCars: number,
  difficulty: CpuDifficulty,
  laps: number,
  bestLapMs: number,
  totalMs: number,
): RaceVsCpuResultsData {
  const trackName = getTrackById(trackId)?.name ?? '';
  return {
    mode: 'vs-cpu',
    trackId,
    trackName,
    position:
      Number.isInteger(position) && position >= 1 ? Math.floor(position) : 1,
    totalCars:
      Number.isInteger(totalCars) && totalCars >= 1 ? Math.floor(totalCars) : 1,
    difficulty: parseCpuDifficulty(difficulty),
    laps: Number.isFinite(laps) ? Math.max(0, Math.floor(laps)) : 0,
    bestLapMs: Number.isFinite(bestLapMs) && bestLapMs > 0 ? Math.floor(bestLapMs) : 0,
    totalMs: Number.isFinite(totalMs) && totalMs > 0 ? Math.floor(totalMs) : 0,
  };
}

/**
 * Parseo defensivo del payload de resultados vs CPU. Devuelve `null` cuando
 * el payload corresponde a otra rama de GameOverScene (solo clásico, multi,
 * práctica): la pantalla decide su rama con un solo chequeo.
 */
export function parseRaceVsCpuResults(raw: unknown): RaceVsCpuResultsData | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (record.mode !== 'vs-cpu') {
    return null;
  }
  const trackId =
    typeof record.trackId === 'string' && getTrackById(record.trackId)
      ? (record.trackId as TrackId)
      : defaultTrackId();
  return {
    mode: 'vs-cpu',
    trackId,
    trackName: typeof record.trackName === 'string' ? record.trackName : '',
    position:
      typeof record.position === 'number' && Number.isInteger(record.position) && record.position >= 1
        ? Math.floor(record.position)
        : 1,
    totalCars:
      typeof record.totalCars === 'number' && Number.isInteger(record.totalCars) && record.totalCars >= 1
        ? Math.floor(record.totalCars)
        : 1,
    difficulty: parseCpuDifficulty(record.difficulty),
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

/* ------------------------------------------------------------------ */
/* Resultados de la carrera MULTI (issue #9, V2)                       */
/* ------------------------------------------------------------------ */

/**
 * V4 — vuelta rápida de la carrera multi: el mejor `bestLapMs` reportado por
 * `rfin` (ver `fastestRaceLap`). Viaja en el payload de resultados para que
 * el podio la destaque.
 */
export interface RaceFastLap {
  /** Autor de la vuelta. */
  peerId: string;
  /** Tiempo de la vuelta (ms, > 0). */
  bestLapMs: number;
}

/**
 * V4 — elige la vuelta rápida de la carrera: el mejor `bestLapMs` (> 0 y
 * finito) entre los que reportaron `rfin`. Empate → peerId ASC (mismo
 * criterio determinista de `raceRanking`: todos los clientes con las mismas
 * entradas eligen la misma vuelta). Entradas inválidas (peerId vacío, ms no
 * finito o ≤ 0) se ignoran; sin candidatas válidas → null.
 */
export function fastestRaceLap(
  laps: readonly { peerId: string; bestLapMs: number }[],
): RaceFastLap | null {
  let best: RaceFastLap | null = null;
  for (const lap of laps) {
    if (typeof lap.peerId !== 'string' || lap.peerId.length === 0) {
      continue;
    }
    if (!Number.isFinite(lap.bestLapMs) || lap.bestLapMs <= 0) {
      continue;
    }
    const beatsBest =
      best === null ||
      lap.bestLapMs < best.bestLapMs ||
      (lap.bestLapMs === best.bestLapMs && lap.peerId < best.peerId);
    if (beatsBest) {
      best = { peerId: lap.peerId, bestLapMs: Math.floor(lap.bestLapMs) };
    }
  }
  return best;
}

/** Resultados de la carrera multi (payload RaceScene → GameOverScene). */
export interface RaceMultiResultsData {
  mode: 'race-multi';
  trackId: TrackId;
  /** Nombre visible de la pista (resuelto contra TRACKS). */
  trackName: string;
  /** Clasificación final (salida de `finalClassification` / `race-over`). */
  standings: RaceFinalStanding[];
  /** Roster congelado al iniciar: resuelve nombre/color por peerId. */
  players: PlayerInfo[];
  /** peerId propio dentro de `standings`. */
  myPeerId: string;
  /**
   * V4 — vuelta rápida de la carrera (null si nadie terminó, p. ej. cierre
   * por gracia con la carrera a medio correr).
   */
  fastLap: RaceFastLap | null;
}

/** Coacciona una fila de la clasificación de carrera; null si es basura. */
function parseRaceFinalStanding(raw: unknown): RaceFinalStanding | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (typeof record.peerId !== 'string' || record.peerId.length === 0) {
    return null;
  }
  if (
    typeof record.position !== 'number' ||
    !Number.isInteger(record.position) ||
    record.position < 1
  ) {
    return null;
  }
  if (record.status !== 'finished' && record.status !== 'running' && record.status !== 'disconnected') {
    return null;
  }
  if (
    typeof record.lap !== 'number' ||
    !Number.isFinite(record.lap) ||
    typeof record.s !== 'number' ||
    !Number.isFinite(record.s)
  ) {
    return null;
  }
  return {
    peerId: record.peerId,
    position: record.position,
    status: record.status,
    totalMs:
      record.status === 'finished' &&
      typeof record.totalMs === 'number' &&
      Number.isFinite(record.totalMs)
        ? Math.max(0, Math.round(record.totalMs))
        : null,
    lap: Math.max(0, record.lap),
    s: Math.max(0, record.s),
    progress: Number.isFinite(record.progress) ? Math.max(0, record.progress as number) : 0,
  };
}

/**
 * Arma el payload de resultados multi a partir del id de pista, la
 * clasificación final (local del ganador o la recibida por `race-over`), el
 * roster congelado (nombres/colores para el podio) y la vuelta rápida (V4;
 * null por default para no romper a quien no la compute).
 */
export function raceMultiResultsPayload(
  trackId: TrackId,
  standings: readonly RaceFinalStanding[],
  myPeerId: string,
  players: readonly PlayerInfo[] = [],
  fastLap: RaceFastLap | null = null,
): RaceMultiResultsData {
  return {
    mode: 'race-multi',
    trackId,
    trackName: getTrackById(trackId)?.name ?? '',
    standings: [...standings],
    players: [...players],
    myPeerId,
    fastLap,
  };
}

/**
 * Parseo defensivo del payload de resultados multi. Devuelve `null` cuando
 * el payload corresponde a otra rama de GameOverScene (solo clásico, multi
 * BATALLA o práctica): la pantalla decide su rama con un solo chequeo.
 */
export function parseRaceMultiResults(raw: unknown): RaceMultiResultsData | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (record.mode !== 'race-multi') {
    return null;
  }
  const trackId =
    typeof record.trackId === 'string' && getTrackById(record.trackId)
      ? (record.trackId as TrackId)
      : defaultTrackId();
  if (typeof record.myPeerId !== 'string' || record.myPeerId.length === 0) {
    return null;
  }
  if (!Array.isArray(record.standings) || record.standings.length === 0) {
    return null;
  }
  const standings: RaceFinalStanding[] = [];
  for (const entry of record.standings) {
    const standing = parseRaceFinalStanding(entry);
    if (!standing) {
      return null;
    }
    standings.push(standing);
  }
  return {
    mode: 'race-multi',
    trackId,
    trackName: typeof record.trackName === 'string' ? record.trackName : '',
    standings,
    players: parsePlayerInfoList(record.players) ?? [],
    myPeerId: record.myPeerId,
    fastLap: parseRaceFastLap(record.fastLap),
  };
}

/**
 * V4 — parseo defensivo de la vuelta rápida del payload: null ante basura,
 * peerId vacío o ms no finito/≤ 0 (el receptor nunca lanza ni acepta una
 * vuelta imposible).
 */
function parseRaceFastLap(raw: unknown): RaceFastLap | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (typeof record.peerId !== 'string' || record.peerId.length === 0) {
    return null;
  }
  if (
    typeof record.bestLapMs !== 'number' ||
    !Number.isFinite(record.bestLapMs) ||
    record.bestLapMs <= 0
  ) {
    return null;
  }
  return { peerId: record.peerId, bestLapMs: Math.max(0, Math.floor(record.bestLapMs)) };
}
