import { describe, expect, it } from 'vitest';
import { MULTIPLAYER } from '../config/balance';
import {
  isValidPlayerName,
  isValidRoomWord,
  parseMultiplayerInit,
  sanitizePlayerName,
  sanitizeRoomWord,
} from '../net/protocol';

/**
 * Tests del protocolo multijugador (M1): sanitización de nombre/palabra (la
 * misma normalización corre en emisor y receptor) y parseo defensivo del
 * init data multi de GameScene.
 */

describe('protocol — sanitizePlayerName', () => {
  it('recorta espacios de los bordes y colapsa los internos', () => {
    expect(sanitizePlayerName('Ana')).toBe('Ana');
    expect(sanitizePlayerName('   Ana   ')).toBe('Ana');
    expect(sanitizePlayerName('Juan    Pérez')).toBe('Juan Pérez');
    expect(sanitizePlayerName('  Ana   García  ')).toBe('Ana García');
  });

  it('corta en el máximo de balance (12) sin cortar a medias un espacio', () => {
    const thirteen = 'ABCDEFGHIJKLM';
    expect(thirteen.length).toBe(13);
    expect(MULTIPLAYER.maxPlayerNameLength).toBe(12);
    expect(sanitizePlayerName(thirteen)).toBe('ABCDEFGHIJKL');
  });

  it('respeta mayúsculas/minúsculas y unicode (es un nombre, no un código)', () => {
    expect(sanitizePlayerName('Ñoño Össo')).toBe('Ñoño Össo');
    // 12 exactos pasan; 13 se recorta.
    expect(sanitizePlayerName('speedRacer42')).toBe('speedRacer42');
    expect(sanitizePlayerName('speedRacer421')).toBe('speedRacer42');
  });

  it('vacío y solo espacios quedan vacíos (sin nombre válido)', () => {
    expect(sanitizePlayerName('')).toBe('');
    expect(sanitizePlayerName('   ')).toBe('');
    expect(sanitizePlayerName('\t\n')).toBe('');
  });

  it('isValidPlayerName es false solo cuando no queda nada', () => {
    expect(isValidPlayerName('Ana')).toBe(true);
    expect(isValidPlayerName('  x  ')).toBe(true);
    expect(isValidPlayerName('')).toBe(false);
    expect(isValidPlayerName('    ')).toBe(false);
  });
});

describe('protocol — sanitizeRoomWord', () => {
  it('trim + uppercase + solo A-Z', () => {
    expect(sanitizeRoomWord('parrilla')).toBe('PARRILLA');
    expect(sanitizeRoomWord('  parrilla  ')).toBe('PARRILLA');
    expect(sanitizeRoomWord('par rilla')).toBe('PARRILLA');
    expect(sanitizeRoomWord('parrilla9')).toBe('PARRILLA');
    expect(sanitizeRoomWord('parrilla!')).toBe('PARRILLA');
  });

  it('descompone y elimina diacríticos (NFD): acentos y Ñ', () => {
    expect(sanitizeRoomWord('párrilla')).toBe('PARRILLA');
    expect(sanitizeRoomWord('piraña')).toBe('PIRANA');
    expect(sanitizeRoomWord('Chicane')).toBe('CHICANE');
  });

  it('es idempotente', () => {
    const once = sanitizeRoomWord('_NEUMÁTICO_');
    expect(sanitizeRoomWord(once)).toBe(once);
  });

  it('entrada basura queda vacía o reducida a letras', () => {
    expect(sanitizeRoomWord('12345')).toBe('');
    expect(sanitizeRoomWord('---')).toBe('');
  });
});

describe('protocol — isValidRoomWord (formato de palabra VÁLIDA)', () => {
  it('acepta 5 a 9 letras A-Z', () => {
    expect(isValidRoomWord('PARRILLA')).toBe(true);
    expect(isValidRoomWord('BOXES')).toBe(true);
    expect(isValidRoomWord('ESCAPERIA')).toBe(true);
  });

  it('rechaza cortas, largas, minúsculas y con caracteres ajenos', () => {
    expect(isValidRoomWord('POLO')).toBe(false); // 4 letras
    expect(isValidRoomWord('PARRILLAX')).toBe(true); // 9 (límite ok)
    expect(isValidRoomWord('PARRILLAXY')).toBe(false); // 10
    expect(isValidRoomWord('parrilla')).toBe(false); // minúsculas
    expect(isValidRoomWord('PARR1LLA')).toBe(false); // dígito
    expect(isValidRoomWord('')).toBe(false);
  });
});

describe('protocol — parseMultiplayerInit (init data de GameScene)', () => {
  const valid = {
    mode: 'multi',
    seed: 123456789,
    players: [
      { peerId: 'a1', name: 'Ana', color: 0xd63c3c },
      { peerId: 'b2', name: 'Beto', color: 0x3c6cd6 },
    ],
    myPeerId: 'a1',
    roomWord: 'PARRILLA',
  };

  it('parsea un payload multi completo', () => {
    const parsed = parseMultiplayerInit(valid);
    expect(parsed).not.toBeNull();
    expect(parsed?.mode).toBe('multi');
    expect(parsed?.seed).toBe(123456789);
    expect(parsed?.myPeerId).toBe('a1');
    expect(parsed?.roomWord).toBe('PARRILLA');
    expect(parsed?.players).toEqual(valid.players);
  });

  it('null/undefined/objetos sin mode multi → null (modo solo)', () => {
    expect(parseMultiplayerInit(null)).toBeNull();
    expect(parseMultiplayerInit(undefined)).toBeNull();
    expect(parseMultiplayerInit(42)).toBeNull();
    expect(parseMultiplayerInit({})).toBeNull();
    expect(parseMultiplayerInit({ mode: 'solo' })).toBeNull();
  });

  it('seed inválida (fraccional, negativa, string) → null', () => {
    expect(parseMultiplayerInit({ ...valid, seed: 1.5 })).toBeNull();
    expect(parseMultiplayerInit({ ...valid, seed: -1 })).toBeNull();
    expect(parseMultiplayerInit({ ...valid, seed: '42' })).toBeNull();
  });

  it('rosters malformados → null (un jugador basura tira todo el payload)', () => {
    expect(parseMultiplayerInit({ ...valid, players: [] })).toBeNull();
    expect(parseMultiplayerInit({ ...valid, players: 'no array' })).toBeNull();
    expect(parseMultiplayerInit({ ...valid, players: [{ peerId: 'x' }] })).toBeNull();
    expect(
      parseMultiplayerInit({
        ...valid,
        players: [...valid.players, { peerId: '', name: 'Roto', color: 1 }],
      }),
    ).toBeNull();
  });

  it('myPeerId ausente → null; roomWord ausente → string vacío (degrada bien)', () => {
    expect(parseMultiplayerInit({ ...valid, myPeerId: '' })).toBeNull();
    const withoutWord = parseMultiplayerInit({ ...valid, roomWord: undefined });
    expect(withoutWord).not.toBeNull();
    expect(withoutWord?.roomWord).toBe('');
  });
});
