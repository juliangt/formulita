/**
 * Tests de `race/tireWear` (#39): desgaste de neumáticos OPCIONAL del GRAN
 * PREMIO. Funciones puras: acumulación con tope, desgaste por distancia y
 * por golpe, y el recorte de velocidad punta que produce la goma gastada.
 */

import { describe, expect, it } from 'vitest';

import { CIRCUIT, RACE_CONTACT, RACE_WEAR } from '../../config/balance';
import {
  accumulateWear,
  speedCapFor,
  wearFromDistance,
  wearFromImpact,
} from '../../race/tireWear';

describe('wearFromDistance — el kilometraje gasta goma', () => {
  it('1000 px cuestan exactamente `perThousandPx`', () => {
    expect(wearFromDistance(1000)).toBeCloseTo(RACE_WEAR.perThousandPx, 12);
  });

  it('una carrera de 3 vueltas (~54000 px) gasta una fracción sentible sin llegar al tope', () => {
    const lapPx = CIRCUIT.referenceSpeed * 40; // 18000 px: vuelta de referencia.
    const raceWear = wearFromDistance(lapPx * CIRCUIT.totalLaps);
    expect(raceWear).toBeGreaterThan(0.2);
    expect(raceWear).toBeLessThan(RACE_WEAR.maxLevel);
  });

  it('distancia basura (0, negativa, NaN) no gasta nada', () => {
    for (const px of [0, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(wearFromDistance(px)).toBe(0);
    }
  });
});

describe('wearFromImpact — los golpes aceleran el desgaste', () => {
  it('un golpe al tope del impacto cuesta el `perImpact` completo', () => {
    expect(wearFromImpact(RACE_CONTACT.maxImpactPx)).toBeCloseTo(RACE_WEAR.perImpact, 12);
  });

  it('escala lineal con el impacto y se clampea por encima del tope', () => {
    expect(wearFromImpact(RACE_CONTACT.maxImpactPx / 2)).toBeCloseTo(RACE_WEAR.perImpact / 2, 12);
    expect(wearFromImpact(RACE_CONTACT.maxImpactPx * 10)).toBeCloseTo(RACE_WEAR.perImpact, 12);
  });

  it('impacto basura no gasta nada', () => {
    for (const impact of [0, -50, Number.NaN]) {
      expect(wearFromImpact(impact)).toBe(0);
    }
  });
});

describe('accumulateWear — sólo suma, con tope', () => {
  it('acumula dos deltas', () => {
    expect(accumulateWear(0.2, 0.3)).toBeCloseTo(0.5, 12);
  });

  it('el tope es `maxLevel`: la goma no queda peor que 1', () => {
    expect(accumulateWear(0.95, 0.5)).toBe(RACE_WEAR.maxLevel);
    expect(accumulateWear(RACE_WEAR.maxLevel, 0.1)).toBe(RACE_WEAR.maxLevel);
  });

  it('delta basura es no-op y base basura arranca desde 0', () => {
    expect(accumulateWear(0.4, -0.5)).toBeCloseTo(0.4, 12); // No se regenera.
    expect(accumulateWear(0.4, Number.NaN)).toBeCloseTo(0.4, 12);
    expect(accumulateWear(Number.NaN, 0.2)).toBeCloseTo(0.2, 12);
  });
});

describe('speedCapFor — la goma gastada recorta la punta', () => {
  it('goma nueva: punta completa (sin castigo)', () => {
    expect(speedCapFor(0)).toBe(CIRCUIT.maxSpeed);
  });

  it('goma en el tope: la punta cae exactamente `maxSpeedPenalty`', () => {
    expect(speedCapFor(RACE_WEAR.maxLevel)).toBeCloseTo(
      CIRCUIT.maxSpeed * (1 - RACE_WEAR.maxSpeedPenalty),
      6,
    );
  });

  it('monótona: más desgaste nunca sube la punta', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let level = 0; level <= 1.0001; level += 0.05) {
      expect(speedCapFor(level)).toBeLessThanOrEqual(previous);
      previous = speedCapFor(level);
    }
  });

  it('nivel basura degrada a goma nueva (sin castigo fantasma)', () => {
    expect(speedCapFor(Number.NaN)).toBe(CIRCUIT.maxSpeed);
    expect(speedCapFor(-3)).toBe(CIRCUIT.maxSpeed);
  });

  it('el recorte de punta es sentible pero no rompe el juego (~18% al final)', () => {
    const cap = speedCapFor(RACE_WEAR.maxLevel);
    expect(cap).toBeGreaterThan(CIRCUIT.maxSpeed * 0.7);
    expect(cap).toBeLessThan(CIRCUIT.maxSpeed * 0.9);
  });
});

describe('integración: distancia + golpes sobre una carrera', () => {
  it('una carrera sucia (3 vueltas + 10 golpes fuertes) queda cerca del tope, una limpia no', () => {
    const lapPx = CIRCUIT.referenceSpeed * 40;
    let limpia = 0;
    limpia = accumulateWear(limpia, wearFromDistance(lapPx * CIRCUIT.totalLaps));
    let sucia = limpia;
    for (let i = 0; i < 10; i += 1) {
      sucia = accumulateWear(sucia, wearFromImpact(RACE_CONTACT.maxImpactPx));
    }
    // La limpia sólo paga kilometraje; la sucia llega mucho más arriba.
    expect(sucia).toBeGreaterThan(limpia + 0.3);
    // Y la punta de la sucia cae visiblemente más.
    expect(speedCapFor(sucia)).toBeLessThan(speedCapFor(limpia));
  });
});
