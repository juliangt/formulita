/**
 * types.ts — modelo de datos de la capa de persistencia (Fase 5).
 *
 * Tipos + funciones PURAS (sin Phaser, sin storage): el parseo defensivo y
 * la aplicación de resultados de carrera son testeados directamente por
 * Vitest. El almacenamiento en sí vive detrás de `ISaveRepository`.
 */

/** Progreso persistido del jugador (clave versionada en localStorage). */
export interface SaveData {
  /** Total de monedas acumuladas (suma de todas las carreras). */
  totalCoins: number;
  /** Mejor puntaje histórico (una sola carrera). */
  bestScore: number;
  /** Mejor distancia histórica de una carrera (px). */
  bestDistance: number;
}

/**
 * Entrada del scoreboard futuro (fuera de alcance del MVP, ver plan
 * §Fases futuras). Hoy solo declara la forma de datos que un
 * `HttpScoreboardRepository` enviaría, para que la capa no tenga que
 * reinventarse cuando llegue.
 */
export interface ScoreEntry {
  readonly name: string;
  readonly score: number;
  readonly distance: number;
  readonly coins: number;
  /** Fecha ISO en que se logró el puntaje. */
  readonly achievedAtIso: string;
}

/** Resumen de una carrera terminada (lo que GameScene produce al morir). */
export interface RaceSummary {
  readonly score: number;
  /** Distancia recorrida en la carrera (px). */
  readonly distance: number;
  /** Monedas recolectadas en la carrera. */
  readonly coins: number;
}

/**
 * Datos que GameScene le pasa a GameOverScene como init data de escena
 * (`scene.start(GameOverScene.KEY, payload)`). Elección documentada: el
 * payload por transición es síncrono, tipado y no deja estado global (a
 * diferencia del EventBus, pensado para consumidores desacoplados del HUD).
 */
export interface GameOverData extends RaceSummary {
  /** true si el puntaje de esta carrera superó el récord previo. */
  readonly isNewBest: boolean;
}

/** SaveData con todos los campos en cero (primer arranque). */
export function defaultSaveData(): SaveData {
  return { totalCoins: 0, bestScore: 0, bestDistance: 0 };
}

/**
 * Ajustes del chat social (issue #2, C0): lo único del chat que se persiste.
 * El BLOQUEO de peers NO vive acá a propósito: los peerId de Trystero son
 * efímeros (cambian en cada conexión), así que persistirlos no serviría; el
 * bloqueo es por sesión y vive en `ChatStore`.
 */
export interface ChatSettings {
  /**
   * true si la lista de jugadores disponibles (sala pública de presencia)
   * se muestra en el menú. Default `false`: ESCONDIDA — opt-in explícito,
   * el menú queda limpio en el primer arranque.
   */
  readonly showAvailable: boolean;
}

/** Ajustes de chat por defecto: sala pública de presencia escondida. */
export function defaultChatSettings(): ChatSettings {
  return { showAvailable: false };
}

/**
 * Merge defensivo de los ajustes de chat (espejo de `sanitizeSaveData`):
 * acepta cualquier valor crudo (JSON corrupto, parcial, con tipos
 * inválidos) y devuelve un `ChatSettings` completo. Los campos válidos se
 * conservan; los ausentes o basura toman el default. Nunca lanza.
 */
export function sanitizeChatSettings(raw: unknown): ChatSettings {
  const fallback = defaultChatSettings();
  if (typeof raw !== 'object' || raw === null) {
    return fallback;
  }
  const record = raw as Record<string, unknown>;
  return {
    showAvailable:
      typeof record.showAvailable === 'boolean' ? record.showAvailable : fallback.showAvailable,
  };
}

/**
 * Coacciona un valor desconocido a un entero ≥ 0: acepta el `fallback` si el
 * valor no es un número finito y trunca los fraccionales.
 */
function toCount(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
}

/**
 * Merge defensivo de datos guardados: acepta cualquier valor crudo (JSON
 * corrupto, parcial, con tipos inválidos) y devuelve un `SaveData` completo.
 * Los campos válidos se conservan (merge); los ausentes o basura toman el
 * default. Nunca lanza.
 */
export function sanitizeSaveData(raw: unknown): SaveData {
  const fallback = defaultSaveData();
  if (typeof raw !== 'object' || raw === null) {
    return fallback;
  }
  const record = raw as Record<string, unknown>;
  return {
    totalCoins: toCount(record.totalCoins, fallback.totalCoins),
    bestScore: toCount(record.bestScore, fallback.bestScore),
    bestDistance: toCount(record.bestDistance, fallback.bestDistance),
  };
}

/**
 * Aplica el resultado de una carrera sobre un `SaveData` (puro): suma las
 * monedas, sube los récords por máximo y marca si hubo nuevo récord de
 * puntaje (comparación estricta: empatar conserva el récord anterior).
 */
export function applyRaceResult(
  save: SaveData,
  race: RaceSummary,
): { save: SaveData; isNewBest: boolean } {
  const clean: RaceSummary = {
    score: toCount(race.score, 0),
    distance: toCount(race.distance, 0),
    coins: toCount(race.coins, 0),
  };
  const isNewBest = clean.score > save.bestScore;
  return {
    isNewBest,
    save: {
      totalCoins: save.totalCoins + clean.coins,
      bestScore: Math.max(save.bestScore, clean.score),
      bestDistance: Math.max(save.bestDistance, clean.distance),
    },
  };
}

/**
 * Parseo defensivo del payload GameScene → GameOverScene. Phaser propaga el
 * init data de escena como `unknown` (puede faltar si la escena se arranca
 * en caliente): los campos faltantes o inválidos toman defaults.
 */
export function parseGameOverData(raw: unknown): GameOverData {
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    score: toCount(record.score, 0),
    distance: toCount(record.distance, 0),
    coins: toCount(record.coins, 0),
    isNewBest: typeof record.isNewBest === 'boolean' ? record.isNewBest : false,
  };
}
