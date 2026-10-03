/**
 * Tests de `race/gpSettings` (#39): la preferencia DESGASTE del GRAN PREMIO.
 * Persistencia defensiva con storage inyectado (FakeStorage): round-trip,
 * defaults y degradación ante storage roto o JSON corrupto.
 */

import { describe, expect, it } from 'vitest';

import { FakeStorage } from '../fakeStorage';
import {
  GP_SETTINGS_STORAGE_KEY,
  defaultGpSettings,
  loadGpSettings,
  saveGpWearEnabled,
} from '../../race/gpSettings';

describe('loadGpSettings — defaults', () => {
  it('sin storage (null) devuelve el default: desgaste APAGADO', () => {
    expect(loadGpSettings(null)).toEqual({ wearEnabled: false });
    expect(loadGpSettings(null)).toEqual(defaultGpSettings());
  });

  it('clave vacía (primera vez) devuelve el default', () => {
    expect(loadGpSettings(new FakeStorage())).toEqual({ wearEnabled: false });
  });

  it('storage que falla al leer degrada al default sin lanzar', () => {
    const storage = new FakeStorage();
    storage.failReads = true;
    expect(loadGpSettings(storage)).toEqual({ wearEnabled: false });
  });
});

describe('loadGpSettings — parseo defensivo', () => {
  it('JSON corrupto cae al default sin lanzar', () => {
    const storage = new FakeStorage();
    storage.setItem(GP_SETTINGS_STORAGE_KEY, '{esto no es json');
    expect(loadGpSettings(storage)).toEqual({ wearEnabled: false });
  });

  it('shapes inesperados (número, array, null) caen al default', () => {
    for (const junk of ['5', '[]', 'null', '"hola"']) {
      const storage = new FakeStorage();
      storage.setItem(GP_SETTINGS_STORAGE_KEY, junk);
      expect(loadGpSettings(storage), `basura: ${junk}`).toEqual({ wearEnabled: false });
    }
  });

  it('wearEnabled no booleano (0, 1, "true") cae al default: no se adivina', () => {
    for (const junk of ['{"wearEnabled":1}', '{"wearEnabled":0}', '{"wearEnabled":"true"}', '{}']) {
      const storage = new FakeStorage();
      storage.setItem(GP_SETTINGS_STORAGE_KEY, junk);
      expect(loadGpSettings(storage), `basura: ${junk}`).toEqual({ wearEnabled: false });
    }
  });
});

describe('saveGpWearEnabled — round-trip', () => {
  it('guarda true y lo lee de vuelta (misma instancia y una nueva)', () => {
    const storage = new FakeStorage();
    saveGpWearEnabled(storage, true);
    expect(loadGpSettings(storage)).toEqual({ wearEnabled: true });
    // Y sobrevive a una "nueva sesión" (otro FakeStorage con el mismo raw).
    const second = new FakeStorage();
    second.setItem(GP_SETTINGS_STORAGE_KEY, storage.raw(GP_SETTINGS_STORAGE_KEY) as string);
    expect(loadGpSettings(second)).toEqual({ wearEnabled: true });
  });

  it('guarda false explícitamente (no confunde con "sin preferencia")', () => {
    const storage = new FakeStorage();
    saveGpWearEnabled(storage, false);
    expect(JSON.parse(storage.raw(GP_SETTINGS_STORAGE_KEY) as string)).toEqual({
      wearEnabled: false,
    });
    expect(loadGpSettings(storage)).toEqual({ wearEnabled: false });
  });

  it('coacciona la entrada a booleano real', () => {
    const storage = new FakeStorage();
    saveGpWearEnabled(storage, 1 as unknown as boolean);
    expect(loadGpSettings(storage)).toEqual({ wearEnabled: false });
    saveGpWearEnabled(storage, 'sí' as unknown as boolean);
    expect(loadGpSettings(storage)).toEqual({ wearEnabled: false });
  });

  it('storage que falla al escribir: el valor rige igualmente vía el retorno', () => {
    const storage = new FakeStorage();
    storage.failWrites = true;
    const settings = saveGpWearEnabled(storage, true);
    expect(settings).toEqual({ wearEnabled: true });
    expect(loadGpSettings(storage)).toEqual({ wearEnabled: false }); // No persistió.
  });

  it('con storage null no lanza y devuelve el valor', () => {
    expect(saveGpWearEnabled(null, true)).toEqual({ wearEnabled: true });
  });
});
