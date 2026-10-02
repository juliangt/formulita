import { describe, expect, it, vi } from 'vitest';
import { relayConfigFor, resolveRelayUrls } from '../net/appId';

/**
 * Tests de los trackers de señalización custom (issue #8): resolución de
 * `VITE_TRYSTERO_RELAYS` y el parche `relayConfig` para `joinRoom`. Mismo
 * patrón que los tests de `resolveAppId`: env INYECTADO (y un caso con
 * `vi.stubEnv` para el `import.meta.env` real). La Fase 2 refuerza estos
 * casos; acá van los básicos de la contract.
 */

describe('resolveRelayUrls', () => {
  it('sin variable devuelve undefined (la librería usa sus defaults)', () => {
    expect(resolveRelayUrls({})).toBeUndefined();
  });

  it('vacía o solo espacios devuelve undefined (comportamiento actual intacto)', () => {
    expect(resolveRelayUrls({ VITE_TRYSTERO_RELAYS: '' })).toBeUndefined();
    expect(resolveRelayUrls({ VITE_TRYSTERO_RELAYS: '   ' })).toBeUndefined();
  });

  it('CSV válido devuelve la lista con el orden preservado', () => {
    expect(
      resolveRelayUrls({
        VITE_TRYSTERO_RELAYS: 'wss://a.example,wss://b.example,ws://c.example',
      }),
    ).toEqual(['wss://a.example', 'wss://b.example', 'ws://c.example']);
  });

  it('filtra entradas vacías y espacios intermedios (robusto a comas de más)', () => {
    expect(
      resolveRelayUrls({
        VITE_TRYSTERO_RELAYS: ' wss://a.example , , wss://b.example ,,  ',
      }),
    ).toEqual(['wss://a.example', 'wss://b.example']);
  });

  it('filtra las URLs que no empiezan por wss:// o ws://', () => {
    expect(
      resolveRelayUrls({
        VITE_TRYSTERO_RELAYS: 'https://no.example, wss://si.example, ftp://tampoco.example',
      }),
    ).toEqual(['wss://si.example']);
  });

  it('con contenido pero CERO URLs válidas lanza (fail-fast, como resolveAppId)', () => {
    expect(() =>
      resolveRelayUrls({ VITE_TRYSTERO_RELAYS: 'https://a.example, peer.example' }),
    ).toThrowError(/VITE_TRYSTERO_RELAYS/);
  });

  it('lee import.meta.env real (vi.stubEnv)', () => {
    vi.stubEnv('VITE_TRYSTERO_RELAYS', 'wss://stubbed.example');
    expect(resolveRelayUrls()).toEqual(['wss://stubbed.example']);
    vi.unstubAllEnvs();
  });
});

describe('relayConfigFor', () => {
  it('sin lista custom devuelve {} (spread inocuo en joinRoom)', () => {
    expect(relayConfigFor({})).toEqual({});
    expect(relayConfigFor({ VITE_TRYSTERO_RELAYS: '   ' })).toEqual({});
  });

  it('con lista custom devuelve { relayConfig: { urls } } filtrada', () => {
    expect(
      relayConfigFor({ VITE_TRYSTERO_RELAYS: 'wss://a.example, basura, wss://b.example' }),
    ).toEqual({ relayConfig: { urls: ['wss://a.example', 'wss://b.example'] } });
  });
});
