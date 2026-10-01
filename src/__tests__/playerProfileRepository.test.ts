import { describe, expect, it } from 'vitest';
import {
  getPlayerProfileRepository,
  LocalStoragePlayerProfileRepository,
  PLAYER_PROFILE_REGISTRY_KEY,
  PLAYER_PROFILE_STORAGE_KEY,
} from '../data/PlayerProfileRepository';
import { MULTIPLAYER } from '../config/balance';
import { FakeStorage } from './fakeStorage';

/**
 * Tests del PlayerProfileRepository (M1): persistencia del nombre para el
 * multijugador, con la MISMA robustez que LocalStorageSaveRepository (clave
 * versionada, storage roto → espejo en memoria, sanitización al guardar y
 * al leer).
 */

describe('LocalStoragePlayerProfileRepository — persistencia', () => {
  it('guarda y lee el nombre bajo la clave versionada formulita.profile.v1', () => {
    const storage = new FakeStorage();
    const repo = new LocalStoragePlayerProfileRepository(storage);

    repo.save({ name: 'Ana' });

    expect(storage.raw(PLAYER_PROFILE_STORAGE_KEY)).toBe(JSON.stringify({ name: 'Ana' }));
    expect(repo.load()).toEqual({ name: 'Ana' });
  });

  it('el nombre se sanitiza al guardar (trim, espacios, máx 12)', () => {
    const storage = new FakeStorage();
    const repo = new LocalStoragePlayerProfileRepository(storage);

    const long = 'A'.repeat(MULTIPLAYER.maxPlayerNameLength + 5);
    repo.save({ name: `  Juan   Pérez  ${long}` });

    expect(repo.load().name.length).toBeLessThanOrEqual(MULTIPLAYER.maxPlayerNameLength);
    expect(repo.load().name).not.toMatch(/\s{2,}/);
  });

  it('el nombre también se sanitiza al LEER (perfil viejo con formato caducado)', () => {
    const storage = new FakeStorage();
    storage.setItem(
      PLAYER_PROFILE_STORAGE_KEY,
      JSON.stringify({ name: `  ${'x'.repeat(40)}  ` }),
    );
    const repo = new LocalStoragePlayerProfileRepository(storage);

    expect(repo.load().name).toBe('x'.repeat(MULTIPLAYER.maxPlayerNameLength));
  });

  it('JSON corrupto o parcial degrada a perfil vacío sin lanzar', () => {
    const storage = new FakeStorage();
    storage.setItem(PLAYER_PROFILE_STORAGE_KEY, '{no es json');
    expect(new LocalStoragePlayerProfileRepository(storage).load()).toEqual({ name: '' });

    storage.setItem(PLAYER_PROFILE_STORAGE_KEY, JSON.stringify({ otra: 'cosa' }));
    expect(new LocalStoragePlayerProfileRepository(storage).load()).toEqual({ name: '' });
  });

  it('sin storage usable vive del espejo en memoria (y no lanza)', () => {
    const failing = new FakeStorage();
    failing.failWrites = true;
    const repo = new LocalStoragePlayerProfileRepository(failing);

    repo.save({ name: 'Ana' });
    expect(repo.load()).toEqual({ name: 'Ana' });

    const broken = new FakeStorage();
    broken.failReads = true;
    const repo2 = new LocalStoragePlayerProfileRepository(broken);
    expect(repo2.load()).toEqual({ name: '' });
  });

  it('persiste entre instancias (simula recargar la página)', () => {
    const storage = new FakeStorage();
    new LocalStoragePlayerProfileRepository(storage).save({ name: 'Ana' });

    const reloaded = new LocalStoragePlayerProfileRepository(storage);
    expect(reloaded.load()).toEqual({ name: 'Ana' });
  });
});

describe('getPlayerProfileRepository — resolución por registry', () => {
  /** Registry mínimo estructural (como DataManager de Phaser). */
  function createRegistry(): Map<string, unknown> {
    return new Map<string, unknown>();
  }

  it('crea el default (localStorage) y lo cachea en el registry', () => {
    const registry = createRegistry();
    const first = getPlayerProfileRepository(registry);
    const second = getPlayerProfileRepository(registry);

    expect(first).toBe(second);
    expect(registry.get(PLAYER_PROFILE_REGISTRY_KEY)).toBe(first);
  });

  it('respeta un repositorio inyectado antes (inversión de dependencias)', () => {
    const registry = createRegistry();
    const injected = {
      load: () => ({ name: 'Inyectado' }),
      save: () => undefined,
    };
    registry.set(PLAYER_PROFILE_REGISTRY_KEY, injected);

    expect(getPlayerProfileRepository(registry)).toBe(injected);
  });
});
