/**
 * lobbyState.ts — reglas PURAS del lobby multijugador (M1).
 *
 * Todo lo que debe decidir cada cliente de forma IDÉNTICA sin negociar vive
 * acá como función pura del roster observable:
 *
 * 1. `resolveHostPeerId`: quién es el anfitrión (el creador si sigue; si se
 *    fue, el peerId MENOR entre los presentes).
 * 2. `colorForPeer` / `assignColors`: color de cada jugador = paleta[index]
 *    donde index es la posición del peer en el roster ordenado por peerId.
 * 3. `isRoomFull` / `canStart`: capacidad (10) y mínimo para iniciar (2).
 *
 * Estas funciones son la ÚNICA fuente de verdad de color/anfitrión: ni la
 * meta viajada ni el orden de llegada importan, solo el conjunto de peerIds
 * presentes. Dos clientes con el mismo roster computan lo mismo, siempre.
 */

import { MULTIPLAYER } from '../config/balance';
import type { PlayerInfo, RosterEntry } from './protocol';

/**
 * Anfitrión de la sala para un roster dado:
 * - Si algún presente tiene `isCreator` (creó la sala), es él. Con VARIOS
 *   creadores a la vez (colisión de palabra, p≈1/150) gana el de peerId
 *   MENOR: los candidatos se ordenan por peerId ANTES del `find` para que
 *   la elección sea determinística también entre clientes cuyo Map de metas
 *   se armó en distinto orden (mismo roster ⇒ mismo anfitrión, siempre).
 * - Si el creador se fue, el anfitrión es el de peerId MENOR entre los
 *   presentes (orden lexicográfico — misma regla en todos los clientes,
 *   sin negociación). `null` si el roster está vacío.
 */
export function resolveHostPeerId(roster: readonly RosterEntry[]): string | null {
  if (roster.length === 0) {
    return null;
  }
  const byPeerId = (a: RosterEntry, b: RosterEntry): number => (a.peerId < b.peerId ? -1 : 1);
  const creator = [...roster].sort(byPeerId).find((entry) => entry.isCreator);
  if (creator) {
    return creator.peerId;
  }
  return roster.reduce((min, entry) => (entry.peerId < min.peerId ? entry : min)).peerId;
}

/** Ordena el roster por peerId (lexicográfico) — base de la asignación de color. */
function sortedPeerIds(roster: readonly RosterEntry[]): string[] {
  return roster.map((entry) => entry.peerId).sort();
}

/**
 * Color de un peer del roster: `MULTIPLAYER.palette[index]` con index = su
 * posición en el roster ordenado por peerId. Determinista e idéntico en
 * todos los clientes para el mismo roster; único mientras el roster no
 * supere la capacidad (los peerIds son únicos ⇒ los índices también).
 * Fuera del roster devuelve null (nadie más tiene color).
 */
export function colorForPeer(peerId: string, roster: readonly RosterEntry[]): number | null {
  const index = sortedPeerIds(roster).indexOf(peerId);
  if (index < 0 || index >= MULTIPLAYER.palette.length) {
    return null;
  }
  return MULTIPLAYER.palette[index];
}

/**
 * Roster completo con colores derivados (la vista que consume la UI y el
 * payload `start.players`): jugadores ordenados por peerId con su color de
 * paleta. Si el roster superara la paleta (no puede pasar con el guardia de
 * capacidad, pero por defensa) los extras quedan sin color (color 0).
 */
export function assignColors(roster: readonly RosterEntry[]): PlayerInfo[] {
  return sortedPeerIds(roster).map((peerId, index) => {
    const entry = roster.find((candidate) => candidate.peerId === peerId);
    return {
      peerId,
      name: entry?.name ?? '',
      color: index < MULTIPLAYER.palette.length ? MULTIPLAYER.palette[index] : 0,
    };
  });
}

/**
 * Capacidad de la sala: `count` es la cantidad de jugadores INCLUIDO uno
 * mismo. Con 10 está llena de verdad (máximo permitido); con 11 el que
 * entra es el 11º y debe ser rechazado.
 */
export function isRoomFull(count: number): boolean {
  return count > MULTIPLAYER.maxPlayers;
}

/**
 * ¿Es `senderPeerId` el anfitrión de ESTE roster? Es la única fuente
 * legítima del arranque en AMBOS sentidos (T3, issue #35): la EMISIÓN
 * (`canStart`) y la RECEPCIÓN del payload `start` (TrysteroNetClient
 * descarta en silencio el start de cualquier otro peer — malicioso o de una
 * vista de metas divergente). TRADEOFF documentado: si el creador se fue y
 * el host migrado difunde antes de que mi roster local lo refleje, mi gate
 * rechaza un start legítimo — es preferible a aceptar dos "anfitriones" y
 * partir la sala en dos carreras con seeds distintas.
 */
export function isStartFromHost(roster: readonly RosterEntry[], senderPeerId: string): boolean {
  return resolveHostPeerId(roster) === senderPeerId;
}

/**
 * ¿Puede `selfPeerId` iniciar la carrera? Solo el ANFITRIÓN decide, y con
 * al menos `minPlayersToStart` jugadores en la sala (partidas de 2 a 10):
 * el anfitrión se resuelve del roster con `isStartFromHost` (mismo
 * cálculo en todos los clientes).
 */
export function canStart(roster: readonly RosterEntry[], selfPeerId: string): boolean {
  if (roster.length < MULTIPLAYER.minPlayersToStart) {
    return false;
  }
  return isStartFromHost(roster, selfPeerId);
}
