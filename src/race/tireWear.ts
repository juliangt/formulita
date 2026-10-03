/**
 * tireWear — desgaste de neumáticos del GRAN PREMIO (issue #39).
 *
 * Mecánica OPCIONAL (toggle DESGASTE del picker, default NO): con el toggle
 * apagado ningún auto cambia su rendimiento por rodar o chocar; con el
 * toggle encendido cada auto lleva un nivel de goma 0–1 que:
 * - crece con la DISTANCIA rodada (`wearFromDistance`) y con cada GOLPE
 *   (`wearFromImpact`, escalado por el impacto del contacto), y
 * - recorta la VELOCIDAD PUNTA (`speedCapFor`): la punta cae linealmente
 *   hasta `RACE_WEAR.maxSpeedPenalty` con la goma en el tope.
 *
 * Es el mismo contrato de siempre: funciones puras, defensivas con basura
 * (NaN degrada a "sin cambio") y constantes en `RACE_WEAR` — cero números
 * mágicos acá. El nivel NO se persiste: vive y muere con la carrera.
 */

import { CIRCUIT, RACE_CONTACT, RACE_WEAR } from '../config/balance';

/**
 * Desgaste por DISTANCIA rodada (fracción de goma por los px dados): el
 * kilometraje de la carrera degrada la goma aunque se maneje limpio.
 * Distancia basura (negativa, no finita) → 0.
 */
export function wearFromDistance(distancePx: number): number {
  if (!Number.isFinite(distancePx) || distancePx <= 0) {
    return 0;
  }
  return (distancePx / 1000) * RACE_WEAR.perThousandPx;
}

/**
 * Desgaste extra por UN GOLPE: escalado por el impacto del contacto contra
 * `RACE_CONTACT.maxImpactPx` (un roce leve casi no castiga; un golpe al
 * tope del impacto cuesta el `RACE_WEAR.perImpact` completo).
 * Impacto basura → 0.
 */
export function wearFromImpact(impact: number): number {
  if (!Number.isFinite(impact) || impact <= 0) {
    return 0;
  }
  const normalized = Math.min(impact / RACE_CONTACT.maxImpactPx, 1);
  return RACE_WEAR.perImpact * normalized;
}

/**
 * Acumula desgaste sobre el nivel actual, con tope en `RACE_WEAR.maxLevel`
 * (la goma no se regenera: sólo suma). Nivel basura arranca desde 0.
 */
export function accumulateWear(current: number, delta: number): number {
  const base = Number.isFinite(current) ? Math.max(current, 0) : 0;
  const add = Number.isFinite(delta) && delta > 0 ? delta : 0;
  return Math.min(base + add, RACE_WEAR.maxLevel);
}

/**
 * Tope de velocidad (px/s) para un nivel de desgaste dado: de
 * `CIRCUIT.maxSpeed` con la goma nueva baja linealmente hasta
 * `CIRCUIT.maxSpeed × (1 − maxSpeedPenalty)` con la goma en el tope.
 * Nivel basura → goma nueva (sin castigo fantasma).
 */
export function speedCapFor(wear: number): number {
  const level = Number.isFinite(wear) ? Math.min(Math.max(wear, 0), RACE_WEAR.maxLevel) : 0;
  return CIRCUIT.maxSpeed * (1 - RACE_WEAR.maxSpeedPenalty * level);
}
