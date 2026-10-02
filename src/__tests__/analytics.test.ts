import { afterEach, describe, expect, it, vi } from 'vitest';
import { trackEvent } from '../telemetry/analytics';

/**
 * Tests del wrapper de telemetría (issue #27).
 *
 * `trackEvent` es el ÚNICO punto de contacto con PostHog y su contrato es
 * no-op seguro: sin SDK en window (dev, uBlock, sin red), con SDK a medio
 * cargar o con `capture` roto, NUNCA lanza ni rompe al caller. Los tests
 * manejan `window.posthog` por asignación directa (tipada vía augmentation
 * de `Window` en `src/telemetry/analytics.ts`) y limpian en afterEach.
 */

function installCapture(): ReturnType<typeof vi.fn> {
  const capture = vi.fn();
  window.posthog = { capture };
  return capture;
}

afterEach(() => {
  delete window.posthog;
});

describe('trackEvent — sin SDK (no-op seguro)', () => {
  it('sin window.posthog no lanza y no hace nada', () => {
    delete window.posthog;
    expect(() => trackEvent('partida_iniciada')).not.toThrow();
    expect(() => trackEvent('partida_iniciada', { pista: 'MONACO' })).not.toThrow();
  });

  it('window.posthog sin capture (SDK a medio cargar) degrada a no-op sin lanzar', () => {
    window.posthog = {} as Window['posthog'];
    expect(() => trackEvent('vuelta_completada')).not.toThrow();
  });

  it('capture no-función (SDK basura en runtime) no lanza: el try/catch lo traga', () => {
    window.posthog = { capture: 42 } as unknown as Window['posthog'];
    expect(() => trackEvent('evento')).not.toThrow();
  });
});

describe('trackEvent — delegación en window.posthog.capture', () => {
  it('delega con (name, properties) tal cual', () => {
    const capture = installCapture();
    const properties = { pista: 'GALVEZ', vueltas: 3 };
    trackEvent('partida_iniciada', properties);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith('partida_iniciada', properties);
  });

  it('sin properties igual delega el evento (properties undefined)', () => {
    const capture = installCapture();
    trackEvent('menu_visto');
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0][0]).toBe('menu_visto');
    expect(capture.mock.calls[0][1]).toBeUndefined();
  });

  it('cada trackEvent delega exactamente una vez', () => {
    const capture = installCapture();
    trackEvent('a');
    trackEvent('b', { x: 1 });
    trackEvent('c');
    expect(capture).toHaveBeenCalledTimes(3);
  });
});

describe('trackEvent — robustez (nunca rompe al caller)', () => {
  it('si capture lanza, trackEvent traga el error y no lanza', () => {
    window.posthog = {
      capture: () => {
        throw new Error('red caída (fake)');
      },
    };
    expect(() => trackEvent('partida_iniciada', { pista: 'MONACO' })).not.toThrow();
  });

  it('un capture que lanzó no deja al wrapper herido: el siguiente evento pasa', () => {
    let lanzar = true;
    const capture = vi.fn(() => {
      if (lanzar) {
        throw new Error('fallo transitorio (fake)');
      }
    });
    window.posthog = { capture };

    expect(() => trackEvent('evento_roto')).not.toThrow();

    lanzar = false;
    expect(() => trackEvent('evento_bueno')).not.toThrow();
    expect(capture).toHaveBeenCalledTimes(2);
  });

  it('un caller del juego sigue su flujo aunque la telemetría muera entera', () => {
    window.posthog = {
      capture: () => {
        throw new Error('SDK quemado (fake)');
      },
    };
    // Simula el patrón de uso planeado para los ganchos (fase 2): llamar y
    // seguir, sin try/catch del lado del caller.
    const caller = (): string => {
      trackEvent('largada', { luz: 1 });
      trackEvent('largada', { luz: 2 });
      trackEvent('largada', { luz: 3 });
      return 'largada ok';
    };
    expect(caller()).toBe('largada ok');
  });
});
