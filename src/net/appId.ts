/**
 * appId.ts — namespace de Trystero compartido por todos los clientes (C2).
 *
 * `resolveAppId` vivía en TrysteroNetClient; con la sala pública de presencia
 * (issue #2, C2) HAY un segundo consumidor del mismo appId (TrysteroChatClient),
 * así que la resolución se extrae a este módulo compartido — UNA sola lógica,
 * cero duplicación: si el appId falta o cambia, fallan/valen igual en el
 * matchmaking de partidas y en la sala social.
 *
 * La sala pública de presencia no es una sala de partida: es un "vestíbulo"
 * permanente donde quien elige mostrarse aparece como disponible. Para no
 * mezclarse con las palabras de sala (5–9 letras A–Z) usa el nombre derivado
 * `${appId}-social`: mismo namespace → dev y producción quedan separados gratis
 * (cada entorno tiene su VITE_TRYSTERO_APP_ID).
 */

/** Entorno de Vite (por defecto el real; los tests inyectan el suyo). */
export interface NetEnvSource {
  readonly VITE_TRYSTERO_APP_ID?: string;
  /**
   * Trackers de señalización BitTorrent custom (CSV de `wss://`/`ws://`),
   * issue #8. OPCIONAL: si falta, la librería usa sus defaults.
   */
  readonly VITE_TRYSTERO_RELAYS?: string;
}

/**
 * Resuelve el appId de Trystero desde el entorno. Fail-fast: sin
 * `VITE_TRYSTERO_APP_ID` no hay matchmaking posible, y conectar "en
 * silencio" con un appId vacío daría salas fantasma — mejor un error claro
 * que la UI muestra. (Definirlo en `.env.local` para dev y en el CI para
 * producción; ver `.env.example`.)
 */
export function resolveAppId(env: NetEnvSource = import.meta.env): string {
  const appId = env.VITE_TRYSTERO_APP_ID?.trim();
  if (!appId) {
    throw new Error('falta VITE_TRYSTERO_APP_ID (namespace de matchmaking de Trystero; ver .env.example)');
  }
  return appId;
}

/** Sufijo que marca la sala pública de presencia dentro del namespace. */
export const SOCIAL_ROOM_SUFFIX = '-social';

/**
 * Nombre de la sala pública de presencia para un appId dado:
 * `${appId}-social`. Derivado SIEMPRE de acá (nunca concatenar a mano) para
 * que todos los clientes computen la misma sala.
 */
export function socialRoomId(appId: string): string {
  return `${appId}${SOCIAL_ROOM_SUFFIX}`;
}

/* ------------------------------------------------------------------ */
/* Trackers de señalización custom (issue #8)                          */
/* ------------------------------------------------------------------ */

/**
 * Los trackers son los servidores de la SEÑALIZACIÓN inicial de Trystero: el
 * único "encuentro" entre dos jugadores antes de que WebRTC conecte el P2P
 * directo — el tráfico del juego (estado, chat, posiciones) NUNCA pasa por
 * ellos. Solo son útiles en `wss://`/`ws://` (WebSockets).
 *
 * RIESGO DE FRAGMENTACIÓN: la sala de Trystero existe DENTRO de los trackers
 * usados para announce. Dos jugadores con listas de trackers DISJUNTAS nunca
 * se encuentran, aunque compartan appId y palabra de sala — cada uno anuncia
 * en su propio trackers y nadie recibe el offer del otro. Cualquier lista
 * custom debe ser IGUAL en todas las instalaciones (es la misma razón por la
 * que el appId se comparte: solo separa aplicaciones, nunca jugadores).
 */

/** Los trackers de señalización son WebSockets: prefijo requerido. */
const RELAY_URL_PATTERN = /^wss?:\/\//;

/**
 * Resuelve la lista custom de trackers desde el entorno (issue #8).
 *
 * - `undefined`/vacío → `undefined`: la librería usa sus trackers default
 *   (comportamiento actual — NO degradar).
 * - Con contenido: CSV separado por comas, recortado, filtrando entradas
 *   vacías y URLs sin `wss://`/`ws://` (robusto a una coma de más o un
 *   espacio perdido; el orden de las válidas se preserva).
 * - Fail-fast: si había contenido pero CERO URLs válidas, lanza — el
 *   operador configuró trackers custom y todos son basura; degradar en
 *   silencio a los defaults fragmentaría el matchmaking (ver riesgo arriba):
 *   esta instalación buscaría peers donde nadie más está.
 */
export function resolveRelayUrls(env: NetEnvSource = import.meta.env): string[] | undefined {
  const raw = env.VITE_TRYSTERO_RELAYS?.trim();
  if (!raw) {
    return undefined;
  }
  const urls = raw
    .split(',')
    .map((url) => url.trim())
    .filter((url) => url.length > 0 && RELAY_URL_PATTERN.test(url));
  if (urls.length === 0) {
    throw new Error(
      'VITE_TRYSTERO_RELAYS no contiene ninguna URL válida (se esperaban trackers wss:// o ws:// separados por comas; ver .env.example)',
    );
  }
  return urls;
}

/**
 * Parche de `relayConfig` para el config de `joinRoom` (issue #8), con la
 * forma de `JoinRoomConfig['relayConfig']` de la librería. Devuelve `{}` sin
 * lista custom para que los factories de room spreadeen SIN condicionales:
 * `joinRoom({ appId, ...relayConfigFor() }, roomId)`.
 */
export type RelayConfigOverride = { relayConfig: { urls: string[] } } | {};

export function relayConfigFor(env: NetEnvSource = import.meta.env): RelayConfigOverride {
  const urls = resolveRelayUrls(env);
  return urls ? { relayConfig: { urls } } : {};
}
