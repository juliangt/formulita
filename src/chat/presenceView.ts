/**
 * presenceView.ts — lógica PURA de la sala pública de presencia (C2).
 *
 * Todo lo decidible de la tab PÚBLICO del ChatScene vive acá como funciones
 * puras (sin Phaser, sin red) para testearlo directo: estados/labels de tabs,
 * el texto del toggle de disponibilidad, las filas de la lista y su
 * PAGINACIÓN ligera (v1, auditoría #2 MENOR 1), el hint de efimeridad (§10)
 * y el flujo toggle → persistencia + `setAvailable` (que también aplica la
 * sesión social al crearse eager en el Boot). El wiring Phaser (crear
 * botones, repintar textos) queda en la escena y se documenta como en C1.
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
/* Paginación de la lista (v1 — auditoría #2, MENOR 1)                 */
/* ------------------------------------------------------------------ */

/** Label del botón de página anterior (táctil). */
export const PEER_PAGE_PREV_LABEL = '◀';

/** Label del botón de página siguiente (táctil). */
export const PEER_PAGE_NEXT_LABEL = '▶';

/** Una página de la lista lista para renderizar (la escena solo cablea). */
export interface PaginatedPeers {
  /** Filas de ESTA página (el orden del cliente, sin copiar la lista). */
  readonly rows: readonly AvailablePeer[];
  /** Página efectiva (0-based): la pedida, CLAMPEADA a las que existen. */
  readonly page: number;
  /** Total de páginas (0 si no hay peers; 1 = página única, sin botones). */
  readonly pageCount: number;
  /** Indicador "N–M DE T" de esta página ('' sin peers). */
  readonly rangeLabel: string;
  /** true si hay página siguiente (el botón ▶ solo existe con esto). */
  readonly hasNext: boolean;
  /** true si hay página anterior (el botón ◀ solo existe con esto). */
  readonly hasPrev: boolean;
}

/**
 * Pagina la lista de disponibles (v1 pragmática: la malla pública llega
 * cómodamente a ~30–50 peers y `visiblePeers` cortaba a los 6+). Decide TODO
 * lo mostrable — filas de la página, clamp, rango y habilitación de botones —
 * para que la escena solo cablee taps; la lista viene ordenada por peerId del
 * cliente, así la página N es estable entre clientes.
 *
 * Bordes: `pageSize <= 0` o lista vacía → resultado vacío sin páginas (la
 * escena pinta `EMPTY_PEERS_HINT`); `page` fuera de rango (negativa, fracción
 * o una página que DEJÓ de existir porque un peer se fue y la lista se encogió)
 * se clampedea a la última página válida — nunca a una página sin filas.
 */
export function paginatePeers(
  peers: readonly AvailablePeer[],
  page: number,
  pageSize: number,
): PaginatedPeers {
  if (pageSize <= 0 || peers.length === 0) {
    return { rows: [], page: 0, pageCount: 0, rangeLabel: '', hasNext: false, hasPrev: false };
  }
  const pageCount = Math.ceil(peers.length / pageSize);
  const requested = Number.isFinite(page) ? Math.floor(page) : 0;
  const current = Math.min(Math.max(requested, 0), pageCount - 1);
  const rows = peers.slice(current * pageSize, current * pageSize + pageSize);
  const rangeLabel = `${current * pageSize + 1}–${current * pageSize + rows.length} DE ${peers.length}`;
  return {
    rows,
    page: current,
    pageCount,
    rangeLabel,
    hasNext: current < pageCount - 1,
    hasPrev: current > 0,
  };
}

/* ------------------------------------------------------------------ */
/* Aviso de efimeridad (§10 del issue #2 — auditoría #2, COSMÉTICA 4)  */
/* ------------------------------------------------------------------ */

/**
 * Hint discreto de la tab PÚBLICO: los mensajes son EFÍMEROS (viven en la
 * sesión, no se persisten) — mitiga el "chateé y desapareció todo" de quien
 * cierra y vuelve a abrir esperando el historial.
 */
export const EPHEMERAL_MESSAGES_HINT = 'MENSAJES EFÍMEROS — NO SE GUARDAN AL CERRAR';

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
