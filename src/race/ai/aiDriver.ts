/**
 * aiDriver — piloto del rival CPU (issue #14, V1 + V2).
 *
 * Un piloto REAL que sigue la LÍNEA DE CARRERA (`racingLine.ts`, no el eje):
 *
 * - Dirección: error angular hacia un punto de MIRA sobre la línea a
 *   `lookAheadPx` de arco adelante del propio arco proyectado, desplazado
 *   por el offset lateral PERSONAL del driver (la personalidad no es un
 *   temblor: es SU trazada). Volante bang-bang con zona muerta (−1/0/+1, la
 *   única granularidad que acepta `CircuitPhysics`), acotado igual que el
 *   jugador. Si el auto se sale, la proyección al eje sigue viva y la mira
 *   cae sobre el asfalto: el driver vuelve solo. V2: el desvío total de la
 *   mira (personalidad + error + adelantamiento) queda CLAMPEADO al asfalto
 *   (`RacingLine.maxOffsetPx`) — equivocarse cuesta tiempo, no pasto.
 * - Longitudinal: escanea el horizonte de FRENADA sobre la línea — para cada
 *   distancia `d` adelante, la velocidad máxima permitida HOY para llegar al
 *   `targetSpeed` de ese punto frenando a `CIRCUIT.brakeDeceleration` es
 *   `√(v_t² + 2·a·d)` (cinemática pura; el lookahead queda así proporcional
 *   a la distancia de frenada disponible). El objetivo del paso es el mínimo
 *   de esa barra (y el cap de recta del preset). Con velocidad sobre el
 *   objetivo + margen, FRENA (antes de la curva, no dentro); debajo,
 *   acelera; en el medio, regula soltando (sin bang-bang nervioso).
 *
 * V2 — tres dificultades con carácter (presets en `RACE_AI`, resueltos por
 * `rivalRoster.rivalDriverConfig`; la personalidad desvía DENTRO del
 * preset):
 * - ERRORES HUMANOS (Poisson): con media `mistakeEverySec` y el RNG PROPIO
 *   del rival (inyectado), cada tanto el driver comete un fallo breve de
 *   `mistakeMs`: frenada tardía (objetivo × `mistakeSpeedOvershoot`) o
 *   desvío lateral (`mistakeMagPx` px de su trazada). El fallo TERMINA SOLO
 *   y el retorno a la línea es suave. Sin RNG inyectado no hay errores.
 * - ADELANTAMIENTO: con visión de los demás autos (`{s, lateral, speed}`,
 *   coordenada de arco envuelta), si hay un auto adelante a menos de
 *   `overtakeGapPx` cerrando a más de `overtakeClosingPx`, desvía SU
 *   trazada hacia el lado con más hueco (si la agresividad lo decide:
 *   `overtakeAttemptBase + (1 − base) × aggression`) y vuelve suave a la
 *   línea al pasar. Los autos se atraviesan: el desvío es sólo "buscar el
 *   hueco".
 * - RUBBER-BANDING: ajusta su ritmo GLOBAL (cap de recta Y escala de línea)
 *   en ±`rubberBandPct` según su gap de progreso al JUGADOR
 *   (`playerGapPx`, + = jugador adelante), interpolado hasta
 *   `rubberBandFullGapPx` y NUNCA por encima del techo físico.
 *
 * Contrato (igual que V0):
 * - SOLO produce `CircuitInput { throttle, brake, steer }` — NUNCA escribe
 *   posiciones: la física es la MISMA `CircuitPhysics` del jugador y el
 *   rival juega con las mismas reglas (auto-acelerado, pasto, techo).
 *
 * Puro: sin Phaser, sin red, sin reloj — determinista por construcción
 * (mismo estado + misma línea + mismo RNG + mismos dt/contexto ⇒ mismo
 * input). Testeable headless con Vitest.
 */

import { CIRCUIT, RACE_AI } from '../../config/balance';
import type { Rng } from '../../net/roomRng';
import type { CarState, CircuitInput } from '../circuitPhysics';
import type { TrackPath } from '../trackPath';
import type { RacingLine } from './racingLine';

/** Configuración del driver (`RACE_AI` + preset de dificultad + personalidad). */
export interface AiDriverConfig {
  /**
   * Techo de velocidad en recta como fracción de `CIRCUIT.maxSpeed` (0–1):
   * preset de dificultad × personalidad, resuelto por `rivalRoster`.
   */
  readonly targetSpeedFraction: number;
  /** Escala sobre el `targetSpeed` de la línea (preset × personalidad). */
  readonly lineSpeedScale: number;
  /** Offset lateral propio sobre la línea (px, ±; SU trazada). */
  readonly lineOffsetPx: number;
  /** Distancia del punto de mira sobre la línea (px de arco). */
  readonly lookAheadPx: number;
  /** Zona muerta del error angular (rad): debajo, volante recto. */
  readonly steerDeadzoneRad: number;
  /** Margen de frenada (px/s): recién tan por encima del objetivo frena. */
  readonly brakeMarginSpeedPx: number;
  /** V2 — media (s) entre errores humanos (Poisson); ≤ 0 desactiva. */
  readonly mistakeEverySec: number;
  /** V2 — desvío lateral del error humano (px desde SU trazada). */
  readonly mistakeMagPx: number;
  /** V2 — agresividad efectiva 0–1 (preset × personalidad). */
  readonly aggression: number;
  /** V2 — goma: ± fracción sobre el ritmo global según gap al jugador. */
  readonly rubberBandPct: number;
}

/** Visión de OTRO auto en pista (lo que el driver puede ver de un rival). */
export interface AiCarVision {
  /** Coordenada de arco envuelta del auto (px, en [0, totalLength)). */
  readonly s: number;
  /** Lateral con signo respecto del eje (px, convención `TrackPath`). */
  readonly lateral: number;
  /** Velocidad escalar (px/s). */
  readonly speed: number;
}

/** Contexto del paso: visión de los demás autos y gap al jugador. */
export interface AiDriverContext {
  /** Los DEMÁS autos en pista (rivales + jugador). Ausente: nadie. */
  readonly cars?: readonly AiCarVision[];
  /**
   * Gap de progreso al JUGADOR (px; + = el jugador va ADELANTE de este
   * rival): alimenta el rubber-banding. Ausente: 0 (sin goma).
   */
  readonly playerGapPx?: number;
}

/**
 * Multiplicador de ritmo por rubber-banding para un gap de progreso al
 * jugador (px): interpolación lineal hasta `fullGapPx`, clampeada a
 * [1 − pct, 1 + pct]. Inputs basura degradan a "sin ajuste" (1). Puro:
 * testeable sin driver.
 */
export function rubberBandMultiplier(
  playerGapPx: number,
  pct: number,
  fullGapPx: number,
): number {
  const pctClean = Number.isFinite(pct) ? Math.min(Math.max(pct, 0), 1) : 0;
  if (pctClean === 0 || !Number.isFinite(playerGapPx) || !(fullGapPx > 0)) {
    return 1;
  }
  const t = Math.min(Math.max(playerGapPx / fullGapPx, -1), 1);
  return 1 + pctClean * t;
}

/* ------------------------------------------------------------------ */
/* Constantes del módulo (no gameplay: los presets viven en RACE_AI)    */
/* Issue #18: los px de mundo escalan ×2.5 con el circuito.             */
/* ------------------------------------------------------------------ */

/**
 * Paso del escaneo de frenada sobre la línea (px de arco): muestrear el
 * horizonte a este ritmo captura cualquier curva de la pista (radios ≥
 * 216 px ⇒ arcos de curva mucho más largos que el paso) sin costar por
 * frame.
 */
const BRAKE_SCAN_STEP_PX = 100;

/** Horizonte máximo del escaneo de frenada (px de arco): frenar de punta a
 * la curva más lenta ocupa ~176 px (`CIRCUIT.brakeDeceleration`), así que
 * con margen sobra — mirar más lejos no cambia ninguna decisión. */
const BRAKE_SCAN_MAX_PX = 600;

/** dt máximo aceptado por paso (anti-espiral; igual criterio que la física). */
const MAX_DT_S = 0.25;

/** Ventana hacia ATRÁS (px de progreso) al elegir el lado del hueco: un auto
 * apenas detrás y a la par también ocupa lado. */
const SIDE_SCAN_BEHIND_PX = 150;

/** Probabilidad de que el error humano sea hacia un lado u otro (50/50). */
const MISTAKE_SIDE_CHANCE = 0.5;

/** Tipos de error humano: frenada tardía o desvío lateral de la trazada. */
type MistakeKind = 'brake' | 'lateral';

/** Normaliza un ángulo a (−π, π] (los headings y tangentes viven ahí). */
function normalizeAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) {
    a -= Math.PI * 2;
  }
  while (a < -Math.PI) {
    a += Math.PI * 2;
  }
  return a;
}

/** Clamp genérico. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Delta más corto entre dos coordenadas de arco del anillo (px, en
 * (−L/2, L/2]): > 0 = `other` está adelante.
 */
function wrappedDelta(otherS: number, myS: number, length: number): number {
  let ds = otherS - myS;
  if (ds > length / 2) {
    ds -= length;
  } else if (ds < -length / 2) {
    ds += length;
  }
  return ds;
}

/** Mueve `current` hacia `target` a lo sumo `maxDelta` px (suavizado). */
function approach(current: number, target: number, maxDelta: number): number {
  const delta = target - current;
  if (Math.abs(delta) <= maxDelta) {
    return target;
  }
  return current + Math.sign(delta) * maxDelta;
}

export class AiDriver {
  constructor(
    private readonly path: TrackPath,
    private readonly line: RacingLine,
    private readonly config: AiDriverConfig,
    /**
     * RNG PROPIO del rival (mulberry32 sobre su seed derivada): fuente de
     * azar determinista para errores y maniobras. Ausente: piloto limpio
     * (sin errores; las maniobras se intentan siempre).
     */
    private readonly rng?: Rng,
  ) {}

  /* --- Estado interno del piloto (determinista por sim) --------------- */

  /** true cuando el schedule de errores ya fue inicializado (lazy). */
  private scheduleReady = false;
  /** Segundos hasta el próximo error (sorteo exponencial). */
  private nextMistakeInS = 0;
  /** Segundos restantes del error en curso (0 = sin error). */
  private mistakeTimerS = 0;
  /** Tipo y lado del error en curso. */
  private mistakeKind: MistakeKind = 'brake';
  private mistakeSide: -1 | 1 = 1;
  /** Cantidad de errores cometidos (observabilidad para tests/HUD). */
  private mistakeCount = 0;
  /** Desvío lateral APLICADO respecto de SU trazada (px, suavizado). */
  private lateralBiasPx = 0;
  /** Maniobra en curso: lado elegido (0 = sin maniobra). */
  private overtakeSide: -1 | 0 | 1 = 0;
  /** Segundos de enfriamiento tras una maniobra rechazada. */
  private overtakeCooldownS = 0;

  /** Errores humanos cometidos desde la creación (tests/observabilidad). */
  get mistakes(): number {
    return this.mistakeCount;
  }

  /** true mientras dura el fallo en curso (tests/observabilidad). */
  get mistaking(): boolean {
    return this.mistakeTimerS > 0;
  }

  /**
   * Decide el input del paso a partir del estado (lectura pura: no muta
   * `state`, no avanza la física — de eso se encarga el dueño). `dt`
   * alimenta el reloj interno de errores y el suavizado lateral; `context`
   * trae la visión de los demás autos y el gap al jugador.
   */
  drive(state: CarState, dt = 0, context: AiDriverContext = {}): CircuitInput {
    const dtS = Number.isFinite(dt) && dt > 0 ? Math.min(dt, MAX_DT_S) : 0;

    // Proyección al eje: da el arco `s` propio (absorbe autos fuera de
    // pista: la mira siempre cae sobre la línea, así el driver vuelve solo).
    const projection = this.path.project(state.x, state.y);
    const s = projection.s;

    // --- Errores y maniobras (estado interno avanzado por dt) ----------
    this.updateMistakeTimer(dtS);
    this.updateMistakeSchedule(dtS);
    const overtakeTargetPx = this.updateOvertake(s, state.speed, dtS, context);
    const mistakingLateral = this.mistakeTimerS > 0 && this.mistakeKind === 'lateral';
    const biasTarget = mistakingLateral
      ? this.mistakeSide * this.config.mistakeMagPx
      : overtakeTargetPx;
    // El desvío (ida y retorno) es suave: px/s del preset.
    this.lateralBiasPx = approach(
      this.lateralBiasPx,
      biasTarget,
      RACE_AI.overtakeLateralSpeedPx * dtS,
    );

    // --- Longitudinal: objetivo = mínima velocidad permitida en el horizonte.
    // Goma V2: el ritmo GLOBAL (cap de recta y escala de línea) se ajusta
    // ±rubberBandPct según el gap al jugador, con techo físico.
    const pace = rubberBandMultiplier(
      context.playerGapPx ?? 0,
      this.config.rubberBandPct,
      RACE_AI.rubberBandFullGapPx,
    );
    const fraction = clamp(this.config.targetSpeedFraction * pace, 0, 1);
    const cap = CIRCUIT.maxSpeed * fraction;
    const scale = Math.max(this.config.lineSpeedScale * pace, 0);

    let target = Math.min(this.line.pointAtS(s).targetSpeed * scale, cap);
    for (let d = BRAKE_SCAN_STEP_PX; d <= BRAKE_SCAN_MAX_PX; d += BRAKE_SCAN_STEP_PX) {
      const ahead = this.line.pointAtS(s + d);
      const aheadTarget = Math.min(ahead.targetSpeed * scale, cap);
      // Cinemática: velocidad HOY que permite llegar a `aheadTarget` frenando.
      const allowed = Math.sqrt(aheadTarget * aheadTarget + 2 * CIRCUIT.brakeDeceleration * d);
      if (allowed < target) {
        target = allowed;
      }
    }

    // Error de frenada tardía: durante el fallo el objetivo se dispara
    // (frena MÁS TARDE), con techo físico `CIRCUIT.maxSpeed`.
    if (this.mistakeTimerS > 0 && this.mistakeKind === 'brake') {
      target = Math.min(target * RACE_AI.mistakeSpeedOvershoot, CIRCUIT.maxSpeed);
    }

    // Bang-bang longitudinal con banda muerta: sobre objetivo+margen frena,
    // debajo acelera, en el medio regula soltando (roce de `CIRCUIT`).
    const brake = state.speed > target + this.config.brakeMarginSpeedPx;
    const throttle = !brake && state.speed < target;

    // --- Dirección: error angular hacia el punto de mira sobre la LÍNEA,
    // desplazado por SU trazada + el desvío del momento (maniobra o error),
    // TODO clampeado al asfalto (la mira nunca sale del ruedo).
    const aim = this.line.pointAtS(s + this.config.lookAheadPx);
    const aimAxis = this.path.sample(aim.s);
    const normal = aimAxis.angle + Math.PI / 2;
    const aimLateral = clamp(
      aim.offset + this.config.lineOffsetPx + this.lateralBiasPx,
      -this.line.maxOffsetPx,
      this.line.maxOffsetPx,
    );
    const aimX = aimAxis.x + Math.cos(normal) * aimLateral;
    const aimY = aimAxis.y + Math.sin(normal) * aimLateral;
    const desired = Math.atan2(aimY - state.y, aimX - state.x);
    const error = normalizeAngle(desired - state.heading);
    const deadzone = this.config.steerDeadzoneRad;
    const steer: CircuitInput['steer'] =
      error > deadzone ? 1 : error < -deadzone ? -1 : 0;

    return { throttle, brake, steer };
  }

  /* --- Errores humanos (Poisson) -------------------------------------- */

  /** Cuenta atrás del fallo en curso (termina solo). */
  private updateMistakeTimer(dtS: number): void {
    if (this.mistakeTimerS > 0) {
      this.mistakeTimerS = Math.max(0, this.mistakeTimerS - dtS);
    }
  }

  /**
   * Schedule de Poisson: cada paso descuenta dt del sorteo exponencial
   * vigente; al vencer dispara UN fallo (tipo y lado con el RNG) y sortea
   * el próximo. Sin RNG (o `mistakeEverySec ≤ 0`) no hay errores.
   */
  private updateMistakeSchedule(dtS: number): void {
    const meanS = this.config.mistakeEverySec;
    if (!this.rng || !(meanS > 0)) {
      return;
    }
    if (!this.scheduleReady) {
      this.scheduleReady = true;
      this.nextMistakeInS = this.drawExponential(meanS);
    }
    this.nextMistakeInS -= dtS;
    if (this.mistakeTimerS <= 0 && this.nextMistakeInS <= 0) {
      this.mistakeCount += 1;
      this.mistakeTimerS = RACE_AI.mistakeMs / 1000;
      this.mistakeKind = this.rng() < RACE_AI.mistakeLateralChance ? 'lateral' : 'brake';
      this.mistakeSide = this.rng() < MISTAKE_SIDE_CHANCE ? -1 : 1;
      this.nextMistakeInS = this.drawExponential(meanS);
    }
  }

  /** Sorteo exponencial (media `meanS`): −mean·ln(1 − u), u ∈ [0, 1). */
  private drawExponential(meanS: number): number {
    const u = Math.min(Math.max(this.rng?.() ?? 0, 0), 1 - 1e-12);
    return -meanS * Math.log(1 - u);
  }

  /* --- Adelantamiento -------------------------------------------------- */

  /**
   * Devuelve el desvío lateral objetivo (px respecto de SU trazada) según
   * la visión: si hay un auto adelante dentro de la ventana y lo está
   * cerrando, elige (una vez por maniobra, con la agresividad) el lado con
   * más hueco y se desvía hacia ahí; al pasar, vuelve suave a la línea.
   */
  private updateOvertake(
    myS: number,
    mySpeed: number,
    dtS: number,
    context: AiDriverContext,
  ): number {
    if (this.overtakeCooldownS > 0) {
      this.overtakeCooldownS = Math.max(0, this.overtakeCooldownS - dtS);
    }

    const cars = context.cars ?? [];
    const length = this.path.totalLength;

    // El auto de ADELANTE más cercano dentro de la ventana (delta envuelta:
    // la comparación sobrevive el cruce de meta).
    let ahead: AiCarVision | null = null;
    let aheadGap = Infinity;
    for (const car of cars) {
      const gap = wrappedDelta(car.s, myS, length);
      if (gap > 0 && gap <= RACE_AI.overtakeGapPx && gap < aheadGap) {
        ahead = car;
        aheadGap = gap;
      }
    }
    if (!ahead) {
      // Nadie adelante en la ventana: maniobra terminada, vuelve a la línea.
      this.overtakeSide = 0;
      return 0;
    }

    if (this.overtakeSide === 0) {
      // Sin maniobra: sólo decide si lo está CERRANDO y salió del enfriamiento.
      if (mySpeed - ahead.speed < RACE_AI.overtakeClosingPx || this.overtakeCooldownS > 0) {
        return 0;
      }
      // No intenta mientras dura un fallo humano (primero el auto).
      if (this.mistakeTimerS > 0) {
        return 0;
      }
      // La agresividad decide: probabilidad de intentar la maniobra.
      const chance =
        RACE_AI.overtakeAttemptBase +
        (1 - RACE_AI.overtakeAttemptBase) * clamp(this.config.aggression, 0, 1);
      if (this.rng && this.rng() >= chance) {
        // Rechazada: enfriamiento antes de reintentar (1 roll por intento).
        this.overtakeCooldownS = RACE_AI.overtakeRetrySec;
        return 0;
      }
      this.overtakeSide = this.chooseSide(myS, this.config.lineOffsetPx, cars, length);
    }
    return this.overtakeSide * RACE_AI.overtakeSidePx;
  }

  /**
   * Lado del hueco: puntúa ±1 por la distancia libre mínima al objetivo
   * lateral de ese lado entre los autos cercanos (adelante en la ventana y
   * apenas atrás); gana el lado con más hueco, empate → +1 (determinista).
   */
  private chooseSide(
    myS: number,
    ownOffset: number,
    cars: readonly AiCarVision[],
    length: number,
  ): -1 | 1 {
    const nearby = cars.filter((car) => {
      const gap = wrappedDelta(car.s, myS, length);
      return gap <= RACE_AI.overtakeGapPx && gap >= -SIDE_SCAN_BEHIND_PX;
    });
    const room = (side: -1 | 1): number => {
      const target = clamp(
        ownOffset + side * RACE_AI.overtakeSidePx,
        -this.line.maxOffsetPx,
        this.line.maxOffsetPx,
      );
      let minDistance = Infinity;
      for (const car of nearby) {
        minDistance = Math.min(minDistance, Math.abs(car.lateral - target));
      }
      return minDistance;
    };
    return room(1) >= room(-1) ? 1 : -1;
  }
}
