import { describe, expect, it } from 'vitest';
import { isSpectatorChatVisible } from '../chat/spectatorChat';

/**
 * Tests de la gate del chat de espectador (C3, decisión 2A del issue #2):
 * el botón CHAT del overlay de espectador existe SOLO para un jugador
 * ELIMINADO de una carrera MULTIJUGADOR. Un VIVO en multi nunca lo ve (ni
 * deshabilitado) y en SOLO no aplica. GameScene la usa dentro de
 * `showSpectatorOverlay` — esta tabla es el contrato.
 */

describe('spectatorChat — isSpectatorChatVisible (gate pura)', () => {
  it('eliminado en MULTIJUGADOR: SÍ (lee y escribe en el chat de sala)', () => {
    expect(isSpectatorChatVisible(true, true)).toBe(true);
  });

  it('vivo en multijugador: NUNCA (mientras conducís no hay chat)', () => {
    expect(isSpectatorChatVisible(false, true)).toBe(false);
  });

  it('modo SOLO: no aplica (no hay sala ni nadie con quien hablar)', () => {
    expect(isSpectatorChatVisible(true, false)).toBe(false);
    expect(isSpectatorChatVisible(false, false)).toBe(false);
  });

  it('la tabla completa (2×2) — eliminado&&multi es el ÚNICO caso visible', () => {
    const table = [
      [true, true, true],
      [true, false, false],
      [false, true, false],
      [false, false, false],
    ] as const;
    for (const [selfEliminated, isMultiplayer, expected] of table) {
      expect(isSpectatorChatVisible(selfEliminated, isMultiplayer)).toBe(expected);
    }
  });
});
