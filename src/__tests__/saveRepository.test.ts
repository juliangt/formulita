import { describe, expect, it } from 'vitest';
import {
  SAVE_REPOSITORY_REGISTRY_KEY,
  type RegistryLike,
} from '../data/ISaveRepository';
import {
  getSaveRepository,
  LocalStorageSaveRepository,
  SAVE_STORAGE_KEY,
} from '../data/LocalStorageSaveRepository';
import { applyRaceResult, defaultSaveData } from '../data/types';
import { FakeStorage } from './fakeStorage';

/**
 * Tests del LocalStorageSaveRepository (Fase 5): persistencia con clave
 * versionada, merges defensivos de datos corruptos/parciales y fallback en
 * memoria cuando el storage no está disponible o se rompe a mitad de
 * sesión. Todo sobre un `Storage` fake, sin localStorage real.
 */

const VALID_SAVE = { totalCoins: 12, bestScore: 3456, bestDistance: 78900 };

describe('LocalStorageSaveRepository — persistencia básica', () => {
  it('guarda y lee bajo la clave versionada formulita.save.v1', () => {
    const storage = new FakeStorage();
    const repo = new LocalStorageSaveRepository(storage);

    repo.save(VALID_SAVE);

    expect(storage.raw(SAVE_STORAGE_KEY)).toBe(JSON.stringify(VALID_SAVE));
    expect(repo.load()).toEqual(VALID_SAVE);
  });

  it('persiste entre instancias (simula recarga de página)', () => {
    const storage = new FakeStorage();
    const first = new LocalStorageSaveRepository(storage);
    first.save(VALID_SAVE);

    const second = new LocalStorageSaveRepository(storage);

    expect(second.load()).toEqual(VALID_SAVE);
  });

  it('sin datos previos devuelve defaults', () => {
    const repo = new LocalStorageSaveRepository(new FakeStorage());

    expect(repo.load()).toEqual(defaultSaveData());
  });

  it('la sonda de disponibilidad no deja basura en el storage', () => {
    const storage = new FakeStorage();
    new LocalStorageSaveRepository(storage);

    expect(storage.length).toBe(0);
  });
});

describe('LocalStorageSaveRepository — merge defensivo', () => {
  it('JSON corrupto cae a defaults sin lanzar', () => {
    const storage = new FakeStorage();
    storage.setItem(SAVE_STORAGE_KEY, '{esto no es json');

    const repo = new LocalStorageSaveRepository(storage);

    expect(repo.load()).toEqual(defaultSaveData());
  });

  it('JSON válido pero no-objeto cae a defaults', () => {
    const storage = new FakeStorage();
    storage.setItem(SAVE_STORAGE_KEY, 'null');
    const nullRepo = new LocalStorageSaveRepository(storage);
    expect(nullRepo.load()).toEqual(defaultSaveData());

    storage.setItem(SAVE_STORAGE_KEY, '42');
    const numberRepo = new LocalStorageSaveRepository(storage);
    expect(numberRepo.load()).toEqual(defaultSaveData());
  });

  it('datos parciales: los campos presentes se conservan, los ausentes toman default', () => {
    const storage = new FakeStorage();
    storage.setItem(SAVE_STORAGE_KEY, JSON.stringify({ totalCoins: 7 }));

    const repo = new LocalStorageSaveRepository(storage);

    expect(repo.load()).toEqual({ totalCoins: 7, bestScore: 0, bestDistance: 0 });
  });

  it('campos inválidos (tipo incorrecto, negativos, fraccionales) se normalizan por campo', () => {
    const storage = new FakeStorage();
    storage.setItem(
      SAVE_STORAGE_KEY,
      JSON.stringify({ totalCoins: 'x', bestScore: -5, bestDistance: 123.9, extra: true }),
    );

    const repo = new LocalStorageSaveRepository(storage);

    expect(repo.load()).toEqual({ totalCoins: 0, bestScore: 0, bestDistance: 123 });
  });

  it('save normaliza lo que recibe (nadie puede guardar basura)', () => {
    const storage = new FakeStorage();
    const repo = new LocalStorageSaveRepository(storage);
    const garbage = { totalCoins: Number.NaN, bestScore: -3, bestDistance: 4.7 } as unknown;

    repo.save(garbage as typeof VALID_SAVE);

    expect(repo.load()).toEqual({ totalCoins: 0, bestScore: 0, bestDistance: 4 });
  });
});

describe('LocalStorageSaveRepository — fallback en memoria', () => {
  it('storage que bloquea la escritura desde el inicio → memoria, sin lanzar', () => {
    const storage = new FakeStorage();
    storage.failWrites = true; // la sonda de construcción ya falla
    const repo = new LocalStorageSaveRepository(storage);

    expect(() => repo.save(VALID_SAVE)).not.toThrow();
    expect(repo.load()).toEqual(VALID_SAVE); // el espejo en memoria retiene
    expect(storage.length).toBe(0); // nada llegó al storage
  });

  it('otra instancia sobre un storage roto desde el inicio ve defaults', () => {
    const storage = new FakeStorage();
    storage.failWrites = true;
    const repo = new LocalStorageSaveRepository(storage);
    repo.save(VALID_SAVE);

    const fresh = new LocalStorageSaveRepository(storage);

    expect(fresh.load()).toEqual(defaultSaveData());
  });

  it('escritura que falla a mitad de sesión: la lectura cae al espejo en memoria', () => {
    const storage = new FakeStorage();
    const repo = new LocalStorageSaveRepository(storage);
    repo.save(VALID_SAVE);

    storage.failWrites = true; // se rompe después de construir
    repo.save({ totalCoins: 99, bestScore: 1, bestDistance: 1 });

    expect(repo.load()).toEqual({ totalCoins: 99, bestScore: 1, bestDistance: 1 });
  });

  it('lectura que lanza (storage bloqueado) devuelve defaults o memoria, sin lanzar', () => {
    const storage = new FakeStorage();
    storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(VALID_SAVE));

    const repo = new LocalStorageSaveRepository(storage);
    expect(repo.load()).toEqual(VALID_SAVE);

    storage.failReads = true;
    expect(repo.load()).toEqual(defaultSaveData());
  });

  it('constructor tolera null y storage undefined-like', () => {
    const repo = new LocalStorageSaveRepository(null);

    expect(() => repo.save(VALID_SAVE)).not.toThrow();
    expect(repo.load()).toEqual(VALID_SAVE);
  });
});

describe('LocalStorageSaveRepository — monedas acumuladas entre sesiones', () => {
  it('dos carreras sobre el mismo storage suman totalCoins', () => {
    const storage = new FakeStorage();
    const sessionOne = new LocalStorageSaveRepository(storage);

    // Carrera 1 en la sesión 1.
    const raceOne = applyRaceResult(sessionOne.load(), {
      score: 1000,
      distance: 9000,
      coins: 3,
    });
    expect(raceOne.isNewBest).toBe(true);
    sessionOne.save(raceOne.save);

    // "Recarga": sesión 2 sobre el mismo storage.
    const sessionTwo = new LocalStorageSaveRepository(storage);
    const raceTwo = applyRaceResult(sessionTwo.load(), {
      score: 800,
      distance: 7000,
      coins: 2,
    });
    expect(raceTwo.isNewBest).toBe(false);
    sessionTwo.save(raceTwo.save);

    expect(sessionTwo.load()).toEqual({
      totalCoins: 5,
      bestScore: 1000,
      bestDistance: 9000,
    });
  });
});

describe('getSaveRepository — resolución desde el registry', () => {
  /** Registry fake mínimo (la misma porción que Phaser.Data.DataManager). */
  class FakeRegistry implements RegistryLike {
    private readonly map = new Map<string, unknown>();

    get(key: string): unknown {
      return this.map.get(key);
    }

    set(key: string, value: unknown): this {
      this.map.set(key, value);
      return this;
    }
  }

  it('crea y cachea un repositorio default si el registry está vacío', () => {
    const registry = new FakeRegistry();

    const repo = getSaveRepository(registry);

    expect(repo.load()).toEqual(defaultSaveData());
    expect(registry.get(SAVE_REPOSITORY_REGISTRY_KEY)).toBe(repo); // misma instancia
  });

  it('respeta un repositorio inyectado previamente (inversión de dependencias)', () => {
    const registry = new FakeRegistry();
    const injected = new LocalStorageSaveRepository(new FakeStorage());
    injected.save(VALID_SAVE);
    registry.set(SAVE_REPOSITORY_REGISTRY_KEY, injected);

    const resolved = getSaveRepository(registry);

    expect(resolved).toBe(injected);
    expect(resolved.load()).toEqual(VALID_SAVE);
  });
});
