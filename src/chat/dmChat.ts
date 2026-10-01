/**
 * dmChat.ts — adaptador puro ChatClient ↔ ChatStore de los hilos de DM (C3).
 *
 * Hermano de `roomChat.ts` (C1) para el chat DIRECTO de la sala pública: el
 * ChatStore no conoce la red y el ChatClient no conoce los hilos, así que
 * este módulo es el ÚNICO punto donde ambos se tocan, con funciones 100%
 * puras (todo son parámetros) para poder testear el flujo completo sin
 * Phaser y sin red:
 *
 * - SALIDA (`sendDirectMessage`): la UI pasa el texto crudo; el store valida
 *   cooldown/texto/bloqueo (guarda de salida) y, SI el mensaje sale, se envía
 *   DIRIGIDO con `sendDm` (el transporte re-sanitiza — es idempotente). Si el
 *   hilo está DESCONECTADO el envío se corta ACÁ (antes del store): no se
 *   agrega un mensaje que nadie recibiría, ni se consume el cooldown.
 * - ENTRADA (`receiveDirectMessage`): `onDm` entrega `(fromPeerId, payload)`;
 *   el remitente se resuelve contra la LISTA VIVA de disponibles (nombre +
 *   color vistos por ESTE cliente — nunca se confía del wire) y entra al
 *   hilo del remitente (el bloqueo descarta ANTES de entrar al store).
 * - PRESENCIA (`syncDmThreadAvailability`): `onAvailablePeers` entrega la
 *   lista de disponibles; cada hilo de DM queda ACTIVO si su peer sigue en
 *   la lista y DESCONECTADO si se fue (toggle OFF, pestaña cerrada, stale).
 */

import type { ChatStore } from './ChatStore';
import { ROOM_THREAD_ID, type ChatMessage } from './ChatStore';
import type { AvailablePeer } from '../net/ChatClient';
import type { DmPayload, PlayerInfo } from '../net/protocol';

/** Porción de ChatClient que el envío de DM necesita (facilita testear). */
export interface DmSender {
  sendDm(peerId: string, text: string): void;
}

/** Nombre que se muestra cuando el remitente ya no está disponible. */
export const UNKNOWN_DM_SENDER_NAME = 'PILOTO';

/**
 * Color de un remitente que ya no está en la lista de disponibles: el gris
 * claro de la paleta (`MULTIPLAYER.palette[8]`), neutro respecto de los
 * colores en juego (mismo criterio que `roomChat.resolveRoomSender`).
 */
export const UNKNOWN_DM_SENDER_COLOR = 0x9aa5b4;

/**
 * Resuelve quién envió un DM contra la lista VIVA de disponibles: si el peer
 * sigue en la sala pública, su nombre y color son los de la lista (fuente de
 * verdad local); si ya se fue (o nunca estuvo), se muestra como "PILOTO" con
 * el color neutro — el mensaje no se pierde, solo se degrada la identidad.
 */
export function resolveDmSender(
  fromPeerId: string,
  peers: readonly AvailablePeer[],
): PlayerInfo {
  const known = peers.find((peer) => peer.peerId === fromPeerId);
  if (known) {
    return { peerId: known.peerId, name: known.name, color: known.color };
  }
  return { peerId: fromPeerId, name: UNKNOWN_DM_SENDER_NAME, color: UNKNOWN_DM_SENDER_COLOR };
}

/**
 * Envía un mensaje directo al hilo de `peerId`: corta el envío si el hilo
 * está DESCONECTADO (el peer dejó la sala pública) o si el store rechaza el
 * mensaje (texto vacío, cooldown, peer bloqueado — guarda de salida). Solo
 * si sale, viaja DIRIGIDO por la red. Nada viaja cuando devuelve null.
 */
export function sendDirectMessage(
  store: ChatStore,
  sender: DmSender,
  peerId: string,
  rawText: string,
  now?: number,
): ChatMessage | null {
  if (store.isThreadDisconnected(peerId)) {
    return null; // hilo caído: ni se agrega al historial ni viaja
  }
  const message = store.sendDm(peerId, rawText, now);
  if (message) {
    sender.sendDm(peerId, message.text);
  }
  return message;
}

/**
 * Registra en el store un `dm` que llegó por la red: resuelve el remitente
 * contra la lista de disponibles y lo agrega a SU hilo (o lo descarta —
 * null — si está bloqueado o el texto quedó vacío tras sanitizar).
 */
export function receiveDirectMessage(
  store: ChatStore,
  peers: readonly AvailablePeer[],
  fromPeerId: string,
  payload: DmPayload,
  at: number,
): ChatMessage | null {
  return store.receiveDm(resolveDmSender(fromPeerId, peers), payload.text, at);
}

/**
 * Sincroniza la disponibilidad de los hilos de DM con la lista viva de la
 * sala pública: los hilos cuyo peer SIGUE en la lista quedan activos y los
 * cuyo peer se fue quedan DESCONECTADOS (toggle OFF, salida, stale). El
 * hilo `room` no se toca (la sala de partida tiene su propio ciclo de vida)
 * y los peers SIN hilo tampoco: la disponibilidad se aprende al abrir el
 * hilo, no hace falta marcar a todos los desconocidos.
 */
export function syncDmThreadAvailability(
  store: ChatStore,
  peers: readonly AvailablePeer[],
): void {
  const present = new Set(peers.map((peer) => peer.peerId));
  for (const threadId of store.getThreadIds()) {
    if (threadId === ROOM_THREAD_ID) {
      continue;
    }
    store.setPeerAvailability(threadId, present.has(threadId));
  }
}
