import { describe, expect, it } from 'vitest';
import { CHAT_MAX_LEN, CHAT_SEND_COOLDOWN_MS } from '../config/balance';
import { ChatStore, ROOM_THREAD_ID } from '../chat/ChatStore';
import type { PlayerInfo } from '../net/protocol';

/**
 * Tests del ChatStore (issue #2, C0): el estado puro del chat — hilos room
 * y DM, sanitización, throttle por hilo, no leídos y bloqueo por sesión.
 * Sin Phaser y sin red: el reloj se pasa explícito (o inyectado) y la
 * "red" es el propio llamador de receive*.
 */

const SELF: PlayerInfo = { peerId: 'me', name: 'Yo', color: 0xd63c3c };

function peer(peerId: string, name = peerId): PlayerInfo {
  return { peerId, name, color: 0x3c6cd6 };
}

function createStore(now?: () => number): ChatStore {
  return new ChatStore({ self: SELF, now });
}

describe('ChatStore — sanitizeText (una sola regla de texto)', () => {
  it('recorta espacios de los bordes y colapsa el whitespace interno', () => {
    const store = createStore();
    expect(store.sanitizeText('hola')).toBe('hola');
    expect(store.sanitizeText('   hola   ')).toBe('hola');
    expect(store.sanitizeText('que\t  tal\nestás')).toBe('que tal estás');
    expect(store.sanitizeText('  aa \n\n bb  ')).toBe('aa bb');
  });

  it('trunca en CHAT_MAX_LEN (200) y respeta unicode', () => {
    const store = createStore();
    expect(CHAT_MAX_LEN).toBe(200);
    expect(store.sanitizeText('ñandú ÑOÑO')).toBe('ñandú ÑOÑO');
    expect(store.sanitizeText('a'.repeat(350)).length).toBe(CHAT_MAX_LEN);
    // 200 exactos pasan; 201 se recorta a 200.
    expect(store.sanitizeText('b'.repeat(200)).length).toBe(200);
    expect(store.sanitizeText('b'.repeat(201)).length).toBe(200);
  });

  it('vacío y solo whitespace quedan vacíos (no hay mensaje)', () => {
    const store = createStore();
    expect(store.sanitizeText('')).toBe('');
    expect(store.sanitizeText('    ')).toBe('');
    expect(store.sanitizeText('\t\n ')).toBe('');
  });

  it('es idempotente (sanitizar un texto ya sanitizado no lo cambia)', () => {
    const store = createStore();
    const once = store.sanitizeText('  hola   que   tal  ');
    expect(store.sanitizeText(once)).toBe(once);
  });
});

describe('ChatStore — envío (valida cooldown + texto y devuelve mensaje o null)', () => {
  it('un mensaje válido entra al hilo room firmado con mi identidad', () => {
    const store = createStore();
    const message = store.sendRoomMessage('hola sala', 1_000);

    expect(message).not.toBeNull();
    expect(message).toMatchObject({
      threadId: ROOM_THREAD_ID,
      fromPeerId: SELF.peerId,
      fromName: SELF.name,
      color: SELF.color,
      text: 'hola sala',
      at: 1_000,
      mine: true,
    });
    expect(store.getMessages(ROOM_THREAD_ID)).toHaveLength(1);
    expect(store.hasThread(ROOM_THREAD_ID)).toBe(true);
  });

  it('el texto vacío (o solo espacios) no se envía y NO consume el cooldown', () => {
    const store = createStore();
    expect(store.sendRoomMessage('   ', 1_000)).toBeNull();
    expect(store.getMessages(ROOM_THREAD_ID)).toHaveLength(0);

    // El intento vacío no armó el reloj: el próximo mensaje válido pasa ya.
    expect(store.sendRoomMessage('ahora sí', 1_001)).not.toBeNull();
  });

  it('el texto se sanitiza al enviar (trim, colapso, máx 200)', () => {
    const store = createStore();
    const message = store.sendRoomMessage(`  hola\n  sala  ${'x'.repeat(300)}`, 1_000);

    // "hola sala " (10) + 190 x = exactamente CHAT_MAX_LEN.
    expect(message?.text).toBe(`hola sala ${'x'.repeat(190)}`);
    expect(message?.text.length).toBe(CHAT_MAX_LEN);
  });
});

describe('ChatStore — throttle (1 mensaje cada 1,5 s POR HILO)', () => {
  it('el primer mensaje pasa, el inmediato no, y a los 1,5 s vuelve a pasar', () => {
    const store = createStore();
    expect(CHAT_SEND_COOLDOWN_MS).toBe(1500);

    expect(store.sendRoomMessage('uno', 1_000)).not.toBeNull();
    expect(store.sendRoomMessage('dos', 1_400)).toBeNull();
    // Aún dentro del cooldown aunque el texto sea distinto.
    expect(store.canSend(ROOM_THREAD_ID, 1_500)).toBe(false);
    expect(store.sendRoomMessage('dos', 2_499)).toBeNull();
    // Justo a 1,5 s del último envío aceptado: pasa de nuevo.
    expect(store.sendRoomMessage('dos', 2_500)).not.toBeNull();
    // Y re-arma el cooldown desde el NUEVO envío.
    expect(store.sendRoomMessage('tres', 3_000)).toBeNull();
    expect(store.sendRoomMessage('tres', 4_000)).not.toBeNull();
  });

  it('los intentos rechazados no re-aran el cooldown', () => {
    const store = createStore();
    store.sendRoomMessage('uno', 1_000);
    // Rechazado por cooldown: no corre el reloj desde acá.
    expect(store.sendRoomMessage('dos', 2_000)).toBeNull();
    // Sigue contando desde el envío ACEPTADO de las 1_000.
    expect(store.sendRoomMessage('dos', 2_500)).not.toBeNull();
  });

  it('el cooldown es INDEPENDIENTE por hilo (room y cada DM por separado)', () => {
    const store = createStore();
    store.sendRoomMessage('sala', 1_000);

    // Room está en cooldown, pero el DM a otro peer no.
    expect(store.canSend(ROOM_THREAD_ID, 1_100)).toBe(false);
    expect(store.canSend('peer-a', 1_100)).toBe(true);
    expect(store.sendDm('peer-a', 'dm a', 1_100)).not.toBeNull();

    // Y un segundo DM (a otro peer) tampoco espera al de peer-a.
    expect(store.sendDm('peer-b', 'dm b', 1_100)).not.toBeNull();
    // Pero dos DM al MISMO peer sí se throttlean entre sí.
    expect(store.sendDm('peer-a', 'dm a2', 1_100)).toBeNull();
  });

  it('cooldownRemainingMs informa la espera (0 = se puede enviar)', () => {
    const store = createStore();
    expect(store.cooldownRemainingMs(ROOM_THREAD_ID, 0)).toBe(0);
    store.sendRoomMessage('hola', 1_000);
    expect(store.cooldownRemainingMs(ROOM_THREAD_ID, 1_000)).toBe(CHAT_SEND_COOLDOWN_MS);
    expect(store.cooldownRemainingMs(ROOM_THREAD_ID, 2_000)).toBe(500);
    expect(store.cooldownRemainingMs(ROOM_THREAD_ID, 2_500)).toBe(0);
  });

  it('funciona igual con reloj inyectado (sin now explícito por llamada)', () => {
    let now = 10_000;
    const store = createStore(() => now);

    expect(store.sendRoomMessage('uno')).not.toBeNull();
    expect(store.sendRoomMessage('dos')).toBeNull();
    now += CHAT_SEND_COOLDOWN_MS;
    expect(store.sendRoomMessage('dos')).not.toBeNull();
    expect(store.getMessages(ROOM_THREAD_ID)).toHaveLength(2);
    expect(store.getMessages(ROOM_THREAD_ID)[1]?.at).toBe(11_500);
  });
});

describe('ChatStore — recepción', () => {
  it('un mensaje de sala ajeno entra sanitizado, mine=false y suma no leídos', () => {
    const store = createStore();
    const message = store.receiveRoomMessage(peer('ana'), '  hola   gente ', 5_000);

    expect(message).toMatchObject({
      threadId: ROOM_THREAD_ID,
      fromPeerId: 'ana',
      fromName: 'ana',
      text: 'hola gente',
      at: 5_000,
      mine: false,
    });
    expect(store.getMessages(ROOM_THREAD_ID)).toHaveLength(1);
  });

  it('el texto recibido se re-sanitiza (un cliente rogue no elude el límite)', () => {
    const store = createStore();
    const message = store.receiveRoomMessage(peer('ana'), 'y'.repeat(500), 5_000);
    expect(message?.text.length).toBe(CHAT_MAX_LEN);
  });

  it('un mensaje recibido vacío se descarta (null, sin estado)', () => {
    const store = createStore();
    expect(store.receiveRoomMessage(peer('ana'), '   ', 5_000)).toBeNull();
    expect(store.receiveDm(peer('ana'), '', 5_000)).toBeNull();
    expect(store.hasThread(ROOM_THREAD_ID)).toBe(false);
    expect(store.hasThread('ana')).toBe(false);
  });

  it('un eventual eco del propio peerId cuenta como propio (no suma no leídos)', () => {
    const store = createStore();
    const message = store.receiveRoomMessage(SELF, 'eco', 5_000);
    expect(message?.mine).toBe(true);
    expect(store.getUnreadCount(ROOM_THREAD_ID)).toBe(0);
  });

  it('los DM entrantes crean su hilo on-demand con el peerId del remitente', () => {
    const store = createStore();
    expect(store.hasThread('ana')).toBe(false);

    const message = store.receiveDm(peer('ana', 'Ana'), 'hola pst', 6_000);

    expect(message?.threadId).toBe('ana');
    expect(store.hasThread('ana')).toBe(true);
    expect(store.getMessages('ana')).toHaveLength(1);
    // Los hilos se listan en orden de creación.
    store.receiveRoomMessage(peer('bob'), 'hola sala', 6_100);
    expect(store.getThreadIds()).toEqual(['ana', ROOM_THREAD_ID]);
  });

  it('un DM saliente también crea el hilo on-demand', () => {
    const store = createStore();
    expect(store.sendDm('ana', 'hola', 1_000)).not.toBeNull();
    expect(store.hasThread('ana')).toBe(true);
    expect(store.getMessages('ana')[0]?.mine).toBe(true);
  });
});

describe('ChatStore — no leídos por hilo y total', () => {
  it('los mensajes ajenos suman por hilo y los propios no', () => {
    const store = createStore();

    store.receiveRoomMessage(peer('ana'), 'uno', 1_000);
    store.receiveRoomMessage(peer('bob'), 'dos', 1_100);
    expect(store.getUnreadCount(ROOM_THREAD_ID)).toBe(2);

    // Propio en room: no suma.
    store.sendRoomMessage('mi mensaje', 1_200);
    expect(store.getUnreadCount(ROOM_THREAD_ID)).toBe(2);

    // Un DM ajeno suma SOLO en su hilo.
    store.receiveDm(peer('ana'), 'pst', 1_300);
    expect(store.getUnreadCount('ana')).toBe(1);
    expect(store.getUnreadCount(ROOM_THREAD_ID)).toBe(2);
    expect(store.getUnreadCount('inexistente')).toBe(0);
  });

  it('markRead resetea el hilo (y solo ese)', () => {
    const store = createStore();
    store.receiveRoomMessage(peer('ana'), 'uno', 1_000);
    store.receiveDm(peer('bob'), 'pst', 1_100);

    store.markRead(ROOM_THREAD_ID);

    expect(store.getUnreadCount(ROOM_THREAD_ID)).toBe(0);
    expect(store.getUnreadCount('bob')).toBe(1);
  });

  it('totalUnread agrega todos los hilos (para el badge del menú)', () => {
    const store = createStore();
    expect(store.totalUnread).toBe(0);

    store.receiveRoomMessage(peer('ana'), 'uno', 1_000);
    store.receiveRoomMessage(peer('bob'), 'dos', 1_100);
    store.receiveDm(peer('ana'), 'pst', 1_200);
    store.receiveDm(peer('carl'), 'pst pst', 1_300);
    store.sendDm('ana', 're', 1_400);

    expect(store.totalUnread).toBe(4);

    store.markRead(ROOM_THREAD_ID);
    expect(store.totalUnread).toBe(2);

    store.markRead('ana');
    store.markRead('carl');
    expect(store.totalUnread).toBe(0);
  });
});

describe('ChatStore — bloqueo por sesión (descarta AL RECIBIR)', () => {
  it('recibir de un peer bloqueado se descarta antes de entrar al store', () => {
    const store = createStore();
    store.blockPeer('ana');
    expect(store.isBlocked('ana')).toBe(true);

    expect(store.receiveRoomMessage(peer('ana'), 'hola', 1_000)).toBeNull();
    expect(store.receiveDm(peer('ana'), 'pst', 1_100)).toBeNull();

    // Nada entró: ni mensajes ni hilos ni no leídos.
    expect(store.hasThread('ana')).toBe(false);
    expect(store.getMessages(ROOM_THREAD_ID)).toHaveLength(0);
    expect(store.totalUnread).toBe(0);
  });

  it('desbloquear re-admite sus mensajes desde ese momento', () => {
    const store = createStore();
    store.blockPeer('ana');
    expect(store.receiveRoomMessage(peer('ana'), 'bloqueado', 1_000)).toBeNull();

    store.unblockPeer('ana');
    expect(store.isBlocked('ana')).toBe(false);
    expect(store.receiveRoomMessage(peer('ana'), 're-admitido', 2_000)).not.toBeNull();

    expect(store.getMessages(ROOM_THREAD_ID)).toHaveLength(1);
    expect(store.getMessages(ROOM_THREAD_ID)[0]?.text).toBe('re-admitido');
  });

  it('el bloqueo solo filtra la ENTRADA: enviar hacia él sigue permitido', () => {
    const store = createStore();
    store.blockPeer('ana');

    // Decisión documentada: el bloqueo descarta al recibir; el propio envío
    // sigue saliendo (es el receptor quien descarta lo que no quiere ver).
    const message = store.sendDm('ana', 'igual te escribo', 1_000);

    expect(message).not.toBeNull();
    expect(store.getMessages('ana')).toHaveLength(1);
    expect(store.getMessages('ana')[0]?.mine).toBe(true);
  });

  it('el bloqueo sobrevive a clear() (es de sesión, no de partida)', () => {
    const store = createStore();
    store.blockPeer('ana');
    store.receiveRoomMessage(peer('ana'), 'hola', 1_000);
    store.clear();

    expect(store.isBlocked('ana')).toBe(true);
    expect(store.receiveDm(peer('ana'), 'otra vez', 2_000)).toBeNull();
  });
});

describe('ChatStore — disponibilidad de hilos de DM (ACTIVO / DESCONECTADO)', () => {
  it('un peer desconocido se asume disponible (hilo activo)', () => {
    const store = createStore();
    expect(store.isPeerAvailable('ana')).toBe(true);
    expect(store.isThreadDisconnected('ana')).toBe(false);
  });

  it('setPeerAvailability(false) marca el hilo DESCONECTADO', () => {
    const store = createStore();
    store.setPeerAvailability('ana', false);

    expect(store.isPeerAvailable('ana')).toBe(false);
    expect(store.isThreadDisconnected('ana')).toBe(true);

    // Y vuelve a ACTIVO si reaparece en la sala pública.
    store.setPeerAvailability('ana', true);
    expect(store.isThreadDisconnected('ana')).toBe(false);
  });

  it('los mensajes NO cambian la disponibilidad (ni en un sentido ni en el otro)', () => {
    const store = createStore();

    // Un DM entrante NO marca disponible...
    store.setPeerAvailability('ana', false);
    store.receiveDm(peer('ana'), 'mensaje de cola', 1_000);
    expect(store.isPeerAvailable('ana')).toBe(false);
    expect(store.getMessages('ana')).toHaveLength(1);

    // ...y un DM saliente a un peer disponible NO lo desconecta.
    store.setPeerAvailability('bob', true);
    store.sendDm('bob', 'hola?', 1_000);
    expect(store.isPeerAvailable('bob')).toBe(true);

    // El hilo room nunca se marca desconectado.
    expect(store.isThreadDisconnected(ROOM_THREAD_ID)).toBe(false);
  });
});

describe('ChatStore — identidad y ciclo de sesión', () => {
  it('updateSelf refresca la identidad sin perder mensajes ni contadores', () => {
    const store = createStore();
    store.receiveDm(peer('ana'), 'hola', 1_000);

    const renamed: PlayerInfo = { peerId: SELF.peerId, name: 'Yo Nuevo', color: 0x1d8f43 };
    store.updateSelf(renamed);
    expect(store.getSelf()).toEqual(renamed);

    const message = store.sendDm('ana', ' respuesta', 5_000);
    expect(message?.fromName).toBe('Yo Nuevo');
    expect(message?.color).toBe(0x1d8f43);
    expect(store.getMessages('ana')).toHaveLength(2);
    expect(store.getUnreadCount('ana')).toBe(1);
  });

  it('clear vacía mensajes, no leídos, cooldowns y disponibilidad', () => {
    const store = createStore();
    store.sendRoomMessage('hola', 1_000);
    store.receiveDm(peer('ana'), 'pst', 1_100);
    store.setPeerAvailability('ana', false);

    store.clear();

    expect(store.hasThread(ROOM_THREAD_ID)).toBe(false);
    expect(store.hasThread('ana')).toBe(false);
    expect(store.getThreadIds()).toEqual([]);
    expect(store.totalUnread).toBe(0);
    expect(store.canSend(ROOM_THREAD_ID, 1_150)).toBe(true);
    expect(store.isPeerAvailable('ana')).toBe(true);
    expect(store.isBlocked('ana')).toBe(false);
  });
});
