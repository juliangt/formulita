/**
 * VirtualClock — reloj virtual de generación a paso fijo (M0, multijugador).
 *
 * Problema que resuelve: `SpawnScheduler` genera oleadas por TIEMPO
 * (`update(dt, speed, params)`), así que con velocidades reales distintas
 * cada jugador vería una pista diferente. La solución no toca el scheduler:
 * este reloj convierte el avance real en TIEMPO VIRTUAL a velocidad
 * constante (`VIRTUAL_SPEED`), de modo que la generación queda como función
 * pura de la distancia recorrida — idéntica para todos los clientes.
 *
 * Mecánica (100% pura, sin Phaser):
 *
 * 1. Por frame se acumula DISTANCIA: `Δd = realSpeed × realDt`. Acumular en
 *    distancia (no en tiempo) es la clave: la misma distancia recorrida
 *    produce los mismos pasos virtuales aunque los perfiles de velocidad y
 *    los tamaños de frame difieran entre dispositivos.
 * 2. `consumeSteps()` devuelve cuántos pasos completos de `FIXED_VIRTUAL_STEP`
 *    hay disponibles (a `VIRTUAL_SPEED`) y los descuenta, preservando el
 *    resto (< 1 paso) para el próximo frame: jamás se pierde distancia.
 * 3. El caller alimenta al scheduler con UN `update(FIXED_VIRTUAL_STEP,
 *    VIRTUAL_SPEED, params)` por paso consumido — el scheduler existente no
 *    cambia su contrato update(dt, speed, difficulty).
 *
 * Entradas no finitas o no positivas son no-op (defensa, como en el resto
 * de los sistemas). No hay clamp de dt: recortar un frame grande DESCARTARÍA
 * distancia real y rompería la determinación por distancia.
 */

import { FIXED_VIRTUAL_STEP, VIRTUAL_SPEED } from '../config/balance';

/** Distancia que vale un paso virtual (px), precomputada una sola vez. */
const STEP_DISTANCE = VIRTUAL_SPEED * FIXED_VIRTUAL_STEP;

export class VirtualClock {
  /** Distancia acumulada pendiente de convertir en pasos (px, < 1 paso tras consume). */
  private pendingDistance = 0;

  /** Distancia total acumulada desde el reset (px, solo crece). */
  private totalDistance = 0;

  /** Pasos virtuales emitidos en total desde el reset. */
  private stepsEmitted = 0;

  /** Distancia total acumulada (px) — para HUD/debug y sync con el scroll real. */
  get distance(): number {
    return this.totalDistance;
  }

  /** Distancia aún no convertida en paso (siempre < STEP_DISTANCE tras un consume). */
  get pending(): number {
    return this.pendingDistance;
  }

  /** Pasos virtuales emitidos en total (cada uno = FIXED_VIRTUAL_STEP s virtuales). */
  get totalSteps(): number {
    return this.stepsEmitted;
  }

  /** Reinicia el acumulador (arranque de carrera / restart). */
  reset(): void {
    this.pendingDistance = 0;
    this.totalDistance = 0;
    this.stepsEmitted = 0;
  }

  /**
   * Registra el avance de un frame real: `realDt` en segundos, `realSpeed`
   * en px/s. dt/velocidad no finitos o ≤ 0 son no-op (no hay distancia).
   */
  addFrame(realDt: number, realSpeed: number): void {
    if (!Number.isFinite(realDt) || realDt <= 0) {
      return;
    }
    if (!Number.isFinite(realSpeed) || realSpeed <= 0) {
      return;
    }
    const delta = realSpeed * realDt;
    this.pendingDistance += delta;
    this.totalDistance += delta;
  }

  /**
   * Devuelve cuántos pasos fijos de `FIXED_VIRTUAL_STEP` (a `VIRTUAL_SPEED`)
   * están completos y los descuenta del acumulador. El resto fraccionario
   * queda preservado: la distancia jamás se pierde entre frames.
   */
  consumeSteps(): number {
    const steps = Math.floor(this.pendingDistance / STEP_DISTANCE);
    if (steps > 0) {
      this.pendingDistance -= steps * STEP_DISTANCE;
      this.stepsEmitted += steps;
    }
    return steps;
  }
}
