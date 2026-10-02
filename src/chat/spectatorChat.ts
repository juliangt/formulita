/**
 * spectatorChat.ts — decisión PURA del chat en modo espectador (C3, decisión
 * 2A del issue #2: SÍ hay chat para el eliminado).
 *
 * La única regla decidible vive acá como función pura (sin Phaser, sin red):
 * el botón CHAT del overlay de espectador existe SOLO para un jugador
 * ELIMINADO de una carrera MULTIJUGADOR —
 *
 * - ELIMINADO en multi: SÍ (el mundo sigue y el espectador puede leer y
 *   escribir en el chat de SALA de la partida).
 * - VIVO en multi: NUNCA. Mientras conducís no hay chat: la decisión cerrada
 *   del issue es que el chat de sala del vivo no existe (ni se abre, ni se
 *   muestra el botón — ni siquiera deshabilitado).
 * - Modo SOLO: no aplica (no hay sala ni nadie con quien hablar).
 *
 * GameScene la usa como gate al crear el botón dentro de
 * `showSpectatorOverlay` (que solo corre tras el crash propio en multi), así
 * el "nunca para el vivo" queda garantizado por construcción Y por test.
 */

/**
 * true si el botón CHAT del overlay de espectador debe existir: solo para un
 * jugador eliminado de una carrera multijugador.
 */
export function isSpectatorChatVisible(selfEliminated: boolean, isMultiplayer: boolean): boolean {
  return isMultiplayer && selfEliminated;
}

/**
 * Variante CARRERA (issue #9, V3): en el circuito el mundo también sigue
 * después de que UNO termina — quien cruzó la bandera a cuadros espera a los
 * demás en modo espectador y el chat de sala le vale IGUAL que al eliminado
 * de la BATALLA (la puerta adicional que pide el issue: "terminó la
 * carrera"). Mismo criterio cerrado de #2: mientras CONDUCÍS no hay chat.
 *
 * RaceScene la usa como gate al terminar su propia carrera (tras difundir el
 * `rfin` propio), así el "nunca para el que conduce" queda garantizado por
 * construcción Y por test.
 */
export function isRaceSpectatorChatVisible(
  selfFinished: boolean,
  isMultiplayer: boolean,
): boolean {
  return isMultiplayer && selfFinished;
}
