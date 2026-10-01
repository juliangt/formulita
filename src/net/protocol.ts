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
 * los tipos ahora evita tocar el protocolo cuando lleguen.
 */

import { MULTIPLAYER } from '../config/balance';

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
 * `start` (solo anfitrión → todos): arranca la carrera.
 *
 * - `seed`: semilla uint32 de la sala; pista determinista vía el reloj
 *   virtual de M0 (todos los clientes generan la MISMA pista).
 * - `players`: roster congelado al iniciar (nombre + color por peerId).
 * - `startAt`: `Date.now()` del anfitrión en el momento del envío — cada
 *   cliente arranca su countdown 3-2-1 local apenas recibe la acción (M1);
 *   el timestamp queda para el arranque alineado de M2.
 */
export interface StartPayload {
  readonly seed: number;
  readonly players: PlayerInfo[];
  readonly startAt: number;
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
