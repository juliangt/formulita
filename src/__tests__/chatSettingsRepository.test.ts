import { describe, expect, it } from 'vitest';
import {
  CHAT_SETTINGS_REGISTRY_KEY,
  CHAT_SETTINGS_STORAGE_KEY,
  getChatSettingsRepository,
  LocalStorageChatSettingsRepository,
} from '../data/ChatSettingsRepository';
import { defaultChatSettings, sanitizeChatSettings } from '../data/types';
import { FakeStorage } from './fakeStorage';

/**
 * Tests del ChatSettingsRepository (issue #2, C0): persistencia del único
 * ajuste del chat que sobrevive a una recarga (mostrar la sala pública de
 * presencia), con la MISMA robustez que los repos existentes (clave
 * versionada, storage roto → espejo en memoria, sanitize al guardar y leer).
 */

describe('sanitizeChatSettings — merge defensivo puro', () => {
  it('default es showAvailable=false (la sala pública queda ESCONDIDA)', () => {
    expect(defaultChatSettings()).toEqual({ showAvailable: false });
    expect(sanitizeChatSettings(undefined)).toEqual({ showAvailable: false });
    expect(sanitizeChatSettings(null)).toEqual({ showAvailable: false });
  });

  it('conserva el valor booleano válido', () => {
    expect(sanitizeChatSettings({ showAvailable: true })).toEqual({ showAvailable: true });
    expect(sanitizeChatSettings({ showAvailable: false })).toEqual({ showAvailable: false });
  });

  it('clampa valores inválidos al default sin lanzar', () => {
    expect(sanitizeChatSettings({})).toEqual({ showAvailable: false });
    expect(sanitizeChatSettings({ showAvailable: 'si' })).toEqual({ showAvailable: false });
    expect(sanitizeChatSettings({ showAvailable: 1 })).toEqual({ showAvailable: false });
    expect(sanitizeChatSettings({ showAvailable: undefined })).toEqual({ showAvailable: false });
    expect(sanitizeChatSettings('otra cosa')).toEqual({ showAvailable: false });
    expect(sanitizeChatSettings(42)).toEqual({ showAvailable: false });
    // Campos extra se ignoran (forward-compatible con settings futuros).
    expect(sanitizeChatSettings({ showAvailable: true, bloqueados: ['x'] })).toEqual({
      showAvailable: true,
    });
  });
});

describe('LocalStorageChatSettingsRepository — persistencia', () => {
  it('default (sin datos): showAvailable=false', () => {
    const storage = new FakeStorage();
    expect(new LocalStorageChatSettingsRepository(storage).load()).toEqual({
      showAvailable: false,
    });
  });

  it('roundtrip: guarda y lee el ajuste bajo la clave versionada', () => {
    const storage = new FakeStorage();
    const repo = new LocalStorageChatSettingsRepository(storage);

    repo.save({ showAvailable: true });
    expect(storage.raw(CHAT_SETTINGS_STORAGE_KEY)).toBe(
      JSON.stringify({ showAvailable: true }),
    );
    expect(repo.load()).toEqual({ showAvailable: true });

    repo.save({ showAvailable: false });
    expect(repo.load()).toEqual({ showAvailable: false });
  });

  it('el ajuste se sanitiza al guardar (basura de tipos degrada al default)', () => {
    const storage = new FakeStorage();
    const repo = new LocalStorageChatSettingsRepository(storage);

    repo.save({ showAvailable: 'sí' as unknown as boolean });
    expect(storage.raw(CHAT_SETTINGS_STORAGE_KEY)).toBe(
      JSON.stringify({ showAvailable: false }),
    );
  });

  it('JSON corrupto en el storage degrada al default sin lanzar', () => {
    const storage = new FakeStorage();
    storage.setItem(CHAT_SETTINGS_STORAGE_KEY, '{no es json');
    expect(new LocalStorageChatSettingsRepository(storage).load()).toEqual({
      showAvailable: false,
    });

    storage.setItem(CHAT_SETTINGS_STORAGE_KEY, JSON.stringify({ otra: 'cosa' }));
    expect(new LocalStorageChatSettingsRepository(storage).load()).toEqual({
      showAvailable: false,
    });

    storage.setItem(CHAT_SETTINGS_STORAGE_KEY, JSON.stringify({ showAvailable: 'sí' }));
    expect(new LocalStorageChatSettingsRepository(storage).load()).toEqual({
      showAvailable: false,
    });
  });

  it('sin storage usable vive del espejo en memoria (y no lanza)', () => {
    const failing = new FakeStorage();
    failing.failWrites = true;
    const repo = new LocalStorageChatSettingsRepository(failing);

    repo.save({ showAvailable: true });
    expect(repo.load()).toEqual({ showAvailable: true });

    const broken = new FakeStorage();
    broken.failReads = true;
    expect(new LocalStorageChatSettingsRepository(broken).load()).toEqual({
      showAvailable: false,
    });
  });

  it('persiste entre instancias (simula recargar la página)', () => {
    const storage = new FakeStorage();
    new LocalStorageChatSettingsRepository(storage).save({ showAvailable: true });

    const reloaded = new LocalStorageChatSettingsRepository(storage);
    expect(reloaded.load()).toEqual({ showAvailable: true });
  });

  it('sin storage inyectado y sin window.localStorage tampoco lanza', () => {
    expect(new LocalStorageChatSettingsRepository(null).load()).toEqual({
      showAvailable: false,
    });
  });
});

describe('getChatSettingsRepository — resolución por registry', () => {
  /** Registry mínimo estructural (como DataManager de Phaser). */
  function createRegistry(): Map<string, unknown> {
    return new Map<string, unknown>();
  }

  it('crea el default (localStorage) y lo cachea en el registry', () => {
    const registry = createRegistry();
    const first = getChatSettingsRepository(registry);
    const second = getChatSettingsRepository(registry);

    expect(first).toBe(second);
    expect(registry.get(CHAT_SETTINGS_REGISTRY_KEY)).toBe(first);
  });

  it('respeta un repositorio inyectado antes (inversión de dependencias)', () => {
    const registry = createRegistry();
    const injected = {
      load: () => ({ showAvailable: true }),
      save: () => undefined,
    };
    registry.set(CHAT_SETTINGS_REGISTRY_KEY, injected);

    expect(getChatSettingsRepository(registry)).toBe(injected);
  });
});
