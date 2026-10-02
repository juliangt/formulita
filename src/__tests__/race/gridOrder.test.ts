import { describe, expect, it } from 'vitest';
import { CIRCUIT } from '../../config/balance';
import { assignGridOrder } from '../../race/gridOrder';
import type { GridSlot } from '../../race/gridOrder';
import { buildTrackPath, getTrackById } from '../../race/tracks';

/**
 * Tests de la parrilla determinista (issue #9, V0): misma (players, seed) ⇒
 * misma parrilla siempre; seeds distintas varían; todas las casillas quedan
 * detrás de la meta en 2 columnas escalonadas.
 */

const path = buildTrackPath(getTrackById('monza')!);
const L = path.totalLength;

function roster(n: number): { peerId: string }[] {
  return Array.from({ length: n }, (_, i) => ({ peerId: `peer-${String(i).padStart(2, '0')}` }));
}

describe('assignGridOrder — determinismo', () => {
  it('misma (players, seed) produce exactamente la misma parrilla', () => {
    const players = roster(8);
    const a = assignGridOrder(players, 12345, path);
    const b = assignGridOrder(players, 12345, path);
    expect(a).toEqual(b);
  });

  it('el orden de llegada del roster no afecta el resultado', () => {
    const players = roster(6);
    const reordered = [...players].reverse();
    const a = assignGridOrder(players, 777, path);
    const b = assignGridOrder(reordered, 777, path);
    expect(a).toEqual(b);
  });

  it('con varias seeds aparecen al menos 2 órdenes distintos (estadístico)', () => {
    const players = roster(10);
    const orders = new Set<string>();
    for (let seed = 0; seed < 24; seed += 1) {
      const grid = assignGridOrder(players, seed * 7919, path);
      orders.add(grid.map((slot) => slot.peerId).join(','));
    }
    expect(orders.size).toBeGreaterThanOrEqual(2);
  });

  it('asigna todos los jugadores exactamente una vez', () => {
    const players = roster(10);
    const grid = assignGridOrder(players, 42, path);
    expect(grid).toHaveLength(10);
    const ids = grid.map((slot) => slot.peerId).sort();
    expect(ids).toEqual(roster(10).map((p) => p.peerId).sort());
  });
});

describe('assignGridOrder — casillas', () => {
  const grid = assignGridOrder(roster(10), 42, path) as Required<GridSlot>[];

  it('todas las casillas están detrás de la meta (s cerca de L)', () => {
    const maxBehind = CIRCUIT.gridStartOffsetPx
      + 4 * CIRCUIT.gridRowStepPx; // 5 filas para 10 jugadores
    for (const slot of grid) {
      expect(slot.s).toBeGreaterThanOrEqual(L - maxBehind - 1);
      expect(slot.s).toBeLessThan(L);
    }
  });

  it('la pole (índice 0) comparte fila y cada fila escalona hacia atrás', () => {
    const byIndex = [...grid].sort((a, b) => a.index - b.index);
    // Dentro de una fila (2 autos) el s es idéntico; entre filas escala atrás.
    for (let i = 2; i < byIndex.length; i += 1) {
      expect(byIndex[i].s).toBeLessThan(byIndex[i - 2].s);
    }
    expect(byIndex[1].s).toBeCloseTo(byIndex[0].s, 6);
    const expectedFirst = L - CIRCUIT.gridStartOffsetPx;
    expect(byIndex[0].s).toBeCloseTo(expectedFirst, 6);
  });

  it('dos columnas escalonadas: laterales alternan ±gridLateralOffsetPx', () => {
    const byIndex = [...grid].sort((a, b) => a.index - b.index);
    byIndex.forEach((slot, i) => {
      const expected = i % 2 === 0
        ? -CIRCUIT.gridLateralOffsetPx
        : CIRCUIT.gridLateralOffsetPx;
      expect(slot.lateral).toBe(expected);
      const row = Math.floor(i / 2);
      const expectedS = L - CIRCUIT.gridStartOffsetPx - row * CIRCUIT.gridRowStepPx;
      expect(slot.s).toBeCloseTo(expectedS, 6);
    });
  });

  it('las laterales caben en la pista más angosta', () => {
    const monaco = buildTrackPath(getTrackById('monaco')!);
    expect(CIRCUIT.gridLateralOffsetPx).toBeLessThan(getTrackById('monaco')!.widthPx / 2);
    void monaco;
  });

  it('con pista resuelve coordenadas de mundo sobre el asfalto', () => {
    for (const slot of grid) {
      // La casilla proyectada cae a ±gridLateralOffsetPx del eje (tolerancia
      // de 0.05 px: el ruido float de la proyección crece con el mundo ×2.5
      // del issue #18 — medía ~0.005 px sobre coordenadas de 7000).
      const proj = path.project(slot.x, slot.y);
      expect(Math.abs(proj.lateral)).toBeCloseTo(Math.abs(slot.lateral), 1);
      expect(slot.angle).toBeTypeOf('number');
    }
  });

  it('sin pista devuelve offsets negativos relativos a la meta', () => {
    const grid = assignGridOrder(roster(4), 9);
    grid.forEach((slot, i) => {
      const row = Math.floor(i / 2);
      expect(slot.s).toBe(-(CIRCUIT.gridStartOffsetPx + row * CIRCUIT.gridRowStepPx));
      expect(slot.x).toBeUndefined();
      expect(slot.y).toBeUndefined();
    });
  });
});
