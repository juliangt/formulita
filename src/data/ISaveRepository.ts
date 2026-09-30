/**
 * ISaveRepository — contrato de persistencia del progreso (Fase 5).
 *
 * Inversión de dependencias (plan §SOLID): escenas y pantallas dependen de
 * ESTA interfaz, no de localStorage. Hoy la implementa
 * `LocalStorageSaveRepository`; el scoreboard HTTP futuro implementaría la
 * misma interfaz (`HttpScoreboardRepository`) sin refactor del juego.
 */

import type { SaveData } from './types';

export interface ISaveRepository {
  /**
   * Lee el progreso persistido. Si no hay datos válidos devuelve defaults.
   * Nunca lanza (el storage puede estar corrupto, bloqueado o ausente).
   */
  load(): SaveData;

  /**
   * Persiste el progreso completo. El merge con lo previo lo resuelve el
   * llamador (p. ej. `applyRaceResult`); acá se guarda el estado resultante.
   * Nunca lanza.
   */
  save(data: SaveData): void;
}

/**
 * Clave del repositorio como servicio de larga vida en el registry de
 * Phaser (`game.registry`): se inyecta una vez en Boot y todas las escenas
 * lo consumen. Para enchufar otro backend basta un
 * `game.registry.set(SAVE_REPOSITORY_REGISTRY_KEY, repo)` antes de Boot.
 */
export const SAVE_REPOSITORY_REGISTRY_KEY = 'saveRepository';

/**
 * Porción mínima del registry de Phaser que las escenas consumen
 * (`Phaser.Data.DataManager` la satisface estructuralmente): así el helper
 * de resolución queda testeable sin runtime de Phaser.
 */
export interface RegistryLike {
  get(key: string): unknown;
  set(key: string, value: unknown): unknown;
}
