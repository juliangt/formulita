/**
 * raceStale — detección de peers muertos a mitad de carrera (issue #9, V3).
 *
 * Si un peer deja de mandar `rstate` (pestaña cerrada, red caída sin
 * `onPeerLeave`), su coche queda congelado en el último progreso. Mismo
 * patrón que `MatchTracker` (#1): un barrido periódico marca como IDO a todo
 * peer que lleva más de `PLAYER_STALE_MS` sin señal, contando desde el
 * arranque si NUNCA mandó nada (la escena registra a cada rival al armar la
 * parrilla). Marcado es PERMANENTE — igual que el eliminado de la BATALLA:
 * si el peer "vuelve", ya no reconstruye su coche en esta carrera.
 *
 * La escena consume los `sweep()` recién vencidos para: destruir el
 * RemoteCar (desaparece del mundo y del minimapa), vaciar su buffer de
 * interpolación y sumarlo a `disconnectedPeers` — su ÚLTIMO progreso
 * conocido queda en `remoteProgress` y alimenta la clasificación final como
 * `disconnected` (ver `raceRanking.finalClassification`).
 *
 * Puro: reloj inyectado por llamada (`nowMs`), cero Phaser, cero red.
 */

import { PLAYER_STALE_MS } from '../config/balance';

export class RaceStaleTracker {
  /** Umbral de staleness en ms (default PLAYER_STALE_MS, heredado de #1). */
  private readonly staleMs: number;
  /** Última señal (`rstate` o alta) por peer. */
  private readonly lastSeen = new Map<string, number>();
  /** Peers ya marcados (nunca vuelven a reportarse). */
  private readonly stale = new Set<string>();

  constructor(staleMs: number = PLAYER_STALE_MS) {
    this.staleMs = Math.max(1, staleMs);
  }

  /** Llegó un `rstate` del peer: refresca su presencia. */
  record(peerId: string, nowMs: number): void {
    if (this.stale.has(peerId) || !Number.isFinite(nowMs)) {
      return;
    }
    this.lastSeen.set(peerId, nowMs);
  }

  /**
   * Marca directa (el peer avisó `onPeerLeave`, o la escena ya lo procesó):
   * queda fuera de futuros barridos.
   */
  markStale(peerId: string): void {
    this.stale.add(peerId);
    this.lastSeen.delete(peerId);
  }

  /**
   * Barrido (la escena lo llama ~1 vez por segundo): todo peer con más de
   * `staleMs` desde su última señal pasa a IDO. Devuelve SOLO los recién
   * marcados (idempotente: un segundo barrido no los repite).
   */
  sweep(nowMs: number): string[] {
    const expired: string[] = [];
    if (!Number.isFinite(nowMs)) {
      return expired;
    }
    for (const [peerId, at] of this.lastSeen) {
      if (nowMs - at > this.staleMs) {
        expired.push(peerId);
      }
    }
    for (const peerId of expired) {
      this.markStale(peerId);
    }
    return expired;
  }

  /** true si el peer ya fue marcado (leave o staleness). */
  isStale(peerId: string): boolean {
    return this.stale.has(peerId);
  }

  /** Reinicia todo el estado (SHUTDOWN de la escena). */
  clear(): void {
    this.lastSeen.clear();
    this.stale.clear();
  }
}
