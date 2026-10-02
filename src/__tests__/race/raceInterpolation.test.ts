import { describe, expect, it } from 'vitest';
import { GHOST_MAX_EXTRAPOLATION_MS } from '../../config/balance';
import { SnapshotBuffer } from '../../net/interpolation';
import { wrapProgress, type RaceRemoteSample } from '../../race/raceRemote';

/**
 * Tests del buffer de interpolación para la CARRERA (issue #9, V2): el
 * `SnapshotBuffer` se GENERALIZÓ (acepta cualquier snapshot timestamped e
 * interpola TODOS sus campos numéricos) y acá se prueba el caso específico
 * del circuito: la META. El progreso viaja DESENROLLADO (lap × L + s), así
 * que el buffer NUNCA ve una envoltura — el escalar es monótono y la
 * interpolación lineal es continua al cruzar la meta; la re-envoltura
 * (lap, s) sólo ocurre al reconstruir la posición.
 */

/** Longitud de vuelta corta de los tests (px). */
const LAP_LENGTH = 1000;

/** Paso del stream (ms) = 1 intervalo a 10 Hz. */
const STEP_MS = 100;

/** Llena el buffer con un progreso lineal que CRUZA la meta varias veces. */
function pushAroundLapLine(buffer: SnapshotBuffer<RaceRemoteSample>, lateral: number): void {
  // progress: 800 → 3200 en pasos de 100 px (cruza L en 1000 y 2000).
  for (let progress = 800; progress <= 3200; progress += 100) {
    buffer.push({ t: (progress - 800) * STEP_MS, progress, o: lateral });
  }
}

describe('SnapshotBuffer de carrera — la meta no salta (progreso desenrollado)', () => {
  it('el progreso interpolado es MONÓTONO a través de la meta (sin envoltura)', () => {
    const buffer = new SnapshotBuffer<RaceRemoteSample>();
    pushAroundLapLine(buffer, 0);

    // Barrido fino alrededor del primer cruce (progress L = 1000):
    // interpolado entre 900→1000 y 1000→1100, NUNCA cae ni vuelve a 0.
    let previous = -Infinity;
    for (let t = 850; t <= 1250; t += 5) {
      const point = buffer.renderAt(t);
      expect(point).not.toBeNull();
      const progress = point!.progress;
      expect(progress).toBeGreaterThanOrEqual(previous); // monótono creciente
      expect(progress).toBeLessThan(2 * LAP_LENGTH); // nunca re-envuelto a [0, L)
      previous = progress;
    }
  });

  it('interpola los DOS campos (progress y o) en el mismo punto', () => {
    const buffer = new SnapshotBuffer<RaceRemoteSample>();
    buffer.push({ t: 0, progress: 900, o: -20 });
    buffer.push({ t: STEP_MS, progress: 1000, o: 20 }); // cruza la meta entre ambos

    const mid = buffer.renderAt(STEP_MS / 2);
    expect(mid!.progress).toBeCloseTo(950, 6);
    expect(mid!.o).toBeCloseTo(0, 6); // el lateral también interpola
  });

  it('la re-envoltura (lap, s) es continua al reconstruir: L−10 y L+10 caen a ambos lados de s=0', () => {
    const buffer = new SnapshotBuffer<RaceRemoteSample>();
    buffer.push({ t: 0, progress: LAP_LENGTH - 10, o: 0 });
    buffer.push({ t: STEP_MS, progress: LAP_LENGTH + 10, o: 0 });

    const before = wrapProgress(buffer.renderAt(0)!.progress, LAP_LENGTH);
    const after = wrapProgress(buffer.renderAt(STEP_MS)!.progress, LAP_LENGTH);
    expect(before).toEqual({ lap: 0, s: LAP_LENGTH - 10 });
    expect(after).toEqual({ lap: 1, s: 10 }); // la vuelta sube, la s envuelve
    // La distancia de arco entre ambos puntos es de 20 px, no de una vuelta.
    expect(after.s + (LAP_LENGTH - before.s)).toBe(20);
  });

  it('dos vueltas cruzadas seguidas: el escalar sigue subiendo (lap 0 → 3)', () => {
    // Capacidad mayor que el stream (25 muestras) para conservar el inicio.
    const buffer = new SnapshotBuffer<RaceRemoteSample>({ capacity: 30 });
    pushAroundLapLine(buffer, 5);

    const start = buffer.renderAt(0)!.progress;
    const lastT = (3200 - 800) * STEP_MS; // t del último snapshot del stream
    const end = buffer.renderAt(lastT)!.progress;
    expect(start).toBe(800);
    expect(end).toBe(3200); // 3.2 vueltas: sin ningún salto
    expect(wrapProgress(end, LAP_LENGTH).lap).toBe(3);
  });
});

describe('SnapshotBuffer genérico — el comportamiento de la BATALLA queda intacto', () => {
  it('el default sigue siendo GhostSnapshot: push/renderAt con {t, distance, x}', () => {
    const buffer = new SnapshotBuffer();
    buffer.push({ t: 1000, distance: 100, x: 200 });
    buffer.push({ t: 1100, distance: 200, x: 260 });

    const mid = buffer.renderAt(1050);
    expect(mid).toEqual({ distance: 150, x: 230 }); // SIN t (mismo shape de M2)
    expect(buffer.latest!.t).toBe(1100); // latest SÍ conserva t
  });

  it('extrapolación acotada con campos de carrera (progress/o)', () => {
    const buffer = new SnapshotBuffer<RaceRemoteSample>();
    buffer.push({ t: 1000, progress: 5000, o: 0 });
    buffer.push({ t: 1100, progress: 5100, o: 10 });

    // 50 ms más allá del último: medio intervalo extra (a 100 px / 100 ms).
    const point = buffer.renderAt(1150)!;
    expect(point.progress).toBeCloseTo(5150, 6);
    expect(point.o).toBeCloseTo(15, 6);

    // Pasado el techo: congelado en el último valor extrapolable.
    const capped = buffer.renderAt(1100 + GHOST_MAX_EXTRAPOLATION_MS * 5)!;
    const atCap = buffer.renderAt(1100 + GHOST_MAX_EXTRAPOLATION_MS)!;
    expect(capped.progress).toBe(atCap.progress);
  });

  it('snapshots fuera de orden o con campos no finitos se descartan', () => {
    const buffer = new SnapshotBuffer<RaceRemoteSample>();
    buffer.push({ t: 1000, progress: 100, o: 0 });
    buffer.push({ t: 900, progress: 90, o: 0 }); // desordenado
    buffer.push({ t: 1100, progress: Number.NaN, o: 0 }); // corrupto
    expect(buffer.size).toBe(1);
    expect(buffer.latest!.progress).toBe(100);
  });
});
