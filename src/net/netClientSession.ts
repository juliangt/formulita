/**
 * netClientSession.ts — handoff del NetClient lobby → carrera (M2).
 *
 * M1: LobbyScene era dueña del cliente y lo destruía en su SHUTDOWN. Con la
 * carrera compartida el cliente tiene que seguir VIVO durante GameScene (es
 * quien difunde `state`/`eliminated`/`match-over`), así que la propiedad se
 * transfiere por el REGISTRY de Phaser — mismo patrón que el bus de sesión y
 * el repositorio de guardado (`getSessionEventBus`, `getSaveRepository`):
 *
 * 1. LobbyScene crea el cliente y, al arrancar la carrera, lo entrega con
 *    `handoffNetClient` (su SHUTDOWN ya NO lo destruye: dejó de ser dueño).
 * 2. GameScene lo toma con `takeSessionNetClient` (lo REMUEVE del registry:
 *    la propiedad es de la escena de carrera y ningún restart posterior puede
 *    heredar un cliente viejo).
 * 3. GameScene lo destruye en su SHUTDOWN (sale de la sala y limpia
 *    handlers) — el siguiente lobby crea uno fresco.
 */

import type { NetClient } from './NetClient';

/** Clave del registry de Phaser donde vive el cliente en traspaso. */
export const NET_CLIENT_REGISTRY_KEY = 'netClient';

/** Porción del registry de Phaser que el handoff consume. */
interface RegistrySlice {
  get(key: string): unknown;
  set(key: string, value: unknown): unknown;
  remove(key: string): unknown;
}

/** Entrega la propiedad del cliente a la escena de carrera (lobby → Game). */
export function handoffNetClient(registry: RegistrySlice, client: NetClient): void {
  registry.set(NET_CLIENT_REGISTRY_KEY, client);
}

/**
 * Toma el cliente entregado por el lobby (si hay uno): lo remueve del
 * registry y lo devuelve; null si no hay entrega pendiente o lo que hay no
 * tiene forma de `NetClient` (defensivo: nunca devuelve basura).
 */
export function takeSessionNetClient(registry: RegistrySlice): NetClient | null {
  const raw = registry.get(NET_CLIENT_REGISTRY_KEY);
  registry.remove(NET_CLIENT_REGISTRY_KEY);
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  const looksLikeClient =
    typeof candidate.selfPeerId === 'string' &&
    typeof candidate.sendState === 'function' &&
    typeof candidate.destroy === 'function';
  return looksLikeClient ? (raw as NetClient) : null;
}
