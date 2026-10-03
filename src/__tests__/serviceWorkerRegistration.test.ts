import { describe, expect, it, vi } from 'vitest';
import {
  registerServiceWorker,
  SERVICE_WORKER_URL,
} from '../pwa/serviceWorkerRegistration';

/**
 * Tests del registro del service worker (issue #43).
 *
 * El contrato es el mismo estilo "no-op seguro" del loader de PostHog
 * (#41): gates en orden (producción → soporte) y NINGÚN camino que lance
 * o rechace — el arranque del juego no puede depender del SW. Las deps se
 * inyectan para no depender del entorno real (happy-dom no provee
 * navigator.serviceWorker, y en tests PROD es false).
 */

/** Contenedor falso cuyo `register` es espiable. */
function fakeContainer() {
  return { register: vi.fn<(scriptUrl: string) => Promise<unknown>>().mockResolvedValue(undefined) };
}

describe('registerServiceWorker (issue #43)', () => {
  it('en dev (PROD falso) es no-op: no toca al navegador', async () => {
    const container = fakeContainer();
    await expect(
      registerServiceWorker({ env: { PROD: false }, container }),
    ).resolves.toBe(false);
    expect(container.register).not.toHaveBeenCalled();
  });

  it('en producción registra con la URL RELATIVA (subpath-safe en Pages)', async () => {
    const container = fakeContainer();
    await expect(
      registerServiceWorker({ env: { PROD: true }, container }),
    ).resolves.toBe(true);
    expect(container.register).toHaveBeenCalledTimes(1);
    expect(container.register).toHaveBeenCalledWith(SERVICE_WORKER_URL);
    // Sin "/" inicial: se resuelve contra el documento (/formulita/sw.js en
    // Pages). Una URL absoluta rompería el deploy con subpath.
    expect(SERVICE_WORKER_URL).toBe('sw.js');
    expect(SERVICE_WORKER_URL.startsWith('/')).toBe(false);
  });

  it('sin soporte de service worker (navegador viejo / happy-dom) es no-op', async () => {
    await expect(
      registerServiceWorker({ env: { PROD: true }, container: null }),
    ).resolves.toBe(false);
  });

  it('con los defaults del navegador es no-op acá (tests sin serviceWorker)', async () => {
    // Cubre la rama default `navigator.serviceWorker ?? undefined`: happy-dom
    // no lo provee, así que ni siquiera se intenta registrar.
    await expect(registerServiceWorker({ env: { PROD: true } })).resolves.toBe(false);
  });

  it('un rechazo del registro se traga: resuelve false, jamás rechaza', async () => {
    const container = {
      register: vi.fn().mockRejectedValue(new Error('quota exceeded')),
    };
    await expect(
      registerServiceWorker({ env: { PROD: true }, container }),
    ).resolves.toBe(false);
  });

  it('un error SINCRÓNICO del register se traga igual', async () => {
    const container = {
      register: vi.fn().mockImplementation(() => {
        throw new Error('boom');
      }),
    };
    await expect(
      registerServiceWorker({ env: { PROD: true }, container }),
    ).resolves.toBe(false);
  });
});
