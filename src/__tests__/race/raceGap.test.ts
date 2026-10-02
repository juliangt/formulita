import { describe, expect, it } from 'vitest';
import { RACE_VS_CPU } from '../../config/balance';
import { computeRaceGaps, type RaceGapOptions } from '../../race/raceGap';

/**
 * Tests del gap en tiempo a los rivales de adelante/atrás (issue #14, V3).
 * La aproximación es la del presupuesto propio: diferencia de progreso
 * desenrollado dividida por la velocidad del JUGADOR, clampeada a
 * `RACE_VS_CPU.gapMaxSeconds` y redondeada a 0.1 s.
 */

const OPTIONS: RaceGapOptions = {
  maxSeconds: RACE_VS_CPU.gapMaxSeconds,
  minOwnSpeedPx: RACE_VS_CPU.gapMinOwnSpeedPx,
};

describe('computeRaceGaps — vecino de adelante y de atrás (V3 #14)', () => {
  it('elige al rival INMEDIATAMENTE adelante (positivo) y al inmediatamente atrás (negativo)', () => {
    // Velocidad propia 100 px/s: 120 px adelante = 1.2 s, 80 px atrás = -0.8 s.
    const gaps = computeRaceGaps(
      1000,
      100,
      [
        { peerId: 'far-ahead', progress: 1500 },
        { peerId: 'ahead', progress: 1120 },
        { peerId: 'behind', progress: 920 },
        { peerId: 'far-behind', progress: 400 },
      ],
      OPTIONS,
    );
    expect(gaps.ahead).toEqual({ peerId: 'ahead', seconds: 1.2 });
    expect(gaps.behind).toEqual({ peerId: 'behind', seconds: -0.8 });
  });

  it('la convención es la del intervalo F1: + le perdés al de adelante, − te lleva el de atrás', () => {
    const gaps = computeRaceGaps(
      500,
      250,
      [{ peerId: 'rival', progress: 575 }],
      OPTIONS,
    );
    expect(gaps.ahead?.seconds).toBe(0.3);
    expect(gaps.behind).toBeNull();
  });

  it('con un solo rival ATRÁS el lado de adelante queda vacío', () => {
    const gaps = computeRaceGaps(
      900,
      90,
      [{ peerId: 'behind', progress: 810 }],
      OPTIONS,
    );
    expect(gaps.ahead).toBeNull();
    expect(gaps.behind?.peerId).toBe('behind');
    expect(gaps.behind?.seconds).toBe(-1);
  });

  it('sin rivales no hay gaps', () => {
    const gaps = computeRaceGaps(100, 100, [], OPTIONS);
    expect(gaps.ahead).toBeNull();
    expect(gaps.behind).toBeNull();
  });

  it('un rival EXACTAMENTE a la par no es vecino de nadie (empate sin gap)', () => {
    const gaps = computeRaceGaps(
      700,
      100,
      [
        { peerId: 'even-a', progress: 700 },
        { peerId: 'even-b', progress: 700 },
      ],
      OPTIONS,
    );
    expect(gaps.ahead).toBeNull();
    expect(gaps.behind).toBeNull();
  });
});

describe('computeRaceGaps — clamp y redondeo (V3 #14)', () => {
  it('clampea al techo del balance (lejos ya no informa)', () => {
    expect(RACE_VS_CPU.gapMaxSeconds).toBe(30);
    const gaps = computeRaceGaps(
      0,
      100,
      [
        { peerId: 'ahead', progress: 9000 },
        { peerId: 'behind', progress: -9000 },
      ],
      OPTIONS,
    );
    expect(gaps.ahead?.seconds).toBe(30);
    expect(gaps.behind?.seconds).toBe(-30);
  });

  it('un clamp personalizado reemplaza al del balance (config inyectable)', () => {
    const gaps = computeRaceGaps(
      0,
      10,
      [
        { peerId: 'ahead', progress: 500 },
        { peerId: 'behind', progress: -500 },
      ],
      { maxSeconds: 2.5, minOwnSpeedPx: 0 },
    );
    expect(gaps.ahead?.seconds).toBe(2.5);
    expect(gaps.behind?.seconds).toBe(-2.5);
  });

  it('redondea a 0.1 s (un número que vibra por frame estorba)', () => {
    // 137 px a 100 px/s = 1.37 s → 1.4; 33 px a 100 px/s = 0.33 s → 0.3.
    const gaps = computeRaceGaps(
      1000,
      100,
      [
        { peerId: 'ahead', progress: 1137 },
        { peerId: 'behind', progress: 967 },
      ],
      OPTIONS,
    );
    expect(gaps.ahead?.seconds).toBe(1.4);
    expect(gaps.behind?.seconds).toBe(-0.3);
  });

  it('clampea ANTES de redondear (no muestra el techo redondeado hacia arriba)', () => {
    // 29.97 s con techo 30: sin clamp previo redondearía a 30 (igual), con
    // 29.96 + techo 29.9 comprueba que el techo manda sobre el redondeo.
    const gaps = computeRaceGaps(
      0,
      100,
      [{ peerId: 'ahead', progress: 2996 }],
      { maxSeconds: 29.9, minOwnSpeedPx: 0 },
    );
    expect(gaps.ahead?.seconds).toBe(29.9);
  });
});

describe('computeRaceGaps — defensas (V3 #14)', () => {
  it('con velocidad propia bajo el piso la estimación no se muestra', () => {
    // Arrancando de la parrilla (0 px/s) no hay gap confiable.
    const gaps = computeRaceGaps(
      1000,
      5,
      [{ peerId: 'ahead', progress: 1100 }],
      OPTIONS,
    );
    expect(gaps.ahead).toBeNull();
    expect(gaps.behind).toBeNull();
  });

  it('velocidad propia exactamente en el piso sí muestra', () => {
    const gaps = computeRaceGaps(
      1000,
      RACE_VS_CPU.gapMinOwnSpeedPx,
      [{ peerId: 'ahead', progress: 1090 }],
      OPTIONS,
    );
    expect(gaps.ahead?.seconds).toBe(3);
  });

  it('velocidad propia no finita o cero → nulls (nunca divide por cero)', () => {
    const rivals = [{ peerId: 'ahead', progress: 1100 }];
    expect(computeRaceGaps(1000, 0, rivals, OPTIONS).ahead).toBeNull();
    expect(computeRaceGaps(1000, Number.NaN, rivals, OPTIONS).ahead).toBeNull();
    expect(
      computeRaceGaps(1000, Number.POSITIVE_INFINITY, rivals, OPTIONS).ahead,
    ).toBeNull();
  });

  it('progresos no finitos se ignoran', () => {
    const gaps = computeRaceGaps(
      1000,
      100,
      [
        { peerId: 'ahead-broken', progress: Number.NaN },
        { peerId: 'ahead', progress: 1120 },
      ],
      OPTIONS,
    );
    expect(gaps.ahead?.peerId).toBe('ahead');
    expect(
      computeRaceGaps(Number.NaN, 100, [{ peerId: 'ahead', progress: 1100 }], OPTIONS).ahead,
    ).toBeNull();
  });

  it('peerIds vacíos o ausentes se ignoran', () => {
    const gaps = computeRaceGaps(
      1000,
      100,
      [
        { peerId: '', progress: 1120 },
        { peerId: 'ahead', progress: 1200 },
      ],
      OPTIONS,
    );
    expect(gaps.ahead?.peerId).toBe('ahead');
  });

  it('empate de progreso entre dos rivales adelante: peerId ASC (determinista)', () => {
    const gaps = computeRaceGaps(
      1000,
      100,
      [
        { peerId: 'b', progress: 1150 },
        { peerId: 'a', progress: 1150 },
      ],
      OPTIONS,
    );
    expect(gaps.ahead?.peerId).toBe('a');
  });

  it('opciones basura degradan sin lanzar (clamp infinito, piso 0)', () => {
    const gaps = computeRaceGaps(
      0,
      10,
      [{ peerId: 'ahead', progress: 500 }],
      { maxSeconds: Number.NaN, minOwnSpeedPx: -5 },
    );
    // Sin techo válido el gap sale crudo redondeado: 50 s.
    expect(gaps.ahead?.seconds).toBe(50);
  });
});
