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

/* ------------------------------------------------------------------ */
/* Carrera en circuito (issue #9, V1)                                  */
/* ------------------------------------------------------------------ */

/**
 * Tiempo de carrera en ms → cronómetro "M:SS.mmm" (0:42.317). Es el formato
 * del HUD de la RaceScene y de la rama de resultados de carrera de
 * GameOverScene. Defensivo: NaN, infinitos y negativos muestran 0:00.000.
 */
export function formatLapMs(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : 0;
  const minutes = Math.floor(safe / 60000);
  const seconds = Math.floor((safe % 60000) / 1000);
  const millis = safe % 1000;
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

/**
 * Badge de vuelta del HUD de carrera: "VUELTA 2/3". La vuelta entrante se
 * clampea a [1, totalLaps] (defensa contra valores fuera de rango) y el total
 * es siempre ≥ 1.
 */
export function formatLapBadge(lap: number, totalLaps: number): string {
  const total = Number.isFinite(totalLaps) ? Math.max(1, Math.floor(totalLaps)) : 1;
  const current = Number.isFinite(lap) ? Math.min(Math.max(1, Math.floor(lap)), total) : 1;
  return `VUELTA ${current}/${total}`;
}

/* ------------------------------------------------------------------ */
/* Gran Premio vs CPU (issue #14, V3)                                   */
/* ------------------------------------------------------------------ */

/** Separador de los segmentos del chip de modo. */
const CHIP_SEPARATOR = ' · ';

/**
 * Chip de contexto del GRAN PREMIO: "GRAN PREMIO · MÓNACO · DIFÍCIL". Los
 * segmentos vacíos (pista o dificultad ausentes) se omiten junto con su
 * separador — nunca deja "· " colgando; sin nada, devuelve al menos el modo.
 */
export function formatGrandPrixChip(trackName: string, difficultyLabel: string): string {
  const parts = ['GRAN PREMIO'];
  const track = trackName.trim();
  const difficulty = difficultyLabel.trim();
  if (track.length > 0) {
    parts.push(track);
  }
  if (difficulty.length > 0) {
    parts.push(difficulty);
  }
  return parts.join(CHIP_SEPARATOR);
}

/**
 * Línea de gaps del HUD vs CPU: primero el rival de ADELANTE (positivo: le
 * perdés ese tiempo) y después el de ATRÁS (negativo: te lleva ese tiempo),
 * en segundos a un decimal con unidad — "+1.2s -0.8s". Los valores `null`
 * (sin vecino de ese lado o estimación no confiable) no se muestran; sin
 * ningún vecino devuelve '' (el HUD oculta la línea).
 */
export function formatRaceGaps(
  aheadSeconds: number | null,
  behindSeconds: number | null,
): string {
  const parts: string[] = [];
  if (aheadSeconds !== null && Number.isFinite(aheadSeconds)) {
    parts.push(`+${aheadSeconds.toFixed(1)}s`);
  }
  if (behindSeconds !== null && Number.isFinite(behindSeconds)) {
    parts.push(`${behindSeconds.toFixed(1)}s`);
  }
  return parts.join(' ');
}

/**
 * Indicador de goma del GRAN PREMIO con desgaste activo (#39): porcentaje de
 * neumático RESTANTE — "NEUMÁTICOS 87%" (100 = goma nueva). El porcentaje se
 * clampea a [0, 100] y el basura degrada a 0 (sin "NaN%" en pantalla).
 */
export function formatWear(remainingPct: number): string {
  const safe = Number.isFinite(remainingPct)
    ? Math.min(Math.max(Math.round(remainingPct), 0), 100)
    : 0;
  return `NEUMÁTICOS ${safe}%`;
}
