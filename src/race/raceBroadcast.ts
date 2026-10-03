/**
 * raceBroadcast — saturación del acumulador del broadcast `rstate` (issue #35).
 *
 * Cálculo puro extraído de `RaceScene.broadcastRaceState` para testear el
 * techo: adopta el patrón de referencia de GameScene para su `state`
 * (acumulador + reset al enviar, NUNCA un `while` sin techo de iteraciones).
 * Un delta gigante (vuelta del background en multi, donde no hay auto-pausa)
 * no itera ni emite una ráfaga de `rstate` idénticos en un solo frame: se
 * envía UN único mensaje fresco y el tramo ausente se descarta — el tiempo
 * en background no existe para la carrera.
 */

/** Resultado de un frame: acumulador para el próximo y envíos de éste. */
export interface RaceStateSchedule {
  /** Acumulador (ms) que queda para el próximo frame. */
  accumulatorMs: number;
  /** Mensajes a enviar este frame: 0 o 1, nunca una ráfaga. */
  sendCount: number;
}

/**
 * Acumula `deltaMs` sobre `accumulatorMs`: sin alcanzar `intervalMs` no envía
 * y conserva el acumulado; al alcanzarse envía UNA vez y resetea a 0 (el
 * sobrante de un tramo gigante se descarta, igual que en GameScene).
 */
export function scheduleRaceStateBroadcast(
  accumulatorMs: number,
  deltaMs: number,
  intervalMs: number,
): RaceStateSchedule {
  if (
    !Number.isFinite(deltaMs) ||
    deltaMs <= 0 ||
    !Number.isFinite(intervalMs) ||
    intervalMs <= 0
  ) {
    return { accumulatorMs, sendCount: 0 };
  }
  const next = accumulatorMs + deltaMs;
  if (next < intervalMs) {
    return { accumulatorMs: next, sendCount: 0 };
  }
  return { accumulatorMs: 0, sendCount: 1 };
}
