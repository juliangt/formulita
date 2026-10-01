/**
 * presenceView.ts — lógica PURA de la sala pública de presencia (C2).
 *
 * Todo lo decidible de la tab PÚBLICO del ChatScene vive acá como funciones
 * puras (sin Phaser, sin red) para testearlo directo: estados/labels de tabs,
 * el texto del toggle de disponibilidad, las filas de la lista y el flujo
 * toggle → persistencia + `setAvailable`. El wiring Phaser (crear botones,
 * repintar textos) queda en la escena y se documenta como en C1.
 *
 * PRIVACIDAD: `applyAvailabilitySetting`/`toggleAvailability` son los ÚNICOS
 * puntos donde la UI toca la disponibilidad — siempre reflejan el ajuste
 * persistido (`ChatSettingsRepository`, default NO = nunca conecta).
 */

import type { IChatSettingsRepository } from '../data/ChatSettingsRepository';
import type { AvailablePeer, ChatClient } from '../net/ChatClient';
import { colorNumberToCss } from '../ui/ChatPanel';

/* ------------------------------------------------------------------ */
/* Tabs del overlay                                                    */
/* ------------------------------------------------------------------ */

/** Tabs del overlay de chat: SALA (partida) y PÚBLICO (presencia, C2). */
export type ChatTabId = 'room' | 'public';

/** Orden de presentación de los tabs (SALA a la izquierda, PÚBLICO derecha). */
export const CHAT_TAB_ORDER: readonly ChatTabId[] = ['room', 'public'];

/** Label de cada tab (chips del overlay). */
export const CHAT_TAB_LABELS: Readonly<Record<ChatTabId, string>> = {
  room: 'SALA',
  public: 'PÚBLICO',
};

/**
 * Parseo defensivo del tab pedida en el init data del ChatScene (Phaser lo
 * propaga como unknown): solo acepta 'public'; cualquier otra cosa (ausente,
 * basura) degrada a 'room' — el comportamiento de C1 queda intacto.
 */
export function parseChatTab(raw: unknown): ChatTabId {
  return raw === 'public' ? 'public' : 'room';
}

/**
 * true si la tab SALA está habilitada: necesita el ChatStore de la SESIÓN de
 * partida (lo publica LobbyScene) y el transporte de envío. Sin lobby (chat
 * abierto desde el menú) la tab existe pero está deshabilitada.
 */
export function isRoomTabEnabled(hasRoomChat: boolean): boolean {
  return hasRoomChat;
}

/** Mensaje de la tab SALA deshabilitada (chat abierto desde el menú). */
export const ROOM_TAB_MENU_HINT = 'ESTÁS EN EL MENÚ — EL CHAT DE SALA ES DENTRO DE UNA PARTIDA';

/* ------------------------------------------------------------------ */
/* Toggle de disponibilidad                                            */
/* ------------------------------------------------------------------ */

/** Label del toggle grande de la tab PÚBLICO según el estado. */
export function availabilityToggleLabel(available: boolean): string {
  return available ? 'MOSTRARME DISPONIBLE: SÍ' : 'MOSTRARME DISPONIBLE: NO';
}

/**
 * Aplica el ajuste PERSISTIDO al cliente (al abrir la tab PÚBLICO): quien
 * dejó el toggle en SÍ vuelve a aparecer como disponible sin re-decidir;
 * con NO (default) esto NO conecta nada — `setAvailable(false)` es no-op de
 * conexión. Devuelve el estado aplicado.
 */
export function applyAvailabilitySetting(
  repo: IChatSettingsRepository,
  client: ChatClient,
): boolean {
  const available = repo.load().showAvailable;
  client.setAvailable(available);
  return available;
}

/**
 * El usuario tocó el toggle: invierte el ajuste persistido, lo guarda y
 * sincroniza la conexión (SÍ ⇒ join a la sala pública; NO ⇒ leave). Devuelve
 * el NUEVO estado. Es el único camino por el que la disponibilidad cambia.
 */
export function toggleAvailability(repo: IChatSettingsRepository, client: ChatClient): boolean {
  const next = !repo.load().showAvailable;
  repo.save({ showAvailable: next });
  client.setAvailable(next);
  return next;
}

/* ------------------------------------------------------------------ */
/* Lista de disponibles                                                */
/* ------------------------------------------------------------------ */

/** Placeholder de la lista vacía (nadie disponible o toggle OFF). */
export const EMPTY_PEERS_HINT = 'NADIE DISPONIBLE';

/** Una fila de la lista lista para renderizar: texto + color CSS. */
export interface AvailablePeerRow {
  readonly text: string;
  readonly color: string;
}

/**
 * Formatea un peer disponible como fila de la lista: su nombre con el color
 * derivado del conjunto de presentes (la escena dibuja el swatch al lado).
 * Nombre vacío (meta corrupta) degrada a "PILOTO", igual que el chat de sala.
 * C3: `unreadCount > 0` agrega el badge de no leídos del hilo de DM con ese
 * peer ("BETO · 2") — la lista es el índice de hilos de la tab PÚBLICO.
 */
export function formatAvailablePeerRow(peer: AvailablePeer, unreadCount = 0): AvailablePeerRow {
  const name = peer.name.length > 0 ? peer.name : 'PILOTO';
  return {
    text: unreadCount > 0 ? `${name} · ${unreadCount}` : name,
    color: colorNumberToCss(peer.color),
  };
}

/**
 * Las primeras `maxVisible` filas de la lista (viene ordenada por peerId del
 * cliente; la UI muestra las primeras y ancla arriba). `maxVisible <= 0` no
 * muestra nada.
 */
export function visibleAvailablePeers(
  peers: readonly AvailablePeer[],
  maxVisible: number,
): readonly AvailablePeer[] {
  if (maxVisible <= 0) {
    return [];
  }
  return peers.slice(0, maxVisible);
}

/* ------------------------------------------------------------------ */
/* Detalle al tocar un disponible (hook del DM de C3)                  */
/* ------------------------------------------------------------------ */

/**
 * Datos que se muestran al tocar un elemento de la lista: por ahora SOLO
 * información (nombre + peerId). C3 reemplazará este detalle por la apertura
 * del hilo de DM con ese peer (`sendDm`/`onDm` ya están declarados en
 * `ChatClient`); la escena llama a esta función desde el tap de la fila —
 * ese callback ES el hook donde C3 enchufará `openDmThread(peer)`.
 */
export function formatPeerDetail(peer: AvailablePeer): AvailablePeerRow {
  const name = peer.name.length > 0 ? peer.name : 'PILOTO';
  return { text: `${name} · ${peer.peerId}`, color: colorNumberToCss(peer.color) };
}
