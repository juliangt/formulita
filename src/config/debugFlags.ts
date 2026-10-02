/**
 * debugFlags — bandera del modo diagnóstico (issue #16).
 *
 * Un solo flag gobierna los dos artefactos que quedaron del debugging del
 * input móvil (`src/main.ts`) y que ningún jugador debería ver:
 * - el tag de build (`build <hash>`, esquina inferior derecha),
 * - el anillo de tap (eco visual de dónde el juego registró el toque).
 *
 * OFF por defecto. ON sin recompilar, por dos vías SUMATIVAS (basta una):
 * - Query param `?debug=1` o `?debug=true`: fácil de tipear una vez.
 * - localStorage (`DEBUG_STORAGE_KEY` con valor `'1'`/`'true'`): sobrevive
 *   recargas mientras se depura en el teléfono, donde tipear la URL cada vez
 *   es un insulto.
 *
 * Contrato:
 * - Puro e INYECTABLE (`search` / `storage` como parámetros con defaults del
 *   entorno): testeable sin tocar globales, igual que `gpRecords`.
 * - NUNCA lanza: storage bloqueado (modo privado, permisos) degrada a OFF,
 *   mismo patrón try/catch de `ChatSettingsRepository` / `gpRecords`.
 * - Valor inválido (`?debug=0`, `'0'`, basura) NO prende el flag: no hay
 *   vía de "apagado" vía storage — si la query no pide debug, el storage
 *   decid solo (OR).
 */

/** Clave versionada del modo debug en localStorage (convención del repo). */
export const DEBUG_STORAGE_KEY = 'formulita.debug.v1';

/** Únicos valores que consideramos "prendido", en query y en storage. */
const TRUTHY_VALUES = new Set(['1', 'true']);

/** Search del entorno real; `''` fuera del navegador (SSR/tests). */
function defaultSearch(): string {
  return typeof location !== 'undefined' ? location.search : '';
}

/** Storage del entorno real; `undefined` fuera del navegador (SSR/tests). */
function defaultStorage(): Pick<Storage, 'getItem'> | undefined {
  return typeof localStorage !== 'undefined' ? localStorage : undefined;
}

/**
 * ¿Modo debug prendido? `true` si la query trae `?debug=1|true` O el storage
 * tiene `DEBUG_STORAGE_KEY` con valor truthy. Los dos orígenes se aceptan en
 * minúscula y con espacios accidentales; todo lo demás cuenta como OFF.
 */
export function isDebugMode(
  search: string = defaultSearch(),
  storage: Pick<Storage, 'getItem'> | undefined = defaultStorage(),
): boolean {
  // 1) Query param: la vía rápida para prenderlo desde el teléfono.
  try {
    const raw = new URLSearchParams(search).get('debug');
    if (raw !== null && TRUTHY_VALUES.has(raw.trim().toLowerCase())) {
      return true;
    }
  } catch {
    // `URLSearchParams` no debería lanzar con un string, pero el diagnóstico
    // no puede tumbar el arranque del juego por nada.
  }

  // 2) Persistido: sobrevive recargas mientras se está depurando.
  if (storage) {
    try {
      const raw = storage.getItem(DEBUG_STORAGE_KEY);
      if (raw !== null && TRUTHY_VALUES.has(raw.trim().toLowerCase())) {
        return true;
      }
    } catch {
      // localStorage que lanza (Safari privado viejo, permisos): OFF y listo.
    }
  }

  return false;
}
