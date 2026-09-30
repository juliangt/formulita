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
  /* Marcador de puntaje y contador de monedas (Fase 5): en las esquinas del
   * borde superior, dejando el centro para velocímetro/barra/chip. */
  /** X del puntaje (el texto ancla por su borde izquierdo). */
  scoreX: 64,
  /** Y del puntaje (centro del texto). */
  scoreY: 64,
  /** X de las monedas (el texto ancla por su borde derecho). */
  coinsX: 656,
  /** Y de las monedas (centro del texto). */
  coinsY: 64,
  /** Tamaño de fuente del marcador de puntaje y de las monedas (px). */
  scoreFontSize: 26,
} as const;

/* ------------------------------------------------------------------ */
/* Pantallas — menú y game over (Fase 5)                               */
/* ------------------------------------------------------------------ */

/** Layout de MenuScene sobre el lienzo 720×1280 (de arriba hacia abajo). */
export const MENU = {
  /** Velocidad de scroll de la pista de fondo (px/s). */
  roadScrollSpeed: 90,
  /** Opacidad del velo oscuro sobre la pista de fondo (0–1). */
  veilAlpha: 0.62,
  /** Y del título (centro). */
  titleY: 240,
  /** Y del subtítulo (centro). */
  subtitleY: 335,
  /** Y del auto decorativo (centro) y su escala. */
  carY: 520,
  carScale: 2.5,
  /** Y de la línea de récord (centro). */
  recordY: 742,
  /** Y de la línea de monedas (centro). */
  coinsY: 812,
  /** Botón JUGAR: centro Y, tamaño y fuente de la etiqueta. */
  playY: 980,
  playWidth: 400,
  playHeight: 120,
  playFontSize: 52,
  /** Y del centro del bloque de ayuda de controles. */
  helpY: 1160,
  /** Separación vertical entre líneas de ayuda (px). */
  helpLineHeight: 34,
  /** Tamaño de fuente de las líneas de récord/monedas (px). */
  statFontSize: 34,
} as const;

/** Layout de GameOverScene sobre el lienzo 720×1280 (de arriba hacia abajo). */
export const GAME_OVER = {
  /** Y del título GAME OVER (centro). */
  titleY: 210,
  /** Y del cartel ¡NUEVO RÉCORD! (centro). */
  newRecordY: 318,
  /** Y de las líneas de puntaje, distancia y monedas de la carrera. */
  scoreY: 450,
  distanceY: 535,
  coinsY: 620,
  /** Y de la línea de récord histórico (centro). */
  recordY: 726,
  /** Botones REINTENTAR y MENÚ: centro Y, tamaño y fuente compartida. */
  retryY: 900,
  menuY: 1044,
  buttonWidth: 380,
  buttonHeight: 104,
  buttonFontSize: 40,
  /** Tamaño de fuente de las líneas de estadísticas (px). */
  statFontSize: 36,
  /** Y de la ayuda de teclado (solo desktop). */
  hintY: 1180,
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
/* Puntaje — Fase 5                                                    */
/* ------------------------------------------------------------------ */

/**
 * Bonus por velocidad sostenida (ScoreSystem): mientras la velocidad
 * efectiva se mantiene sobre `SCORE_BONUS_SPEED_FRACTION × MAX_SPEED`
 * durante al menos `SCORE_BONUS_WARMUP_SECONDS`, se suman
 * `SCORE_BONUS_PER_SECOND` puntos por segundo, prorrateados por frame.
 * Bajar del umbral corta la racha: hay que volver a sostener la velocidad.
 */
export const SCORE_BONUS_SPEED_FRACTION = 0.9;

/** Segundos sostenidos sobre el umbral antes de que el bonus empiece a pagar. */
export const SCORE_BONUS_WARMUP_SECONDS = 1;

/** Puntos por segundo del bonus, una vez vencido el warmup. */
export const SCORE_BONUS_PER_SECOND = 20;

/**
 * Conversión estética de distancia a metros para la pantalla de Game Over
 * (10 px = 1 m).
 */
export const DISTANCE_METERS_PER_PIXEL = 0.1;

/**
 * Demora de la transición Game → GameOver tras el crash (ms): deja ver la
 * explosión y el shake antes del corte a la pantalla de resultados.
 */
export const GAMEOVER_TRANSITION_MS = 650;

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
 * Entidades de pista y generación procedural (Fase 4). El ritmo de spawn
 * depende de la velocidad actual (más rápido = más frecuente) y de la
 * densidad marcada por DifficultySystem; el SpawnScheduler garantiza
 * siempre al menos un carril libre (pasabilidad).
 */
export const SPAWN = {
  /** Cantidad de carriles dentro del asfalto. */
  laneCount: 4,
  /** Y donde nacen las entidades (fuera de pantalla, arriba). */
  spawnY: -96,
  /** Y donde las entidades se reciclan al pool (fuera de pantalla, abajo). */
  despawnY: 1376, // GAME_HEIGHT (1280) + margen
  /** Monedas por línea (mínimo y máximo). */
  coinLineMin: 5,
  coinLineMax: 8,
  /** Separación vertical entre monedas consecutivas (px). */
  coinGap: 110,
  /** Escalonado vertical entre obstáculos de una misma oleada (px). */
  waveGap: 150,
  /** Separación vertical entre rivales de un slalom (px). */
  slalomGap: 300,
  /** Cierre mínimo (px/s) de un rival aunque el jugador frene a fondo. */
  rivalMinClosing: 40,
  /** Intervalo base entre oleadas, a velocidad de referencia (s). */
  baseWaveInterval: 1.2,
  /** Piso del intervalo entre oleadas (punta de velocidad + dificultad). */
  minWaveInterval: 0.5,
  /** Demora de la primera oleada tras arrancar la carrera (s). */
  initialWaveDelay: 1.1,
  /** Probabilidad de que una oleada incluya un pickup (0–1). */
  pickupChance: 0.16,
} as const;

/** Comportamiento de cambio de carril de los rivales. */
export const RIVAL = {
  /** Solo cambian de carril por encima de esta Y (lejos del jugador). */
  laneChangeMaxY: 360,
  /** Enfriamiento entre cambios de carril, en segundos (mín./máx.). */
  laneChangeCooldownMin: 1.4,
  laneChangeCooldownMax: 2.8,
  /** Velocidad lateral del cambio de carril (px/s). */
  laneChangeSpeed: 190,
} as const;

/** Duración del derrape al pisar aceite (s). */
export const OIL_SLIP_SECONDS = 0.8;

/**
 * Límites de pool por familia de entidad: el juego crea como máximo estas
 * instancias por escena y las recicla (sin fugas en sesiones largas).
 */
export const ENTITY_POOL_LIMITS = {
  rival: 10,
  coin: 44,
  hazard: 14,
  pickup: 4,
} as const;

/** Rampa de dificultad por distancia recorrida (px). */
export const DIFFICULTY = {
  /** Distancia a la que se alcanza la dificultad máxima. */
  maxDistance: 75000,
  /** Velocidad extra de los rivales al llegar al tope (×1 → ×1+bonus). */
  rivalSpeedBonus: 0.35,
  /** Densidad de spawn al llegar al tope (el intervalo se divide por esto). */
  spawnDensityMax: 2.2,
  /** Cantidad de niveles de variedad de patrones. */
  maxPatternLevel: 3,
} as const;

/** X del centro de un carril del asfalto (índice 0 = izquierda). */
export function laneCenterX(index: number, laneCount: number = SPAWN.laneCount): number {
  const roadWidth = TRACK.roadRight - TRACK.roadLeft;
  const laneWidth = roadWidth / laneCount;
  return TRACK.roadLeft + laneWidth * (index + 0.5);
}

/** Índice del carril más cercano a una X (clampeado a [0, laneCount-1]). */
export function laneIndexAtX(x: number, laneCount: number = SPAWN.laneCount): number {
  const roadWidth = TRACK.roadRight - TRACK.roadLeft;
  const laneWidth = roadWidth / laneCount;
  const index = Math.floor((x - TRACK.roadLeft) / laneWidth);
  return Math.min(Math.max(index, 0), laneCount - 1);
}

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

/* ------------------------------------------------------------------ */
/* Audio sintético (Fase 6)                                            */
/* ------------------------------------------------------------------ */

/**
 * Parámetros del audio sintético (Web Audio pura, sin assets). El dron del
 * motor mapea linealmente la velocidad de la carrera de `engineFreqMin` (a
 * velocidad mínima) a `engineFreqMax` (a punta combinada turbo × DRS); con
 * el turbo activo la frecuencia se realza además por `engineTurboBoost`.
 */
export const AUDIO = {
  /** Volumen del dron del motor (ganancia pico, 0–1). */
  engineVolume: 0.055,
  /** Frecuencia del dron a velocidad mínima (Hz). */
  engineFreqMin: 55,
  /** Frecuencia del dron a velocidad punta combinada (Hz). */
  engineFreqMax: 235,
  /** Realce de frecuencia del dron con turbo activo (×1 = sin realce). */
  engineTurboBoost: 1.14,
} as const;

/** Layout del botón de mute (Fase 6): menú (esquina) y carrera (abajo-centro). */
export const MUTE_BUTTON = {
  /** Lado del botón cuadrado (px). */
  size: 76,
  /** Margen desde el borde en el menú (esquina superior derecha). */
  margin: 44,
  /** Profundidad en GameScene: sobre el HUD, bajo el HUD táctil. */
  gameDepth: 45,
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
