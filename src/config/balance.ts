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
/* SpeedSystem (Fase 3)                                                */
/* ------------------------------------------------------------------ */

/**
 * Aceleración con el acelerador (px/s²): de `BASE_SPEED` a `MAX_SPEED`
 * en ≈ 1.2 s de acelerador sostenido.
 */
export const SPEED_ACCELERATION = 100;

/** Desaceleración con el freno (px/s²): más brusca que acelerar. */
export const SPEED_BRAKE_DECELERATION = 260;

/**
 * Arrastre al soltar todo (px/s²): sin acelerador ni freno la velocidad
 * vuelve sola hacia `BASE_SPEED` (la base es autónoma).
 */
export const SPEED_COAST_DRAG = 60;

/**
 * Conversión estética del velocímetro: km/h mostrados por cada px/s reales.
 * Calibrada para que la punta combinada (MAX × turbo × DRS = 840 px/s)
 * marque ≈ 336 km/h, típico de una F1.
 */
export const SPEEDOMETER_KMH_PER_PX = 0.4;

/* ------------------------------------------------------------------ */
/* HUD de carrera (Fase 3)                                             */
/* ------------------------------------------------------------------ */

/**
 * Layout del HUD superior de la Fase 3 (velocímetro, barra de turbo y chip
 * DRS) sobre un lienzo de 720×1280. Columna centrada en el borde superior:
 * los pulgares quedan libres para el TOUCH_HUD inferior (depth 50).
 */
export const RACE_HUD = {
  /** Profundidad del HUD (encima del auto, debajo de los botones táctiles). */
  depth: 40,
  /** Y del velocímetro numérico (centro del texto). */
  speedometerY: 64,
  /** Tamaño de la barra de turbo. */
  turboBarWidth: 320,
  turboBarHeight: 24,
  /** Y de la barra de turbo (centro). */
  turboBarY: 112,
  /** Tamaño del chip de DRS. */
  drsChipWidth: 180,
  drsChipHeight: 48,
  /** Y del chip de DRS (centro). */
  drsChipY: 158,
} as const;

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

/* ------------------------------------------------------------------ */
/* HUD táctil (Fase 2)                                                 */
/* ------------------------------------------------------------------ */

/**
 * Layout y feedback visual de los botones táctiles (TouchSource).
 * Dos clusters en el borde inferior: ◀ ▶ abajo-izquierda y GAS / BRK /
 * TURBO / DRS en grilla 2×2 abajo-derecha (el acelerador en la esquina,
 * donde llega el pulgar derecho).
 */
export const TOUCH_HUD = {
  /** Lado de cada botón (px). */
  buttonSize: 116,
  /** Separación entre botones (px). */
  gap: 20,
  /** Margen horizontal de los clusters (px). */
  marginX: 44,
  /** Margen inferior de la fila de abajo (px). */
  marginBottom: 44,
  /** Margen extra del hit-test (px): los dedos son imprecisos. */
  hitPadding: 12,
  /** Profundidad del HUD (por encima del auto, depth 10). */
  depth: 50,
  /** Alfa en reposo (HUD translúcido). */
  baseAlpha: 0.55,
  /** Alfa presionado (feedback de presión). */
  pressedAlpha: 0.95,
  /** Escala presionada (feedback de presión). */
  pressedScale: 0.9,
  /** Tamaño de fuente de las etiquetas de texto (px). */
  labelFontSize: 30,
} as const;

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
