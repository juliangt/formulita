import { describe, expect, it } from 'vitest';
import {
  handoffNetClient,
  NET_CLIENT_REGISTRY_KEY,
  takeSessionNetClient,
} from '../net/netClientSession';
import { FakeNetClient, FakeNetHub } from './fakes/FakeNetClient';

/**
 * Tests del handoff del NetClient lobby → GameScene por registry (M2): la
 * propiedad del transporte se transfiere UNA vez y se remueve al tomarla
 * (ningún restart posterior hereda un cliente viejo).
 */

/** Registry falso con la porción que el handoff consume (get/set/remove). */
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

describe('netClientSession — handoff por registry', () => {
  it('handoff + take devuelven EL MISMO cliente y limpian la clave', () => {
    const { registry, dump } = fakeRegistry();
    const hub = new FakeNetHub();
    const client = new FakeNetClient(hub, { peerId: 'a' });

    handoffNetClient(registry, client);
    expect(dump().has(NET_CLIENT_REGISTRY_KEY)).toBe(true);

    const taken = takeSessionNetClient(registry);
    expect(taken).toBe(client);
    expect(dump().has(NET_CLIENT_REGISTRY_KEY)).toBe(false);
  });

  it('take sin entrega pendiente → null (y sin lanzar)', () => {
    const { registry } = fakeRegistry();
    expect(takeSessionNetClient(registry)).toBeNull();
  });

  it('take descarta basura: solo acepta con forma de NetClient', () => {
    const { registry } = fakeRegistry();
    registry.set(NET_CLIENT_REGISTRY_KEY, { selfPeerId: 'x' }); // sin métodos
    expect(takeSessionNetClient(registry)).toBeNull();

    registry.set(NET_CLIENT_REGISTRY_KEY, 42);
    expect(takeSessionNetClient(registry)).toBeNull();

    registry.set(NET_CLIENT_REGISTRY_KEY, null);
    expect(takeSessionNetClient(registry)).toBeNull();
  });

  it('dos take seguidos: el segundo ya no ve el cliente (propiedad única)', () => {
    const { registry } = fakeRegistry();
    const hub = new FakeNetHub();
    handoffNetClient(registry, new FakeNetClient(hub, { peerId: 'a' }));
    expect(takeSessionNetClient(registry)).not.toBeNull();
    expect(takeSessionNetClient(registry)).toBeNull();
  });
});
