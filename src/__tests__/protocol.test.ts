import { describe, expect, it } from 'vitest';
import { CHAT_MAX_LEN, MULTIPLAYER } from '../config/balance';
import {
  isValidChatText,
  isValidPlayerName,
  isValidRoomWord,
  makeChatPayload,
  makeDmPayload,
  makeInvitePayload,
  makePingPayload,
  parseMultiplayerInit,
  roundStatePayload,
  sanitizeChatText,
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

describe('protocol — roundStatePayload (wire de `state`, M2)', () => {
  it('redondea los floats a enteros (payload chico a 10 Hz)', () => {
    expect(
      roundStatePayload({
        distance: 12345.6789,
        x: 360.4,
        speed: 403.2,
        turboActive: false,
        coins: 7,
        score: 2345.6,
      }),
    ).toEqual({
      distance: 12346,
      x: 360,
      speed: 403,
      turboActive: false,
      coins: 7,
      score: 2346,
    });
  });

  it('viaja SOLO los campos del protocolo (nada extra se cuela)', () => {
    const payload = roundStatePayload({
      distance: 1,
      x: 2,
      speed: 3,
      turboActive: true,
      coins: 4,
      score: 5,
    });
    expect(Object.keys(payload).sort()).toEqual(['coins', 'distance', 'score', 'speed', 'turboActive', 'x']);
  });

  it('no finitos degradan a 0 (jamás NaN por el wire)', () => {
    expect(
      roundStatePayload({
        distance: Number.NaN,
        x: Number.POSITIVE_INFINITY,
        speed: -12.5,
        turboActive: undefined as unknown as boolean,
        coins: Number.NaN,
        score: 1,
      }),
    ).toEqual({ distance: 0, x: 0, speed: -12, turboActive: false, coins: 0, score: 1 });
  });
});

describe('protocol — chat social (issue #2, C0): sanitizeChatText', () => {
  it('trim + colapso de whitespace interno + máx CHAT_MAX_LEN', () => {
    expect(CHAT_MAX_LEN).toBe(200);
    expect(sanitizeChatText('  hola   gente  ')).toBe('hola gente');
    expect(sanitizeChatText('una\tlínea\n nueva')).toBe('una línea nueva');
    expect(sanitizeChatText('a'.repeat(CHAT_MAX_LEN))).toHaveLength(CHAT_MAX_LEN);
    expect(sanitizeChatText(`a`.repeat(CHAT_MAX_LEN + 50))).toHaveLength(CHAT_MAX_LEN);
  });

  it('vacío y solo whitespace quedan vacíos; isValidChatText los rechaza', () => {
    expect(sanitizeChatText('')).toBe('');
    expect(sanitizeChatText(' \t\n ')).toBe('');
    expect(isValidChatText('hola')).toBe(true);
    expect(isValidChatText('   ')).toBe(false);
    expect(isValidChatText('')).toBe(false);
  });

  it('respeta unicode y es idempotente (misma regla en emisor y receptor)', () => {
    const once = sanitizeChatText('  ñandú   voló  ');
    expect(once).toBe('ñandú voló');
    expect(sanitizeChatText(once)).toBe(once);
  });
});

describe('protocol — factories de payloads del chat', () => {
  it('makeChatPayload: solo {text}, ya sanitizado', () => {
    expect(makeChatPayload('  hola   sala  ')).toEqual({ text: 'hola sala' });
    expect(Object.keys(makeChatPayload('x'))).toEqual(['text']);
    expect(makeChatPayload('b'.repeat(400)).text).toHaveLength(CHAT_MAX_LEN);
    // Vacío viaja como vacío: quien llama decide no enviarlo (ChatStore lo
    // valida con isValidChatText/sanitizeText antes de armar el payload).
    expect(makeChatPayload('   ')).toEqual({ text: '' });
  });

  it('makeDmPayload: {text, targetPeerId} con texto sanitizado y target limpio', () => {
    expect(makeDmPayload('  pst  estás? ', ' peer-a ')).toEqual({
      text: 'pst estás?',
      targetPeerId: 'peer-a',
    });
    expect(makeDmPayload('z'.repeat(300), 'peer-a').text).toHaveLength(CHAT_MAX_LEN);
    expect(Object.keys(makeDmPayload('x', 'y')).sort()).toEqual(['targetPeerId', 'text']);
  });

  it('makePingPayload: heartbeat VACÍO (la señal es el hecho, no el contenido)', () => {
    expect(makePingPayload()).toEqual({});
    expect(Object.keys(makePingPayload())).toHaveLength(0);
  });

  it('makeInvitePayload: la keyword es una room word (trim, NFD, A-Z)', () => {
    expect(makeInvitePayload('parrilla')).toEqual({ keyword: 'PARRILLA' });
    expect(makeInvitePayload('  párrilla  ')).toEqual({ keyword: 'PARRILLA' });
    expect(makeInvitePayload('chicane9')).toEqual({ keyword: 'CHICANE' });
    expect(Object.keys(makeInvitePayload('boxes'))).toEqual(['keyword']);
  });
});
