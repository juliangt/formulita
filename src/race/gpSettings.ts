/**
 * gpSettings — preferencias del GRAN PREMIO (issue #39).
 *
 * Hoy guarda UNA preferencia: el toggle DESGASTE (neumáticos) del picker.
 * Vive separado de los récords (`gpRecords.ts`) porque es una ELECCIÓN del
 * jugador, no una marca: la elige el picker, la transporta el init data de
 * RaceScene y la conserva REINTENTAR — leyendo siempre esta única fuente.
 *
 * Persistencia (mismo patrón del mute en `AudioManager` y de los récords):
 * clave PROPIA y VERSIONADA `formulita.gpSettings.v1`, todo acceso envuelto
 * en try/catch y DEGRADA sin lanzar: JSON corrupto, shape inesperado o valor
 * no booleano → default (`wearEnabled: false`). Storage ausente (sin
 * `window`, tests) o que falla al leer → default; que falla al escribir
 * (modo privado, cuota) → el valor rige igualmente en memoria vía el
 * retorno.
 *
 * Puro: sin Phaser, sin escenas — el storage es INYECTADO (contrato
 * `Storage`), así que es testeable directo con Vitest con un fake.
 */

/** Clave versionada de las preferencias del GRAN PREMIO en el storage. */
export const GP_SETTINGS_STORAGE_KEY = 'formulita.gpSettings.v1';

/** Preferencias del GRAN PREMIO (todas con default explícito). */
export interface GpSettings {
  /**
   * Toggle DESGASTE de neumáticos (issue #39): `false` (default) = carrera
   * arcade sin degradación; `true` = la goma se gasta por kilometraje y
   * golpes y recorta la velocidad punta.
   */
  readonly wearEnabled: boolean;
}

/** Defaults de las preferencias (lo que corre con storage ausente o roto). */
export function defaultGpSettings(): GpSettings {
  return { wearEnabled: false };
}

/**
 * Storage default para las preferencias: localStorage del navegador, o
 * `null` si no existe/acceso bloqueado (misma red defensiva que `gpRecords`).
 */
export function defaultGpStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Coacciona UNA preferencia cruda: sólo acepta booleano real (los basura
 * no se "adivinan": `0`/`1`/`'true'` → default).
 */
function parseWearEnabled(raw: unknown): boolean | null {
  return typeof raw === 'boolean' ? raw : null;
}

/**
 * Lee las preferencias persistidas. Defensivo en cada capa: storage ausente
 * o roto, JSON corrupto, shape inesperado o campos basura → el campo cae al
 * default sin lanzar.
 */
export function loadGpSettings(storage: Storage | null): GpSettings {
  if (!storage) {
    return defaultGpSettings();
  }
  try {
    const raw = storage.getItem(GP_SETTINGS_STORAGE_KEY);
    if (raw === null) {
      return defaultGpSettings();
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return defaultGpSettings();
    }
    const source = parsed as Record<string, unknown>;
    const wearEnabled = parseWearEnabled(source.wearEnabled);
    return {
      wearEnabled: wearEnabled ?? defaultGpSettings().wearEnabled,
    };
  } catch {
    return defaultGpSettings();
  }
}

/**
 * Persiste el toggle DESGASTE (best-effort: si el storage falla, el valor
 * rige igualmente para esta sesión vía el retorno).
 */
export function saveGpWearEnabled(storage: Storage | null, wearEnabled: boolean): GpSettings {
  const settings: GpSettings = { wearEnabled: wearEnabled === true };
  if (storage) {
    try {
      storage.setItem(GP_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Modo privado / cuota: la preferencia rige vía el retorno.
    }
  }
  return settings;
}
