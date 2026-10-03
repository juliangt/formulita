import { describe, expect, it, vi } from 'vitest';
import {
  createInstallPromptManager,
  type BeforeInstallPromptEventLike,
  type InstallOutcome,
  type InstallPromptTarget,
} from '../pwa/installPrompt';

/**
 * Tests del manager del prompt de instalación (issue #43).
 *
 * El manager SOLO observa: sin `preventDefault`, el banner nativo de
 * Chrome/Android sigue funcionando. Con un target falso (mapa de listeners)
 * se despachan los eventos del spec a mano y se verifica el ciclo completo:
 * captura → disponibilidad → prompt() de un solo uso → resultado reportado.
 */

/** Target falso: guarda listeners por tipo y permite despachar eventos. */
class FakeEventTarget implements InstallPromptTarget {
  private readonly listeners = new Map<string, Array<(event: Event) => void>>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (typeof listener !== 'function') {
      return;
    }
    const list = this.listeners.get(type) ?? [];
    list.push(listener as (event: Event) => void);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      list.filter((candidate) => candidate !== listener),
    );
  }

  /** Entrega un evento a todos los listeners del tipo (en orden de registro). */
  dispatch(type: string, event: Event): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(event);
    }
  }

  listenerCount(type: string): number {
    return (this.listeners.get(type) ?? []).length;
  }
}

/** Evento beforeinstallprompt falso con prompt()/userChoice espiables. */
function fakeInstallEvent(options: {
  outcome?: string;
  promptImpl?: () => Promise<void>;
}): BeforeInstallPromptEventLike {
  return {
    prompt: options.promptImpl ?? vi.fn().mockResolvedValue(undefined),
    userChoice: Promise.resolve({ outcome: options.outcome ?? 'accepted' }),
  } as unknown as BeforeInstallPromptEventLike;
}

describe('createInstallPromptManager (issue #43)', () => {
  it('sin beforeinstallprompt no hay instalación disponible y promptInstall es unavailable', async () => {
    const target = new FakeEventTarget();
    const onResult = vi.fn<(outcome: InstallOutcome) => void>();
    const manager = createInstallPromptManager(target, { onResult });

    expect(manager.isAvailable()).toBe(false);
    await expect(manager.promptInstall()).resolves.toBe('unavailable');
    expect(onResult).toHaveBeenCalledWith('unavailable');
  });

  it('captura el evento SIN preventDefault (el prompt nativo sigue intacto)', () => {
    const target = new FakeEventTarget();
    const manager = createInstallPromptManager(target);
    const event = fakeInstallEvent({});
    const preventDefault = vi.fn<(options?: boolean) => void>();
    (event as unknown as { preventDefault: typeof preventDefault }).preventDefault =
      preventDefault;

    target.dispatch('beforeinstallprompt', event);

    expect(manager.isAvailable()).toBe(true);
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('avisó disponibilidad (onAvailable) y el resultado accepted se reporta', async () => {
    const target = new FakeEventTarget();
    const onAvailable = vi.fn<() => void>();
    const onResult = vi.fn<(outcome: InstallOutcome) => void>();
    const manager = createInstallPromptManager(target, { onAvailable, onResult });
    const event = fakeInstallEvent({ outcome: 'accepted' });

    target.dispatch('beforeinstallprompt', event);
    await expect(manager.promptInstall()).resolves.toBe('accepted');

    expect(onAvailable).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith('accepted');
    // Evento de UN solo uso: consumido, no queda disponible ni repite.
    expect(manager.isAvailable()).toBe(false);
    expect(onResult).toHaveBeenCalledTimes(1);
  });

  it('un dismissed del usuario se reporta como dismissed (no es error)', async () => {
    const target = new FakeEventTarget();
    const onResult = vi.fn<(outcome: InstallOutcome) => void>();
    const manager = createInstallPromptManager(target, { onResult });

    target.dispatch('beforeinstallprompt', fakeInstallEvent({ outcome: 'dismissed' }));
    await expect(manager.promptInstall()).resolves.toBe('dismissed');
    expect(onResult).toHaveBeenCalledWith('dismissed');
  });

  it('un evento a medio formar (sin prompt del spec) se ignora sin romper nada', () => {
    const target = new FakeEventTarget();
    const onAvailable = vi.fn<() => void>();
    const manager = createInstallPromptManager(target, { onAvailable });

    target.dispatch('beforeinstallprompt', { type: 'event' } as unknown as Event);

    expect(manager.isAvailable()).toBe(false);
    expect(onAvailable).not.toHaveBeenCalled();
  });

  it('si el navegador rechaza el prompt() se reporta unavailable y NO lanza', async () => {
    const target = new FakeEventTarget();
    const onResult = vi.fn<(outcome: InstallOutcome) => void>();
    const manager = createInstallPromptManager(target, { onResult });

    target.dispatch(
      'beforeinstallprompt',
      fakeInstallEvent({ promptImpl: () => Promise.reject(new Error('already shown')) }),
    );

    await expect(manager.promptInstall()).resolves.toBe('unavailable');
    expect(onResult).toHaveBeenCalledWith('unavailable');
  });

  it('appinstalled avisa onInstalled y limpia la disponibilidad', () => {
    const target = new FakeEventTarget();
    const onInstalled = vi.fn<() => void>();
    const manager = createInstallPromptManager(target, { onInstalled });

    target.dispatch('beforeinstallprompt', fakeInstallEvent({}));
    target.dispatch('appinstalled', new Event('appinstalled'));

    expect(onInstalled).toHaveBeenCalledTimes(1);
    expect(manager.isAvailable()).toBe(false);
  });

  it('dispose suelta los listeners: después, los eventos ya no tocan los hooks', () => {
    const target = new FakeEventTarget();
    const onAvailable = vi.fn<() => void>();
    const onInstalled = vi.fn<() => void>();
    const manager = createInstallPromptManager(target, { onAvailable, onInstalled });
    expect(target.listenerCount('beforeinstallprompt')).toBe(1);
    expect(target.listenerCount('appinstalled')).toBe(1);

    manager.dispose();
    target.dispatch('beforeinstallprompt', fakeInstallEvent({}));
    target.dispatch('appinstalled', new Event('appinstalled'));

    expect(target.listenerCount('beforeinstallprompt')).toBe(0);
    expect(target.listenerCount('appinstalled')).toBe(0);
    expect(onAvailable).not.toHaveBeenCalled();
    expect(onInstalled).not.toHaveBeenCalled();
    expect(manager.isAvailable()).toBe(false);
  });
});
