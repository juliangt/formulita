/**
 * chatClientSession.ts — ChatClient de sesión (issue #2, C2).
 *
 * Mismo patrón que `chatSession`/`netClientSession`: el recurso viaja por el
 * REGISTRY de Phaser. La diferencia clave con el NetClient de partidas: la
 * sala pública de presencia es INDEPENDIENTE de las partidas — uno elige
 * verse disponible en el MENÚ y lo sigue estando en el lobby, en la carrera
 * y de vuelta en el menú. Por eso el cliente es UNO POR SESIÓN DE NAVEGADOR
 * (singleton perezoso en el registry), no una propiedad que las escenas se
 * transfieren:
 *
 * 1. La PRIMERA consumidora (ChatScene, abierta desde el menú o el lobby) lo
 *    resuelve con `getChatClient` y queda cacheado para toda la sesión.
 * 2. Las escenas NUNCA lo destruyen: cerrar el chat o salir de una partida
 *    no toca la presencia (solo el TOGGLE la enciende/apaga). Las escenas
 *    solo llaman `setAvailable` según el ajuste persistido.
 * 3. `destroySessionChatClient` existe para el apagado EXPLÍCITO (tests,
 *    un futuro logout). NO hay hook de "shutdown raíz" donde llamarlo: el
 *    juego (ver `main.ts`) nunca destruye el `Phaser.Game` — la pestaña se
 *    cierra y el navegador reclama sockets, timers y memoria. Colgar un
 *    `destroy` a `beforeunload` no ganaría nada (el navegador ya corta las
 *    conexiones) y podría disparar de más en recargas; la decisión es no
 *    hacerlo y dejarlo documentado acá.
 *
 * PRIVACIDAD: resolver el cliente NO conecta a nada — sin `setAvailable(true)`
 * (decisión persistida en `ChatSettingsRepository`, default NO) no hay join.
 */

import type { ChatClient } from '../net/ChatClient';
import { TrysteroChatClient } from '../net/TrysteroChatClient';

/** Clave del registry de Phaser donde vive el ChatClient de la sesión. */
export const CHAT_CLIENT_REGISTRY_KEY = 'chatClient';

/** Porción del registry de Phaser que la sesión de chat consume. */
interface RegistrySlice {
  get(key: string): unknown;
  set(key: string, value: unknown): unknown;
  remove(key: string): unknown;
}

/** Shape check mínimo del valor del registry (defensivo contra basura). */
function looksLikeChatClient(value: unknown): value is ChatClient {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.selfPeerId === 'string' &&
    typeof candidate.setAvailable === 'function' &&
    typeof candidate.getAvailablePeers === 'function' &&
    typeof candidate.destroy === 'function'
  );
}

/**
 * Devuelve el ChatClient de la sesión (lo crea la primera vez con el
 * transporte real Trystero y lo cachea en el registry). Respeta uno inyectado
 * antes con `setSessionChatClient` (tests / futuro relay) — inversión de
 * dependencias igual que `getSaveRepository`. LO DEJA PUBLICADO: es un
 * servicio compartido, no una entrega única.
 */
export function getChatClient(registry: RegistrySlice): ChatClient {
  const existing = registry.get(CHAT_CLIENT_REGISTRY_KEY);
  if (looksLikeChatClient(existing)) {
    return existing;
  }
  const created: ChatClient = new TrysteroChatClient();
  registry.set(CHAT_CLIENT_REGISTRY_KEY, created);
  return created;
}

/** Publica/reemplaza el ChatClient de la sesión (inyección para tests). */
export function setSessionChatClient(registry: RegistrySlice, client: ChatClient): void {
  registry.set(CHAT_CLIENT_REGISTRY_KEY, client);
}

/**
 * Destruye el ChatClient de la sesión (si hay): desconecta de la sala pública
 * y limpia handlers, y lo retira del registry para que la próxima resolución
 * cree uno fresco. Solo para apagados EXPLÍCITOS — ver la nota de ciclo de
 * vida en el header del módulo.
 */
export function destroySessionChatClient(registry: RegistrySlice): void {
  const existing = registry.get(CHAT_CLIENT_REGISTRY_KEY);
  registry.remove(CHAT_CLIENT_REGISTRY_KEY);
  if (looksLikeChatClient(existing)) {
    existing.destroy();
  }
}
