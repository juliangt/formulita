/**
 * balance.ts — constantes de gameplay del juego.
 *
 * Todos los números de gameplay viven acá (PLAN_DESARROLLO.md §Valores
 * iniciales de balance): son ajustables sin tocar lógica. Las fases 3+
 * (SpeedSystem, TurboSystem, DrsSystem, ScoreSystem) consumen estas
 * constantes; la Fase 1 usa velocidad base, jugador y pista.
 */

/* ------------------------------------------------------------------ */
/* Velocidades de avance (px/s)                                        */
/* ------------------------------------------------------------------ */

/**
 * Velocidad base de la carrera.
 * Fase 1: fija, define el scroll de la pista. Fase 3: punto de partida del
 * SpeedSystem (el acelerador sube hasta `MAX_SPEED`, el freno baja hasta
 * `MIN_SPEED`).
 */
export const BASE_SPEED = 300;

/** Velocidad máxima base (sin turbo/DRS). */
export const MAX_SPEED = 420;

/** Velocidad mínima (frenando a fondo). */
export const MIN_SPEED = 160;

/* ------------------------------------------------------------------ */
/* Turbo                                                               */
/* ------------------------------------------------------------------ */

/** Nivel máximo del medidor de turbo. */
export const TURBO_MAX = 100;

/** Multiplicador de velocidad máxima con turbo activo. */
export const TURBO_MULTIPLIER = 1.6;

/** Drenaje de turbo por segundo (~3.5 s de uso total). */
export const TURBO_DRAIN_PER_SECOND = 28;

/** Recarga pasiva de turbo por segundo. */
export const TURBO_REGEN_PER_SECOND = 4;

/** Recarga otorgada por el pickup de turbo (+50 medidor). */
export const TURBO_PICKUP_REFILL = 50;

/* ------------------------------------------------------------------ */
/* DRS                                                                 */
/* ------------------------------------------------------------------ */

/** Multiplicador de velocidad punta con DRS activo. */
export const DRS_MULTIPLIER = 1.25;

/** Duración del DRS activo, en segundos. */
export const DRS_DURATION_SECONDS = 3;

/** Cooldown del DRS tras desactivarse, en segundos. */
export const DRS_COOLDOWN_SECONDS = 8;

/**
 * Umbral de activación del DRS: fracción de `MAX_SPEED` que debe superarse
 * (> 75% de velocidad, rectas).
 */
export const DRS_SPEED_THRESHOLD = 0.75;

/* ------------------------------------------------------------------ */
/* Monedas y puntaje                                                   */
/* ------------------------------------------------------------------ */

/** Monedas otorgadas por cada moneda recolectada. */
export const COIN_VALUE = 1;

/** Puntos otorgados por cada moneda recolectada. */
export const COIN_SCORE = 50;

/** Puntos por segundo a velocidad base (puntaje por distancia). */
export const SCORE_PER_SECOND_AT_BASE_SPEED = 10;

/* ------------------------------------------------------------------ */
/* Jugador (Fase 1)                                                    */
/* ------------------------------------------------------------------ */

/** Aceleración lateral al doblar (px/s²). */
export const PLAYER_LATERAL_ACCELERATION = 2600;

/** Fricción lateral cuando no hay input (px/s² de desaceleración). */
export const PLAYER_LATERAL_DRAG = 2400;

/** Velocidad lateral máxima (px/s). */
export const PLAYER_MAX_LATERAL_SPEED = 520;

/** Inclinación visual máxima al doblar (grados). */
export const PLAYER_TILT_MAX_DEGREES = 10;

/** Posición vertical inicial del auto (centro, en px). */
export const PLAYER_START_Y = 1020;

/* ------------------------------------------------------------------ */
/* Pista (Fase 1)                                                      */
/* ------------------------------------------------------------------ */

/**
 * Layout horizontal de la pista, de afuera hacia adentro:
 * barrera (barrierWidth) → kerb/rumble (kerbWidth) → asfalto jugable.
 * Symétrico: roadRight = width - roadLeft.
 */
export const TRACK = {
  /** Ancho total de la pista (= ancho del juego). */
  width: 720,
  /** Ancho de cada barrera lateral. */
  barrierWidth: 40,
  /** Ancho de cada banda de rumble (kerb rojo/blanco). */
  kerbWidth: 36,
  /** X del borde interno del kerb izquierdo (inicio del asfalto). */
  roadLeft: 76,
  /** X del borde interno del kerb derecho (fin del asfalto). */
  roadRight: 644,
  /** Alto del tile de pista (debe dividir a GAME_HEIGHT para tiling limpio). */
  tileHeight: 256,
} as const;
