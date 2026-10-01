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
