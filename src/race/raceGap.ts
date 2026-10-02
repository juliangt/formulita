/**
 * raceGap — gap en tiempo a los rivales de adelante/atrás (issue #14, V3).
 *
 * El HUD del GRAN PREMIO muestra un texto discreto "+1.2s / −0.8s": cuánto le
 * lleva al jugador alcanzar al rival de ADELANTE (+, le pierde) y cuánta
 * ventaja tiene sobre el de ATRÁS (−, se le aleja... o no). La convención es
 * la del intervalo de la telemetría F1: positivo = rival de adelante,
 * negativo = rival de atrás.
 *
 * El gap en tiempo se APROXIMA del progreso desenrollado (`lap × vuelta + s`,
 * el mismo escalar de `raceRanking`) dividido por la velocidad PROPIA:
 * es la estimación del presupuesto del propio piloto, no un cronómetro
 * exacto — por eso se clampea (muy lejos ya no informa) y se redondea a
 * 0.1 s (un "1.23 s" que vibra por frame estorba). Con poca velocidad propia
 * la división explota: debajo del piso la estimación no es confiable y se
 * oculta (el HUD recibe `null`).
 *
 * Puro: progresos + velocidad ⇒ gaps. Sin Phaser, sin reloj — testeable
 * directo con Vitest.
 */

/** Un rival para el cálculo de gaps (fila del ranking vivo, ya vale). */
export interface RaceGapRival {
  /** Identidad del auto (sólo para devolver quién es el vecino). */
  readonly peerId: string;
  /** Progreso desenrollado (px; `lap × lapLength + s`). */
  readonly progress: number;
}

/** Gap a un vecino: + del de adelante, − del de atrás (segundos, 0.1). */
export interface RaceNeighborGap {
  readonly peerId: string;
  readonly seconds: number;
}

/** Gaps del frame: `null` cuando no hay vecino (o la estimación no vale). */
export interface RaceGaps {
  readonly ahead: RaceNeighborGap | null;
  readonly behind: RaceNeighborGap | null;
}

/** Parámetros del cálculo (presets en `RACE_VS_CPU`, balance.ts). */
export interface RaceGapOptions {
  /** Techo del |gap| mostrado (s): más lejos se clampea. */
  readonly maxSeconds: number;
  /** Velocidad propia mínima (px/s) para confiar en la división. */
  readonly minOwnSpeedPx: number;
}

/** Redondeo a 0.1 s (el dígito que el ojo puede leer a 4 Hz). */
function roundToTenth(seconds: number): number {
  return Math.round(seconds * 10) / 10;
}

/**
 * Clampea el |gap| al techo y redondea a 0.1 conservando el signo (el de
 * atrás es negativo: la distancia se devuelve como la pierde el jugador).
 */
function formatGapSeconds(rawSeconds: number, maxSeconds: number): number {
  const sign = rawSeconds < 0 ? -1 : 1;
  const clamped = Math.min(Math.abs(rawSeconds), maxSeconds);
  return sign * roundToTenth(clamped);
}

/**
 * Gap a los vecinos de la carrera: el rival con el progreso INMEDIATAMENTE
 * mayor al propio (adelante) y el inmediatamente menor (atrás). Empates de
 * progreso se resuelven por peerId ASC (mismo tiebreak determinista de
 * `raceRanking`); un rival EXACTAMENTE a la par no es vecino de nadie
 * (está al costado: no hay gap que mostrar).
 *
 * Defensa: sin velocidad propia suficiente (`minOwnSpeedPx`), con progresos
 * no finitos o sin rivales devuelve `null` en ambos lados — el HUD oculta la
 * línea en vez de mostrar un número sin sentido.
 */
export function computeRaceGaps(
  ownProgress: number,
  ownSpeed: number,
  rivals: readonly RaceGapRival[],
  options: RaceGapOptions,
): RaceGaps {
  const empty: RaceGaps = { ahead: null, behind: null };
  const maxSeconds =
    Number.isFinite(options.maxSeconds) && options.maxSeconds > 0
      ? options.maxSeconds
      : Number.POSITIVE_INFINITY;
  const minOwnSpeedPx =
    Number.isFinite(options.minOwnSpeedPx) && options.minOwnSpeedPx >= 0
      ? options.minOwnSpeedPx
      : 0;

  if (!Number.isFinite(ownProgress)) {
    return empty;
  }
  if (!Number.isFinite(ownSpeed) || ownSpeed < minOwnSpeedPx || ownSpeed <= 0) {
    return empty;
  }

  let ahead: RaceGapRival | null = null;
  let behind: RaceGapRival | null = null;
  for (const rival of rivals) {
    if (typeof rival.peerId !== 'string' || rival.peerId.length === 0) {
      continue;
    }
    if (!Number.isFinite(rival.progress)) {
      continue;
    }
    if (rival.progress > ownProgress) {
      // El más CERCANO adelante: menor progreso gana; empate → peerId ASC.
      if (
        ahead === null ||
        rival.progress < ahead.progress ||
        (rival.progress === ahead.progress && rival.peerId < ahead.peerId)
      ) {
        ahead = rival;
      }
    } else if (rival.progress < ownProgress) {
      // El más CERCANO atrás: mayor progreso gana; empate → peerId ASC.
      if (
        behind === null ||
        rival.progress > behind.progress ||
        (rival.progress === behind.progress && rival.peerId < behind.peerId)
      ) {
        behind = rival;
      }
    }
  }

  return {
    ahead: ahead
      ? {
          peerId: ahead.peerId,
          seconds: formatGapSeconds((ahead.progress - ownProgress) / ownSpeed, maxSeconds),
        }
      : null,
    behind: behind
      ? {
          peerId: behind.peerId,
          seconds: formatGapSeconds((behind.progress - ownProgress) / ownSpeed, maxSeconds),
        }
      : null,
  };
}
