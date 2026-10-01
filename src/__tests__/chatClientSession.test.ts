import { describe, expect, it, vi } from 'vitest';
import {
  CHAT_CLIENT_REGISTRY_KEY,
  destroySessionChatClient,
  getChatClient,
  setSessionChatClient,
} from '../chat/chatClientSession';
import type { ChatClient } from '../net/ChatClient';

/**
 * Tests del ChatClient de sesión (C2): mismo patrón que chatSession — el
 * cliente de la sala pública viaja por el registry de Phaser como SERVICIO
 * COMPARTIDO (uno por pestaña, no una entrega única). La creación default no
 * se testea acá (construiría el transporte real): se inyecta un doble que
 * registra destroy/setAvailable, que es lo que la sesión promete.
 */

/** Doble de ChatClient: registra lo que la sesión le hace. */
function fakeClient(): ChatClient & { destroyed: number } {
  const double = {
    selfPeerId: 'fake-self',
    destroyed: 0,
    setAvailable: vi.fn(),
    isAvailable: () => false,
    getAvailablePeers: () => [],
    updateSelf: vi.fn(),
    sendDm: vi.fn(),
    onDm: () => () => undefined,
    sendInvite: vi.fn(),
    onInvite: () => () => undefined,
    destroy: vi.fn(),
    onError: () => () => undefined,
  };
  double.destroy.mockImplementation(() => {
    double.destroyed += 1;
  });
  return double as unknown as ChatClient & { destroyed: number };
}

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

describe('chatClientSession — servicio compartido por registry', () => {
  it('get cachea el cliente en el registry: lecturas repetidas ven EL MISMO', () => {
    const { registry, dump } = fakeRegistry();
    const injected = fakeClient();
    setSessionChatClient(registry, injected);

    expect(getChatClient(registry)).toBe(injected);
    expect(getChatClient(registry)).toBe(injected); // no entrega única
    expect(dump().get(CHAT_CLIENT_REGISTRY_KEY)).toBe(injected);
  });

  it('get sin cliente publicado crea uno default y lo cachea (transporte real)', () => {
    const { registry, dump } = fakeRegistry();
    const first = getChatClient(registry);
    const second = getChatClient(registry);

    expect(first).toBe(second);
    expect(dump().get(CHAT_CLIENT_REGISTRY_KEY)).toBe(first);
    // El default existe de verdad (Trystero real) pero NUNCA conectó:
    // sin setAvailable(true) no hay join (privacidad by default).
    expect(first.isAvailable()).toBe(false);
    first.destroy(); // limpieza del test (cierra nada: nunca abrió)
  });

  it('get descarta basura en la clave: solo acepta forma de ChatClient', () => {
    const { registry } = fakeRegistry();
    registry.set(CHAT_CLIENT_REGISTRY_KEY, { setAvailable: () => undefined });
    expect(getChatClient(registry).setAvailable).toBeInstanceOf(Function);
    expect(getChatClient(registry).isAvailable()).toBe(false);

    registry.set(CHAT_CLIENT_REGISTRY_KEY, 42);
    const fresh = getChatClient(registry);
    expect(typeof fresh.selfPeerId).toBe('string');
    fresh.destroy();

    registry.set(CHAT_CLIENT_REGISTRY_KEY, null);
    expect(() => getChatClient(registry)).not.toThrow();
  });

  it('destroySessionChatClient destruye el cliente y lo retira del registry', () => {
    const { registry, dump } = fakeRegistry();
    const injected = fakeClient();
    setSessionChatClient(registry, injected);

    destroySessionChatClient(registry);

    expect(injected.destroyed).toBe(1);
    expect(dump().has(CHAT_CLIENT_REGISTRY_KEY)).toBe(false);
  });

  it('destroySessionChatClient sin cliente (o con basura) es no-op sin lanzar', () => {
    const { registry } = fakeRegistry();
    expect(() => destroySessionChatClient(registry)).not.toThrow();

    registry.set(CHAT_CLIENT_REGISTRY_KEY, 'basura');
    expect(() => destroySessionChatClient(registry)).not.toThrow();
  });

  it('tras destroy, la próxima resolución crea un cliente FRESCO', () => {
    const { registry } = fakeRegistry();
    const viejo = fakeClient();
    setSessionChatClient(registry, viejo);
    destroySessionChatClient(registry);

    const nuevo = getChatClient(registry);
    expect(nuevo).not.toBe(viejo);
    nuevo.destroy();
  });
});
