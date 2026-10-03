/**
 * installPrompt — observador del prompt de instalación nativo (issue #43).
 *
 * Chrome/Android dispara `beforeinstallprompt` cuando el juego cumple los
 * criterios de instalabilidad (manifest + iconos + service worker + HTTPS)
 * y `appinstalled` cuando el usuario acepta. Este manager los captura para:
 * - telemetría anónima: main.ts cuelga ganchos que mandan `pwa_installed`
 *   y el resultado del prompt vía `trackEvent` (agregados, sin PII);
 * - dejar lista la API para un futuro botón "INSTALAR" del menú: el evento
 *   capturado permite llamar `prompt()` programáticamente.
 *
 * SIN `preventDefault` a propósito: no queremos secuestrar el UX nativo —
 * el navegador sigue mostrando su propio banner/botón de instalación. El
 * manager SOLO observa; `promptInstall()` es best-effort (si el navegador
 * ya mostró el suyo, puede rechazar: se reporta como 'unavailable').
 *
 * Fábrica pura e inyectable (nada de estado global de módulo): los tests
 * arman targets falsos y cada instancia vive y muere con `dispose()`.
 * Como todo el módulo pwa: nunca lanza — un prompt de instalación no puede
 * romper el arranque ni el loop del juego.
 */

/** Forma mínima de BeforeInstallPromptEvent que este repo consume. */
export interface BeforeInstallPromptEventLike extends Event {
  /** Muestra el prompt nativo; el resultado real llega en `userChoice`. */
  prompt(): Promise<void>;
  /** Promesa con la decisión del usuario: 'accepted' | 'dismissed'. */
  userChoice: Promise<{ outcome: string }>;
}

/** Superficie de add/removeEventListener que consume el manager (window en runtime). */
export interface InstallPromptTarget {
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean,
  ): void;
}

/** Resultado de un intento de instalación vía `promptInstall()`. */
export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable';

/** Ganchos opcionales de observabilidad (main.ts les enchufa trackEvent). */
export interface InstallPromptHooks {
  /** El navegador declaró al juego instalable (beforeinstallprompt). */
  onAvailable?(): void;
  /** Se instaló (aceptado por el usuario por cualquier vía). */
  onInstalled?(): void;
  /** Resultado de un `promptInstall()` explícito. */
  onResult?(outcome: InstallOutcome): void;
}

export interface InstallPromptManager {
  /** Hay un evento de instalación capturado y usable para `prompt()`. */
  isAvailable(): boolean;
  /**
   * Muestra el prompt nativo y reporta la decisión. Sin evento capturado
   * (o si el navegador rechaza) resuelve 'unavailable' — nunca lanza.
   * El evento es de UN SOLO uso: tras la llamada queda consumido.
   */
  promptInstall(): Promise<InstallOutcome>;
  /** Suelta los listeners: después de esto el manager queda inerte. */
  dispose(): void;
}

/**
 * Crea el manager y le attachea sus dos listeners al target (window en
 * runtime). La instancia no hace nada hasta que el navegador dispare.
 */
export function createInstallPromptManager(
  target: InstallPromptTarget,
  hooks: InstallPromptHooks = {},
): InstallPromptManager {
  let deferred: BeforeInstallPromptEventLike | null = null;

  const onBeforeInstallPrompt = (event: Event): void => {
    const candidate = event as BeforeInstallPromptEventLike;
    // Evento a medio formar (raro, pero visto en WebViews): ignorar y dejar
    // que el navegador haga lo suyo. `typeof ... === 'function'` por si el
    // host provee un objeto sin los métodos del spec.
    if (typeof candidate.prompt !== 'function' || typeof candidate.userChoice?.then !== 'function') {
      return;
    }
    deferred = candidate;
    hooks.onAvailable?.();
  };

  const onAppInstalled = (): void => {
    deferred = null;
    hooks.onInstalled?.();
  };

  target.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  target.addEventListener('appinstalled', onAppInstalled);

  return {
    isAvailable: () => deferred !== null,
    async promptInstall(): Promise<InstallOutcome> {
      const event = deferred;
      if (!event) {
        // Todo intento reporta su resultado (un intento sin evento también:
        // la telemetría cuenta intentos, no solo éxitos).
        hooks.onResult?.('unavailable');
        return 'unavailable';
      }
      deferred = null;
      try {
        await event.prompt();
        const choice = await event.userChoice;
        const outcome: InstallOutcome = choice?.outcome === 'accepted' ? 'accepted' : 'dismissed';
        hooks.onResult?.(outcome);
        return outcome;
      } catch {
        // El navegador ya mostró su propio prompt, el usuario cerró el
        // banner, o el WebView no implementa el spec: 'unavailable'.
        hooks.onResult?.('unavailable');
        return 'unavailable';
      }
    },
    dispose(): void {
      target.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      target.removeEventListener('appinstalled', onAppInstalled);
      deferred = null;
    },
  };
}
