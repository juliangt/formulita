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

import type { ChatPayload, PlayerInfo, StartPayload } from './protocol';
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

/* ------------------------------------------------------------------ */
/* Vinculación del lobby (issue #35 — handlers zombie tras el handoff) */
/* ------------------------------------------------------------------ */

/** Handlers del lobby sobre el NetClient (los seis eventos que consume). */
export interface LobbyNetHandlers {
  /** `onError`: feedback de error en el status del lobby. */
  onStatus(message: string): void;
  /** `onRoomFull`: sala llena al entrar. */
  onRoomFull(): void;
  /** `onRosterChange`: roster vivo. */
  onRosterChange(roster: PlayerInfo[], hostPeerId: string | null): void;
  /** `onHostChange`: migración de anfitrión. */
  onHostChange(hostPeerId: string): void;
  /** `onStart`: el anfitrión difundió el arranque. */
  onStart(payload: StartPayload): void;
  /** `onChat`: chat de sala al store de sesión. */
  onChat(fromPeerId: string, payload: ChatPayload): void;
}

/**
 * Suscribe TODOS los handlers del lobby y devuelve su desuscripción TOTAL.
 *
 * Issue #35: al arrancar la carrera el lobby sólo desuscribía `onChat`;
 * `onStart`/`onRosterChange`/`onHostChange`/`onRoomFull`/`onError` quedaban
 * vivos toda la partida apuntando a widgets destruidos y a `startRace()` —
 * un `start` de un anfitrión migrado reiniciaba la carrera de todos. El
 * lobby DEBE llamar el detach devuelto ANTES del handoff (en `startRace`),
 * no en el SHUTDOWN: ahí los handlers ya habrían hecho daño.
 */
export function bindLobbyNet(client: NetClient, handlers: LobbyNetHandlers): () => void {
  const unsubscribe: ReadonlyArray<() => void> = [
    client.onError(handlers.onStatus),
    client.onRoomFull(handlers.onRoomFull),
    client.onRosterChange(handlers.onRosterChange),
    client.onHostChange(handlers.onHostChange),
    client.onStart(handlers.onStart),
    client.onChat(handlers.onChat),
  ];
  return () => {
    for (const off of unsubscribe) {
      off();
    }
  };
}

/** Resultado de una entrada a sala (create/join) del lobby. */
export interface LobbyEntryResult {
  /** true SOLO si el cliente quedó dentro de una sala. */
  readonly entered: boolean;
  /** Palabra vigente ('' si la entrada falló). */
  readonly roomWord: string;
}

/**
 * Evalúa la entrada SIN confiar en el fire-and-forget: `create`/`join` son
 * síncronos y pueden fallar ANTES de abrir sala (nombre inválido, transporte
 * que lanza); en ese caso `roomWord` queda null, así que la palabra vigente
 * es LA señal de éxito. Issue #35: `joined` sólo con sala real, para que la
 * UI no pinte la sala ni pise el error que `onError` ya dejó en pantalla.
 */
export function evaluateLobbyEntry(client: Pick<NetClient, 'roomWord'>): LobbyEntryResult {
  const roomWord = client.roomWord ?? '';
  return { entered: roomWord.length > 0, roomWord };
}
