/**
 * serviceWorkerRegistration — registro del service worker de la PWA
 * (issue #43), separado del HTML por la misma razón que el loader de
 * PostHog (issue #41): código chequeado por tsc y testeable directo.
 *
 * Gates, en orden (ANTES de tocar al navegador):
 * - Producción: `import.meta.env.PROD` (build de Vite). En dev (`npm run
 *   dev`) y en tests NO se registra — iterar sin caché de por medio, como
 *   pide el README, y sin sorpresas en la suite.
 * - Soporte: sin `navigator.serviceWorker` (navegador viejo, happy-dom,
 *   contextos no seguros) es no-op. No hay warning: el juego funciona
 *   igual, la PWA es una mejora progresiva.
 *
 * URL RELATIVA (`sw.js`, sin `/` inicial): se resuelve contra el documento
 * (el juego es un SPA sin rutas), así que el registro sale /formulita/sw.js
 * en Pages y /sw.js en un hosting de raíz, sin tocar config. El scope que
 * deriva el navegador (la carpeta del worker) es exactamente el del juego.
 *
 * NO-OP SEGURO en todos los bordes: gate de prod, sin soporte, o cualquier
 * error/rechazo de `register` — el arranque del juego JAMÁS depende del
 * service worker (mismo contrato que `loadPostHogTelemetry`: nunca lanza).
 */

/** Entorno de Vite que consume el registro (por defecto el real; tests inyectan el suyo). */
export interface ServiceWorkerEnvSource {
  /** `true` solo en builds de producción de Vite. */
  readonly PROD?: boolean;
}

/** Superficie mínima de `ServiceWorkerContainer` que este repo consume. */
export interface ServiceWorkerContainerLike {
  register(scriptUrl: string, options?: { scope?: string }): Promise<unknown>;
}

/** Dependencias inyectables del registro (tests; en runtime los defaults). */
export interface ServiceWorkerRegistrationDeps {
  /** Entorno de Vite. Default: `import.meta.env`. */
  readonly env?: ServiceWorkerEnvSource;
  /** Contenedor del SW. Default: `navigator.serviceWorker` si existe. */
  readonly container?: ServiceWorkerContainerLike | null;
  /** URL del script del worker (relativa al documento). Default: `sw.js`. */
  readonly scriptUrl?: string;
}

/** URL relativa del worker copiado desde public/ (subpath-safe). */
export const SERVICE_WORKER_URL = 'sw.js';

/**
 * Registra el service worker si corresponde. Resuelve `true` solo si el
 * navegador aceptó el registro. Nunca lanza y jamás rechaza.
 *
 * Llamar UNA vez al arrancar (src/main.ts). Es fire-and-forget: el registro
 * es asíncrono y no bloquea ni interfiere con el bootstrap de Phaser.
 */
export async function registerServiceWorker(
  deps: ServiceWorkerRegistrationDeps = {},
): Promise<boolean> {
  try {
    const env = deps.env ?? import.meta.env;
    if (!env.PROD) {
      return false;
    }
    const container =
      deps.container ?? (typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined);
    if (!container) {
      return false;
    }
    await container.register(deps.scriptUrl ?? SERVICE_WORKER_URL);
    return true;
  } catch {
    // El juego nunca depende del service worker: si el registro falla, sigue.
    return false;
  }
}
