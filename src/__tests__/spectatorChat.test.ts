import { describe, expect, it } from 'vitest';
import {
  isRaceSpectatorChatVisible,
  isSpectatorChatVisible,
} from '../chat/spectatorChat';

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

/**
 * V3 (issue #9) — la puerta ADICIONAL que pide el issue: "terminó la
 * carrera" también habilita el chat de espectador en el circuito. Misma
 * decisión cerrada de #2: mientras CONDUCÍS no hay chat. RaceScene la usa
 * tras difundir su `rfin` propio.
 */
describe('spectatorChat — isRaceSpectatorChatVisible (gate de CARRERA, V3)', () => {
  it('terminó la propia carrera en MULTIJUGADOR: SÍ (lee y escribe en el chat de sala)', () => {
    expect(isRaceSpectatorChatVisible(true, true)).toBe(true);
  });

  it('todavía conduciendo en multijugador: NUNCA (mismo criterio que el vivo de #2)', () => {
    expect(isRaceSpectatorChatVisible(false, true)).toBe(false);
  });

  it('modo SOLO (ENTRENAR): no aplica (no hay sala ni nadie con quien hablar)', () => {
    expect(isRaceSpectatorChatVisible(true, false)).toBe(false);
    expect(isRaceSpectatorChatVisible(false, false)).toBe(false);
  });

  it('la tabla completa (2×2) — terminado&&multi es el ÚNICO caso visible', () => {
    const table = [
      [true, true, true],
      [true, false, false],
      [false, true, false],
      [false, false, false],
    ] as const;
    for (const [selfFinished, isMultiplayer, expected] of table) {
      expect(isRaceSpectatorChatVisible(selfFinished, isMultiplayer)).toBe(expected);
    }
  });

  it('es la MISMA regla que la gate de #2 con otra condición propia (coherencia)', () => {
    // La extensión es simétrica: espectador&&multi ⇒ chat, en ambos modos.
    for (const spectator of [true, false]) {
      for (const multi of [true, false]) {
        expect(isRaceSpectatorChatVisible(spectator, multi)).toBe(
          isSpectatorChatVisible(spectator, multi),
        );
      }
    }
  });
});
