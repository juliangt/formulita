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
export const BASE_SPEED = 360;

/** Velocidad máxima base (sin turbo/DRS). */
export const MAX_SPEED = 504;

/** Velocidad mínima (frenando a fondo). */
export const MIN_SPEED = 190;

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
 * en ≈ 1.25 s de acelerador sostenido.
 */
export const SPEED_ACCELERATION = 120;

/** Desaceleración con el freno (px/s²): más brusca que acelerar. */
export const SPEED_BRAKE_DECELERATION = 260;

/**
 * Arrastre al soltar todo (px/s²): sin acelerador ni freno la velocidad
 * vuelve sola hacia `BASE_SPEED` (la base es autónoma).
 */
export const SPEED_COAST_DRAG = 60;

/**
 * Conversión estética del velocímetro: km/h mostrados por cada px/s reales.
 * Calibrada para que la punta combinada (MAX × turbo × DRS = 1008 px/s)
 * marque ≈ 363 km/h, típico de una F1.
 */
export const SPEEDOMETER_KMH_PER_PX = 0.36;

/* ------------------------------------------------------------------ */
/* Salud del vehículo (issue #10, H1)                                  */
/* ------------------------------------------------------------------ */

/**
 * Salud del vehículo: daño gradual por choques (rival/piedra) y roce con
 * pared, i-frames post-impacto y botiquín de reparación. La muerte ya no es
 * instantánea por contacto: el HP llega a 0. Los consumidores (GameScene,
 * HUD) llegan en fases H2+; H1 solo define la mecánica pura y el balance.
 */
export const HEALTH = {
  /** HP máximo (y valor de arranque de cada carrera). */
  max: 100,
  /** Daño de un impacto puntual, por tipo de colisión. */
  impactDamage: {
    /** Choque contra un vehículo rival. */
    rival: 35,
    /** Impacto contra una piedra (debris). */
    debris: 20,
  },
  /** Daño continuo por roce con pared (HP/s, sin i-frames). */
  scrapePerSecond: 15,
  /** Invulnerabilidad tras un impacto (s): bloquea daños puntual repetidos. */
  invulnerabilitySeconds: 0.6,
  /** HP reparado por el botiquín (tope `max`). */
  repairAmount: 35,
  /** Fracción de HP por debajo de la cual el auto está en estado crítico. */
  criticalRatio: 0.25,
  /** Pérdida de velocidad al recibir un impacto (px/s). */
  impactSpeedLoss: 150,
} as const;

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
  /* Salud del vehículo (issue #10, H1): la barra va debajo del chip DRS
   * (que termina en y ≈ 182), centrada como la barra de turbo y el chip. */
  /** Tamaño de la barra de salud. */
  healthBarWidth: 320,
  healthBarHeight: 24,
  /** Y de la barra de salud (centro). */
  healthBarY: 212,
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
  /* Botón de pausa (Fase 7): debajo del puntaje, alineado a la altura del
   * chip DRS. Zona libre: la barra de turbo arranca en x≈196 y el botón
   * termina en x≈104. La profundidad es la del botón de mute (MUTE_BUTTON
   * .gameDepth): sobre el HUD, bajo el HUD táctil. */
  /** X del centro del botón de pausa. */
  pauseX: 64,
  /** Y del centro del botón de pausa. */
  pauseY: 158,
  /** Tamaño del botón de pausa (cuadrado). */
  pauseButtonSize: 72,
  /** Tamaño de fuente de la etiqueta del botón de pausa (px). */
  pauseButtonFontSize: 30,
} as const;

/* ------------------------------------------------------------------ */
/* Pantallas — menú y game over (Fase 5)                               */
/* ------------------------------------------------------------------ */

/**
 * Layout de MenuScene sobre el lienzo 720×1280 (de arriba hacia abajo).
 *
 * M1 — multijugador: se agregó el botón MULTIJUGADOR debajo de JUGAR y el
 * bloque se reacomodó (título/auto/estadísticas más arriba) para que ambos
 * botones + la ayuda quepan sin tocarse.
 *
 * V1 (issue #9): se agregó el botón ENTRENAR (RaceScene local) entre JUGAR y
 * MULTIJUGADOR y el bloque inferior volvió a reacomodarse: los tres botones
 * grandes bajaron de 118 a 96/88 px de alto y la ayuda compactó su interlineado
 * para que todo siga quepa en el lienzo sin tocarse.
 */
export const MENU = {
  /** Velocidad de scroll de la pista de fondo (px/s). */
  roadScrollSpeed: 90,
  /** Opacidad del velo oscuro sobre la pista de fondo (0–1). */
  veilAlpha: 0.62,
  /** Y del título (centro). */
  titleY: 220,
  /** Y del subtítulo (centro). */
  subtitleY: 308,
  /** Y del auto decorativo (centro) y su escala. */
  carY: 452,
  carScale: 2.5,
  /** Y de la línea de récord (centro). */
  recordY: 646,
  /** Y de la línea de monedas (centro). */
  coinsY: 714,
  /** Botón JUGAR: centro Y, tamaño y fuente de la etiqueta. */
  playY: 840,
  playWidth: 400,
  playHeight: 104,
  playFontSize: 52,
  /* V1 (issue #9) — botón ENTRENAR: debajo de JUGAR, mismo ancho, abre el
   * selector de pistas (overlay) y lanza RaceScene en modo práctica. */
  /** Centro Y del botón ENTRENAR. */
  trainY: 948,
  /** Ancho/alto del botón ENTRENAR (mismo ancho que JUGAR). */
  trainWidth: 400,
  trainHeight: 88,
  /** Tamaño de fuente de la etiqueta ENTRENAR (px). */
  trainFontSize: 40,
  /* M1 — botón MULTIJUGADOR: debajo de ENTRENAR, mismo ancho (13 caracteres
   * de monospace tienen que entrar en 400 px). */
  /** Centro Y del botón MULTIJUGADOR. */
  multiY: 1056,
  /** Ancho/alto del botón MULTIJUGADOR (mismo ancho que JUGAR/ENTRENAR). */
  multiWidth: 400,
  multiHeight: 88,
  /** Tamaño de fuente de la etiqueta MULTIJUGADOR (px). */
  multiFontSize: 40,
  /* C2 (issue #2) — botón CHAT: debajo de MULTIJUGADOR, mismo ancho; abre el
   * overlay con la tab PÚBLICO (el chat social vive también en el menú). El
   * bloque de ayuda compactó su interlineado para hacerle sitio (helpY
   * 1204 → 1220, helpLineHeight 34 → 30). */
  /** Centro Y del botón CHAT del menú. */
  chatY: 1136,
  /** Ancho/alto del botón CHAT (mismo ancho que JUGAR/ENTRENAR/MULTIJUGADOR). */
  chatWidth: 400,
  chatHeight: 64,
  /** Tamaño de fuente de la etiqueta CHAT (px). */
  chatFontSize: 34,
  /** Y del centro del bloque de ayuda de controles. */
  helpY: 1220,
  /** Separación vertical entre líneas de ayuda (px). */
  helpLineHeight: 30,
  /** Tamaño de fuente de las líneas de récord/monedas (px). */
  statFontSize: 34,
  /* Botón FULLSCREEN (Fase 7, solo desktop): esquina superior izquierda,
   * espejo del botón de mute (que usa MUTE_BUTTON.margin). Libre: el título
   * arranca en y≈192 y el botón termina en y≈120. */
  /** Margen del botón fullscreen desde el borde. */
  fullscreenMargin: 44,
  /** Ancho del botón fullscreen. */
  fullscreenWidth: 300,
  /** Alto del botón fullscreen. */
  fullscreenHeight: 72,
  /** Tamaño de fuente de la etiqueta fullscreen (px). */
  fullscreenFontSize: 22,
} as const;

/**
 * Layout de GameOverScene sobre el lienzo 720×1280 (de arriba hacia abajo).
 *
 * V1 (issue #9): la rama de resultados de carrera (ENTRENAR) reutiliza las
 * mismas posiciones: el título pasa a RESULTADOS, la línea del cartel muestra
 * la pista y las tres líneas de estadísticas muestran tiempo total, mejor
 * vuelta y vueltas completadas.
 */
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

/* ------------------------------------------------------------------ */
/* Carrera en circuito (issue #9, V0 — núcleo puro)                    */
/* ------------------------------------------------------------------ */

/**
 * Física arcade de conducción sobre circuito cerrado (issue #9). Consume
 * `race/circuitPhysics.ts`; las pistas de `race/tracks.ts` se validan contra
 * `referenceSpeed`/`turnRate*` (radio de curvatura mínimo alcanzable) y contra
 * la banda de duración de vuelta.
 *
 * Convención del input (auto-acelerado): el acelerador viene PISADO por
 * defecto (ver `defaultCircuitInput`); frenar y girar son acciones explícitas.
 * El giro se mide en rad/s y decae con la velocidad: `turnRateAtSpeed`
 * interpola de `turnRateBase` (parado) a `turnRateAtMaxSpeed` (a punta).
 */
export const CIRCUIT = {
  /** Velocidad máxima en asfalto (px/s). */
  maxSpeed: 300,
  /** Aceleración con el acelerador (px/s²): 0 → maxSpeed en ≈ 1.25 s. */
  acceleration: 240,
  /** Frenada a fondo (px/s²): maxSpeed → 0 en ≈ 0.47 s. */
  brakeDeceleration: 640,
  /** Roce al soltar todo (px/s²): la velocidad decae hacia 0. */
  coastDrag: 130,
  /** Tasa de giro a velocidad 0 (rad/s). */
  turnRateBase: 3.4,
  /** Tasa de giro a velocidad máxima (rad/s): a más velocidad, menos giro. */
  turnRateAtMaxSpeed: 1.2,
  /** Techo de velocidad en pasto, como fracción de `maxSpeed`. */
  grassMaxSpeedFactor: 0.45,
  /**
   * Velocidad de referencia para validar pistas (px/s), ≈ 60% de `maxSpeed`.
   * Es el ritmo medio de vuelta esperado (las curvas y el pasto impiden
   * sostener la punta). Con ella se valida: (a) el radio de curvatura de
   * cada punto de las 5 pistas — debe permitir sostener la curva a esta
   * velocidad con la tasa de giro disponible — y (b) la longitud de vuelta
   * contra la banda 36–44 s (objetivo 40 s ⇒ pista de ~7200 px).
   */
  referenceSpeed: 180,
  /** Ventanas de sector por vuelta (checkpoints anti-corte). */
  sectorCount: 8,
  /** Vueltas por carrera. */
  totalLaps: 3,
  /** Banda de validación de duración de vuelta (s) a `referenceSpeed`. */
  lapMinSeconds: 36,
  lapMaxSeconds: 44,
  /* Parrilla de salida: 2 columnas escalonadas detrás de la meta. */
  /** Separación en s entre filas consecutivas (px de arco). */
  gridRowStepPx: 70,
  /** Lateral de cada columna respecto del eje (px; ±este valor). */
  gridLateralOffsetPx: 35,
  /** Distancia de la primera fila (pole) detrás de la meta (px de arco). */
  gridStartOffsetPx: 140,
} as const;

/* ------------------------------------------------------------------ */
/* Carrera en circuito (issue #9, V1 — RaceScene local / ENTRENAR)      */
/* ------------------------------------------------------------------ */

/**
 * Presentación de la RaceScene (V1): cámara, HUD de carrera y minimapa sobre
 * el lienzo 720×1280. El gameplay vive en `CIRCUIT`; acá sólo hay layout y
 * feeling de cámara. V2 (multi) reutiliza el mismo bloque.
 */
export const RACE = {
  /* Cámara: sigue al auto con lerp (norte arriba, sin rotación), zoom fijo
   * y clampada al mundo de la pista. El zoom < 1 muestra más contexto del
   * circuito: a 300 px/s la punta cruza la pantalla en ~3 s a zoom 1, y con
   * 0.8 se ve lo suficiente para planificar la curva siguiente. */
  /** Zoom fijo de la cámara (1 = px de mundo 1:1). */
  cameraZoom: 0.8,
  /** Lerp de seguimiento (por frame, interpolación exponencial de Phaser). */
  cameraLerp: 0.14,
  /* HUD de carrera (RaceHud): columna del borde superior izquierdo. El
   * minimapa ocupa la esquina superior derecha, así que el centro queda
   * despejado para ver la pista adelante. */
  /** X del borde izquierdo de los textos del HUD (origen 0). */
  hudX: 24,
  /** Y del badge VUELTA n/N (centro). */
  lapBadgeY: 56,
  /** Y del tiempo de vuelta en curso (centro). */
  lapTimeY: 104,
  /** Y del tiempo total (centro). */
  totalTimeY: 142,
  /** Tamaños de fuente del HUD de carrera (px). */
  lapBadgeFontSize: 34,
  lapTimeFontSize: 30,
  totalTimeFontSize: 22,
  /* Minimapa (MiniMap): cuadrado en la esquina superior derecha. */
  /** Lado del minimapa (px). */
  miniMapSize: 180,
  /** Margen del minimapa desde los bordes superior/derecho (px). */
  miniMapMargin: 20,
  /** Padding interno entre el borde del panel y el contorno (px). */
  miniMapPadding: 12,
  /* Botón de pausa: centrado bajo el minimapa (misma columna), mismo tamaño
   * que el de GameScene (RACE_HUD.pauseButtonSize). */
  /** X del centro del botón de pausa. */
  pauseX: 610,
  /** Y del centro del botón de pausa. */
  pauseY: 268,
  /* V2 (issue #9) — badge de posición en vivo "P3/8": bajo el tiempo total
   * de la columna izquierda del HUD (totalTimeY 142). Sólo visible en modo
   * multi (la práctica nunca lo llama). */
  /** Y del badge de posición (centro). */
  positionBadgeY: 184,
} as const;

/* ------------------------------------------------------------------ */
/* Carrera en circuito multijugador (issue #9, V2)                     */
/* ------------------------------------------------------------------ */

/**
 * Gracia de cierre de la carrera multi (ms): el primer auto en completar las
 * `CIRCUIT.totalLaps` vueltas dispara la condición de ganador (su `rfin` es
 * el primero); la partida termina para TODOS cuando terminaron todos O pasa
 * esta ventana desde ese primer `rfin` — los que no llegaron se clasifican
 * por su último progreso conocido (ver `race/raceRanking.finalClassification`).
 */
export const RACE_FINISH_GRACE_MS = 30000;

/**
 * Presentación y ritmo del modo multi de RaceScene (V2). El netcode comparte
 * STATE_HZ / GHOST_INTERPOLATION_MS / SNAPSHOT_BUFFER_SIZE con la BATALLA.
 */
export const RACE_MULTI = {
  /**
   * Intervalo del ranking vivo (ms): `rankCars` corre cada este tiempo (no
   * por frame — el orden no cambia tan rápido y el badge repinta sólo si
   * cambió el texto). También gobierna el seguimiento de cámara del
   * espectador (quien terminó sigue al líder). El vs CPU (#14) reutiliza el
   * mismo ritmo para su ranking de 2 autos.
   */
  rankIntervalMs: 250,
} as const;

/* ------------------------------------------------------------------ */
/* Gran Premio vs CPU — HUD enriquecido (issue #14, V3)                 */
/* ------------------------------------------------------------------ */

/**
 * Presentación V3 del GRAN PREMIO (issue #14): la columna izquierda del HUD
 * gana el GAP a los rivales de adelante/atrás y el chip de modo/pista/
 * dificultad; la largada y los cambios de posición suenan. La lógica es pura
 * (`race/raceGap`, `race/racePositionSwap`); acá sólo viven los números de
 * layout y feel. Práctica y multi no consumen nada de este bloque (cero
 * cambios de comportamiento).
 */
export const RACE_VS_CPU = {
  /** Techo del |gap| mostrado (s): más lejos se clampea (ya no informa). */
  gapMaxSeconds: 30,
  /** Velocidad propia mínima (px/s) para confiar en el gap en tiempo. */
  gapMinOwnSpeedPx: 30,
  /** Y del texto de gaps (centro), bajo el badge de posición (184). */
  gapY: 222,
  /** Tamaño de fuente del gap (px): discreto, como el tiempo total. */
  gapFontSize: 20,
  /** Y del chip "GRAN PREMIO · MÓNACO · DIFÍCIL" (centro), cierra la columna. */
  infoChipY: 258,
  /** Tamaño de fuente del chip (px). */
  infoChipFontSize: 20,
  /** Tamaño de fuente del nombre sobre los rivales vs CPU (px; multi usa 20). */
  rivalNameFontSize: 24,
  /** Enfriamiento del SFX de cambio de posición (ms): máximo 1 por cambio. */
  positionSfxCooldownMs: 2000,
} as const;

/* ------------------------------------------------------------------ */
/* Gran Premio vs CPU (issue #14, V0)                                  */
/* ------------------------------------------------------------------ */

/**
 * Rivales CPU del GRAN PREMIO (issue #14). V0 era un "piloto de pruebas" que
 * seguía el EJE a velocidad fija; V1 es un piloto real: sigue la LÍNEA DE
 * CARRERA (`race/ai/racingLine.ts`) con frenada por curvatura lookahead y
 * personalidades propias (`race/ai/rivalRoster.ts`). V2 son TRES
 * DIFICULTADES CON CARÁCTER: cada dificultad es un preset data-driven de 6
 * parámetros (tabla del issue) que la personalidad del rival desvía hacia
 * adentro — mismo orden de ritmo y de "humanness" garantizado por preset.
 *
 * Los presets viven acá (ajustables sin tocar lógica); las constantes
 * puramente geométricas de la línea (paso de muestreo, ventanas de
 * suavizado, margen al borde) viven en el propio módulo `racingLine`.
 */
export const RACE_AI = {
  /* --- Presets por dificultad (V2, tabla del issue #14) ---------------- */

  /**
   * speedPct — techo de velocidad en RECTA como fracción de
   * `CIRCUIT.maxSpeed`. En curva manda el `targetSpeed` de la línea (siempre
   * menor): el cap sólo recorta las rectas, así que la dificultad marca el
   * ritmo general sin impedir que el CPU sostenga las curvas.
   */
  targetSpeedFraction: {
    easy: 0.78,
    normal: 0.88,
    hard: 0.97,
  },
  /**
   * lineQuality — cuán pegado va al ritmo de la LÍNEA: escala sobre su
   * `targetSpeed` por punto. La línea ya trae un factor de seguridad (0.9)
   * sobre la velocidad físicamente sostenible de cada curva; 1.0 sería "al
   * límite de la línea" (el preset de DIFÍCIL) y los presets más lentos
   * dejan margen para que un exceso lo castigue el pasto.
   */
  lineSpeedScale: {
    easy: 0.84,
    normal: 0.9,
    hard: 0.97,
  },
  /**
   * Media (segundos) entre ERRORES HUMANOS del rival (proceso de Poisson
   * con el RNG propio de cada rival): en FÁCIL el error es notorio, en
   * DIFÍCIL es raro. ≤ 0 desactiva los errores.
   */
  mistakeEverySec: {
    easy: 9,
    normal: 16,
    hard: 30,
  },
  /**
   * Desvío lateral (px) del error humano: cuánto se va el auto de SU
   * trazada durante el fallo (el aim queda siempre clampeado al asfalto:
   * el error cuesta tiempo, no tira al rival al pasto).
   */
  mistakeMagPx: {
    easy: 45,
    normal: 26,
    hard: 12,
  },
  /**
   * aggression — base de agresividad (0–1) por dificultad: cuánto BUSCA el
   * hueco para adelantar (y cuánto recorta su margen de frenada). La
   * personalidad del rival desvía esta base ±`aggressionSpread`.
   */
  aggression: {
    easy: 0.25,
    normal: 0.5,
    hard: 0.75,
  },
  /**
   * rubberBandPct — goma: ± fracción sobre el ritmo GLOBAL del rival según
   * su distancia de progreso al JUGADOR (lejos detrás del jugador acelera
   * hasta esto, lejos adelante frena hasta esto), dentro del preset y
   * NUNCA por encima del techo físico. FÁCIL más elástico, DIFÍCIL casi
   * rígido.
   */
  rubberBandPct: {
    easy: 0.06,
    normal: 0.03,
    hard: 0.01,
  },

  /* --- Parámetros comunes (todas las dificultades) --------------------- */

  /** Distancia del punto de mira sobre la línea (px de arco). */
  lookAheadPx: 120,
  /** Zona muerta del error angular (rad): debajo, volante recto. */
  steerDeadzoneRad: 0.06,
  /**
   * Margen de frenada (px/s): el driver sólo pisa el freno cuando su
   * velocidad supera la permitida por la curva venidera en MÁS que esto
   * (debajo del margen regula soltando el acelerador — evita frenadas
   * nerviosas de bang-bang longitudinal).
   */
  brakeMarginSpeedPx: 10,
  /** Rivales CPU del GRAN PREMIO (V1): parrilla de 8 con el jugador. */
  rivalCount: 7,
  /** Desvío personal ± de velocidad (fracción sobre AMBOS presets). */
  speedPctSpread: 0.05,
  /** Desvío personal ± del offset lateral propio sobre la línea (px). */
  lineOffsetSpreadPx: 10,
  /**
   * Cuánto recorta la agresividad el margen de frenada (0 = nada, 1 =
   * margen × (1 − gain)): los agresivos frenan más tarde.
   */
  aggressionBrakeGain: 0.6,
  /**
   * Desvío ± de la personalidad sobre la base de `aggression` del preset:
   * agresividad efectiva = base + (roll − ½) × 2 × esto, clampeada a 0–1.
   */
  aggressionSpread: 0.3,

  /* --- Errores humanos (V2) -------------------------------------------- */

  /** Duración del fallo (ms): pasa y el driver vuelve solo a su ritmo. */
  mistakeMs: 500,
  /**
   * Sobre-velocidad del error de frenada tardía: durante el fallo el
   * objetivo longitudinal se multiplica por esto (frena MÁS TARDE), con
   * techo físico `CIRCUIT.maxSpeed`.
   */
  mistakeSpeedOvershoot: 1.3,
  /** Probabilidad de que un error sea de DESVÍO lateral (vs frenada). */
  mistakeLateralChance: 0.5,

  /* --- Adelantamiento (V2) ---------------------------------------------- */

  /** Ventana de detección del auto de adelante (px de progreso). */
  overtakeGapPx: 240,
  /**
   * Diferencia de velocidad mínima (px/s) para INICIAR la maniobra: no
   * desvía su trazada por un auto que no está cerrando.
   */
  overtakeClosingPx: 10,
  /** Desvío lateral hacia el hueco elegido (px sobre SU trazada). */
  overtakeSidePx: 34,
  /** Velocidad del desvío lateral (px/s): ida y retorno suaves. */
  overtakeLateralSpeedPx: 170,
  /**
   * Probabilidad MÍNIMA de intentar una maniobra (con agresividad 0):
   * intenta con `base + (1 − base) × agresividad`; con RNG fallado entra a
   * un enfriamiento de `overtakeRetrySec` antes de reintentar.
   */
  overtakeAttemptBase: 0.25,
  /** Enfriamiento (s) tras una maniobra rechazada por el RNG. */
  overtakeRetrySec: 1.5,

  /* --- Rubber-banding (V2) ---------------------------------------------- */

  /**
   * Gap de progreso al jugador (px) al que el ajuste de goma llega a SU
   * tope ±`rubberBandPct` (interpolación lineal entre 0 y este gap).
   */
  rubberBandFullGapPx: 600,
} as const;

/* ------------------------------------------------------------------ */
/* Carrera en circuito — pulido V4 (issue #9)                          */
/* ------------------------------------------------------------------ */

/**
 * Cartel pop "¡VUELTA 2/3!" al completar una vuelta válida (la última no:
 * esa ya muestra el cartel de BANDERA A CUADROS). Mismo lenguaje del
 * countdown: texto gigante centrado en pantalla fija con pop de escala y
 * fade de salida.
 */
export const RACE_LAP_BANNER = {
  /** Tamaño de fuente del cartel (px). */
  fontSize: 72,
  /** Escala inicial del pop (idem countdown). */
  popScale: 1.45,
  /** Duración del pop de escala (ms). */
  popMs: 240,
  /** Tiempo visible a escala 1 antes del fade (ms). */
  holdMs: 700,
  /** Duración del fade de salida (ms). */
  fadeMs: 260,
} as const;

/**
 * Confeti del cruce de la meta FINAL (practice y multi): burst one-shot
 * multicolor sobre el auto (posición del mundo, la cámara lo está siguiendo).
 * Los tintos salen de la paleta de la sala (`MULTIPLAYER.palette`): cero
 * colores mágicos nuevos.
 */
export const RACE_CONFETTI = {
  /** Partículas por burst. */
  burstCount: 90,
  /** Vida de cada partícula (ms). */
  lifespanMs: 950,
  /** Velocidad de eyección (px/s). */
  speedMin: 120,
  speedMax: 430,
  /** Abanico de eyección hacia arriba (grados Phaser: 270 = −Y). */
  angleMin: 190,
  angleMax: 350,
  /** Escala inicial de partícula (la textura `particle` mide 4 px). */
  scaleStart: 2.2,
  /** Profundidad: sobre el mundo y el auto, bajo el HUD. */
  depth: 30,
} as const;

/**
 * Línea "VUELTA RÁPIDA: NOMBRE (M:SS.mmm)" del podio de la carrera multi
 * (GameOverScene, rama race-multi). Va entre el subtítulo de pista
 * (`LEADERBOARD.headerY` 384) y la primera fila del podio (448): el hueco de
 * 64 px las separa sin tocarse (fuente 24 px centrada).
 */
export const RACE_FAST_LAP = {
  /** Y del centro de la línea. */
  y: 414,
  /** Tamaño de fuente (px). */
  fontSize: 24,
} as const;

/**
 * Sonido de motor de la carrera en circuito (V4): el dron del AudioManager
 * mapea velocidad → frecuencia sobre el dominio de la BATALLA
 * ([MIN_SPEED, MAX_SPEED] px/s). La velocidad del circuito vive en
 * [0, CIRCUIT.maxSpeed] px/s — un rango distinto — y se NORMALIZA a ese
 * dominio para que el dron barra toda su banda: la fracción
 * speed/maxSpeed del circuito entra como la misma fracción del dominio
 * (`race/raceAudio.raceEngineSpeed`, pura y testeada).
 */

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
 *
 * Tamaño calibrado para pantallas chicas: el canvas escala ~0.54 en un
 * iPhone (720 → 390 CSS px), así que 124 px de juego son ≈ 67 CSS px por
 * botón — cómodo para el pulgar — y el hueco central deja lugar al botón de
 * mute sin que los hit areas se pisen (hitPadding ≤ gap/2).
 */
export const TOUCH_HUD = {
  /** Lado de cada botón (px). */
  buttonSize: 124,
  /** Separación entre botones (px). */
  gap: 24,
  /** Margen horizontal de los clusters (px). */
  marginX: 40,
  /** Margen inferior de la fila de abajo (px). */
  marginBottom: 44,
  /** Margen extra del hit-test (px): los dedos son imprecisos. Debe quedar
   * por debajo de gap/2 para que los hits de botones vecinos no se pisen. */
  hitPadding: 8,
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
 * el turbo activo la frecuencia se realza además por `engineTurboBoost` y
 * el lowpass se abre a `engineFilterTurboHz`.
 *
 * Perfil móvil (issue #4, H4): los parlantes de un celular apenas reproducen
 * por debajo de ~400 Hz, así que el dron desktop (55–235 Hz) puede ser
 * FÍSICAMENTE inaudible en móvil aunque todo el pipeline de audio funcione
 * (en desktop con auriculares/parlantes grandes sí se oye: el síntoma
 * reportado). El perfil móvil sube el dron una octava (entra en la banda que
 * los parlantes chicos sí reproducen), abre el lowpass para dejar pasar los
 * armónicos nuevos y compensa la baja eficiencia del parlante con más
 * ganancia. El mapeo velocidad→frecuencia y el turbo son idénticos en
 * proporción: solo cambia la banda base.
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
  /** Corte del lowpass del dron (Hz); con turbo: `engineFilterTurboHz`. */
  engineFilterHz: 1100,
  /** Corte del lowpass del dron con turbo activo (Hz). */
  engineFilterTurboHz: 2200,

  /* --- Perfil móvil (issue #4, H4) --- */
  /** Volumen del dron en móvil (el parlante chico rinde menos). */
  engineVolumeMobile: 0.085,
  /** Frecuencia del dron en móvil a velocidad mínima (Hz): octava arriba. */
  engineFreqMinMobile: 110,
  /** Frecuencia del dron en móvil a velocidad punta combinada (Hz). */
  engineFreqMaxMobile: 470,
  /** Corte del lowpass del dron en móvil (deja pasar los armónicos nuevos). */
  engineFilterHzMobile: 2200,
  /** Corte del lowpass del dron en móvil con turbo activo (Hz). */
  engineFilterTurboHzMobile: 3600,
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

/* ------------------------------------------------------------------ */
/* Multijugador (M1 — Trystero + lobby)                                */
/* ------------------------------------------------------------------ */

/**
 * Constantes del multijugador online (M1). La palabra clave de la sala ES el
 * roomId de Trystero (`joinRoom({appId}, 'PARRILLA')`): 5–9 letras A-Z la
 * mantienen pronunciable por teléfono y libre de ambigüedad de acentos/Ñ.
 */
export const MULTIPLAYER = {
  /** Capacidad máxima por sala (el 11º es rechazado con `roomFull`). */
  maxPlayers: 10,
  /** Jugadores mínimos para que el anfitrión pueda INICIAR. */
  minPlayersToStart: 2,
  /** Largo máximo del nombre del jugador (sanitizado antes de viajar). */
  maxPlayerNameLength: 12,
  /** Largo mínimo de la palabra de sala (letras). */
  roomWordMinLength: 5,
  /** Largo máximo de la palabra de sala (letras). */
  roomWordMaxLength: 9,
  /**
   * Paleta fija de 10 colores (0xrrggbb), uno por jugador. La asignación es
   * una FUNCIÓN PURA del roster (índice del peer en el roster ordenado por
   * peerId — ver `net/lobbyState.ts`): determinista e idéntica en todos los
   * clientes para un mismo roster, sin negociación. Elegidos para leerse
   * sobre asfalto gris (#3a3a44) con contraste alto entre sí.
   */
  palette: [
    0xd63c3c, // rojo
    0x3c6cd6, // azul
    0x1d8f43, // verde
    0xf7c531, // amarillo
    0xb04ee0, // violeta
    0xf07f2c, // naranja
    0x2cd6c9, // cian
    0xe84c8b, // rosa
    0x9aa5b4, // gris claro
    0x8fce3c, // lima
  ],
} as const;

/** Layout de LobbyScene sobre el lienzo 720×1280 (de arriba hacia abajo). */
export const LOBBY = {
  /** Y del título SALA / UNIRSE (centro). */
  titleY: 130,
  /** Y del subtítulo de modo (centro). */
  subtitleY: 205,
  /** Y del rótulo "PALABRA DE SALA" (centro). */
  wordLabelY: 300,
  /** Y de la palabra gigante / campo de palabra (centro). */
  wordY: 380,
  /** Tamaño de fuente de la palabra gigante (px). */
  wordFontSize: 80,
  /** Y del rótulo del roster ("JUGADORES n/10"). */
  rosterLabelY: 495,
  /** Y de la primera fila del roster; una fila por jugador (hasta 10). */
  rosterStartY: 560,
  rosterLineHeight: 52,
  rosterFontSize: 32,
  /** Indicador cuadrado de color a la izquierda del nombre (px). */
  swatchSize: 30,
  /** Y del mensaje de estado ("ESPERANDO AL ANFITRIÓN…" / errores). */
  statusY: 1078,
  statusFontSize: 28,
  /* Botones lado a lado abajo: SALIR a la izquierda, INICIAR/ENTRAR a la
   * derecha (el primario cerca del pulgar derecho). */
  /** Centro X del botón primario (INICIAR/ENTRAR). */
  primaryX: 540,
  /** Centro X del botón SALIR. */
  exitX: 180,
  /** Centro Y de ambos botones. */
  buttonY: 1180,
  buttonWidth: 300,
  buttonHeight: 104,
  buttonFontSize: 38,
  /** Input DOM de palabra/nombre: ancho/alto en px de juego y fuente. */
  inputWidth: 480,
  inputHeight: 84,
  inputFontSize: 44,
  /* C1 (issue #2) — botón CHAT: esquina superior derecha, encima del título
   * (el título arranca en y≈98 y el botón termina en y≈96: no se tocan). Solo
   * existe DENTRO de la sala (la carrera activa no tiene chat, decisión del
   * issue #2). */
  /** Centro X del botón CHAT. */
  chatButtonX: 600,
  /** Centro Y del botón CHAT. */
  chatButtonY: 64,
  /** Tamaño del botón CHAT. */
  chatButtonWidth: 160,
  chatButtonHeight: 64,
  /** Tamaño de fuente de la etiqueta CHAT (px). */
  chatButtonFontSize: 30,
  /* V2 (issue #9) — fila de MODO del anfitrión (BATALLA / CARRERA + pista),
   * entre la palabra de sala (wordY 380) y el rótulo del roster (495). La
   * fila completa es visible SOLO para el anfitrión; los invitados conocen
   * el modo al recibir el `start` (el lobby no difunde estado, igual que #1). */
  /** Y del centro de la fila de modo (centros de los botones). */
  modeRowY: 444,
  /** Ancho/alto de los chips BATALLA / CARRERA y su fuente. */
  modeChipWidth: 170,
  modeChipHeight: 56,
  modeChipFontSize: 24,
  /** Centros X de los chips (BATALLA a la izquierda, CARRERA al medio). */
  battleChipX: 105,
  raceChipX: 300,
  /** Botón de pista (sólo con CARRERA): centro X, ancho/alto y fuente. */
  trackButtonX: 550,
  trackButtonWidth: 280,
  trackButtonHeight: 56,
  trackButtonFontSize: 22,
  /* Overlay del picker de pistas del lobby (miniaturas TrackThumb), mismo
   * patrón del selector de ENTRENAR del menú. */
  /** Centro Y y tamaño del panel. */
  trackPanelY: 660,
  trackPanelWidth: 620,
  trackPanelHeight: 820,
  /** Y del título y del botón CERRAR. */
  trackTitleY: 320,
  trackCloseY: 1010,
  trackCloseWidth: 300,
  trackCloseHeight: 88,
  /** Filas: centro Y de la primera y paso entre filas. */
  trackRowStartY: 430,
  trackRowStep: 118,
  /** Lado de la miniatura de cada fila (TrackThumb) y su centro X. */
  trackThumbSize: 88,
  trackThumbX: 155,
  /** Botón con el nombre de la pista: centro X, ancho/alto y fuente. */
  trackRowButtonX: 435,
  trackRowButtonWidth: 340,
  trackRowButtonHeight: 84,
  trackRowButtonFontSize: 34,
} as const;

/* ------------------------------------------------------------------ */
/* Carrera compartida (M2 — estado en vivo, fantasmas, leaderboard)    */
/* ------------------------------------------------------------------ */

/**
 * Frecuencia de difusión del estado propio (M2): veces por SEGUNDO que cada
 * cliente difunde `state {distance, x, speed, turboActive, coins, score}`.
 * 10 Hz × ~70 B × ~10 pares mantiene el ancho de banda despreciable sin que
 * la interpolación de los fantasmas se note cortada (buffer de 100 ms).
 */
export const STATE_HZ = 10;

/**
 * Retardo de renderizado de los fantasmas (M2, ms): cada auto rival se dibuja
 * en el punto interpolado entre los dos estados más recientes que rodean
 * `t − GHOST_INTERPOLATION_MS`, de modo que SIEMPRE hay dos snapshots entre
 * los que interpolar (nunca teletransporta). Equivale a un intervalo entero
 * del stream a STATE_HZ.
 */
export const GHOST_INTERPOLATION_MS = 100;

/**
 * Techo de extrapolación del fantasma (M2, ms): si no llegó un estado nuevo,
 * se extrapolan UN intervalo como máximo desde el último snapshot (con la
 * velocidad de los dos últimos); pasado el techo el auto se congela en ese
 * punto en vez de volar por la pista.
 */
export const GHOST_MAX_EXTRAPOLATION_MS = 1000 / STATE_HZ;

/** Snapshots de interpolación conservados por fantasma (~2 s de stream). */
export const SNAPSHOT_BUFFER_SIZE = 20;

/**
 * Staleness de un jugador (M2, ms): un jugador VIVO que lleva más de 20 s
 * sin difundir `state` se trata como eliminado (con su última estadística
 * conocida) — cubre pestañas muertas y desconexiones silenciosas que no
 * dispararon `onPeerLeave`.
 */
export const PLAYER_STALE_MS = 20000;

/**
 * Gracia antes de cerrar la partida por detección LOCAL (M2, ms): al quedar
 * ≤1 vivo, quien NO es el superviviente espera este tiempo a que llegue el
 * `match-over` con las stats exactas del ganador antes de armar el
 * leaderboard con las últimas conocidas (el superviviente no espera).
 */
export const MATCH_OVER_GRACE_MS = 1500;

/**
 * Ventana de asentamiento del lobby (ms). Trystero descubre los peers de una
 * malla de forma PROGRESIVA (cada DataChannel abre a su ritmo y dispara
 * `onPeerJoin` en AMBOS extremos), así que un joiner que acaba de entrar
 * necesita este tiempo para saber cuántos jugadores hay realmente en la sala:
 *
 * - El JOINER evalúa SU PROPIA admisión al vencer la ventana (o antes, si ya
 *   ve 10 peers): si con él la sala supera `maxPlayers`, emite `roomFull` y
 *   se va solo. Los RESIDENTES ya establecidos NUNCA se auto-expulsan por
 *   capacidad (evita la implosión cuando el 11º conecta con todos a la vez).
 * - El CREADOR observa la misma ventana como detección de COLISIÓN de
 *   palabra: si un peer aparece antes de que haya compartido nada, asume que
 *   otra sala usó la misma palabra y regenera la suya.
 *
 * ~1500 ms cubre el establecimiento de una malla de 10 peers sin hacer
 * esperar de más al jugador que entra a una sala llena.
 */
export const JOIN_SETTLE_MS = 1500;

/** Alfa de los autos fantasma (semitransparentes y ATRAVESABLES). */
export const GHOST_ALPHA = 0.55;

/** Alfa del marcador de un jugador eliminado en la franja de posiciones. */
export const STRIP_ELIMINATED_ALPHA = 0.3;

/**
 * Layout de la franja de posiciones (M2): columna derecha (sobre la barrera)
 * que muestra dónde está cada jugador relativo a uno mismo por distancia.
 * `range` es la diferencia de distancia (px) que mapea al alto COMPLETO de
 * la franja: ±range/2 desde el propio marcador (centrado).
 */
export const POSITION_STRIP = {
  /** X del centro de la franja (barrera derecha). */
  x: 688,
  /** Y del centro de la franja. */
  centerY: 660,
  /** Ancho de la franja (px). */
  width: 20,
  /** Alto de la franja (px). */
  height: 840,
  /** Rango de distancia mapeado al alto (px de carrera). */
  range: 4000,
  /** Tamaño del marcador de cada jugador (px). */
  dotWidth: 12,
  dotHeight: 18,
  /** Profundidad (mismo plano que el HUD de carrera). */
  depth: 40,
  /** Contador VIVOS: esquina superior derecha, debajo de las monedas. */
  aliveX: 656,
  aliveY: 104,
  aliveFontSize: 26,
} as const;

/**
 * Overlay de eliminación / espectador (M2): cartel "ELIMINADO — PUESTO N"
 * más el subtitulo de modo espectador. Va ARRIBA (el mundo sigue visible:
 * la cámara sigue corriendo hasta el fin de la partida).
 */
export const SPECTATOR_OVERLAY = {
  /** Y del cartel ELIMINADO — PUESTO N (centro). */
  bannerY: 268,
  /** Y del subtítulo de modo espectador (centro). */
  subtitleY: 332,
  /** Tamaño de fuente del cartel (px). */
  bannerFontSize: 52,
  /** Tamaño de fuente del subtítulo (px). */
  subtitleFontSize: 28,
  /** Profundidad: por encima del HUD de carrera, bajo el HUD táctil. */
  depth: 46,
  /* C3 (issue #2, decisión 2A) — botón CHAT del espectador: SOLO existe
   * para el eliminado (nunca para el vivo — ver chat/spectatorChat.ts).
   * Va centrado bajo el subtítulo, fuera de la franja de posiciones. */
  /** Y del botón CHAT del espectador (centro). */
  chatButtonY: 420,
  chatButtonWidth: 240,
  chatButtonHeight: 76,
  chatButtonFontSize: 32,
} as const;

/**
 * Layout del leaderboard final multi (M2) sobre el lienzo 720×1280: título
 * RESULTADOS, mensaje personal, tabla de hasta 10 filas y dos botones.
 */
export const LEADERBOARD = {
  /** Y del título RESULTADOS (centro). */
  titleY: 170,
  /** Y del mensaje personal ¡GANASTE! / TERMINASTE N°X (centro). */
  messageY: 264,
  /** Y de la fila de encabezados de la tabla. */
  headerY: 384,
  /** Y de la primera fila; una fila por jugador (hasta 10). */
  rowStartY: 448,
  /** Separación vertical entre filas (px). */
  rowHeight: 58,
  /** Tamaño de fuente de las filas (px). */
  rowFontSize: 24,
  /** Tamaño de fuente de los encabezados (px). */
  headerFontSize: 22,
  /** Tamaño de fuente del mensaje personal (px). */
  messageFontSize: 56,
  /** Botones MENÚ y CREAR PARTIDA. */
  menuY: 1056,
  playY: 1160,
  /** Y de la ayuda de teclado multi (solo desktop, bajo los botones). */
  hintY: 1236,
  buttonWidth: 380,
  buttonHeight: 96,
  buttonFontSize: 36,
  /** X de las columnas de la tabla (put/mon/pts/km anclan por la derecha). */
  placeX: 96,
  nameX: 150,
  coinsX: 470,
  scoreX: 588,
  kmX: 660,
  /** Tamaño del cuadrado de color junto al nombre (px). */
  swatchSize: 22,
} as const;

/* ------------------------------------------------------------------ */
/* Chat social (C0 — issue #2)                                         */
/* ------------------------------------------------------------------ */

/**
 * Largo máximo de un mensaje de chat (caracteres), ya sanitizado: trim,
 * whitespace interno colapsado y recorte a este tope (issue #2 §6). Corre la
 * misma regla en el emisor (antes de viajar) y en el receptor (antes de
 * renderizar): un peer malicioso que mande 10 KB recibe igual 200.
 */
export const CHAT_MAX_LEN = 200;

/**
 * Enfriamiento entre mensajes propios POR HILO (ms, issue #2 §6): 1 mensaje
 * cada 1,5 s en el hilo `room` y 1 cada 1,5 s en cada hilo de DM (los hilos
 * son independientes — no se comparte el enfriamiento). El tope se mide desde
 * el último envío ACEPTADO: los intentos rechazados no re-arman el reloj.
 */
export const CHAT_SEND_COOLDOWN_MS = 1500;

/**
 * Intervalo del heartbeat de presencia (ms, C2): cada cliente difunde un
 * `ping` vacío a la sala pública de presencia cada 5 s para anunciar que
 * sigue conectado (la sala pública no tiene estado de carrera que sirva de
 * señal de vida).
 */
export const PRESENCE_HEARTBEAT_MS = 5000;

/**
 * Staleness de presencia (ms, C2): un peer de la sala pública que lleva más
 * de 20 s (≈4 heartbeats perdidos) sin hacer ping se considera DESCONECTADO:
 * su hilo de DM se marca como desconectado y sale de la lista de disponibles.
 * Cubre pestañas muertas y desconexiones que no dispararon onPeerLeave.
 */
export const PRESENCE_STALE_MS = 20000;

/**
 * Layout del overlay de chat (C1, issue #2) sobre el lienzo 720×1280, de
 * arriba hacia abajo: título CHAT, tab SALA (en C2 se agrega PÚBLICO), lista
 * de mensajes (anclada abajo, los últimos visibles), input DOM + ENVIAR y
 * CERRAR. El overlay SE LANZA encima del lobby (patrón PauseScene) sin
 * pausarlo: el velo interactivo corta los taps atravesados.
 */
export const CHAT = {
  /** Opacidad del velo oscuro sobre el lobby (0–1). */
  veilAlpha: 0.86,
  /** Y del título CHAT (centro). */
  titleY: 140,
  /** Tamaño de fuente del título (px). */
  titleFontSize: 64,
  /** Y del tab activo (chip SALA; PÚBLICO llega en C2). */
  tabY: 236,
  /** Tamaño del chip de tab. */
  tabWidth: 220,
  tabHeight: 60,
  /** Tamaño de fuente de la etiqueta del tab (px). */
  tabFontSize: 30,
  /** Borde superior/inferior del panel de mensajes (Y de cada borde). */
  listTopY: 300,
  listBottomY: 856,
  /** Ancho del panel de mensajes. */
  listWidth: 640,
  /** Padding interno del panel de mensajes (px). */
  listPadding: 20,
  /** Separación vertical entre mensajes (px). */
  messageGap: 10,
  /* Tamaño de fuente de los mensajes (px): 28 queda en ≈15 px CSS al escala
   * FIT más chica de iPhone (~0,52) — legible en móvil sin agrandar el panel
   * (los que no caben en CHAT.visibleMessages ya no se dibujan). Los mensajes
   * van SIN stroke a propósito: viven sobre el panel casi opaco 0x14141c (no
   * sobre la pista scrolleando como los títulos con sombra) y el outline
   * engrosaría el monospace chico en vez de aclararlo. */
  messageFontSize: 28,
  /** Máximo de mensajes renderizados (siempre los ÚLTIMOS). */
  visibleMessages: 24,
  /* Input DOM + ENVIAR: el input ancho (el pulgar escribe) y el botón
   * grande debajo (táctil primero). */
  /** Y del input DOM (centro). */
  inputY: 948,
  /** Tamaño del input DOM. */
  inputWidth: 560,
  inputHeight: 84,
  inputFontSize: 34,
  /** Y del botón ENVIAR (centro). */
  sendY: 1076,
  /** Tamaño del botón ENVIAR. */
  sendWidth: 320,
  sendHeight: 96,
  sendFontSize: 38,
  /** Y del botón CERRAR (centro). */
  closeY: 1196,
  /** Tamaño del botón CERRAR. */
  closeWidth: 300,
  closeHeight: 92,
  closeFontSize: 34,
  /** Color CSS de los mensajes propios (destacados, amarillo del repo). */
  selfColor: '#f7c531',
  /* C2 (issue #2) — tab PÚBLICO (sala de presencia): toggle grande de
   * disponibilidad + lista de disponibles + detalle al tocar una fila. La
   * lista ocupa el mismo panel que los mensajes (listBottomY como borde
   * inferior) pero anclada ARRIBA (las primeras filas). */
  /** Y del toggle MOSTRARME DISPONIBLE (centro). */
  publicToggleY: 388,
  /** Tamaño del toggle. */
  publicToggleWidth: 600,
  publicToggleHeight: 104,
  publicToggleFontSize: 30,
  /* Auditoría #2 (COSMÉTICA 4) — hint de efimeridad: línea discreta entre el
   * toggle (termina en y≈440) y el panel de la lista (empieza en 480), para
   * que "chateé y desapareció todo" no sorprenda a quien reabre el chat. */
  /** Y del hint "MENSAJES EFÍMEROS" (centro). */
  ephemeralHintY: 462,
  /** Tamaño de fuente del hint (px). */
  ephemeralHintFontSize: 24,
  /** Borde superior del panel de disponibles (Y del borde). */
  peerListTopY: 480,
  /** Y de la primera fila de disponibles; una fila por peer. */
  peerRowStartY: 512,
  /** Separación vertical entre filas de disponibles (px). */
  peerRowHeight: 44,
  /** Tamaño de fuente de las filas de disponibles (px). */
  peerRowFontSize: 30,
  /** Cuadrado de color a la izquierda del nombre (px). */
  peerSwatchSize: 28,
  /* Auditoría #2 (MENOR 1) — paginación de la lista: la malla pública llega
   * cómoda a ~30–50 peers y 5 filas volvían inalcanzables a los 6+. v1 sin
   * scroll: 8 filas por página + fila de paginación (◀ "N–M DE T" ▶) bajo el
   * panel, solo cuando hay más filas que la página (la lógica vive en
   * `paginatePeers`, pura y testeada). Filas: 512..836 con separación 44. */
  /** Filas por página de la lista de disponibles. */
  visiblePeers: 8,
  /** Y de la fila de paginación (centro; bajo el panel de la lista). */
  peerPageY: 890,
  /** Tamaño de los botones ◀ / ▶ de paginación. */
  peerPageButtonWidth: 96,
  peerPageButtonHeight: 48,
  /** Tamaño de fuente de los botones ◀ / ▶ (px). */
  peerPageButtonFontSize: 26,
  /** Separación en X de cada botón respecto del centro (px). */
  peerPageOffsetX: 220,
  /** Tamaño de fuente del indicador "N–M DE T" (px). */
  peerPageLabelFontSize: 24,
  /** Y del detalle del peer tocado / errores de presencia (centro). */
  peerDetailY: 948,
  /** Tamaño de fuente del detalle (px). */
  peerDetailFontSize: 26,
  /* C3 (issue #2) — hilo de DM: el header del peer ocupa la fila de tabs y
   * la acción de la fila de CERRAR pasa a ser VOLVER + BLOQUEAR (+ INVITAR
   * si estoy en un lobby con palabra activa). El panel de mensajes/input es
   * el MISMO ChatPanel de la tab SALA (mismas posiciones). */
  /** Separación entre el swatch y el nombre del header del DM (px). */
  dmHeaderGap: 16,
  /** Tamaño del swatch de color del header del DM (px). */
  dmHeaderSwatchSize: 32,
  /** Tamaño de fuente del header del DM (px). */
  dmHeaderFontSize: 34,
  /** Botones del hilo de DM: fila de CERRAR, tres al ancho de la lista. */
  dmButtonY: 1196,
  dmButtonWidth: 200,
  dmButtonHeight: 92,
  dmButtonFontSize: 26,
  /** Centros X de VOLVER / BLOQUEAR / INVITAR (fila de 3 sobre 640 px). */
  dmBackX: 140,
  dmBlockX: 360,
  dmInviteX: 580,
  /* C3 — banner de invitación (tab PÚBLICO): texto en la línea del detalle
   * + botones UNIRSE / IGNORAR debajo (la fila del ENVIAR está libre en la
   * vista de lista). */
  /** Y de los botones UNIRSE / IGNORAR del banner (centro). */
  inviteButtonY: 1064,
  inviteButtonWidth: 300,
  inviteButtonHeight: 96,
  inviteButtonFontSize: 34,
  /** Centros X de UNIRSE / IGNORAR. */
  inviteJoinX: 220,
  inviteDismissX: 500,
  /** Color CSS de los mensajes de sistema del hilo (avisos locales). */
  systemColor: '#9aa0a8',
} as const;

/* ------------------------------------------------------------------ */
/* Countdown, pausa y viñeta (Fase 7)                                  */
/* ------------------------------------------------------------------ */

/**
 * Countdown 3-2-1-GO! (Fase 7): el mundo (scroll, spawn, puntaje, física)
 * queda congelado hasta terminar la cuenta. Los números se muestran
 * `stepSeconds` cada uno y el GO! `goSeconds`.
 */
export const COUNTDOWN = {
  /** Duración de cada número (3, 2, 1), en segundos. */
  stepSeconds: 0.8,
  /** Duración del GO!, en segundos. */
  goSeconds: 0.7,
  /** Tamaño de fuente del número gigante (px). */
  fontSize: 168,
} as const;

/**
 * Overlay de pausa (Fase 7): escena superpuesta a la carrera pausada con
 * REANUDAR / MENÚ. La pausa es real: `scene.pause()` congela update, física,
 * tweens, timers y partículas de la escena de juego.
 */
export const PAUSE = {
  /** Opacidad del velo oscuro sobre la carrera congelada (0–1). */
  veilAlpha: 0.74,
  /** Y del título PAUSA / PAUSA AUTOMÁTICA (centro). */
  titleY: 400,
  /** Y del subtítulo (centro). */
  subtitleY: 486,
  /** Botones REANUDAR y MENÚ: centro Y, tamaño y fuente compartida. */
  resumeY: 700,
  menuY: 860,
  buttonWidth: 380,
  buttonHeight: 104,
  buttonFontSize: 40,
  /** Y de la ayuda de teclado (solo desktop). */
  hintY: 1010,
  /** Tamaño de fuente del subtítulo (px). */
  subtitleFontSize: 28,
} as const;

/**
 * Viñeta de velocidad (Fase 7): textura de gradiente radial horneada UNA vez
 * (cero `Graphics` dinámicos) cuyo alfa se interpola hacia `maxAlpha` mientras
 * el turbo empuja y vuelve a 0 al soltar. `lerpRate` es la velocidad de la
 * interpolación (por segundo, exponencial suave).
 */
export const SPEED_VIGNETTE = {
  /** Clave de la textura horneada en GameScene.create. */
  textureKey: 'speed-vignette',
  /** Alfa máximo de la viñeta con turbo activo (0–1). */
  maxAlpha: 0.5,
  /** Velocidad de la interpolación del alfa (1/s). */
  lerpRate: 7,
} as const;

/* ------------------------------------------------------------------ */
/* Reloj virtual de generación (M0 — pista determinista)               */
/* ------------------------------------------------------------------ */

/**
 * Velocidad de referencia del reloj virtual de generación (px/s). La pista
 * del multijugador se genera como función pura de la DISTANCIA recorrida:
 * cada cliente acumula su avance real y lo convierte a tiempo virtual a
 * esta velocidad constante (= BASE_SPEED). Dos clientes con la misma seed
 * que recorran la misma distancia ven exactamente las mismas oleadas, sin
 * importar cuán rápido o frenado haya ido cada uno en cada tramo.
 */
export const VIRTUAL_SPEED = BASE_SPEED;

/**
 * Paso fijo del reloj virtual (s): el acumulador de generación emite pasos
 * discretos de esta duración y preserva el resto fraccionario para el
 * próximo frame. Elimina el drift de punto flotante entre dispositivos con
 * framerates distintos (misma distancia ⇒ mismos pasos, ±1 por redondeo).
 */
export const FIXED_VIRTUAL_STEP = 1 / 30;

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
