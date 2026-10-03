/**
 * raceClose — decisiones PURAS del cierre de la carrera multi (issue #35, T5).
 *
 * Dos reglas, extraídas de RaceScene para poder testearlas sin Phaser
 * (mismo estilo que raceStale/racePositionSwap):
 *
 * 1. RESOLUCIÓN del roster: un peer está resuelto si terminó (`rfin` en
 *    finishedPeers) o quedó fuera (leave/stale en disconnectedPeers). Los
 *    desconectados NO bloquean el cierre: jamás mandarán `rfin`, así que
 *    exigirlos esperaría la gracia completa (RACE_FINISH_GRACE_MS) aunque
 *    todos los vivos ya hayan terminado.
 *
 * 2. AUTORIDAD del `race-over`: el "primer rfin visto localmente" es
 *    ambiguo con cruces casi simultáneos — dos máquinas se creían ganadoras
 *    y difundían standings distintas. La autoridad determinista es el
 *    finisher de peerId menor (el MISMO tiebreak peerId ASC de
 *    `raceRanking`): sólo él difunde, y un receptor sólo acepta ese primero
 *    (UNA aceptación: los duplicados posteriores no pisan la clasificación).
 *
 * TRADEOFF aceptado: con una vista local transitoriamente incompleta (falta
 * el `rfin` de un peer de peerId menor) un receptor puede rechazar el
 * `race-over` legítimo. Nadie reintenta, pero la conclusión local es
 * determinista con las mismas entradas (`finalClassification`) y la gracia
 * de RACE_FINISH_GRACE_MS sigue de respaldo para el caso sin difusión.
 *
 * Puro: cero Phaser, cero red.
 */

/** Mínimo por peerId ASC — el tiebreak canónico compartido con el ranking. */
function minPeerId(peerIds: readonly string[]): string | null {
  let min: string | null = null;
  for (const peerId of peerIds) {
    if (min === null || peerId < min) {
      min = peerId;
    }
  }
  return min;
}

/**
 * true si TODOS los peers del roster congelado están resueltos: terminaron
 * (`rfin`) o quedaron fuera (leave/stale). Los peerIds que no pertenecen al
 * roster se ignoran (el roster manda, igual que el resto de la escena).
 */
export function allPeersResolved(
  rosterPeerIds: readonly string[],
  finishedPeerIds: readonly string[],
  disconnectedPeerIds: readonly string[],
): boolean {
  const finished = new Set(finishedPeerIds);
  const disconnected = new Set(disconnectedPeerIds);
  return rosterPeerIds.every((peerId) => finished.has(peerId) || disconnected.has(peerId));
}

/**
 * true si YO debo difundir `race-over`: terminé y soy el finisher de peerId
 * menor (autoridad determinista igual en todas las máquinas). Con un único
 * finisher difunde él — el caso de un solo ganador no cambia.
 */
export function shouldBroadcastRaceOver(
  finishedPeerIds: readonly string[],
  selfPeerId: string,
): boolean {
  if (!finishedPeerIds.includes(selfPeerId)) {
    return false;
  }
  return minPeerId(finishedPeerIds) === selfPeerId;
}

/**
 * true si debo ACEPTAR un `race-over`: el remitente es un finisher que
 * conozco, es la autoridad (peerId menor entre MIS finishers conocidos) y
 * todavía no acepté ninguno — el primero gana, los posteriores se ignoran.
 */
export function shouldAcceptRaceOver(
  senderPeerId: string,
  finishedPeerIds: readonly string[],
  alreadyAccepted: boolean,
): boolean {
  if (alreadyAccepted || !finishedPeerIds.includes(senderPeerId)) {
    return false;
  }
  return minPeerId(finishedPeerIds) === senderPeerId;
}
