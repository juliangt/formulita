import { afterEach, describe, expect, it, vi } from 'vitest';
import { joinRoom } from '@trystero-p2p/torrent';
import { TrysteroChatClient } from '../net/TrysteroChatClient';
import { TrysteroNetClient } from '../net/TrysteroNetClient';

/**
 * Tests del CABLEADO real de los trackers de señalización custom (issue #8,
 * Fase 2). `relays.test.ts` cubre la unidad de resolución (`resolveRelayUrls`
 * / `relayConfigFor`); acá se ejercita el eslabón que quedaba sin cubrir: que
 * el `relayConfigFor()` spreadeado dentro de los `defaultRoomFactory` de
 * `TrysteroNetClient` y `TrysteroChatClient` LLEGA de verdad a `joinRoom`.
 *
 * Técnica: se mockea el módulo de la librería (`@trystero-p2p/torrent`, único
 * import de ambos clientes — ninguno importa `@trystero-p2p/core` directo) con
 * un `joinRoom` ESPIADO, y se instancian los clientes REALES SIN factory
 * inyectado para forzar el `defaultRoomFactory` (el cableado bajo test). La
 * env se stubbea con `vi.stubEnv` porque la resolución lee `import.meta.env`
 * en el call-site del factory, no la env inyectable del cliente.
 */

const APP_ID = 'app-relays';

/** Lista custom en dos URLs: la lista LLEGA tal cual (orden preservado). */
const RELAYS_CSV = 'wss://a.example, wss://b.example';
const RELAYS_LIST = ['wss://a.example', 'wss://b.example'];

/** Room mínima con el subconjunto estructural que consumen los clientes. */
function makeRoomStub(): Record<string, unknown> {
  return {
    makeAction: () => ({ send: () => {}, onMessage: null }),
    onPeerJoin: null,
    onPeerLeave: null,
    getPeers: () => ({}),
    leave: () => {},
  };
}

vi.mock('@trystero-p2p/torrent', () => ({
  selfId: 'trystero-self-mock',
  joinRoom: vi.fn(() => makeRoomStub()),
}));

/** El `joinRoom` real de la librería, ya mockeado: el espía del cableado. */
const joinRoomSpy = vi.mocked(joinRoom);

/** Scheduler no-op: sin timers reales pendientes al terminar cada test. */
const noScheduler = () => () => {};

/** Cliente de partida REAL (defaultRoomFactory, no factory inyectado). */
function makeNetClient(): TrysteroNetClient {
  return new TrysteroNetClient({
    selfIdProvider: () => 'net-self',
    settleScheduler: noScheduler,
  });
}

/** Cliente de presencia REAL (defaultRoomFactory, no factory inyectado). */
function makeChatClient(): TrysteroChatClient {
  return new TrysteroChatClient({
    // El appId va por la env INYECTADA (patrón de los tests del chat); la env
    // de los relays en cambio se lee de `import.meta.env` en el factory —
    // exactamente el cableado de producción que este archivo quiere observar.
    env: { VITE_TRYSTERO_APP_ID: APP_ID },
    selfIdProvider: () => 'chat-self',
    scheduler: noScheduler,
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('cableado de relayConfig → joinRoom (TrysteroNetClient)', () => {
  it('con VITE_TRYSTERO_RELAYS custom, joinRoom recibe { appId, relayConfig: { urls } } y el roomId', () => {
    vi.stubEnv('VITE_TRYSTERO_RELAYS', RELAYS_CSV);
    const client = makeNetClient();
    const onError = vi.fn();
    client.onError(onError);

    client.join({ appId: APP_ID, roomWord: 'PARRILLA', name: 'Ana' });

    expect(onError).not.toHaveBeenCalled();
    expect(joinRoomSpy).toHaveBeenCalledTimes(1);
    const [config, roomId] = joinRoomSpy.mock.calls[0];
    expect(config).toEqual({ appId: APP_ID, relayConfig: { urls: RELAYS_LIST } });
    expect(roomId).toBe('PARRILLA');
  });

  it('sin VITE_TRYSTERO_RELAYS, joinRoom NO recibe la key relayConfig (defaults de la librería intactos)', () => {
    vi.stubEnv('VITE_TRYSTERO_RELAYS', undefined);
    const client = makeNetClient();

    client.join({ appId: APP_ID, roomWord: 'PARRILLA', name: 'Ana' });

    expect(joinRoomSpy).toHaveBeenCalledTimes(1);
    const [config, roomId] = joinRoomSpy.mock.calls[0];
    // toEqual estricto (sin keys de más) + la key explícitamente ausente.
    expect(config).toEqual({ appId: APP_ID });
    expect(Object.keys(config)).toEqual(['appId']);
    expect(roomId).toBe('PARRILLA');
  });

  it('con env basura (cero URLs válidas) el fail-fast emerge por onError del cliente y joinRoom no se llama', () => {
    vi.stubEnv('VITE_TRYSTERO_RELAYS', 'https://no.example, peer-sin-esquema');
    const client = makeNetClient();
    const onError = vi.fn();
    client.onError(onError);

    client.join({ appId: APP_ID, roomWord: 'PARRILLA', name: 'Ana' });

    // El throw de relayConfigFor() ocurre ANTES de llamar a la librería.
    expect(joinRoomSpy).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0][0])).toContain('VITE_TRYSTERO_RELAYS');
    // Estado limpio tras el error: sin sala activa.
    expect(client.roomWord).toBeNull();
  });
});

describe('cableado de relayConfig → joinRoom (TrysteroChatClient)', () => {
  it('con VITE_TRYSTERO_RELAYS custom, joinRoom recibe { appId, relayConfig: { urls } } y la sala -social', () => {
    vi.stubEnv('VITE_TRYSTERO_RELAYS', RELAYS_CSV);
    const client = makeChatClient();
    const onError = vi.fn();
    client.onError(onError);

    client.setAvailable(true);

    expect(onError).not.toHaveBeenCalled();
    expect(client.isAvailable()).toBe(true);
    expect(joinRoomSpy).toHaveBeenCalledTimes(1);
    const [config, roomId] = joinRoomSpy.mock.calls[0];
    expect(config).toEqual({ appId: APP_ID, relayConfig: { urls: RELAYS_LIST } });
    expect(roomId).toBe(`${APP_ID}-social`);
  });

  it('sin VITE_TRYSTERO_RELAYS, joinRoom NO recibe la key relayConfig (defaults de la librería intactos)', () => {
    vi.stubEnv('VITE_TRYSTERO_RELAYS', undefined);
    const client = makeChatClient();

    client.setAvailable(true);

    expect(client.isAvailable()).toBe(true);
    expect(joinRoomSpy).toHaveBeenCalledTimes(1);
    const [config, roomId] = joinRoomSpy.mock.calls[0];
    expect(config).toEqual({ appId: APP_ID });
    expect(Object.keys(config)).toEqual(['appId']);
    expect(roomId).toBe(`${APP_ID}-social`);
  });

  it('con env basura (cero URLs válidas) el fail-fast emerge por onError del cliente y joinRoom no se llama', () => {
    vi.stubEnv('VITE_TRYSTERO_RELAYS', 'https://no.example, peer-sin-esquema');
    const client = makeChatClient();
    const onError = vi.fn();
    client.onError(onError);

    client.setAvailable(true);

    expect(joinRoomSpy).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0][0])).toContain('VITE_TRYSTERO_RELAYS');
    // El cliente queda NO disponible (nunca conecta en silencio).
    expect(client.isAvailable()).toBe(false);
  });
});
