import { describe, expect, it } from 'vitest';
import {
  CHAT,
  CHAT_FLOOD_BURST,
  CHAT_FLOOD_REFILL_MS,
  CHAT_HISTORY_MAX,
} from '../config/balance';
import { ChatStore, ROOM_THREAD_ID, type ChatMessage } from '../chat/ChatStore';
import { chatListStale } from '../ui/ChatPanel';
import type { PlayerInfo } from '../net/protocol';

/**
 * qaT8 (issue #35) — flood del chat sin tope. Tres defensas, medidas con el
 * reloj inyectado del store (el mismo del throttle de envío):
 *
 * 1. Tope de historial por hilo (FIFO): `append` no crece sin bound y el
 *    recorte mantiene coherente el conteo de no leídos (un mensaje recortado
 *    ya no se puede leer: cae del badge).
 * 2. Rate-limit de RECEPCIÓN por peer emisor (token bucket: ráfaga de
 *    CHAT_FLOOD_BURST + 1 mensaje cada CHAT_FLOOD_REFILL_MS): el excedente se
 *    DESCARTA en silencio — ni mensaje, ni hilo, ni no leídos. Los mensajes
 *    PROPIOS (eco local) nunca se limitan a la entrada y el límite es POR
 *    EMISOR: el flood de uno no ahoga a los demás.
 * 3. Detección de re-render del ChatPanel: con el historial clavado en el
 *    tope el largo no cambia, así que la identidad de la COLA también debe
 *    disparar el repintado.
 */

const SELF: PlayerInfo = { peerId: 'me', name: 'Yo', color: 0xd63c3c };

function peer(peerId: string, name = peerId): PlayerInfo {
  return { peerId, name, color: 0x3c6cd6 };
}

function createStore(now?: () => number): ChatStore {
  return new ChatStore({ self: SELF, now });
}

describe('qaT8 — constantes del flood junto a los otros límites del chat', () => {
  it('tope de historial y rate-limit declarados en balance.ts', () => {
    expect(CHAT_HISTORY_MAX).toBe(100);
    expect(CHAT_FLOOD_BURST).toBe(5);
    expect(CHAT_FLOOD_REFILL_MS).toBe(1000);
    // El store puede guardar todo lo que el panel sabe mostrar: el recorte
    // del historial nunca es la restricción de la vista.
    expect(CHAT_HISTORY_MAX).toBeGreaterThanOrEqual(CHAT.visibleMessages);
  });
});

describe('qaT8 — tope de historial por hilo (recorte FIFO)', () => {
  it('llegado CHAT_HISTORY_MAX, cada mensaje nuevo recorta los más viejos', () => {
    const store = createStore();
    // Peers DISTINTOS: el rate-limit de entrada es por emisor y acá se audita
    // sólo el tope del historial.
    for (let index = 0; index < 150; index += 1) {
      store.receiveRoomMessage(peer(`p${index}`), `msg-${index}`, 1_000 + index);
    }

    const messages = store.getMessages(ROOM_THREAD_ID);
    expect(messages).toHaveLength(CHAT_HISTORY_MAX);
    expect(messages[0]?.text).toBe(`msg-${150 - CHAT_HISTORY_MAX}`);
    expect(messages[messages.length - 1]?.text).toBe('msg-149');
  });

  it('aplica el mismo tope a un hilo de DM (ritmo legítimo de 1 msg/s pasa completo)', () => {
    const store = createStore();
    const total = CHAT_HISTORY_MAX + 20;
    for (let index = 0; index < total; index += 1) {
      // 1 mensaje por segundo: dentro del ritmo sostenido del rate-limit.
      store.receiveDm(peer('ana'), `dm-${index}`, 1_000 + index * CHAT_FLOOD_REFILL_MS);
    }

    const messages = store.getMessages('ana');
    expect(messages).toHaveLength(CHAT_HISTORY_MAX);
    expect(messages[0]?.text).toBe(`dm-${total - CHAT_HISTORY_MAX}`);
    expect(messages[messages.length - 1]?.text).toBe(`dm-${total - 1}`);
  });

  it('el recorte mantiene coherentes los no leídos: un recortado ya no se puede leer', () => {
    const store = createStore();
    for (let index = 0; index < 150; index += 1) {
      store.receiveRoomMessage(peer(`p${index}`), `msg-${index}`, 1_000 + index);
    }

    // El badge nunca promete más de lo que el hilo conserva.
    expect(store.getUnreadCount(ROOM_THREAD_ID)).toBe(CHAT_HISTORY_MAX);
    expect(store.totalUnread).toBe(CHAT_HISTORY_MAX);
  });

  it('los recortados YA LEÍDOS no tocan el contador', () => {
    const store = createStore();
    for (let index = 0; index < CHAT_HISTORY_MAX; index += 1) {
      store.receiveRoomMessage(peer(`p${index}`), `msg-${index}`, 1_000 + index);
    }
    store.markRead(ROOM_THREAD_ID);
    for (let index = CHAT_HISTORY_MAX; index < CHAT_HISTORY_MAX + 50; index += 1) {
      store.receiveRoomMessage(peer(`p${index}`), `msg-${index}`, 2_000 + index);
    }

    // Los 50 nuevos suman; los viejos recortados estaban leídos: el contador
    // queda exactamente en ellos.
    expect(store.getUnreadCount(ROOM_THREAD_ID)).toBe(50);
    expect(store.getMessages(ROOM_THREAD_ID)).toHaveLength(CHAT_HISTORY_MAX);
  });
});

describe('qaT8 — rate-limit de recepción por peer emisor', () => {
  it('ráfaga: acepta CHAT_FLOOD_BURST y descarta el excedente EN SILENCIO', () => {
    const store = createStore();
    const ana = peer('ana');
    const results: (ChatMessage | null)[] = [];
    for (let index = 0; index < 10; index += 1) {
      results.push(store.receiveRoomMessage(ana, `flood-${index}`, 1_000));
    }

    for (let index = 0; index < CHAT_FLOOD_BURST; index += 1) {
      expect(results[index]).not.toBeNull();
    }
    for (let index = CHAT_FLOOD_BURST; index < 10; index += 1) {
      expect(results[index]).toBeNull();
    }
    expect(store.getMessages(ROOM_THREAD_ID)).toHaveLength(CHAT_FLOOD_BURST);
    expect(store.getUnreadCount(ROOM_THREAD_ID)).toBe(CHAT_FLOOD_BURST);
  });

  it('en DM el excedente no deja marcadores falsos (ni hilo extra ni contador)', () => {
    const store = createStore();
    const ana = peer('ana');
    for (let index = 0; index < CHAT_FLOOD_BURST; index += 1) {
      store.receiveDm(ana, `dm-${index}`, 1_000);
    }

    expect(store.receiveDm(ana, 'extra', 1_000)).toBeNull();
    expect(store.getMessages('ana')).toHaveLength(CHAT_FLOOD_BURST);
    expect(store.getUnreadCount('ana')).toBe(CHAT_FLOOD_BURST);
  });

  it('ritmo sostenido: recarga 1 mensaje cada CHAT_FLOOD_REFILL_MS', () => {
    const store = createStore();
    const ana = peer('ana');
    for (let index = 0; index < CHAT_FLOOD_BURST; index += 1) {
      store.receiveRoomMessage(ana, `rafaga-${index}`, 1_000);
    }

    // Sin token: dentro de la ventana de recarga se descarta...
    expect(store.receiveRoomMessage(ana, 'sin-token', 1_400)).toBeNull();
    // ...a los 1.000 ms recargó 1 token y pasa...
    expect(store.receiveRoomMessage(ana, 'token-1', 2_000)).not.toBeNull();
    // ...consumido el token, de nuevo se descarta hasta la próxima recarga.
    expect(store.receiveRoomMessage(ana, 'aun-sin-token', 2_400)).toBeNull();
    expect(store.receiveRoomMessage(ana, 'token-2', 3_000)).not.toBeNull();

    expect(store.getMessages(ROOM_THREAD_ID)).toHaveLength(CHAT_FLOOD_BURST + 2);
  });

  it('es POR EMISOR: el flood de ana no ahoga a bob', () => {
    const store = createStore();
    const ana = peer('ana');
    const bob = peer('bob');
    for (let index = 0; index < CHAT_FLOOD_BURST + 3; index += 1) {
      store.receiveRoomMessage(ana, `flood-${index}`, 1_000);
    }

    // A ana se le agotó el bucket, bob llega fresco con el suyo...
    expect(store.receiveRoomMessage(bob, 'hola', 1_000)).not.toBeNull();
    // ...y la ráfaga de bob también vale completa (bucket propio).
    for (let index = 0; index < CHAT_FLOOD_BURST - 1; index += 1) {
      expect(store.receiveRoomMessage(bob, `bob-${index}`, 1_000)).not.toBeNull();
    }
    expect(store.receiveRoomMessage(bob, 'bob-extra', 1_000)).toBeNull();
  });

  it('un mismo emisor no reparte su flood entre hilos (room y DM comparten bucket)', () => {
    const store = createStore();
    const ana = peer('ana');
    const bob = peer('bob');
    for (let index = 0; index < CHAT_FLOOD_BURST; index += 1) {
      store.receiveDm(ana, `dm-${index}`, 1_000);
    }

    // El bucket de ana está agotado por su flood de DMs: su mensaje de SALA
    // también entra al límite (mismo emisor rogue).
    expect(store.receiveRoomMessage(ana, 'sala', 1_000)).toBeNull();
    // Bob no tiene por qué pagar el flood de ana.
    expect(store.receiveRoomMessage(bob, 'sala', 1_000)).not.toBeNull();
  });

  it('los mensajes PROPIOS (eco local) nunca se limitan a la entrada', () => {
    const store = createStore();
    for (let index = 0; index < 20; index += 1) {
      const message = store.receiveRoomMessage(SELF, `eco-${index}`, 1_000);
      expect(message).not.toBeNull();
      expect(message?.mine).toBe(true);
    }
    expect(store.getMessages(ROOM_THREAD_ID)).toHaveLength(20);
    expect(store.getUnreadCount(ROOM_THREAD_ID)).toBe(0);
  });

  it('clear() resetea el rate-limit (estado de flood de la sesión, no de la partida)', () => {
    const store = createStore();
    const ana = peer('ana');
    for (let index = 0; index < CHAT_FLOOD_BURST + 5; index += 1) {
      store.receiveRoomMessage(ana, `flood-${index}`, 1_000);
    }
    expect(store.receiveRoomMessage(ana, 'ahogado', 1_000)).toBeNull();

    store.clear();
    expect(store.receiveRoomMessage(ana, 'nueva-sesion', 2_000)).not.toBeNull();
  });
});

describe('qaT8 — ChatPanel: detectar mensajes nuevos con el largo clavado en el tope', () => {
  function list(texts: string[]): ChatMessage[] {
    return texts.map((text, index) => ({
      threadId: ROOM_THREAD_ID,
      fromPeerId: 'ana',
      fromName: 'Ana',
      color: 0x3c6cd6,
      text,
      at: index,
      mine: false,
    }));
  }

  it('chatListStale dispara por cambio de largo O de cola (identidad del último)', () => {
    const before = list(['m1', 'm2', 'm3']);
    expect(chatListStale(before, 3, before[2])).toBe(false);

    // Escenario del tope: mismo largo (CHAT_HISTORY_MAX clavado) pero el
    // último mensaje es OTRO — la lista quedó vieja.
    const after = list(['m2', 'm3', 'm4']);
    expect(chatListStale(after, 3, before[2])).toBe(true);

    // Cambio de largo clásico (hilo por debajo del tope).
    expect(chatListStale(before.slice(0, 2), 3, before[2])).toBe(true);

    // Hilo vaciado (clearThread) y estado recién construido.
    expect(chatListStale([], 3, before[2])).toBe(true);
    expect(chatListStale([], 0, null)).toBe(false);
  });
});
