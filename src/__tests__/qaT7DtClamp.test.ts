import { describe, expect, it } from 'vitest';
import { MAX_DT } from '../race/circuitPhysics';
import { LapTracker } from '../race/lapTracker';
import { buildTrackPath, getTrackById } from '../race/tracks';

/**
 * qaT7 (issue #35) — delta crudo en la ruta multi de RaceScene: el LapTracker
 * es el único consumidor puro de tiempo SIN techo (`Math.max(0, deltaMs)`).
 * En multi no hay auto-pausa: los tramos ausentes (background, sleep) no deben
 * contar para la carrera — justo para todos: nadie corre mientras está en
 * background — y el clamp con el MISMO techo que los sistemas puros (MAX_DT)
 * los descarta. Sin techo, totalMs/currentLapMs absorben el tramo y el `rfin`
 * propio reporta tiempos absurdos que corrompen la clasificación final multi.
 */

const path = buildTrackPath(getTrackById('monza')!);
const L = path.totalLength;
const SPEED = 250; // px/s del auto simulado
const MAX_DELTA_MS = MAX_DT * 1000;

/** Avanza `length` px desde `startS` a velocidad constante, con paso fijo. */
function drive(tracker: LapTracker, startS: number, length: number): void {
  const step = 25;
  let done = 0;
  while (done < length) {
    const advance = Math.min(step, length - done);
    done += advance;
    const s = (((startS + done) % L) + L) % L;
    tracker.update(s, (advance / SPEED) * 1000);
  }
}

describe('qaT7 lapTracker — techo de delta (issue #35)', () => {
  it('qaT7: un delta de 5 s (vuelta del background) no infla totalMs ni currentLapMs', () => {
    const tracker = new LapTracker(path);
    tracker.update(0, 16);
    tracker.update(25, 5000); // tramo entero en background

    expect(tracker.totalMs).toBe(16 + MAX_DELTA_MS);
    expect(tracker.currentLapMs).toBe(16 + MAX_DELTA_MS);
  });

  it('qaT7: cada update aporta a lo sumo MAX_DT (250 ms); negativo sigue siendo 0', () => {
    const tracker = new LapTracker(path);
    tracker.update(0, -5);
    expect(tracker.totalMs).toBe(0);

    tracker.update(0, 400); // por encima del techo
    tracker.update(25, 400);
    expect(tracker.totalMs).toBe(2 * MAX_DELTA_MS);
  });

  it('qaT7: control — una vuelta limpia con deltas normales sigue contando igual', () => {
    const tracker = new LapTracker(path);
    drive(tracker, 0, L + 10);

    expect(tracker.lapsCompleted).toBe(1);
    const expected = (L / SPEED) * 1000;
    expect(tracker.lastLapMs).toBeGreaterThan(expected * 0.98);
    expect(tracker.lastLapMs).toBeLessThan(expected * 1.02);
  });
});
