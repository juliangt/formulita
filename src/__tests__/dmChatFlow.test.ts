import { describe, expect, it, vi } from 'vitest';
import { MULTIPLAYER } from '../config/balance';
import { ChatStore } from '../chat/ChatStore';
import {
  receiveDirectMessage,
  sendDirectMessage,
  syncDmThreadAvailability,
  UNKNOWN_DM_SENDER_COLOR,
  UNKNOWN_DM_SENDER_NAME,
} from '../chat/dmChat';
import { blockedSystemNote, invitedSystemNote, inviteJoinTarget, unblockedSystemNote } from '../chat/dmView';
import { TrysteroChatClient } from '../net/TrysteroChatClient';
import type { AvailablePeer, PresenceMeta } from '../net/ChatClient';
import type { NetEnvSource } from '../net/appId';
import type { DmPayload, PlayerInfo } from '../net/protocol';
import { FakeSocialHub } from './fakes/FakeSocialHub';

/**
 * Flujo completo del chat DIRECTO (C3): dos clientes de la sala pública
 * conectados por `FakeSocialHub`, cada uno con SU ChatStore, unidos por el
 * adaptador puro de `dmChat` exactamente como los cablea socialChatSession:
 *
 *   salida:  sendDirectMessage(store, client, peerId, texto) → guardas
 *            (desconectado/bloqueo) → store.sendDm → sendDm DIRIGIDO
 *   entrada: client.onDm((from, payload) =>
 *            receiveDirectMessage(store, peersVivos, from, payload, at))
 *   presencia: client.onAvailablePeers((peers) =>
 *            syncDmThreadAvailability(store, peers))
 *
 * Cubre identidad resuelta contra la lista VIVA del receptor, no leídos con
 * el overlay cerrado, el corte del envío en hilo DESCONECTADO (antes del
 * store, sin consumir cooldown), el bloqueo en AMBOS sentidos con su aviso
 * de sistema, y la invitación con el hook de UNIRSE.
 */

const ENV: NetEnvSource = { VITE_TRYSTERO_APP_ID: 'formulita-test' };

/** Timestamp fijo de llegada en los receptores (reloj determinista). */
const ARRIVED_AT = 9_000;

const ANA_META: PresenceMeta = { name: 'Ana', color: 0 };
const BETO_META: PresenceMeta = { name: 'Beto', color: 0 };

/** self inicial de un cliente de la sala pública (color informativo). */
function selfOf(peerId: string, meta: PresenceMeta): PlayerInfo {
  return { peerId, name: meta.name, color: 0 };
}

/**
 * Par A↔B sobre el hub con stores y cableado doble (A→B y B→A) — el mismo
 * cableado que la sesión social: DM entrantes contra la lista VIVA de
 * disponibles y disponibilidad de hilos sincronizada con onAvailablePeers.
 */
function createDmPair(): {
  hub: FakeSocialHub;
  ana: TrysteroChatClient;
  beto: TrysteroChatClient;
  storeAna: ChatStore;
  storeBeto: ChatStore;
  /** Payloads dm que le llegaron a cada lado por la red (para el wire). */
  arrivedToBeto: Array<{ from: string; payload: DmPayload }>;
  arrivedToAna: Array<{ from: string; payload: DmPayload }>;
} {
  const hub = new FakeSocialHub();
  const clock = { now: 0 };
  const makeClient = (peerId: string, meta: PresenceMeta) =>
    new TrysteroChatClient({
      roomFactory: hub.factoryFor(peerId),
      selfIdProvider: () => peerId,
      env: ENV,
      self: meta,
      scheduler: () => () => undefined, // sin heartbeats: la malla se mueve a mano
      now: () => clock.now,
    });
  const ana = makeClient('aa-ana', ANA_META);
  const beto = makeClient('bb-beto', BETO_META);
  const storeAna = new ChatStore({ self: selfOf('aa-ana', ANA_META) });
  const storeBeto = new ChatStore({ self: selfOf('bb-beto', BETO_META) });

  const arrivedToBeto: Array<{ from: string; payload: DmPayload }> = [];
  const arrivedToAna: Array<{ from: string; payload: DmPayload }> = [];
  const wire = (
    client: TrysteroChatClient,
    store: ChatStore,
    arrived: Array<{ from: string; payload: DmPayload }>,
  ) => {
    client.onDm((from, payload) => {
      arrived.push({ from, payload });
      receiveDirectMessage(store, client.getAvailablePeers(), from, payload, ARRIVED_AT);
    });
    client.onAvailablePeers((peers) => syncDmThreadAvailability(store, peers));
  };
  wire(ana, storeAna, arrivedToAna);
  wire(beto, storeBeto, arrivedToBeto);

  ana.setAvailable(true);
  beto.setAvailable(true);
  hub.settle(); // intercambio de metas: ambos se conocen

  return { hub, ana, beto, storeAna, storeBeto, arrivedToBeto, arrivedToAna };
}

/** Envío de DM cableado como ChatScene: el cliente es el transporte. */
function dmSender(client: TrysteroChatClient): { sendDm(peerId: string, text: string): void } {
  return { sendDm: (peerId, text) => client.sendDm(peerId, text) };
}

describe('dmChat — flujo A ↔ B por la sala pública (integración C3)', () => {
  it('A y B quedan disponibles y se ven en las listas del otro', () => {
    const { ana, beto } = createDmPair();

    const seenByAna = ana.getAvailablePeers();
    expect(seenByAna.map((peer) => peer.peerId)).toEqual(['bb-beto']);
    expect(seenByAna[0]).toMatchObject({ name: 'Beto' });
    const seenByBeto = beto.getAvailablePeers();
    expect(seenByBeto.map((peer) => peer.peerId)).toEqual(['aa-ana']);
    expect(seenByBeto[0]).toMatchObject({ name: 'Ana' });
    // El color visible es CONSISTENTE entre clientes: ambos computan la
    // paleta sobre el mismo conjunto ordenado de presentes (aa-ana → [0],
    // bb-beto → [1]), cada uno sin incluirse a sí mismo en el resultado.
    expect(seenByAna[0]?.color).toBe(MULTIPLAYER.palette[1]); // Beto, visto por Ana
    expect(seenByBeto[0]?.color).toBe(MULTIPLAYER.palette[0]); // Ana, vista por Beto
  });

  it('A envía un DM y a B le llega a SU hilo de A con nombre/color resueltos de SU lista viva', () => {
    const { ana, beto, storeAna, storeBeto, arrivedToBeto } = createDmPair();

    const message = sendDirectMessage(storeAna, dmSender(ana), 'bb-beto', 'hola beto', 1_000);

    expect(message).not.toBeNull();
    // Wire: viajó DIRIGIDO, con el texto ya sanitizado.
    expect(arrivedToBeto).toHaveLength(1);
    expect(arrivedToBeto[0]).toMatchObject({
      from: 'aa-ana',
      payload: { text: 'hola beto', targetPeerId: 'bb-beto' },
    });
    // El hilo de B con A (threadId = peerId del remitente), firmado con la
    // identidad VIVA que B ve (nombre y color de SU lista, no del wire).
    const atBeto = storeBeto.getMessages('aa-ana');
    expect(atBeto).toHaveLength(1);
    const anaSeenByBeto = beto.getAvailablePeers().find((peer) => peer.peerId === 'aa-ana');
    expect(atBeto[0]).toMatchObject({
      threadId: 'aa-ana',
      fromPeerId: 'aa-ana',
      fromName: 'Ana',
      color: anaSeenByBeto?.color,
      text: 'hola beto',
      mine: false,
    });
    // No leídos: el DM llegó con el overlay cerrado y el badge lo cuenta.
    expect(storeBeto.getUnreadCount('aa-ana')).toBe(1);
    expect(storeBeto.totalUnread).toBe(1);
    // Y el emisor ve SU mensaje como propio, sin sumar no leídos.
    expect(storeAna.getMessages('bb-beto')).toHaveLength(1);
    expect(storeAna.getMessages('bb-beto')[0]?.mine).toBe(true);
    expect(storeAna.getUnreadCount('bb-beto')).toBe(0);
  });

  it('B responde y A lo recibe en su hilo de B (hilos simétricos)', () => {
    const { ana, beto, storeAna, storeBeto, arrivedToAna } = createDmPair();
    sendDirectMessage(storeAna, dmSender(ana), 'bb-beto', 'hola beto', 1_000);
    sendDirectMessage(storeBeto, dmSender(beto), 'aa-ana', 'holaa ana', 2_500);

    expect(arrivedToAna).toHaveLength(1);
    const atAna = storeAna.getMessages('bb-beto');
    expect(atAna).toHaveLength(2);
    expect(atAna[1]).toMatchObject({
      fromPeerId: 'bb-beto',
      fromName: 'Beto',
      text: 'holaa ana',
      mine: false,
    });
    expect(storeAna.getUnreadCount('bb-beto')).toBe(1);
    // Cada lado tiene SU hilo del par con los DOS mensajes (el propio y el
    // ajeno): B guarda su respuesta en su hilo de A, no en otro lado.
    const atBeto = storeBeto.getMessages('aa-ana');
    expect(atBeto).toHaveLength(2);
    expect(atBeto[1]).toMatchObject({ fromPeerId: 'bb-beto', mine: true });
    expect(storeAna.getMessages('bb-beto')[0]?.mine).toBe(true);
  });

  it('un DM de un peer que YA NO está en la lista viva degrada a PILOTO (no se pierde)', () => {
    const { storeBeto } = createDmPair();

    // Un DM de un peer que ya se fue (mensaje de cola tras la salida): se
    // resuelve contra la lista VIVA vacía → identidad degradada, mensaje
    // intacto (no se pierde, solo se degrada la identificación).
    const message = receiveDirectMessage(
      storeBeto,
      [],
      'zz-fantasma',
      { text: '¿hay alguien?', targetPeerId: 'bb-beto' },
      ARRIVED_AT,
    );

    expect(message).not.toBeNull();
    expect(message).toMatchObject({
      fromPeerId: 'zz-fantasma',
      fromName: UNKNOWN_DM_SENDER_NAME,
      color: UNKNOWN_DM_SENDER_COLOR,
    });
    expect(UNKNOWN_DM_SENDER_NAME).toBe('PILOTO');
  });

  it('B se esconde: el hilo de A con B pasa a DESCONECTADO y el envío corta ANTES del store', () => {
    const { ana, beto, storeAna, storeBeto, arrivedToAna } = createDmPair();
    // B abre la conversación: el hilo de A con B existe, pero A NUNCA envió
    // (su cooldown del hilo está limpio — así el corte se mide sin ruido).
    sendDirectMessage(storeBeto, dmSender(beto), 'aa-ana', 'hola ana', 1_000);
    expect(arrivedToAna).toHaveLength(1);
    expect(storeAna.getMessages('bb-beto')).toHaveLength(1);

    // B apaga su disponibilidad (toggle OFF): leave educado → A lo ve irse.
    beto.setAvailable(false);

    // La disponibilidad del hilo la sincroniza onAvailablePeers (el cableado
    // del fixture lo hace): el hilo de A con B quedó DESCONECTADO.
    expect(storeAna.isPeerAvailable('bb-beto')).toBe(false);
    expect(storeAna.isThreadDisconnected('bb-beto')).toBe(true);

    // El envío se corta en el ADAPTADOR, antes del store: no se agrega un
    // mensaje que nadie recibiría...
    const cut = sendDirectMessage(storeAna, dmSender(ana), 'bb-beto', '¿estás?', 2_000);
    expect(cut).toBeNull();
    expect(storeAna.getMessages('bb-beto')).toHaveLength(1); // solo el de B
    // ...NI se consume el cooldown (el reloj del hilo no se arma): como A
    // nunca envió con éxito, el hilo sigue aceptando EN EL MISMO instante.
    expect(storeAna.canSend('bb-beto', 2_000)).toBe(true);
  });

  it('B reaparece: syncDmThreadAvailability revive el hilo y el envío sale de nuevo', () => {
    const { hub, ana, beto, storeAna, arrivedToBeto } = createDmPair();
    sendDirectMessage(storeAna, dmSender(ana), 'bb-beto', 'hola beto', 1_000);
    beto.setAvailable(false);
    expect(storeAna.isThreadDisconnected('bb-beto')).toBe(true);
    expect(sendDirectMessage(storeAna, dmSender(ana), 'bb-beto', '¿estás?', 2_000)).toBeNull();

    // B vuelve a la sala pública: la malla se re-asienta (settle dispara el
    // intercambio de metas) y el cliente de A vuelve a anunciarlo — el
    // cableado del fixture sincroniza la disponibilidad con esa lista viva.
    beto.setAvailable(true);
    hub.settle();

    expect(storeAna.isThreadDisconnected('bb-beto')).toBe(false);
    // El envío sale apenas el hilo revive (cooldown del primer envío vencido
    // — y el corte de la desconexión NO lo había extendido).
    const resent = sendDirectMessage(storeAna, dmSender(ana), 'bb-beto', 'volvió', 2_500);
    expect(resent).not.toBeNull();
    expect(arrivedToBeto).toHaveLength(2);
    expect(arrivedToBeto[1]?.payload.text).toBe('volvió');
  });

  it('la disponibilidad NO la cambian los mensajes: solo la lista viva (syncDmThreadAvailability)', () => {
    const store = new ChatStore({ self: selfOf('aa-ana', ANA_META) });
    const betoPeer: AvailablePeer = { peerId: 'bb-beto', name: 'Beto', color: 0x3c6cd6 };

    // Sin hilo no hay nada que marcar: la disponibilidad se aprende al abrir.
    syncDmThreadAvailability(store, []);
    expect(store.getThreadIds()).toEqual([]);

    // Con hilo: peer ausente de la lista viva → DESCONECTADO; presente → activo.
    receiveDirectMessage(store, [betoPeer], 'bb-beto', { text: 'hola', targetPeerId: 'aa-ana' }, 1_000);
    syncDmThreadAvailability(store, []);
    expect(store.isThreadDisconnected('bb-beto')).toBe(true);
    syncDmThreadAvailability(store, [betoPeer]);
    expect(store.isThreadDisconnected('bb-beto')).toBe(false);
  });
});

describe('dmChat — bloqueo e2e: corta la conversación en AMBOS sentidos', () => {
  it('A bloquea a B: el DM de B no entra y el de A hacia B no sale, hasta desbloquear', () => {
    const { ana, beto, storeAna, storeBeto, arrivedToBeto, arrivedToAna } = createDmPair();

    const lastOf = (threadId: string) => {
      const messages = storeAna.getMessages(threadId);
      return messages[messages.length - 1];
    };

    // A bloquea a B desde el hilo de DM (lo que hace el botón de ChatScene)
    // y el hilo queda con el aviso de sistema que espera la UI.
    storeAna.blockPeer('bb-beto');
    expect(storeAna.appendSystemMessage('bb-beto', blockedSystemNote('Beto'))).not.toBeNull();
    expect(lastOf('bb-beto')).toMatchObject({
      text: 'BLOQUEASTE A Beto',
      system: true,
    });

    // ENTRADA: B le escribe a A → el adaptador lo descarta ANTES del store.
    sendDirectMessage(storeBeto, dmSender(beto), 'aa-ana', 'che, ¿estás?', 1_000);
    expect(arrivedToAna).toHaveLength(1); // viajó por la red (B no sabe)…
    const atAna = storeAna.getMessages('bb-beto');
    expect(lastOf('bb-beto')?.text).not.toBe('che, ¿estás?'); // …pero NO entró
    expect(atAna.filter((message) => !message.system)).toHaveLength(0);
    expect(storeAna.getUnreadCount('bb-beto')).toBe(0); // el aviso de sistema no suma

    // SALIDA: A le escribe a B → la guarda del store lo rechaza (null, sin
    // consumir cooldown ni crear tráfico).
    expect(sendDirectMessage(storeAna, dmSender(ana), 'bb-beto', 'no te escribo', 2_000)).toBeNull();
    expect(arrivedToBeto).toHaveLength(0);
    expect(storeAna.canSend('bb-beto', 2_000)).toBe(true);

    // DESBLOQUEO: re-admite AMBOS sentidos desde ese momento.
    storeAna.unblockPeer('bb-beto');
    expect(storeAna.appendSystemMessage('bb-beto', unblockedSystemNote('Beto'))).not.toBeNull();
    expect(lastOf('bb-beto')).toMatchObject({
      text: 'DESBLOQUISTE A Beto',
      system: true,
    });
    expect(sendDirectMessage(storeAna, dmSender(ana), 'bb-beto', 'ya estás', 2_000)).not.toBeNull();
    expect(arrivedToBeto).toHaveLength(1);
    sendDirectMessage(storeBeto, dmSender(beto), 'aa-ana', 'qué alivio', 3_000);
    expect(lastOf('bb-beto')).toMatchObject({ text: 'qué alivio', mine: false });
  });

  it('el bloqueo es LOCAL de A: el store de B no bloquea a nadie y la presencia sigue intacta', () => {
    const { beto, storeBeto } = createDmPair();
    // A bloqueó a B — pero en el STORE de B nadie está bloqueado: el bloqueo
    // es una decisión LOCAL de A (B solo deja de recibir respuestas).
    expect(storeBeto.isBlocked('aa-ana')).toBe(false);
    // La lista pública de B sigue viendo a A (la presencia no se bloquea).
    expect(beto.getAvailablePeers().map((peer) => peer.peerId)).toEqual(['aa-ana']);
  });
});

describe('dmChat — invitaciones e2e: del lobby de A al hook de UNIRSE de B', () => {
  it('A (en sala PARRILLA) invita a B: B recibe el payload y UNIRSE resuelve el lobby con la palabra', () => {
    const { ana, beto } = createDmPair();
    const received: Array<{ from: string; keyword: string }> = [];
    beto.onInvite((from, payload) => received.push({ from, keyword: payload.keyword }));
    // La nota de sistema que deja el hilo de A al invitar (contrato de la UI).
    const storeAna = new ChatStore({ self: selfOf('aa-ana', ANA_META) });

    // El proveedor de palabra del lobby de A (solo con sala activa — así lo
    // pasa LobbyScene al overlay: la palabra cruda del input/estado).
    const roomWord: string | null = ' parRilla ';
    ana.sendInvite('bb-beto', roomWord ?? '');
    expect(storeAna.appendSystemMessage('bb-beto', invitedSystemNote('Beto', roomWord ?? ''))).not.toBeNull();

    expect(received).toEqual([{ from: 'aa-ana', keyword: 'PARRILLA' }]);
    const inviteThread = storeAna.getMessages('bb-beto');
    expect(inviteThread[inviteThread.length - 1]).toMatchObject({
      text: 'INVITASTE A Beto A «PARRILLA»',
      system: true,
    });

    // El hook de UNIRSE (puro, lo consume ChatScene): destino = lobby en
    // modo join con la palabra PRECARGADA y el nombre del perfil de B.
    const target = inviteJoinTarget(received[0]?.keyword ?? '', ' Beto ');
    expect(target).toEqual({ mode: 'join', name: 'Beto', keyword: 'PARRILLA' });
  });

  it('una invitación con palabra inválida no viaja y su hook no resuelve destino', () => {
    const { ana, beto } = createDmPair();
    const received: Array<{ from: string; keyword: string }> = [];
    beto.onInvite((from, payload) => received.push({ from, keyword: payload.keyword }));

    ana.sendInvite('bb-beto', 'ABC'); // muy corta: ni viaja
    ana.sendInvite('bb-beto', 'ABCDEFGHIJ'); // muy larga: tampoco

    expect(received).toEqual([]);
    // Y aunque alguien colara una keyword inválida hasta el hook, no hay
    // destino: el botón UNIRSE no navega a ningún lado.
    expect(inviteJoinTarget('ABC', 'Beto')).toBeNull();
    expect(inviteJoinTarget('', 'Beto')).toBeNull();
  });
});

describe('dmChat — sendDirectMessage con sender espía (el adaptador no toca la red)', () => {
  it('el sender recibe el texto YA sanitizado por el store, solo si fue aceptado', () => {
    const store = new ChatStore({ self: selfOf('aa-ana', ANA_META) });
    const sendDm = vi.fn();
    const sender = { sendDm };

    sendDirectMessage(store, sender, 'bb-beto', '  hola   beto  ', 1_000);
    expect(sendDm).toHaveBeenCalledTimes(1);
    expect(sendDm).toHaveBeenCalledWith('bb-beto', 'hola beto');

    // Rechazado por cooldown: nada nuevo al sender.
    sendDirectMessage(store, sender, 'bb-beto', 'de más', 1_100);
    expect(sendDm).toHaveBeenCalledTimes(1);

    // Rechazado por texto vacío: tampoco viaja.
    sendDirectMessage(store, sender, 'bb-beto', '   ', 9_000);
    expect(sendDm).toHaveBeenCalledTimes(1);
  });

  it('el store permite el envío a un DESCONECTADO (la capa de presencia no es del store)', () => {
    const store = new ChatStore({ self: selfOf('aa-ana', ANA_META) });
    store.setPeerAvailability('bb-beto', false);
    // El store solo opina cooldown/texto/bloqueo: es el ADAPTADOR el que
    // corta el envío a un hilo caído (ver el flujo e2e de arriba).
    expect(store.sendDm('bb-beto', 'directo al store', 1_000)).not.toBeNull();
  });
});
