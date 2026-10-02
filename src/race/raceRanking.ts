/**
 * raceRanking — ranking en vivo y clasificación final (issue #9, V0).
 *
 * - `rankCars`: ranking EN VIVO de todos los autos por progreso
 *   `lap × lapLength + s` DESC (V2 interpola ese mismo escalar para el
 *   streaming de estado). Tiebreak: peerId ASC (determinista en todos los
 *   clientes con el mismo snapshot).
 * - `finalClassification`: clasificación FINAL determinista al cerrar la
 *   carrera: terminados por tiempo total ASC → en carrera por progreso DESC
 *   → desconectados por último progreso DESC. Todos los empates caen a
 *   peerId ASC.
 *
 * Puro: roster + progreso ⇒ posiciones. Cero Phaser, cero red.
 */

/** Progreso mínimo que aporta un auto al ranking (V2 lo difunde a 10 Hz). */
export interface RankedCar {
  peerId: string;
  /** Vuelta actual (0-based: 0 = todavía no cruzó la meta). */
  lap: number;
  /** Coordenada de arco dentro de la vuelta (px, [0, lapLength)). */
  s: number;
}

/** Fila del ranking en vivo. */
export interface RaceStanding {
  /** 1 = líder. */
  position: number;
  peerId: string;
  lap: number;
  s: number;
  /** Escalar de progreso `lap × lapLength + s` (px). */
  progress: number;
}

/** Estado de un auto para la clasificación final. */
export interface FinalCar {
  peerId: string;
  lap: number;
  s: number;
  /** finished: cruzó la meta final; running: aún compite; disconnected: peer caído. */
  status: 'finished' | 'running' | 'disconnected';
  /** Tiempo total de carrera (ms); sólo con sentido en `finished`. */
  totalMs?: number;
}

/** Fila de la clasificación final. */
export interface FinalStanding {
  position: number;
  peerId: string;
  status: FinalCar['status'];
  /** Tiempo total (ms) o null si no terminó. */
  totalMs: number | null;
  lap: number;
  s: number;
  progress: number;
}

/** Escalar de progreso con defensa: campos no finitos aportan 0. */
export function carProgress(car: RankedCar, lapLength: number): number {
  const lap = Number.isFinite(car.lap) ? Math.max(0, car.lap) : 0;
  const s = Number.isFinite(car.s) ? Math.max(0, car.s) : 0;
  return lap * lapLength + s;
}

/** Tiebreak canónico compartido: peerId ASC. */
function byPeerId(a: { peerId: string }, b: { peerId: string }): number {
  return a.peerId < b.peerId ? -1 : a.peerId > b.peerId ? 1 : 0;
}

/**
 * Ranking en vivo: progreso DESC, tiebreak peerId ASC. `own` y `remotes` son
 * sólo lecturas; el orden del roster recibido no afecta el resultado.
 */
export function rankCars(
  own: RankedCar,
  remotes: readonly RankedCar[],
  lapLength: number,
): RaceStanding[] {
  const cars = [own, ...remotes].map((car) => ({
    peerId: car.peerId,
    lap: car.lap,
    s: car.s,
    progress: carProgress(car, lapLength),
  }));
  cars.sort((a, b) => (b.progress - a.progress) || byPeerId(a, b));
  return cars.map((car, i) => ({
    position: i + 1,
    peerId: car.peerId,
    lap: car.lap,
    s: car.s,
    progress: car.progress,
  }));
}

/** Grupo de la clasificación final: menor orden gana. */
function statusOrder(status: FinalCar['status']): number {
  if (status === 'finished') return 0;
  if (status === 'running') return 1;
  return 2;
}

/**
 * Clasificación final determinista: terminados por totalMs ASC → en carrera
 * por progreso DESC → desconectados por último progreso DESC; empates por
 * peerId ASC. Un `finished` sin totalMs finito se ordena como si tuviera el
 * peor tiempo de su grupo (defensa contra un peer corrupto).
 */
export function finalClassification(
  cars: readonly FinalCar[],
  lapLength: number,
): FinalStanding[] {
  const entries = cars.map((car) => ({
    peerId: car.peerId,
    lap: car.lap,
    s: car.s,
    status: car.status,
    totalMs:
      car.status === 'finished' && Number.isFinite(car.totalMs)
        ? Math.max(0, car.totalMs as number)
        : null,
    progress: carProgress(car, lapLength),
  }));

  entries.sort((a, b) => {
    const groupA = statusOrder(a.status);
    const groupB = statusOrder(b.status);
    if (groupA !== groupB) {
      return groupA - groupB;
    }
    if (a.status === 'finished' && b.status === 'finished') {
      const timeA = a.totalMs ?? Number.POSITIVE_INFINITY;
      const timeB = b.totalMs ?? Number.POSITIVE_INFINITY;
      if (timeA !== timeB) {
        return timeA - timeB;
      }
    } else {
      // running y disconnected ordenan por último progreso conocido.
      if (b.progress !== a.progress) {
        return b.progress - a.progress;
      }
    }
    return byPeerId(a, b);
  });

  return entries.map((car, i) => ({
    position: i + 1,
    peerId: car.peerId,
    status: car.status,
    totalMs: car.totalMs,
    lap: car.lap,
    s: car.s,
    progress: car.progress,
  }));
}
