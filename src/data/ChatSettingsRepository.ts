/**
 * ChatSettingsRepository — persistencia de los ajustes del chat (issue #2, C0).
 *
 * Lo único del chat que se persiste es si la lista de jugadores disponibles
 * (sala pública de presencia) se muestra: default `false` (escondida). El
 * BLOQUEO de peers NO se persiste — los peerId cambian en cada conexión, es
 * un estado de sesión que vive en `ChatStore`.
 *
 * Mismo patrón que PlayerProfileRepository / LocalStorageSaveRepository:
 * - Clave VERSIONADA (`formulita.chat-settings.v1`).
 * - Todo acceso al storage envuelto en try/catch con espejo en memoria.
 * - Los ajustes se SANITIZAN al guardar y al leer (`sanitizeChatSettings` de
 *   data/types: JSON corrupto o campos inválidos degradan al default).
 */

import { sanitizeChatSettings } from './types';
import type { ChatSettings } from './types';
import type { RegistryLike } from './ISaveRepository';

/** Clave del repositorio en el registry de Phaser (servicio de sesión). */
export const CHAT_SETTINGS_REGISTRY_KEY = 'chatSettingsRepository';

/** Clave versionada bajo la que se persisten los ajustes de chat. */
export const CHAT_SETTINGS_STORAGE_KEY = 'formulita.chat-settings.v1';

/** Contrato (inversión de dependencias, como ISaveRepository). */
export interface IChatSettingsRepository {
  load(): ChatSettings;
  save(settings: ChatSettings): void;
}

/** Sonda desechable para verificar que el storage realmente funciona. */
const PROBE_KEY = '__formulita_chat_settings_probe__';

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

export class LocalStorageChatSettingsRepository implements IChatSettingsRepository {
  private memory: ChatSettings = sanitizeChatSettings(undefined);
  private readonly storage: Storage | null;
  private storageBroken = false;

  constructor(storage: Storage | null = defaultStorage()) {
    this.storage = usableStorage(storage);
  }

  load(): ChatSettings {
    if (!this.storage || this.storageBroken) {
      return { ...this.memory };
    }
    try {
      const raw = this.storage.getItem(CHAT_SETTINGS_STORAGE_KEY);
      if (raw === null) {
        return { ...this.memory };
      }
      const parsed: unknown = JSON.parse(raw);
      // Sanitizado también al LEER: un JSON corrupto o con tipos viejos
      // degrada al default sin romper.
      return sanitizeChatSettings(parsed);
    } catch {
      return { ...this.memory };
    }
  }

  save(settings: ChatSettings): void {
    const clean: ChatSettings = sanitizeChatSettings(settings);
    this.memory = { ...clean };
    if (!this.storage || this.storageBroken) {
      return;
    }
    try {
      this.storage.setItem(CHAT_SETTINGS_STORAGE_KEY, JSON.stringify(clean));
    } catch {
      this.storageBroken = true;
    }
  }
}

/** Shape check mínimo para el valor del registry. */
function looksLikeChatSettingsRepository(value: unknown): value is IChatSettingsRepository {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { load?: unknown; save?: unknown };
  return typeof candidate.load === 'function' && typeof candidate.save === 'function';
}

/**
 * Resuelve el repositorio de ajustes de chat (registry de Phaser): respeta
 * uno inyectado antes del Boot y cachea el default (localStorage) para toda
 * la sesión — mismo contrato que `getPlayerProfileRepository`.
 */
export function getChatSettingsRepository(registry: RegistryLike): IChatSettingsRepository {
  const existing = registry.get(CHAT_SETTINGS_REGISTRY_KEY);
  if (looksLikeChatSettingsRepository(existing)) {
    return existing;
  }
  const created = new LocalStorageChatSettingsRepository();
  registry.set(CHAT_SETTINGS_REGISTRY_KEY, created);
  return created;
}
