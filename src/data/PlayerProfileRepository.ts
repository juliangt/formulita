/**
 * PlayerProfileRepository — persistencia del perfil del jugador (M1).
 *
 * El nombre para el multijugador se pide UNA vez (desde el menú) y se guarda
 * aparte del progreso (`ISaveRepository`): son datos de identidad, no de
 * carrera. Mismo patrón que LocalStorageSaveRepository:
 * - Clave VERSIONADA (`formulita.profile.v1`).
 * - Todo acceso al storage envuelto en try/catch con espejo en memoria.
 * - El nombre se SANITIZA al guardar y al leer (misma regla que el wire:
 *   `sanitizePlayerName` de net/protocol — trim, espacios colapsados, máx 12).
 */

import { sanitizePlayerName } from '../net/protocol';
import type { RegistryLike } from './ISaveRepository';

/** Clave del repositorio en el registry de Phaser (servicio de sesión). */
export const PLAYER_PROFILE_REGISTRY_KEY = 'playerProfileRepository';

/** Clave versionada bajo la que se persiste el perfil. */
export const PLAYER_PROFILE_STORAGE_KEY = 'formulita.profile.v1';

/** Perfil persistido del jugador (por ahora, solo el nombre multijugador). */
export interface PlayerProfile {
  /** Nombre visible en el lobby (vacío = aún no lo eligió). */
  readonly name: string;
}

/** Contrato (inversión de dependencias, como ISaveRepository). */
export interface IPlayerProfileRepository {
  load(): PlayerProfile;
  save(profile: PlayerProfile): void;
}

/** Sonda desechable para verificar que el storage realmente funciona. */
const PROBE_KEY = '__formulita_profile_probe__';

function defaultStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

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

export class LocalStoragePlayerProfileRepository implements IPlayerProfileRepository {
  private memory: PlayerProfile = { name: '' };
  private readonly storage: Storage | null;
  private storageBroken = false;

  constructor(storage: Storage | null = defaultStorage()) {
    this.storage = usableStorage(storage);
  }

  load(): PlayerProfile {
    if (!this.storage || this.storageBroken) {
      return { ...this.memory };
    }
    try {
      const raw = this.storage.getItem(PLAYER_PROFILE_STORAGE_KEY);
      if (raw === null) {
        return { ...this.memory };
      }
      const parsed: unknown = JSON.parse(raw);
      const record = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
      // Sanitizado también al LEER: un perfil viejo con nombre más largo que
      // el máximo actual se normaliza sin romper.
      return { name: typeof record.name === 'string' ? sanitizePlayerName(record.name) : '' };
    } catch {
      return { ...this.memory };
    }
  }

  save(profile: PlayerProfile): void {
    const clean: PlayerProfile = { name: sanitizePlayerName(profile.name) };
    this.memory = { ...clean };
    if (!this.storage || this.storageBroken) {
      return;
    }
    try {
      this.storage.setItem(PLAYER_PROFILE_STORAGE_KEY, JSON.stringify(clean));
    } catch {
      this.storageBroken = true;
    }
  }
}

/** Shape check mínimo para el valor del registry. */
function looksLikeProfileRepository(value: unknown): value is IPlayerProfileRepository {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { load?: unknown; save?: unknown };
  return typeof candidate.load === 'function' && typeof candidate.save === 'function';
}

/**
 * Resuelve el repositorio de perfil (registry de Phaser): respeta uno
 * inyectado antes del Boot y cachea el default (localStorage) para toda la
 * sesión — mismo contrato que `getSaveRepository`.
 */
export function getPlayerProfileRepository(registry: RegistryLike): IPlayerProfileRepository {
  const existing = registry.get(PLAYER_PROFILE_REGISTRY_KEY);
  if (looksLikeProfileRepository(existing)) {
    return existing;
  }
  const created = new LocalStoragePlayerProfileRepository();
  registry.set(PLAYER_PROFILE_REGISTRY_KEY, created);
  return created;
}
