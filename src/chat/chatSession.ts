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
 * 1. LobbyScene lo crea al entrar a la sala y lo publica con
 *    `setSessionChatStore` (self derivado del roster, refrescado en cada
 *    `onRosterChange`).
 * 2. ChatScene (overlay) lo lee con `getSessionChatStore` para pintar el
 *    hilo `room` y enviar — nunca lo destruye: cerrar el chat NO mata la sala.
 * 3. Cuando la sala MUERE (SALIR del lobby / shutdown sin handoff), el dueño
 *    hace `store.clear()` + `removeSessionChatStore`: la próxima sala arranca
 *    con un store fresco. Con handoff a la carrera el store queda publicado
 *    (la sala sigue viva en GameScene; C2/C3 deciden su destino).
 */

import type { ChatStore } from './ChatStore';

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
 * Devuelve el ChatStore publicado (o null si no hay sala con chat): lo deja
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
 * Retira el ChatStore del registry (la sala murió). NO llama `clear()` — el
 * dueño decide: `clear()` conserva el bloqueo de sesión por diseño (ver
 * `ChatStore.clear`), así que el flujo de salida es clear + remove.
 */
export function removeSessionChatStore(registry: RegistrySlice): void {
  registry.remove(CHAT_STORE_REGISTRY_KEY);
}
