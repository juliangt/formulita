/**
 * raceLateAdmission — admisión acotada del "joiner invisible" (issue #35, T6).
 *
 * El roster del payload `start` es la FOTO del Map de metas del anfitrión al
 * presionar INICIAR (LobbyScene.tryStart congela `client.getRoster()` tal
 * cual): un peer presente en la malla cuya meta aún no había llegado al
 * anfitrión no viaja en `players`. Recibe el start igual, corre sus 3 vueltas
 * y, sin corrección, el resto lo ignora (los gates de `rstate`/`rfin` por
 * roster congelado en RaceScene) y él mismo se dibuja en la pole local (el
 * fallback de casilla propia cae en `gridSlots[0]`).
 *
 * La decisión es PURA y ACOTADA: se admite un peerId fuera del roster
 * congelado SÓLO si
 *
 *  1. su meta ya es conocida por ESTE cliente (estaba en la sala cuando el
 *     start llegó — exactamente el caso del joiner invisible, cuya meta
 *     precede a sus `rstate` por el mismo canal WebRTC ordenado), y
 *  2. NO apareció en la sala durante la carrera (`joinedAfterStart`, que la
 *     escena alimenta con `onPeerJoin` desde su create): un peer que entra a
 *     la sala después del start nunca recibió el start, no corre, y aunque un
 *     cliente así emitiera `rstate` no puede colarse a la carrera.
 *
 * Límites documentados: la identidad (nombre/color) sale del roster VIVO
 * local, así que puede diferir entre clientes si sus rosters vivos difieren —
 * es presentación, no gameplay. Admitir (o no) a un peer no reordena a los
 * demás: `rankCars`/`finalClassification` desempatan por peerId, el orden
 * sigue determinista. Un peer cuya meta nunca llegó a un cliente sigue siendo
 * invisible PARA ESE cliente (la admisión es acotada, no una re-negociación
 * del roster).
 *
 * Puro: cero Phaser, cero red.
 */

import type { PlayerInfo } from '../net/protocol';

/**
 * Decide la admisión tardía de `peerId` en la carrera ya empezada: la fila
 * del roster vivo que lo identifica si corresponde admitirlo, `null` si no.
 *
 * - Miembro del roster congelado ⇒ `null` (no es una admisión tardía: ya
 *   tiene buffer y coche desde el create de la escena).
 * - Peer que entró a la sala durante la carrera ⇒ `null` (nunca recibió el
 *   start: no compite).
 * - Fuera del roster pero con meta conocida localmente ⇒ admitido con SU
 *   fila del roster vivo.
 */
export function decideLateAdmission(
  peerId: string,
  frozenRoster: readonly PlayerInfo[],
  liveRoster: readonly PlayerInfo[],
  joinedAfterStart: ReadonlySet<string>,
): PlayerInfo | null {
  if (frozenRoster.some((player) => player.peerId === peerId)) {
    return null;
  }
  if (joinedAfterStart.has(peerId)) {
    return null;
  }
  return liveRoster.find((player) => player.peerId === peerId) ?? null;
}
