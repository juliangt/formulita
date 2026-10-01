/**
 * chatSession.ts — ChatStore compartido por sesión (issue #2, C1).
 *
 * Mismo patrón que `netClientSession`: el estado que varias escenas vivas a
 * la vez necesitan (lobby + overlay de chat, y en C2/C3 también el menú y el
 * modo espectador) viaja por el REGISTRY de Phaser en vez de por globals o
 * init data. A diferencia del handoff del NetClient (propiedad ÚNICA que se
 * transfiere y se remueve al tomar), el ChatStore se COMPARTE mientras viva
 * la sala de partida:
 *
 * 1. LobbyScene entra a una sala y asegura el store de la sesión con
 *    `ensureSessionChatStore` (self derivado del roster, refrescado en cada
 *    `onRosterChange`): lo REUSA si la sesión social ya lo creó (C3) — los
 *    DM y el badge del menú viven en el MISMO store que el chat de sala.
 * 2. ChatScene (overlay) lo lee con `getSessionChatStore` para pintar sus
 *    hilos y enviar — nunca lo destruye: cerrar el chat NO mata nada.
 * 3. C3: el store de sesión vive TODA la pestaña (lo crea on-demand la
 *    sesión social, ver `socialChatSession`). Cuando una sala de partida
 *    muere se limpia SOLO su hilo `room` (`clearThread`): los hilos de DM,
 *    sus no leídos y los bloqueos de sesión sobreviven a la partida.
 */

import { ChatStore } from './ChatStore';
import type { PlayerInfo } from '../net/protocol';

/** Clave del registry de Phaser donde vive el ChatStore de la sesión. */
export const CHAT_STORE_REGISTRY_KEY = 'chatStore';

/** Porción del registry de Phaser que la sesión de chat consume. */
interface RegistrySlice {
  get(key: string): unknown;
  set(key: string, value: unknown): unknown;
  remove(key: string): unknown;
}

/** Publica el ChatStore de la sala actual (lo pisa si hubiera uno viejo). */
export function setSessionChatStore(registry: RegistrySlice, store: ChatStore): void {
  registry.set(CHAT_STORE_REGISTRY_KEY, store);
}

/**
 * Devuelve el ChatStore publicado (o null si no hay sesión de chat): lo deja
 * PUBLICADO — es un recurso compartido, no una entrega única como el
 * `takeSessionNetClient`. Defensivo contra basura en la clave.
 */
export function getSessionChatStore(registry: RegistrySlice): ChatStore | null {
  const raw = registry.get(CHAT_STORE_REGISTRY_KEY);
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  const looksLikeStore =
    typeof candidate.sendRoomMessage === 'function' &&
    typeof candidate.receiveRoomMessage === 'function' &&
    typeof candidate.getMessages === 'function';
  return looksLikeStore ? (raw as ChatStore) : null;
}

/**
 * C3 — asegura que el ChatStore de sesión EXISTA y lo devuelve: lo crea con
 * la identidad dada si nadie lo publicó aún, o REUSA el publicado
 * (refrescando su identidad con `updateSelf`) en vez de recrearlo. Es el
 * corazón del ciclo de vida de C3: el store de sesión vive TODA la pestaña
 * (los DM y el badge del menú son sociales, no de una partida), así que:
 *
 * - La sesión social lo crea on-demand con el perfil persistido
 *   (`socialChatSession`), la primera vez que alguien lo necesita (menú).
 * - El lobby que entra a una sala REUSA el que haya (updateSelf al roster:
 *   mismo peerId, nombre/color de la partida) y sigue publicándolo.
 * - Cuando la sala de partida MUERE se limpia SOLO su hilo `room`
 *   (`clearThread`): los DM, sus no leídos y los bloqueos son de la sesión.
 */
export function ensureSessionChatStore(
  registry: RegistrySlice,
  self: PlayerInfo,
): ChatStore {
  const existing = getSessionChatStore(registry);
  if (existing) {
    existing.updateSelf(self);
    return existing;
  }
  const store = new ChatStore({ self });
  registry.set(CHAT_STORE_REGISTRY_KEY, store);
  return store;
}

/**
 * Retira el ChatStore del registry (la sala murió). NO llama `clear()` — el
 * dueño decide: `clear()` conserva el bloqueo de sesión por diseño (ver
 * `ChatStore.clear`), así que el flujo de salida es clear + remove.
 */
export function removeSessionChatStore(registry: RegistrySlice): void {
  registry.remove(CHAT_STORE_REGISTRY_KEY);
}
