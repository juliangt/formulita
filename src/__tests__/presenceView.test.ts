import { describe, expect, it } from 'vitest';
import {
  applyAvailabilitySetting,
  availabilityToggleLabel,
  CHAT_TAB_LABELS,
  CHAT_TAB_ORDER,
  EMPTY_PEERS_HINT,
  EPHEMERAL_MESSAGES_HINT,
  formatAvailablePeerRow,
  formatPeerDetail,
  isRoomTabEnabled,
  paginatePeers,
  parseChatTab,
  PEER_PAGE_NEXT_LABEL,
  PEER_PAGE_PREV_LABEL,
  ROOM_TAB_MENU_HINT,
  toggleAvailability,
  visibleAvailablePeers,
} from '../chat/presenceView';
import {
  LocalStorageChatSettingsRepository,
  type IChatSettingsRepository,
} from '../data/ChatSettingsRepository';
import type { ChatClient } from '../net/ChatClient';
import { FakeStorage } from './fakeStorage';

/**
 * Tests de la lógica PURA de la tab PÚBLICO (C2): tabs, toggle de
 * disponibilidad (incluida la persistencia con fakeStorage), lista de
 * disponibles y el detalle al tocar una fila. El wiring Phaser del ChatScene
 * (chips, botones, repintado) queda documentado en la escena, como en C1.
 */

/** Doble de ChatClient que registra las órdenes de disponibilidad. */
function fakeClient(): ChatClient & { availabilityCalls: boolean[] } {
  const availabilityCalls: boolean[] = [];
  return {
    selfPeerId: 'fake-self',
    availabilityCalls,
    setAvailable: (available: boolean) => {
      availabilityCalls.push(available);
    },
    isAvailable: () => false,
    getAvailablePeers: () => [],
    onAvailablePeers: () => () => undefined,
    updateSelf: () => undefined,
    sendDm: () => undefined,
    onDm: () => () => undefined,
    sendInvite: () => undefined,
    onInvite: () => () => undefined,
    destroy: () => undefined,
    onError: () => () => undefined,
  };
}

/** Repo fake en memoria (para no tocar storage en los tests de decisión). */
function memoryRepo(showAvailable: boolean): IChatSettingsRepository {
  let current = showAvailable;
  return {
    load: () => ({ showAvailable: current }),
    save: (settings) => {
      current = settings.showAvailable;
    },
  };
}

describe('presenceView — tabs', () => {
  it('parseChatTab: solo "public" cambia el default (room, comportamiento C1)', () => {
    expect(parseChatTab('public')).toBe('public');
    expect(parseChatTab('room')).toBe('room');
    expect(parseChatTab(undefined)).toBe('room');
    expect(parseChatTab('cualquier cosa')).toBe('room');
    expect(parseChatTab(42)).toBe('room');
    expect(parseChatTab(null)).toBe('room');
  });

  it('orden y labels de tabs: SALA a la izquierda, PÚBLICO a la derecha', () => {
    expect(CHAT_TAB_ORDER).toEqual(['room', 'public']);
    expect(CHAT_TAB_LABELS.room).toBe('SALA');
    expect(CHAT_TAB_LABELS.public).toBe('PÚBLICO');
  });

  it('la tab SALA se habilita SOLO con chat de partida (store + envío)', () => {
    expect(isRoomTabEnabled(true)).toBe(true);
    expect(isRoomTabEnabled(false)).toBe(false);
  });

  it('el aviso del chat desde el menú es el texto pedido por el issue', () => {
    expect(ROOM_TAB_MENU_HINT).toBe('ESTÁS EN EL MENÚ — EL CHAT DE SALA ES DENTRO DE UNA PARTIDA');
  });
});

describe('presenceView — toggle de disponibilidad', () => {
  it('labels del toggle grande: MOSTRARME DISPONIBLE SÍ/NO', () => {
    expect(availabilityToggleLabel(true)).toBe('MOSTRARME DISPONIBLE: SÍ');
    expect(availabilityToggleLabel(false)).toBe('MOSTRARME DISPONIBLE: NO');
  });

  it('PRIVACIDAD: con el ajuste default (NO), abrir la tab NO conecta nada', () => {
    const client = fakeClient();
    const applied = applyAvailabilitySetting(memoryRepo(false), client);

    expect(applied).toBe(false);
    expect(client.availabilityCalls).toEqual([false]); // setAvailable(false): no-op de conexión
  });

  it('con el ajuste persistido en SÍ, abrir la tab reconecta (sin re-decidir)', () => {
    const client = fakeClient();
    const applied = applyAvailabilitySetting(memoryRepo(true), client);

    expect(applied).toBe(true);
    expect(client.availabilityCalls).toEqual([true]);
  });

  it('toggleAvailability invierte el ajuste, lo persiste y sincroniza la conexión', () => {
    const client = fakeClient();
    const repo = memoryRepo(false);

    expect(toggleAvailability(repo, client)).toBe(true); // OFF → ON (join)
    expect(toggleAvailability(repo, client)).toBe(false); // ON → OFF (leave)
    expect(client.availabilityCalls).toEqual([true, false]);
    expect(repo.load()).toEqual({ showAvailable: false });
  });

  it('PRIVACIDAD: sin tocar el toggle, el cliente jamás recibe setAvailable(true)', () => {
    const client = fakeClient();
    applyAvailabilitySetting(memoryRepo(false), client);
    expect(client.availabilityCalls).not.toContain(true);
  });
});

describe('presenceView — persistencia del toggle (fakeStorage)', () => {
  it('default false; toggle → repo; una instancia NUEVA sobre el mismo storage recuerda', () => {
    const storage = new FakeStorage();
    const repo = new LocalStorageChatSettingsRepository(storage);
    expect(repo.load()).toEqual({ showAvailable: false }); // default: escondido

    // El usuario activa el toggle (flujo de la escena, aquí la parte pura).
    const client = fakeClient();
    expect(toggleAvailability(repo, client)).toBe(true);

    // "Recarga": nueva instancia del repo sobre el MISMO storage.
    const reloaded = new LocalStorageChatSettingsRepository(storage);
    expect(reloaded.load()).toEqual({ showAvailable: true });
    // Y la conexión sigue al ajuste recordado, no al default.
    const reconnected = fakeClient();
    expect(applyAvailabilitySetting(reloaded, reconnected)).toBe(true);
    expect(reconnected.availabilityCalls).toEqual([true]);
  });
});

describe('presenceView — lista de disponibles', () => {
  it('formatAvailablePeerRow: nombre + color CSS del peer', () => {
    expect(formatAvailablePeerRow({ peerId: 'b', name: 'Beto', color: 0xd63c3c })).toEqual({
      text: 'Beto',
      color: '#d63c3c',
    });
  });

  it('formatAvailablePeerRow: nombre vacío degrada a PILOTO (meta corrupta)', () => {
    expect(formatAvailablePeerRow({ peerId: 'b', name: '', color: 0 }).text).toBe('PILOTO');
  });

  it('formatAvailablePeerRow (C3): no leídos del hilo de DM agregan el badge "· N"', () => {
    const beto = { peerId: 'b', name: 'Beto', color: 0xd63c3c };
    // Sin no leídos (default): la fila queda pelada.
    expect(formatAvailablePeerRow(beto).text).toBe('Beto');
    expect(formatAvailablePeerRow(beto, 0).text).toBe('Beto');
    // Con N>0: el badge cuenta lo no leído del hilo con ese peer.
    expect(formatAvailablePeerRow(beto, 1).text).toBe('Beto · 1');
    expect(formatAvailablePeerRow(beto, 7).text).toBe('Beto · 7');
    // El color no se toca: el badge es solo texto.
    expect(formatAvailablePeerRow(beto, 7).color).toBe('#d63c3c');
  });

  it('visibleAvailablePeers: las PRIMERAS maxVisible filas (ancladas arriba)', () => {
    const peers = [
      { peerId: 'a', name: 'A', color: 1 },
      { peerId: 'b', name: 'B', color: 2 },
      { peerId: 'c', name: 'C', color: 3 },
    ];
    expect(visibleAvailablePeers(peers, 2).map((p) => p.peerId)).toEqual(['a', 'b']);
    expect(visibleAvailablePeers(peers, 10)).toHaveLength(3);
  });

  it('visibleAvailablePeers: tope no positivo no muestra nada', () => {
    expect(visibleAvailablePeers([{ peerId: 'a', name: 'A', color: 1 }], 0)).toEqual([]);
  });

  it('el placeholder de la lista vacía es NADIE DISPONIBLE', () => {
    expect(EMPTY_PEERS_HINT).toBe('NADIE DISPONIBLE');
  });
});

describe('presenceView — detalle al tocar un disponible (hook de C3)', () => {
  it('muestra los datos del peer: nombre + peerId + color', () => {
    expect(formatPeerDetail({ peerId: 'zz-9', name: 'Beto', color: 0x1d8f43 })).toEqual({
      text: 'Beto · zz-9',
      color: '#1d8f43',
    });
  });

  it('nombre vacío degrada a PILOTO también en el detalle', () => {
    expect(formatPeerDetail({ peerId: 'zz-9', name: '', color: 0 }).text).toBe('PILOTO · zz-9');
  });
});

/** Fixture: N peers con peerId estable y ordenado (como los entrega el cliente). */
function makePeers(count: number): Array<{ peerId: string; name: string; color: number }> {
  return Array.from({ length: count }, (_, index) => ({
    peerId: `peer-${String(index).padStart(2, '0')}`,
    name: `P${index}`,
    color: index + 1,
  }));
}

describe('presenceView — paginación de la lista (v1, auditoría #2 MENOR 1)', () => {
  it('página única: todas las filas, sin botones (pageCount 1, hasNext/hasPrev false)', () => {
    const peers = makePeers(5);
    const page = paginatePeers(peers, 0, 8);

    expect(page.rows).toEqual(peers);
    expect(page.page).toBe(0);
    expect(page.pageCount).toBe(1);
    expect(page.hasNext).toBe(false); // sin botón ▶
    expect(page.hasPrev).toBe(false); // sin botón ◀
    expect(page.rangeLabel).toBe('1–5 DE 5');
  });

  it('página exacta sin sobrante: pageCount 1 también con N múltiplo del tamaño', () => {
    const page = paginatePeers(makePeers(8), 0, 8);
    expect(page.pageCount).toBe(1);
    expect(page.rangeLabel).toBe('1–8 DE 8');
  });

  it('multi-página navega: página 0 muestra las PRIMERAS filas y habilita ▶', () => {
    const peers = makePeers(20);
    const page = paginatePeers(peers, 0, 8);

    expect(page.rows).toEqual(peers.slice(0, 8));
    expect(page.pageCount).toBe(3);
    expect(page.hasPrev).toBe(false);
    expect(page.hasNext).toBe(true);
    expect(page.rangeLabel).toBe('1–8 DE 20');
  });

  it('multi-página navega: página intermedia con ◀ y ▶ habilitados', () => {
    const peers = makePeers(20);
    const page = paginatePeers(peers, 1, 8);

    expect(page.rows).toEqual(peers.slice(8, 16));
    expect(page.page).toBe(1);
    expect(page.hasPrev).toBe(true);
    expect(page.hasNext).toBe(true);
    expect(page.rangeLabel).toBe('9–16 DE 20');
  });

  it('borde: última página PARCIAL muestra lo que queda y deshabilita ▶', () => {
    const peers = makePeers(20);
    const page = paginatePeers(peers, 2, 8);

    expect(page.rows).toEqual(peers.slice(16, 20));
    expect(page.page).toBe(2);
    expect(page.pageCount).toBe(3);
    expect(page.hasPrev).toBe(true);
    expect(page.hasNext).toBe(false);
    expect(page.rangeLabel).toBe('17–20 DE 20');
  });

  it('clamp: una página que DEJÓ de existir (la lista se encogió) cae a la última válida', () => {
    const peers = makePeers(10); // 2 páginas de 8: pedida la 5 → clamp a la 1
    const page = paginatePeers(peers, 5, 8);

    expect(page.page).toBe(1);
    expect(page.rows).toEqual(peers.slice(8, 10));
    expect(page.rangeLabel).toBe('9–10 DE 10');
    expect(page.hasNext).toBe(false);
  });

  it('clamp: página negativa o basura degrada a la primera', () => {
    const peers = makePeers(12);
    expect(paginatePeers(peers, -3, 8).page).toBe(0);
    expect(paginatePeers(peers, Number.NaN, 8).page).toBe(0);
    expect(paginatePeers(peers, Number.POSITIVE_INFINITY, 8).page).toBe(0); // no finita → 0
    expect(paginatePeers(peers, 1.9, 8).page).toBe(1); // fracción → floor
  });

  it('lista vacía o pageSize inválido: resultado vacío sin páginas (la escena pinta el placeholder)', () => {
    expect(paginatePeers([], 0, 8)).toEqual({
      rows: [],
      page: 0,
      pageCount: 0,
      rangeLabel: '',
      hasNext: false,
      hasPrev: false,
    });
    expect(paginatePeers(makePeers(5), 0, 0).pageCount).toBe(0);
    expect(paginatePeers(makePeers(5), 0, -3).rows).toEqual([]);
  });

  it('labels de los botones táctiles de paginación: ◀ y ▶', () => {
    expect(PEER_PAGE_PREV_LABEL).toBe('◀');
    expect(PEER_PAGE_NEXT_LABEL).toBe('▶');
  });
});

describe('presenceView — hint de efimeridad (§10, auditoría #2 COSMÉTICA 4)', () => {
  it('el texto del hint avisa que los mensajes NO se guardan al cerrar', () => {
    expect(EPHEMERAL_MESSAGES_HINT).toBe('MENSAJES EFÍMEROS — NO SE GUARDAN AL CERRAR');
  });
});
