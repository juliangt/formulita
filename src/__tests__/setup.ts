/**
 * Setup global de Vitest (registrado en `test.setupFiles` de vite.config.ts).
 *
 * happy-dom no implementa el contexto 2D del canvas (`getContext('2d')`
 * devuelve null). Phaser ejecuta al importarse una detección de capacidades
 * que usa ese contexto y fallaría. Acá proveemos un stub con Proxy: cualquier
 * método del contexto se reemplaza por un no-op y los pocos métodos que
 * necesitan devolver datos (getImageData, measureText, etc.) tienen stubs
 * específicos. Solo se usa si el entorno no puede crear un contexto real.
 */

const noop = (): void => {};

/** Métodos que deben devolver datos con forma específica. */
const specialReturns: Record<string, (...callArgs: unknown[]) => unknown> = {
  getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
  measureText: () => ({ width: 0 }),
  createLinearGradient: () => ({ addColorStop: noop }),
  createRadialGradient: () => ({ addColorStop: noop }),
  createConicGradient: () => ({ addColorStop: noop }),
  createPattern: () => null,
};

function createStubContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const target: Record<string | symbol, unknown> = {
    canvas,
    globalCompositeOperation: 'source-over',
  };

  return new Proxy(target, {
    get(t, prop): unknown {
      if (prop in t) {
        return t[prop];
      }
      const key = String(prop);
      if (key in specialReturns) {
        return specialReturns[key];
      }
      return noop;
    },
    set(t, prop, value): boolean {
      t[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

const originalGetContext = HTMLCanvasElement.prototype.getContext;

HTMLCanvasElement.prototype.getContext = function patchedGetContext(
  this: HTMLCanvasElement,
  ...args: unknown[]
): RenderingContext | null {
  const ctx = (originalGetContext as (...ctxArgs: unknown[]) => RenderingContext | null).apply(
    this,
    args,
  );
  return ctx ?? createStubContext(this);
} as typeof HTMLCanvasElement.prototype.getContext;
