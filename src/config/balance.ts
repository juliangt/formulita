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
  playY: 848,
  playWidth: 400,
  playHeight: 118,
  playFontSize: 52,
  /* M1 — botón MULTIJUGADOR: debajo de JUGAR, mismo ancho, etiqueta más
   * chica (13 caracteres de monospace tienen que entrar en 400 px). */
  /** Centro Y del botón MULTIJUGADOR. */
  multiY: 988,
  /** Ancho/alto del botón MULTIJUGADOR (mismo ancho que JUGAR). */
  multiWidth: 400,
  multiHeight: 118,
  /** Tamaño de fuente de la etiqueta MULTIJUGADOR (px). */
  multiFontSize: 40,
  /* C2 (issue #2) — botón CHAT: debajo de MULTIJUGADOR, mismo ancho; abre el
   * overlay con la tab PÚBLICO (el chat social vive también en el menú). El
   * bloque de ayuda baja para hacerle sitio (helpY 1150 → 1204): quedan 9 px
   * de aire a cada lado del botón y 13 px de margen inferior. */
  /** Centro Y del botón CHAT del menú. */
  chatY: 1096,
  /** Ancho/alto del botón CHAT (mismo ancho que JUGAR/MULTIJUGADOR). */
  chatWidth: 400,
  chatHeight: 64,
  /** Tamaño de fuente de la etiqueta CHAT (px). */
  chatFontSize: 34,
  /** Y del centro del bloque de ayuda de controles. */
  helpY: 1204,
  /** Separación vertical entre líneas de ayuda (px). */
  helpLineHeight: 34,
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
