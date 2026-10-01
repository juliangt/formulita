import { describe, expect, it } from 'vitest';
import { formatKm, leaderboardRowTexts, personalResultMessage } from '../ui/Leaderboard';
import { DISTANCE_METERS_PER_PIXEL } from '../config/balance';
import { parseMultiGameOverData, type FinalStanding } from '../net/protocol';

/**
 * Tests de la lógica PURA del leaderboard final (M2): formateo de kilómetros,
 * textos de fila, mensaje personal y el parseo defensivo del payload
 * GameScene → GameOverScene.
 */

function standing(partial: Partial<FinalStanding> & { peerId: string }): FinalStanding {
  return {
    name: `P-${partial.peerId}`,
    color: 0xd63c3c,
    coins: 10,
    score: 1000,
    distance: 10000,
    place: 1,
    isWinner: false,
    ...partial,
  };
}

describe('formatKm — kilómetros con 2 decimales', () => {
  it('convierte px → km con la constante de balance (10 px = 1 m)', () => {
    // 12345 px = 1234.5 m = 1.2345 km → "1.23 KM".
    expect(formatKm(12345)).toBe('1.23 KM');
    expect(formatKm(100000)).toBe('10.00 KM');
    expect(formatKm(0)).toBe('0.00 KM');
  });

  it('dos decimales SIEMPRE (look de tabla alineada en monospace)', () => {
    expect(formatKm(500)).toBe('0.05 KM');
    expect(formatKm(1)).toBe('0.00 KM'); // 0.1 m redondea a 0.00
    expect(formatKm(25000)).toBe('2.50 KM');
  });

  it('entradas basura degradan a 0.00 KM sin lanzar', () => {
    expect(formatKm(Number.NaN)).toBe('0.00 KM');
    expect(formatKm(-500)).toBe('0.00 KM');
    expect(formatKm(Number.POSITIVE_INFINITY)).toBe('0.00 KM');
  });

  it('usa DISTANCE_METERS_PER_PIXEL (no un número mágico)', () => {
    expect(formatKm(1000 / DISTANCE_METERS_PER_PIXEL)).toBe('1.00 KM');
  });
});

describe('leaderboardRowTexts — textos de fila', () => {
  it('formatea puesto, nombre, monedas, puntaje y km', () => {
    const texts = leaderboardRowTexts(
      standing({ peerId: 'a', name: 'ANA', coins: 42, score: 9999, distance: 12345, place: 2 }),
    );
    expect(texts).toEqual({
      place: '2',
      name: 'ANA',
      coins: '42',
      score: '9999',
      km: '1.23 KM',
    });
  });

  it('el ganador lleva corona en el puesto', () => {
    const texts = leaderboardRowTexts(standing({ peerId: 'a', place: 1, isWinner: true }));
    expect(texts.place).toBe('♛1');
  });
});

describe('personalResultMessage — mensaje según el puesto', () => {
  it('puesto 1 → ¡GANASTE!', () => {
    expect(personalResultMessage(1)).toBe('¡GANASTE!');
  });

  it('los demás → TERMINASTE N°X con el número literal', () => {
    expect(personalResultMessage(2)).toBe('TERMINASTE N°2');
    expect(personalResultMessage(10)).toBe('TERMINASTE N°10');
  });
});

describe('parseMultiGameOverData — payload GameScene → GameOverScene', () => {
  const payload = {
    mode: 'multi' as const,
    myPeerId: 'b',
    standings: [
      standing({ peerId: 'a', place: 1, isWinner: true, coins: 30 }),
      standing({ peerId: 'b', place: 2, coins: 12 }),
    ],
  };

  it('acepta un payload completo', () => {
    const parsed = parseMultiGameOverData(payload);
    expect(parsed).not.toBeNull();
    expect(parsed!.myPeerId).toBe('b');
    expect(parsed!.standings.length).toBe(2);
    expect(parsed!.standings[0].place).toBe(1);
    expect(parsed!.standings[0].isWinner).toBe(true);
  });

  it('null para el payload solo (mode ausente): GameOver degrada a clásico', () => {
    expect(parseMultiGameOverData({ score: 10, distance: 5, coins: 1, isNewBest: false })).toBeNull();
    expect(parseMultiGameOverData(undefined)).toBeNull();
    expect(parseMultiGameOverData('multi')).toBeNull();
  });

  it('null si falta myPeerId o standings (payload corrupto)', () => {
    expect(parseMultiGameOverData({ mode: 'multi', standings: payload.standings })).toBeNull();
    expect(parseMultiGameOverData({ mode: 'multi', myPeerId: 'b' })).toBeNull();
    expect(parseMultiGameOverData({ mode: 'multi', myPeerId: 'b', standings: [] })).toBeNull();
  });

  it('null con una fila corrupta en el medio', () => {
    expect(
      parseMultiGameOverData({
        mode: 'multi',
        myPeerId: 'b',
        standings: [standing({ peerId: 'a', place: 1 }), { peerId: 'x', name: 'X' }],
      }),
    ).toBeNull();
  });

  it('place inválido (0 / fraccional) rechaza la fila', () => {
    expect(
      parseMultiGameOverData({
        mode: 'multi',
        myPeerId: 'a',
        standings: [standing({ peerId: 'a', place: 0 })],
      }),
    ).toBeNull();
  });
});
