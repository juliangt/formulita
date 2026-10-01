import { describe, expect, it } from 'vitest';
import { ChatStore } from '../chat/ChatStore';
import {
  CHAT_STORE_REGISTRY_KEY,
  getSessionChatStore,
  removeSessionChatStore,
  setSessionChatStore,
} from '../chat/chatSession';

/**
 * Tests del ChatStore de sesión (C1): mismo patrón que netClientSession —
 * el recurso viaja por el registry de Phaser para compartirse entre el lobby
 * y el overlay de chat. A diferencia del handoff del NetClient (entrega
 * ÚNICA que se remueve al tomar), el store queda PUBLICADO: varias lecturas
 * consecutivas ven el mismo objeto mientras la sala viva.
 */

/** Registry falso con la porción que la sesión consume (get/set/remove). */
function fakeRegistry(): {
  registry: { get(k: string): unknown; set(k: string, v: unknown): unknown; remove(k: string): unknown };
  dump(): Map<string, unknown>;
} {
  const store = new Map<string, unknown>();
  return {
    registry: {
      get: (key: string) => store.get(key),
      set: (key: string, value: unknown) => store.set(key, value),
      remove: (key: string) => store.delete(key),
    },
    dump: () => store,
  };
}

function createStore(): ChatStore {
  return new ChatStore({ self: { peerId: 'me', name: 'Yo', color: 0xd63c3c } });
}

describe('chatSession — ChatStore compartido por registry', () => {
  it('set + get devuelven EL MISMO store (compartido, no entrega única)', () => {
    const { registry } = fakeRegistry();
    const store = createStore();

    setSessionChatStore(registry, store);
    expect(registry.get(CHAT_STORE_REGISTRY_KEY)).toBe(store);
    expect(getSessionChatStore(registry)).toBe(store);
    // Diferencia clave con takeSessionNetClient: leer NO remueve — el
    // overlay y el lobby ven el mismo store a la vez.
    expect(getSessionChatStore(registry)).toBe(store);
  });

  it('get sin store publicado → null (y sin lanzar)', () => {
    const { registry } = fakeRegistry();
    expect(getSessionChatStore(registry)).toBeNull();
  });

  it('get descarta basura: solo acepta con forma de ChatStore', () => {
    const { registry } = fakeRegistry();
    registry.set(CHAT_STORE_REGISTRY_KEY, { sendRoomMessage: () => null }); // incompleto
    expect(getSessionChatStore(registry)).toBeNull();

    registry.set(CHAT_STORE_REGISTRY_KEY, 42);
    expect(getSessionChatStore(registry)).toBeNull();

    registry.set(CHAT_STORE_REGISTRY_KEY, null);
    expect(getSessionChatStore(registry)).toBeNull();
  });

  it('set pisa un store viejo (la sala nueva arranca fresca)', () => {
    const { registry } = fakeRegistry();
    const viejo = createStore();
    const nuevo = createStore();
    setSessionChatStore(registry, viejo);
    setSessionChatStore(registry, nuevo);
    expect(getSessionChatStore(registry)).toBe(nuevo);
  });

  it('remove retira el store del registry (la sala murió)', () => {
    const { registry, dump } = fakeRegistry();
    setSessionChatStore(registry, createStore());
    expect(dump().has(CHAT_STORE_REGISTRY_KEY)).toBe(true);

    removeSessionChatStore(registry);
    expect(dump().has(CHAT_STORE_REGISTRY_KEY)).toBe(false);
    expect(getSessionChatStore(registry)).toBeNull();
  });
});
