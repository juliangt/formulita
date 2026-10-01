import { describe, expect, it, vi } from 'vitest';
import { CHAT_MAX_LEN, MULTIPLAYER } from '../config/balance';
import { ChatStore, ROOM_THREAD_ID } from '../chat/ChatStore';
import {
  receiveRoomChat,
  resolveRoomSender,
  sendRoomChat,
  UNKNOWN_SENDER_COLOR,
  UNKNOWN_SENDER_NAME,
} from '../chat/roomChat';
import type { ChatSender } from '../chat/roomChat';
import type { ChatPayload, PlayerInfo } from '../net/protocol';
import { FakeNetClient, FakeNetHub } from './fakes/FakeNetClient';

/**
 * Flujo completo del chat de sala (C1): dos jugadores conectados por
 * FakeNetClient, cada uno con SU ChatStore, unidos por el adaptador puro de
 * `roomChat` exactamente como los cablea LobbyScene/ChatScene:
 *
 *   salida:  sendRoomChat(store, sender, texto) → store.sendRoomMessage →
 *            sendChat (broadcast)
 *   entrada: client.onChat((from, payload) =>
 *            receiveRoomChat(store, roster, from, payload, at))
 *
 * Cubre sanitización ANTES de viajar, identidad (nombre/color del roster
 * local), no leídos y degradación a "PILOTO" para peers fuera del roster.
 */

/** Timestamp fijo de llegada en los receptores (reloj determinista). */
const ARRIVED_AT = 9_000;

/** self de un cliente: su propia entrada del roster (con color derivado). */
function selfOf(client: FakeNetClient): PlayerInfo {
  const self = client.getRoster().find((player) => player.peerId === client.selfPeerId);
  if (!self) {
    throw new Error('el cliente no está en su propio roster');
  }
  return self;
}

/** Par A↔B con stores y cableado doble (A→B y B→A), como el lobby real. */
function createChatPair(): {
  hub: FakeNetHub;
  ana: FakeNetClient;
  beto: FakeNetClient;
  storeAna: ChatStore;
  storeBeto: ChatStore;
  /** Payloads que le llegaron a B por la red (para assertar el wire). */
  arrivedToBeto: Array<{ from: string; payload: ChatPayload }>;
  arrivedToAna: Array<{ from: string; payload: ChatPayload }>;
} {
  const hub = new FakeNetHub();
  const ana = new FakeNetClient(hub, { peerId: 'aa-ana' });
  ana.create({ appId: 'formulita-dev', name: 'Ana' });
  const beto = new FakeNetClient(hub, { peerId: 'bb-beto' });
  beto.join({ appId: 'formulita-dev', roomWord: ana.roomWord ?? '', name: 'Beto' });

  const storeAna = new ChatStore({ self: selfOf(ana) });
  const storeBeto = new ChatStore({ self: selfOf(beto) });

  const arrivedToBeto: Array<{ from: string; payload: ChatPayload }> = [];
  const arrivedToAna: Array<{ from: string; payload: ChatPayload }> = [];
  ana.onChat((from, payload) => {
    arrivedToAna.push({ from, payload });
    receiveRoomChat(storeAna, ana.getRoster(), from, payload, ARRIVED_AT);
  });
  beto.onChat((from, payload) => {
    arrivedToBeto.push({ from, payload });
    receiveRoomChat(storeBeto, beto.getRoster(), from, payload, ARRIVED_AT);
  });

  return { hub, ana, beto, storeAna, storeBeto, arrivedToBeto, arrivedToAna };
}

describe('roomChat — flujo A → B por la malla (integración C1)', () => {
  it('A envía y a B le llega al hilo room con SU nombre/color y suma no leídos', () => {
    const { ana, beto, storeAna, storeBeto } = createChatPair();
    const sender: ChatSender = ana;

    const message = sendRoomChat(storeAna, sender, 'hola sala', 1_000);

    expect(message).not.toBeNull();
    const atBeto = storeBeto.getMessages(ROOM_THREAD_ID);
    expect(atBeto).toHaveLength(1);
    expect(atBeto[0]).toMatchObject({
      threadId: ROOM_THREAD_ID,
      fromPeerId: 'aa-ana',
      fromName: 'Ana',
      color: beto.getRoster().find((p) => p.peerId === 'aa-ana')?.color,
      text: 'hola sala',
      mine: false,
    });
    expect(storeBeto.getUnreadCount(ROOM_THREAD_ID)).toBe(1);
    // Y el mensaje propio quedó en el hilo del emisor (mine: true).
    expect(storeAna.getMessages(ROOM_THREAD_ID)[0]?.mine).toBe(true);
    expect(storeAna.getUnreadCount(ROOM_THREAD_ID)).toBe(0);
  });

  it('el texto >200 se trunca ANTES de viajar (el wire ya viene sanitizado)', () => {
    const { ana, storeAna, arrivedToBeto, storeBeto } = createChatPair();

    sendRoomChat(storeAna, ana, `hola ${'x'.repeat(CHAT_MAX_LEN)}`, 1_000);

    expect(arrivedToBeto).toHaveLength(1);
    expect(arrivedToBeto[0]?.payload.text.length).toBe(CHAT_MAX_LEN);
    // Y el receptor lo ve truncado (re-sanitizado al entrar, misma regla).
    expect(storeBeto.getMessages(ROOM_THREAD_ID)[0]?.text.length).toBe(CHAT_MAX_LEN);
  });

  it('B responde y A también lo recibe (el hilo es compartido en ambos sentidos)', () => {
    const { ana, beto, storeAna, storeBeto } = createChatPair();
    sendRoomChat(storeAna, ana, 'hola Ana dice', 1_000);
    sendRoomChat(storeBeto, beto, 'hola Beto dice', 2_500);

    const inAna = storeAna.getMessages(ROOM_THREAD_ID);
    expect(inAna).toHaveLength(2);
    expect(inAna[1]).toMatchObject({ fromPeerId: 'bb-beto', fromName: 'Beto', text: 'hola Beto dice' });
    expect(storeAna.getUnreadCount(ROOM_THREAD_ID)).toBe(1);
  });

  it('cooldown: el envío rechazado NO viaja por la red', () => {
    const { ana, storeAna, arrivedToBeto } = createChatPair();
    sendRoomChat(storeAna, ana, 'primero', 1_000);

    const rejected = sendRoomChat(storeAna, ana, 'segundo inmediato', 1_200);

    expect(rejected).toBeNull();
    expect(arrivedToBeto).toHaveLength(1); // solo viajó el primero
    // Y cuando el cooldown vence, el mensaje sí sale.
    expect(sendRoomChat(storeAna, ana, 'segundo ya sí', 2_500)).not.toBeNull();
    expect(arrivedToBeto).toHaveLength(2);
  });

  it('un remitente fuera del roster llega como PILOTO con color neutro', () => {
    const { hub, ana, storeAna } = createChatPair();
    // Un peer que dejó la sala (o mensaje en vuelo tardío): el hub entrega
    // un chat de un from que ya no está en el roster local de nadie.
    hub.deliver(ana.roomWord ?? '', {
      from: 'zz-fantasma',
      action: 'chat',
      payload: { text: '¿hay alguien?' },
      target: null,
    });

    const thread = storeAna.getMessages(ROOM_THREAD_ID);
    const message = thread[thread.length - 1];
    expect(message).toMatchObject({
      fromPeerId: 'zz-fantasma',
      fromName: UNKNOWN_SENDER_NAME,
      color: UNKNOWN_SENDER_COLOR,
      text: '¿hay alguien?',
    });
  });

  it('un peer BLOQUEADO no entra al store aunque el mensaje haya viajado', () => {
    const { ana, storeAna, storeBeto } = createChatPair();
    storeBeto.blockPeer('aa-ana');

    sendRoomChat(storeAna, ana, 'no te veré', 1_000);

    expect(storeBeto.getMessages(ROOM_THREAD_ID)).toHaveLength(0);
    expect(storeBeto.totalUnread).toBe(0);
  });
});

describe('roomChat — resolveRoomSender (identidad contra el roster LOCAL)', () => {
  const roster: PlayerInfo[] = [
    { peerId: 'aa-ana', name: 'Ana', color: MULTIPLAYER.palette[0] },
    { peerId: 'bb-beto', name: 'Beto', color: MULTIPLAYER.palette[1] },
  ];

  it('un peer del roster conserva SU nombre y SU color derivado', () => {
    expect(resolveRoomSender('bb-beto', roster)).toEqual(roster[1]);
  });

  it('un peer desconocido degrada a PILOTO con el color neutro', () => {
    expect(resolveRoomSender('cc-carla', roster)).toEqual({
      peerId: 'cc-carla',
      name: UNKNOWN_SENDER_NAME,
      color: UNKNOWN_SENDER_COLOR,
    });
    expect(UNKNOWN_SENDER_NAME).toBe('PILOTO');
  });
});

describe('roomChat — sendRoomChat usa el ChatSender provisto (no toca la red)', () => {
  it('el sender recibe el texto YA sanitizado por el store, solo si fue aceptado', () => {
    const store = new ChatStore({
      self: { peerId: 'me', name: 'Yo', color: 0xd63c3c },
    });
    const sendChat = vi.fn();
    const sender: ChatSender = { sendChat };

    sendRoomChat(store, sender, '  hola   sala  ', 1_000);
    expect(sendChat).toHaveBeenCalledTimes(1);
    expect(sendChat).toHaveBeenCalledWith('hola sala');

    // Rechazado por cooldown: nada nuevo al sender.
    sendRoomChat(store, sender, 'de más', 1_100);
    expect(sendChat).toHaveBeenCalledTimes(1);

    // Rechazado por texto vacío: tampoco viaja.
    sendRoomChat(store, sender, '   ', 9_000);
    expect(sendChat).toHaveBeenCalledTimes(1);
  });
});
