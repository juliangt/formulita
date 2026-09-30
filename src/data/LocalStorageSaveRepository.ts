/**
 * LocalStorageSaveRepository — persistencia del progreso en localStorage
 * (Fase 5) detrás de `ISaveRepository`.
 *
 * Robustez según el plan (§Riesgos — "localStorage en modo privado"):
 * - Clave VERSIONADA (`formulita.save.v1`): un cambio de modelo de datos
 *   futuro usa otra clave + migración, sin pisar guardados viejos.
 * - Todo acceso al storage va envuelto en try/catch: si el storage no está
 *   disponible (modo privado, cuota, acceso directo que lanza), el
 *   repositorio cae a un ESPEJO EN MEMORIA y la sesión sigue funcionando.
 * - Lectura con merge defensivo (`sanitizeSaveData`): JSON corrupto o datos
 *   parciales se normalizan a un `SaveData` completo, nunca lanzan.
 */

import {
  SAVE_REPOSITORY_REGISTRY_KEY,
  type ISaveRepository,
  type RegistryLike,
} from './ISaveRepository';
import { defaultSaveData, sanitizeSaveData, type SaveData } from './types';

/** Clave versionada bajo la que se persiste el progreso. */
export const SAVE_STORAGE_KEY = 'formulita.save.v1';

/** Sonda desechable para verificar que el storage realmente funciona. */
const PROBE_KEY = '__formulita_probe__';

/**
 * Storage default. El ACCESO a `window.localStorage` puede lanzar en algunos
 * contextos (modo privado viejo, iframes sandbox): por eso va dentro del try.
 */
function defaultStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Verifica que el storage sirva para leer Y escribir (el modo privado de
 * algunos navegadores permite leer pero lanza al escribir): una sonda
 * desechable que se limpia a sí misma.
 */
function usableStorage(storage: Storage | null): Storage | null {
  if (!storage) {
    return null;
  }
  try {
    storage.setItem(PROBE_KEY, '1');
    const works = storage.getItem(PROBE_KEY) === '1';
    storage.removeItem(PROBE_KEY);
    return works ? storage : null;
  } catch {
    return null;
  }
}

export class LocalStorageSaveRepository implements ISaveRepository {
  /** Espejo en memoria: siempre consistente con el último save(). */
  private memory: SaveData = defaultSaveData();

  /** Storage real, o null si nunca estuvo disponible. */
  private readonly storage: Storage | null;

  /** true cuando el storage falló a mitad de sesión (se degrada a memoria). */
  private storageBroken = false;

  constructor(storage: Storage | null = defaultStorage()) {
    this.storage = usableStorage(storage);
  }

  load(): SaveData {
    if (!this.storage || this.storageBroken) {
      return { ...this.memory };
    }
    try {
      const raw = this.storage.getItem(SAVE_STORAGE_KEY);
      if (raw === null) {
        return { ...this.memory };
      }
      return sanitizeSaveData(JSON.parse(raw));
    } catch {
      // JSON corrupto o el storage pasó a fallar: cae al espejo en memoria.
      return { ...this.memory };
    }
  }

  save(data: SaveData): void {
    const clean = sanitizeSaveData(data);
    this.memory = { ...clean };
    if (!this.storage || this.storageBroken) {
      return;
    }
    try {
      this.storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(clean));
    } catch {
      // Cuota agotada o storage bloqueado a mitad de sesión: a partir de acá
      // esta sesión vive del espejo en memoria (consistencia interna).
      this.storageBroken = true;
    }
  }
}

/** Shape check mínimo de repositorio (para el valor del registry). */
function looksLikeSaveRepository(value: unknown): value is ISaveRepository {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { load?: unknown; save?: unknown };
  return typeof candidate.load === 'function' && typeof candidate.save === 'function';
}

/**
 * Resuelve el repositorio de guardado para las escenas (registry de Phaser):
 * - Si otro módulo ya inyectó uno (p. ej. un futuro HttpScoreboardRepository
 *   desde el bootstrap), se respeta esa decisión (inversión de dependencias).
 * - Si no, crea el default (localStorage) de forma lazy y lo cachea en el
 *   registry para que toda la sesión comparta la misma instancia.
 */
export function getSaveRepository(registry: RegistryLike): ISaveRepository {
  const existing = registry.get(SAVE_REPOSITORY_REGISTRY_KEY);
  if (looksLikeSaveRepository(existing)) {
    return existing;
  }
  const created = new LocalStorageSaveRepository();
  registry.set(SAVE_REPOSITORY_REGISTRY_KEY, created);
  return created;
}
