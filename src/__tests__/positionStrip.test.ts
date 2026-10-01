import { describe, expect, it } from 'vitest';
import { computeStripPlacements, type StripPlayerInput } from '../ui/PositionStrip';
import { POSITION_STRIP } from '../config/balance';

/**
 * Tests de la lógica PURA de la franja de posiciones (M2): el mapeo
 * distancia relativa → offset vertical. El widget (rectángulos + texto
 * VIVOS) es render de Phaser y se verifica manualmente.
 */

const LAYOUT = { range: POSITION_STRIP.range, height: POSITION_STRIP.height };

function entry(partial: Partial<StripPlayerInput> & { peerId: string }): StripPlayerInput {
  return {
    color: 0xffffff,
    distance: 0,
    alive: true,
    isSelf: false,
    ...partial,
  };
}

describe('computeStripPlacements — mapeo por distancia relativa', () => {
  it('uno mismo siempre al centro (offset 0, sin clamp)', () => {
    const placements = computeStripPlacements(
      [entry({ peerId: 'me', isSelf: true, distance: 999999 })],
      12345,
      LAYOUT,
    );
    expect(placements[0]).toEqual({ peerId: 'me', offsetY: 0, clamped: false });
  });

  it('quien va DELANTE queda más arriba (offset negativo)', () => {
    const placements = computeStripPlacements(
      [entry({ peerId: 'rival', distance: 60000 })],
      50000, // yo: el rival lleva 10000 más
      LAYOUT,
    );
    expect(placements[0].offsetY).toBeLessThan(0);
  });

  it('quien va DETRÁS queda más abajo (offset positivo) y simétrico', () => {
    const ahead = computeStripPlacements([entry({ peerId: 'r', distance: 60000 })], 50000, LAYOUT);
    const behind = computeStripPlacements([entry({ peerId: 'r', distance: 40000 })], 50000, LAYOUT);
    expect(behind[0].offsetY).toBeGreaterThan(0);
    expect(behind[0].offsetY).toBeCloseTo(-ahead[0].offsetY, 6);
  });

  it('la escala es lineal: medio rango de distancia → medio camino al borde', () => {
    const half = LAYOUT.height / 2;
    // Diferencia de range/2 → offset de height/4 (range completo → borde).
    const placements = computeStripPlacements(
      [entry({ peerId: 'r', distance: 50000 + LAYOUT.range / 2 })],
      50000,
      LAYOUT,
    );
    expect(placements[0].offsetY).toBeCloseTo(-half / 2, 6);

    // Diferencia de range COMPLETO → borde exacto.
    const edge = computeStripPlacements(
      [entry({ peerId: 'r', distance: 50000 + LAYOUT.range })],
      50000,
      LAYOUT,
    );
    expect(edge[0].offsetY).toBeCloseTo(-half, 6);
    expect(edge[0].clamped).toBe(false); // el borde aún no está recortado
  });

  it('diferencias mayores al rango quedan CLAMPED al borde (sin salirse)', () => {
    const half = LAYOUT.height / 2;
    const far = computeStripPlacements(
      [entry({ peerId: 'r', distance: 50000 + LAYOUT.range * 50 })],
      50000,
      LAYOUT,
    );
    expect(far[0].offsetY).toBe(-half);
    expect(far[0].clamped).toBe(true);

    const farBehind = computeStripPlacements(
      [entry({ peerId: 'r', distance: -9999999 })],
      50000,
      LAYOUT,
    );
    expect(farBehind[0].offsetY).toBe(half);
    expect(farBehind[0].clamped).toBe(true);
  });

  it('dentro del rango no marca clamped', () => {
    const placements = computeStripPlacements(
      [entry({ peerId: 'r', distance: 50000 + LAYOUT.range * 0.4 })],
      50000,
      LAYOUT,
    );
    expect(placements[0].clamped).toBe(false);
  });

  it('el orden de salida respeta el de entrada (peerId emparejado)', () => {
    const placements = computeStripPlacements(
      [entry({ peerId: 'a', distance: 100 }), entry({ peerId: 'b', distance: 900 })],
      500,
      LAYOUT,
    );
    expect(placements.map((p) => p.peerId)).toEqual(['a', 'b']);
  });

  it('geometría degenerada (range ≤ 0): todos al centro, sin NaN', () => {
    const placements = computeStripPlacements(
      [entry({ peerId: 'a', distance: 100 })],
      0,
      { range: 0, height: 100 },
    );
    expect(placements[0].offsetY).toBe(0);
    expect(Number.isFinite(placements[0].offsetY)).toBe(true);
  });
});
