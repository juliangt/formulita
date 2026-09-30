/**
 * format — formateo puro de los números que muestra la UI (Fase 5).
 *
 * Funciones 100% puras (sin Phaser): las usan el HUD de carrera (`ScoreHud`)
 * y la pantalla de resultados (`GameOverScene`). Viven aparte para ser
 * testeables directamente con Vitest y para que el look arcade (ceros a la
 * izquierda, m/km) tenga UNA sola fuente de verdad compartida.
 */

import { DISTANCE_METERS_PER_PIXEL } from '../config/balance';

/** Dígitos del marcador, con ceros a la izquierda (look arcade). */
const SCORE_DIGITS = 6;

/** Distancia en px → texto estético (m por debajo del km, km después). */
export function formatDistance(px: number): string {
  const safe = Number.isFinite(px) && px > 0 ? px : 0;
  const meters = Math.round(safe * DISTANCE_METERS_PER_PIXEL);
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} KM` : `${meters} M`;
}

/** Puntaje con ceros a la izquierda (look arcade de 6 dígitos). */
export function formatScore(score: number): string {
  const safe = Number.isFinite(score) && score > 0 ? Math.floor(score) : 0;
  return String(safe).padStart(SCORE_DIGITS, '0');
}
