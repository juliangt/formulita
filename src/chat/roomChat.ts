/**
 * roomChat.ts — adaptador puro NetClient ↔ ChatStore del hilo de sala (C1).
 *
 * El ChatStore (C0) no conoce la red y el NetClient no conoce el chat: este
 * módulo es el ÚNICO punto donde ambos se tocan, con funciones 100% puras
 * (todo son parámetros) para poder testear el flujo completo sin Phaser:
 *
 * - SALida (`sendRoomChat`): la UI pasa el texto crudo; el store valida el
 *   cooldown y sanitiza, y SI el mensaje sale, se difunde con `sendChat`
 *   (el transporte re-sanitiza — es idempotente — así el wire siempre lleva
 *   `CHAT_MAX_LEN` como tope).
 * - ENTRADA (`receiveRoomChat`): `onChat` entrega `(fromPeerId, payload)`;
 *   el remitente se resuelve contra el ROSTER LOCAL (nombre + color vistos
 *   por ESTE cliente — nunca se confía del wire) y entra al hilo `room`.
 *
 * El hilo de sala es el único de C1; los DM (C2/C3) repetirán el patrón con
 * su propio adaptador.
 */

import type { ChatStore } from './ChatStore';
import type { ChatMessage } from './ChatStore';
import type { ChatPayload, PlayerInfo } from '../net/protocol';

/** Porción de NetClient que el envío necesita (facilita testear/falsificar). */
export interface ChatSender {
  sendChat(text: string): void;
}

/** Nombre que se muestra cuando el remitente ya no está en el roster. */
export const UNKNOWN_SENDER_NAME = 'PILOTO';

/**
 * Color de un remitente desconocido: el gris claro de la paleta
 * (`MULTIPLAYER.palette[8]`), neutro respecto de los colores en juego.
 */
export const UNKNOWN_SENDER_COLOR = 0x9aa5b4;

/**
 * Resuelve quién envió un mensaje contra el roster LOCAL: si el peer sigue
 * en la sala, su nombre y color son los del roster (fuente de verdad); si ya
 * se fue (o nunca estuvo), se muestra como "PILOTO" con el color neutro — el
 * mensaje no se pierde, solo se degrada la identificación.
 */
export function resolveRoomSender(fromPeerId: string, roster: readonly PlayerInfo[]): PlayerInfo {
  const known = roster.find((player) => player.peerId === fromPeerId);
  if (known) {
    return known;
  }
  return { peerId: fromPeerId, name: UNKNOWN_SENDER_NAME, color: UNKNOWN_SENDER_COLOR };
}

/**
 * Envia un mensaje al hilo de sala: valida cooldown/texto contra el store y,
 * si es aceptado, lo difunde por la red. Devuelve el mensaje enviado o null
 * (rechazado por cooldown o texto vacío — en ese caso NADA viaja).
 */
export function sendRoomChat(
  store: ChatStore,
  sender: ChatSender,
  rawText: string,
  now?: number,
): ChatMessage | null {
  const message = store.sendRoomMessage(rawText, now);
  if (message) {
    sender.sendChat(message.text);
  }
  return message;
}

/**
 * Registra en el store un mensaje `chat` que llegó por la red: resuelve el
 * remitente contra el roster local y lo agrega al hilo `room` (o lo descarta
 * — null — si el peer está bloqueado o el texto quedó vacío).
 */
export function receiveRoomChat(
  store: ChatStore,
  roster: readonly PlayerInfo[],
  fromPeerId: string,
  payload: ChatPayload,
  at: number,
): ChatMessage | null {
  return store.receiveRoomMessage(resolveRoomSender(fromPeerId, roster), payload.text, at);
}
