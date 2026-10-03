/**
 * protocol.ts — tipos compartidos del protocolo multijugador (M1).
 *
 * Todo lo que viaja por la red (acciones Trystero / FakeNetClient) tiene su
 * forma acá, junto con los helpers PURAS de sanitización/parseo: la misma
 * normalización corre en el emisor y en el receptor, así ningún cliente puede
 * meter un nombre de 40 caracteres o una palabra de sala con Ñ en el roster.
 *
 * Las acciones `state` / `eliminated` / `match-over` se DECLARAN acá y se
 * usan recién en M2 (estado por frame y eliminación compartida); registrar
 * los tipos ahora evita tocar el protocolo cuando lleguen. Lo mismo aplica a
 * las acciones del chat social del issue #2 (`chat`/`dm`/`ping`/`invite`),
 * cuya base pura (`ChatStore`) llega en C0 y la red en C1/C3.
 */

import { CHAT_MAX_LEN, CIRCUIT, MULTIPLAYER } from '../config/balance';
import { getTrackById, TRACKS, type TrackId } from '../race/tracks';
import type { FinalStanding as RaceFinalStanding } from '../race/raceRanking';

/* ------------------------------------------------------------------ */
/* Meta y roster                                                       */
/* ------------------------------------------------------------------ */

/**
 * Meta que cada peer anuncia al entrar a la sala (acción `meta`).
 *
 * `color` es INFORMATIVO: lo llena el dueño con su color derivado del roster
 * al momento de anunciar, pero todos los consumidores recalculan el color
 * con `colorForPeer` (función pura del roster) — la única fuente de verdad
 * es el roster, así el color es idéntico en todos los clientes aunque el
 * roster cambie después (ver `net/lobbyState.ts`).
 */
export interface PeerMeta {
  /** Nombre visible del jugador (ya sanitizado, máx. 12). */
  readonly name: string;
  /** Color asignado (derivado del roster; informativo en el wire). */
  readonly color: number;
  /** true si este peer CREÓ la sala (anfitrión original). */
  readonly isCreator: boolean;
}

/** Jugador del roster tal como lo ve cualquier cliente (color derivado). */
export interface PlayerInfo {
  readonly peerId: string;
  readonly name: string;
  readonly color: number;
}

/** Entrada interna del roster: lo que se sabe de cada peer (meta + presencia). */
export interface RosterEntry {
  readonly peerId: string;
  readonly name: string;
  readonly isCreator: boolean;
}

/* ------------------------------------------------------------------ */
/* Acciones                                                            */
/* ------------------------------------------------------------------ */

/**
 * Modo de juego de la sala (V2, issue #9): la BATALLA de #1 (`battle`) o la
 * carrera en circuito de #9 (`race`). Viaja en el `start`; un start VIEJO
 * (sin el campo) es batalla — degradación defensiva al parsear.
 */
export type GameMode = 'battle' | 'race';

/**
 * `start` (solo anfitrión → todos): arranca la carrera.
 *
 * - `seed`: semilla uint32 de la sala; pista determinista vía el reloj
 *   virtual de M0 (todos los clientes generan la MISMA pista).
 * - `players`: roster congelado al iniciar (nombre + color por peerId).
 * - `startAt`: `Date.now()` del anfitrión en el momento del envío — cada
 *   cliente arranca su countdown 3-2-1 local apenas recibe la acción (M1);
 *   el timestamp queda para el arranque alineado de M2.
 * - V2 (issue #9): `gameMode` elige BATALLA o CARRERA y `trackId` la pista
 *   del circuito (sólo con sentido en CARRERA). AMBOS OPCIONALES: ausentes
 *   ⇒ batalla, así un anfitrión viejo o un payload truncado degradan al
 *   comportamiento de #1 en vez de romper.
 */
export interface StartPayload {
  readonly seed: number;
  readonly players: PlayerInfo[];
  readonly startAt: number;
  /** Modo de juego (ausente ⇒ 'battle'). */
  readonly gameMode?: GameMode;
  /** Pista del circuito (sólo CARRERA; id de `race/tracks.ts`). */
  readonly trackId?: string;
}

/**
 * `state` (M2 — se declara, no se usa en M1): posición y progreso por frame
 * de un jugador, para dibujar los autos rivales en la pista local.
 */
export interface StatePayload {
  readonly distance: number;
  readonly x: number;
  readonly speed: number;
  readonly turboActive: boolean;
  readonly coins: number;
  readonly score: number;
}

/** `eliminated` (M2): este jugador chocó; viaja su resumen final. */
export interface EliminatedPayload {
  readonly coins: number;
  readonly score: number;
  readonly distance: number;
}

/** `match-over` (M2): la partida terminó (un solo superviviente). */
export interface MatchOverPayload {
  readonly coins: number;
  readonly score: number;
  readonly distance: number;
}

/* ------------------------------------------------------------------ */
/* Acciones de la CARRERA en circuito (issue #9, V2)                   */
/* ------------------------------------------------------------------ */

/**
 * `rstate` (V2): estado propio del circuito a STATE_HZ, en coordenadas de
 * PISTA (no del mundo) para que la reconstrucción sea idéntica en todos los
 * clientes con el TrackPath local (determinista):
 *
 * - `s`: coordenada de arco dentro de la vuelta (px, [0, L)).
 * - `o`: offset LATERAL con signo respecto del eje (px; ±widthPx/2).
 * - `v`: velocidad escalar (px/s, ≥ 0).
 * - `lap`: vueltas completadas válidas (0-based, [0..CIRCUIT.totalLaps]).
 *
 * El receptor interpola el progreso DESENROLLADO `lap × L + s` (monótono,
 * no salta en la meta) y reconstruye x/y/ángulo con `sample(s) + normal × o`.
 */
export interface RaceStatePayload {
  readonly s: number;
  readonly o: number;
  readonly v: number;
  readonly lap: number;
}

/**
 * `rfin` (V2): este cliente COMPLETÓ las 3 vueltas — se difunde UNA vez.
 * El primer `rfin` válido (propio o remoto) dispara la condición de ganador;
 * los tiempos alimentan la clasificación final (`totalMs` ASC).
 */
export interface RaceFinishPayload {
  /** Tiempo total desde el GO! (ms). */
  readonly totalMs: number;
  /** Mejor vuelta de la carrera (ms; 0 si ninguna válida). */
  readonly bestLapMs: number;
}

/**
 * `race-over` (V2): lo difunde el GANADOR (primer `rfin`) una sola vez, al
 * terminar todos o vencer `RACE_FINISH_GRACE_MS`, con la clasificación final
 * de `finalClassification` (determinista: todos los clientes con los mismos
 * eventos computan el mismo orden). Receptor: muestra resultados YA.
 */
export interface RaceOverPayload {
  readonly standings: RaceFinalStanding[];
}

/**
 * Normaliza un `RaceStatePayload` para el wire (emisor y receptor — la
 * misma función corre en ambos extremos): enteros finitos, `s` envuelta a
 * [0, lapLength), `o` acotado a ±halfWidth, `lap` a [0..totalLaps] y `v` ≥ 0.
 * Es la última parada antes de `sendRaceState` y la primera al recibir.
 */
export function roundRaceStatePayload(
  payload: RaceStatePayload,
  lapLength: number,
  halfWidth: number,
): RaceStatePayload {
  const length = Number.isFinite(lapLength) && lapLength > 0 ? lapLength : 1;
  const half = Number.isFinite(halfWidth) && halfWidth > 0 ? halfWidth : 0;
  const wrap = (value: number): number =>
    ((value % length) + length) % length;
  const s = Number.isFinite(payload.s) ? wrap(Math.round(payload.s)) : 0;
  const o = Number.isFinite(payload.o)
    ? Math.min(Math.max(Math.round(payload.o), -half), half)
    : 0;
  const lap = Number.isFinite(payload.lap)
    ? Math.min(Math.max(Math.round(payload.lap), 0), CIRCUIT.totalLaps)
    : 0;
  const v = Number.isFinite(payload.v) ? Math.max(0, Math.round(payload.v)) : 0;
  return { s, o, v, lap };
}

/** Normaliza un `RaceFinishPayload` (enteros ≥ 0; no finito ⇒ 0). */
export function roundRaceFinishPayload(payload: RaceFinishPayload): RaceFinishPayload {
  const clean = (value: number): number =>
    Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
  return { totalMs: clean(payload.totalMs), bestLapMs: clean(payload.bestLapMs) };
}

/**
 * Parseo defensivo de un `rfin` recibido: null si el payload no tiene forma
 * de tiempos de carrera (el receptor lo descarta sin romper). T3 (issue #35):
 * `totalMs <= 0` también es basura (nadie termina 3 vueltas en 0 ms) — si se
 * coaccionara a 0 como antes, un peer ganaría al instante y abriría la
 * ventana de gracia de todos. `bestLapMs: 0` SÍ es legítimo (ninguna vuelta
 * válida) y no se rechaza.
 */
export function parseRaceFinishPayload(raw: unknown): RaceFinishPayload | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (
    typeof record.totalMs !== 'number' ||
    !Number.isFinite(record.totalMs) ||
    record.totalMs <= 0
  ) {
    return null;
  }
  if (typeof record.bestLapMs !== 'number' || !Number.isFinite(record.bestLapMs)) {
    return null;
  }
  return roundRaceFinishPayload({ totalMs: record.totalMs, bestLapMs: record.bestLapMs });
}

/**
 * Parseo defensivo de un `race-over` recibido: valida CADA fila de la
 * clasificación (misma forma que produce `finalClassification`); null si el
 * payload o alguna fila no tiene forma válida — una standings corrupta no
 * pisa la clasificación local del receptor.
 */
export function parseRaceOverPayload(raw: unknown): RaceOverPayload | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.standings) || record.standings.length === 0) {
    return null;
  }
  const standings: RaceFinalStanding[] = [];
  for (const entry of record.standings) {
    if (typeof entry !== 'object' || entry === null) {
      return null;
    }
    const row = entry as Record<string, unknown>;
    if (typeof row.peerId !== 'string' || row.peerId.length === 0) {
      return null;
    }
    if (
      typeof row.position !== 'number' ||
      !Number.isInteger(row.position) ||
      row.position < 1
    ) {
      return null;
    }
    if (row.status !== 'finished' && row.status !== 'running' && row.status !== 'disconnected') {
      return null;
    }
    if (
      typeof row.lap !== 'number' ||
      !Number.isFinite(row.lap) ||
      typeof row.s !== 'number' ||
      !Number.isFinite(row.s)
    ) {
      return null;
    }
    standings.push({
      peerId: row.peerId,
      position: row.position,
      status: row.status,
      totalMs:
        row.status === 'finished' && typeof row.totalMs === 'number' && Number.isFinite(row.totalMs)
          ? Math.max(0, Math.round(row.totalMs))
          : null,
      lap: Math.max(0, row.lap),
      s: Math.max(0, row.s),
      progress: Number.isFinite(row.progress) ? Math.max(0, row.progress as number) : 0,
    });
  }
  return { standings };
}

/* ------------------------------------------------------------------ */
/* Init data de RaceScene en multi (parseo del `start` extendido)      */
/* ------------------------------------------------------------------ */

/**
 * El `start` extendido ya parseado (V2): `gameMode` SIEMPRE presente
 * (ausente ⇒ 'battle' — un start viejo de #1 es batalla) y `trackId`
 * resuelto contra el registro de pistas (id desconocido ⇒ la primera, mismo
 * espíritu defensivo que `parseRaceSceneInit`; null en batalla).
 */
export interface RaceStartInit {
  readonly seed: number;
  readonly players: PlayerInfo[];
  readonly startAt: number;
  readonly gameMode: GameMode;
  readonly trackId: TrackId | null;
}

/**
 * Parseo defensivo del payload `start` extendido: null si el payload ni
 * siquiera tiene la forma de un start de #1 (seed/players/startAt); un
 * `gameMode` ajeno o ausente degrada a batalla y un `trackId` desconocido
 * degrada a la pista por default.
 *
 * Compatibilidad (#26): el `trackId` viaja como string libre, así que un
 * cliente VIEJO que recibe el id de una pista que su versión aún no tiene
 * (p. ej. `galvez`) la degrada en silencio a `TRACKS[0]` (MÓNACO) y la
 * carrera arranca igual — cada uno en su pista. Detectar el desfasaje en
 * el lobby es un follow-up no bloqueante.
 */
export function parseRaceInit(raw: unknown): RaceStartInit | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (typeof record.seed !== 'number' || !Number.isInteger(record.seed) || record.seed < 0) {
    return null;
  }
  if (typeof record.startAt !== 'number' || !Number.isFinite(record.startAt)) {
    return null;
  }
  if (!Array.isArray(record.players) || record.players.length === 0) {
    return null;
  }
  const players: PlayerInfo[] = [];
  for (const entry of record.players) {
    const player = parsePlayerInfo(entry);
    if (!player) {
      return null;
    }
    players.push(player);
  }
  const gameMode: GameMode = record.gameMode === 'race' ? 'race' : 'battle';
  const rawTrackId = typeof record.trackId === 'string' ? record.trackId : '';
  const trackId =
    gameMode === 'race' ? (getTrackById(rawTrackId)?.id ?? TRACKS[0].id) : null;
  return { seed: record.seed, players, startAt: record.startAt, gameMode, trackId };
}

/* ------------------------------------------------------------------ */
/* Acciones del chat social (issue #2, C0 — se declaran acá, la UI       */
/* llega en C1/C3 y la red como adaptador de NetClient)                 */
/* ------------------------------------------------------------------ */

/**
 * `chat` (sala de PARTIDA, broadcast): un mensaje del chat de sala. Viaja
 * solo el texto ya sanitizado (`sanitizeChatText`): el remitente lo deduce
 * del peerId que Trystero entrega al recibir, y el color del roster
 * (`colorForPeer`) — nada más viaja ni se confía del wire.
 */
export interface ChatPayload {
  /** Texto sanitizado: trim, whitespace colapsado, máx. `CHAT_MAX_LEN`. */
  readonly text: string;
}

/**
 * `dm` (sala PÚBLICA de presencia): mensaje DIRIGIDO a un peer concreto. El
 * transporte YA envía dirigido — la acción de Trystero acepta `{target}` y
 * entrega SOLO al destinatario (ver `TrysteroChatClient.sendDm`) — así que el
 * `targetPeerId` del payload es REDUNDANTE A PROPÓSITO: defensa en
 * profundidad para que el receptor re-verifique el destinatario antes de
 * despachar, y si un transporte futuro degradara el dirigido a broadcast,
 * cada cliente descartaría igual los dm ajenos.
 */
export interface DmPayload {
  /** Texto sanitizado con la misma regla que `chat`. */
  readonly text: string;
  /** Destinatario (peerId): redundante con `{target}` por defensa en profundidad. */
  readonly targetPeerId: string;
}

/**
 * `ping` (sala pública de presencia): heartbeat VACÍO cada
 * `PRESENCE_HEARTBEAT_MS`; la señal es el hecho del mensaje, no su contenido.
 */
export type PingPayload = Record<string, never>;

/**
 * `invite` (C3): invita a un peer de la sala pública a la partida por
 * palabra de sala; `keyword` es una palabra de sala normal (A–Z, 5–9).
 */
export interface InvitePayload {
  /** Palabra de la sala a la que se invita (sanitizada como room word). */
  readonly keyword: string;
}

/* ------------------------------------------------------------------ */
/* Resultado final compartido (M2)                                     */
/* ------------------------------------------------------------------ */

/**
 * Estadísticas finales congeladas de un jugador: las que viajan en
 * `eliminated`/`match-over` (exactas) o, si NUNCA llegaron (desconexión
 * abrupta), las de su último `state` recibido.
 */
export interface PlayerStats {
  readonly coins: number;
  readonly score: number;
  readonly distance: number;
}

/**
 * Fila del leaderboard final: estadísticas de un jugador + puesto según el
 * ORDEN DETERMINÍSTICO monedas DESC → km DESC → puntaje DESC (el último en
 * pie NO gana por sobrevivir: solo tuvo más tiempo para juntar monedas).
 */
export interface FinalStanding extends PlayerStats {
  readonly peerId: string;
  readonly name: string;
  readonly color: number;
  /** Puesto 1..n según el orden determinístico. */
  readonly place: number;
  /** true si es la fila ganadora (más monedas). */
  readonly isWinner: boolean;
}

/* ------------------------------------------------------------------ */
/* Sanitización (pura, emisor y receptor)                              */
/* ------------------------------------------------------------------ */

/** Colapsa corridas de espacios a uno solo. */
function collapseSpaces(value: string): string {
  return value.replace(/\s+/g, ' ');
}

/**
 * Normaliza el nombre del jugador: trim, espacios internos colapsados y
 * recorte a `MULTIPLAYER.maxPlayerNameLength` (12). Respeta mayúsculas y
 * caracteres unicode (es un nombre propio, no un código). El resultado
 * vacío significa "sin nombre válido".
 */
export function sanitizePlayerName(raw: string): string {
  return collapseSpaces(raw.trim()).slice(0, MULTIPLAYER.maxPlayerNameLength);
}

/** true si el nombre queda usable tras sanitizar (no vacío). */
export function isValidPlayerName(raw: string): boolean {
  return sanitizePlayerName(raw).length > 0;
}

/**
 * Prepara un `StatePayload` para el wire (M2): redondea los floats a enteros
 * (distance/x/speed en px no necesitan decimales a 10 Hz) y normaliza los
 * contadores — achica el payload y evita viajar NaN/Infinity. Es la ÚLTIMA
 * parada antes de `sendState` en cualquier cliente.
 */
export function roundStatePayload(payload: StatePayload): StatePayload {
  const round = (value: number): number =>
    Number.isFinite(value) ? Math.round(value) : 0;
  return {
    distance: round(payload.distance),
    x: round(payload.x),
    speed: round(payload.speed),
    turboActive: payload.turboActive === true,
    coins: round(payload.coins),
    score: round(payload.score),
  };
}

/**
 * Normaliza una palabra de sala a su forma de protocolo: trim, diacríticos
 * descompuestos y eliminados (NFD), UPPERCASE y SOLO A–Z (sin Ñ, acentos,
 * espacios ni dígitos — todo lo que no sea A–Z se descarta). Ejemplos:
 * " pár rilla " → "PARRILLA", "chicane9" → "CHICANE", "piraña" → "PIRANA".
 * Es idempotente: sanitizar una palabra ya sanitizada la devuelve igual.
 */
export function sanitizeRoomWord(raw: string): string {
  return raw
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
}

/**
 * true si `raw` es una palabra de sala VÁLIDA tal cual se escribe (sin
 * normalizar): solo A–Z y largo dentro de [5, 9]. Es la puerta de entrada
 * del modo UNIRSE: una palabra inválida ni se intenta (no existe sala con
 * esa forma, porque las palabras se generan de `roomWords.ts`).
 */
export function isValidRoomWord(raw: string): boolean {
  if (!/^[A-Z]+$/.test(raw)) {
    return false;
  }
  return raw.length >= MULTIPLAYER.roomWordMinLength && raw.length <= MULTIPLAYER.roomWordMaxLength;
}

/* ------------------------------------------------------------------ */
/* Chat social — sanitización y factories (emisor y receptor)           */
/* ------------------------------------------------------------------ */

/**
 * Normaliza el texto de un mensaje de chat (`chat` y `dm`): trim, corridas
 * de whitespace interno colapsadas a un espacio y recorte a `CHAT_MAX_LEN`
 * (200). Es la MISMA función en el emisor (antes de viajar) y en el receptor
 * (antes de entrar al store/render), y es la que usa `ChatStore.sanitizeText`
 * — una sola regla de texto para todo el chat. Como los mensajes se dibujan
 * como `Phaser.GameObjects.Text` (nunca HTML/innerHTML), no hay vector XSS:
 * esto es límite de largo/limpieza, no sanitización HTML.
 */
export function sanitizeChatText(raw: string): string {
  return collapseSpaces(raw.trim()).slice(0, CHAT_MAX_LEN);
}

/** true si a `raw` le queda texto utilizable tras sanitizar (no vacío). */
export function isValidChatText(raw: string): boolean {
  return sanitizeChatText(raw).length > 0;
}

/** Factory del payload `chat` (sala de partida, broadcast). */
export function makeChatPayload(rawText: string): ChatPayload {
  return { text: sanitizeChatText(rawText) };
}

/** Factory del payload `dm` (sala pública, dirigido por `targetPeerId`). */
export function makeDmPayload(rawText: string, targetPeerId: string): DmPayload {
  return { text: sanitizeChatText(rawText), targetPeerId: targetPeerId.trim() };
}

/** Factory del payload `ping` (heartbeat vacío de presencia). */
export function makePingPayload(): PingPayload {
  return {};
}

/** Factory del payload `invite` (C3): la keyword es una room word A–Z. */
export function makeInvitePayload(rawKeyword: string): InvitePayload {
  return { keyword: sanitizeRoomWord(rawKeyword) };
}

/* ------------------------------------------------------------------ */
/* Init data de GameScene en multi (parseo defensivo)                  */
/* ------------------------------------------------------------------ */

/**
 * Init data que LobbyScene le pasa a GameScene en multijugador. Phaser
 * propaga el payload como `unknown`, así que `parseMultiplayerInit` lo
 * valida y coacciona; `null` significa "no es multi" → modo solo.
 */
export interface MultiplayerInit {
  readonly mode: 'multi';
  /** Semilla uint32 de la sala (pista determinista). */
  readonly seed: number;
  /** Roster congelado al iniciar. */
  readonly players: PlayerInfo[];
  /** peerId propio (qué soy yo dentro de `players`). */
  readonly myPeerId: string;
  /** Palabra de la sala (debug/HUD futuro). */
  readonly roomWord: string;
}

/** Coacciona un `PlayerInfo` crudo; null si no tiene forma válida. */
function parsePlayerInfo(raw: unknown): PlayerInfo | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (typeof record.peerId !== 'string' || record.peerId.length === 0) {
    return null;
  }
  if (typeof record.name !== 'string' || record.name.length === 0) {
    return null;
  }
  if (typeof record.color !== 'number' || !Number.isFinite(record.color)) {
    return null;
  }
  return { peerId: record.peerId, name: record.name, color: record.color };
}

/**
 * Coacciona un roster crudo completo (V2): `PlayerInfo[]` válido o null.
 * Exportado para los parseos de init data de la carrera en circuito
 * (`race/results.ts`) que comparten la misma forma de roster congelado.
 */
export function parsePlayerInfoList(raw: unknown): PlayerInfo[] | null {
  if (!Array.isArray(raw) || raw.length === 0) {
    return null;
  }
  const players: PlayerInfo[] = [];
  for (const entry of raw) {
    const player = parsePlayerInfo(entry);
    if (!player) {
      return null;
    }
    players.push(player);
  }
  return players;
}

/**
 * Parsea el init data de GameScene: devuelve `MultiplayerInit` si el payload
 * es una carrera multi completa y válida, `null` en cualquier otro caso (lo
 * que incluye el arranque solo, que no manda payload). Defensivo igual que
 * `parseGameOverData`: un payload corrupto degrada a modo solo en vez de
 * romper la escena.
 */
export function parseMultiplayerInit(raw: unknown): MultiplayerInit | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (record.mode !== 'multi') {
    return null;
  }
  if (typeof record.seed !== 'number' || !Number.isInteger(record.seed) || record.seed < 0) {
    return null;
  }
  if (typeof record.myPeerId !== 'string' || record.myPeerId.length === 0) {
    return null;
  }
  if (!Array.isArray(record.players) || record.players.length === 0) {
    return null;
  }
  const players: PlayerInfo[] = [];
  for (const entry of record.players) {
    const player = parsePlayerInfo(entry);
    if (!player) {
      return null;
    }
    players.push(player);
  }
  return {
    mode: 'multi',
    seed: record.seed,
    players,
    myPeerId: record.myPeerId,
    roomWord: typeof record.roomWord === 'string' ? record.roomWord : '',
  };
}

/* ------------------------------------------------------------------ */
/* Init data de GameOverScene en multi (parseo defensivo)              */
/* ------------------------------------------------------------------ */

/**
 * Payload que GameScene le pasa a GameOverScene al terminar una partida
 * multijugador: los puestos finales (computados LOCALMENTE por cada cliente
 * con las mismas reglas determinísticas de MatchTracker) + quién soy yo.
 * Phaser lo propaga como `unknown`; `parseMultiGameOverData` lo valida.
 */
export interface MultiGameOverData {
  readonly mode: 'multi';
  /** Puestos finales ordenados por place (1..n). */
  readonly standings: FinalStanding[];
  /** peerId propio dentro de `standings`. */
  readonly myPeerId: string;
}

/** Coacciona una fila cruda de standings; null si no tiene forma válida. */
function parseFinalStanding(raw: unknown): FinalStanding | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (typeof record.peerId !== 'string' || record.peerId.length === 0) {
    return null;
  }
  if (typeof record.name !== 'string') {
    return null;
  }
  if (typeof record.color !== 'number' || !Number.isFinite(record.color)) {
    return null;
  }
  if (typeof record.place !== 'number' || !Number.isInteger(record.place) || record.place < 1) {
    return null;
  }
  const stats = parsePlayerStats(record);
  if (!stats) {
    return null;
  }
  return {
    peerId: record.peerId,
    name: record.name,
    color: record.color,
    place: record.place,
    isWinner: record.isWinner === true || record.place === 1,
    ...stats,
  };
}

/** Coacciona {coins, score, distance}; null si alguno no es número finito. */
function parsePlayerStats(raw: Record<string, unknown>): PlayerStats | null {
  if (
    typeof raw.coins !== 'number' ||
    !Number.isFinite(raw.coins) ||
    typeof raw.score !== 'number' ||
    !Number.isFinite(raw.score) ||
    typeof raw.distance !== 'number' ||
    !Number.isFinite(raw.distance)
  ) {
    return null;
  }
  return {
    coins: Math.max(0, raw.coins),
    score: Math.max(0, raw.score),
    distance: Math.max(0, raw.distance),
  };
}

/**
 * Parsea el init data multijugador de GameOverScene: devuelve
 * `MultiGameOverData` si el payload está completo y válido, `null` en
 * cualquier otro caso (GameOverScene degrada a su layout solo de siempre).
 */
export function parseMultiGameOverData(raw: unknown): MultiGameOverData | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (record.mode !== 'multi') {
    return null;
  }
  if (typeof record.myPeerId !== 'string' || record.myPeerId.length === 0) {
    return null;
  }
  if (!Array.isArray(record.standings) || record.standings.length === 0) {
    return null;
  }
  const standings: FinalStanding[] = [];
  for (const entry of record.standings) {
    const standing = parseFinalStanding(entry);
    if (!standing) {
      return null;
    }
    standings.push(standing);
  }
  return { mode: 'multi', standings, myPeerId: record.myPeerId };
}
