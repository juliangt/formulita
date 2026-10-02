import { describe, expect, it } from 'vitest';
import { CIRCUIT } from '../../config/balance';
import { LapTracker } from '../../race/lapTracker';
import { buildTrackPath, getTrackById } from '../../race/tracks';

/**
 * Tests del LapTracker (issue #9, V0): vueltas sólo con los 8 sectores pisados
 * EN ORDEN, anti-corte (saltar sectores no suma vuelta), retroceso sobre la
 * meta, 3 vueltas completas y tiempos coherentes. Se alimenta `s` directo.
 */

const path = buildTrackPath(getTrackById('monza')!);
const L = path.totalLength;
const SPEED = 250; // px/s del auto simulado

/** Avanza `length` px desde `startS` a velocidad constante, con paso fijo. */
function drive(
  tracker: LapTracker,
  startS: number,
  length: number,
  timeScale = 1,
): void {
  const step = 25;
  let done = 0;
  while (done < length) {
    const advance = Math.min(step, length - done);
    done += advance;
    const s = (((startS + done) % L) + L) % L;
    tracker.update(s, (advance / SPEED) * 1000 * timeScale);
  }
}

function newTracker(): LapTracker {
  return new LapTracker(path);
}

describe('LapTracker — vueltas y sectores', () => {
  it('una vuelta limpia desde la línea cuenta exactamente 1', () => {
    const tracker = newTracker();
    drive(tracker, 0, L + 10);
    expect(tracker.lapsCompleted).toBe(1);
    expect(tracker.currentLap).toBe(2);
    expect(tracker.finished).toBe(false);
  });

  it('3 vueltas completas desde la parrilla terminan la carrera', () => {
    const tracker = newTracker();
    const laps: number[] = [];
    tracker.onLapCompleted = (e) => laps.push(e.lap);
    let finishedEvents = 0;
    tracker.onRaceFinished = () => {
      finishedEvents += 1;
    };

    // Parrilla: gridStartOffsetPx + una fila, detrás de la meta.
    const grid = L - CIRCUIT.gridStartOffsetPx;
    drive(tracker, grid, CIRCUIT.gridStartOffsetPx + 3 * L + 10);

    expect(tracker.lapsCompleted).toBe(3);
    expect(laps).toEqual([1, 2, 3]);
    expect(tracker.finished).toBe(true);
    expect(finishedEvents).toBe(1);
    expect(tracker.currentLap).toBe(3);
  });

  it('cortarse sectores (saltar por el pasto) NO suma vuelta', () => {
    const tracker = newTracker();
    // Sector 0 pisado, salto hasta el sector 6, cruzo la meta: faltan sectores.
    drive(tracker, 0, L * 0.125);
    tracker.update(L * 0.75, 1000);
    drive(tracker, L * 0.75, L * 0.26);
    expect(tracker.lapsCompleted).toBe(0);

    // La vuelta siguiente limpia sí cuenta.
    drive(tracker, L * 0.01, L + 10);
    expect(tracker.lapsCompleted).toBe(1);
  });

  it('un salto a mitad de vuelta rompe el intento aunque se crucen 7 sectores', () => {
    const tracker = newTracker();
    drive(tracker, 0, L * 0.3); // sectores 0-2
    tracker.update(L * 0.875, 1000); // teletransporte al sector 7
    drive(tracker, L * 0.875, L * 0.14); // sector 7 y cruce
    expect(tracker.lapsCompleted).toBe(0);
  });

  it('retroceder sobre la meta no cuenta ni corrompe la vuelta siguiente', () => {
    const tracker = newTracker();
    drive(tracker, 0, L * 0.05);
    // Retrorceso envolvente: de 0.05L hacia atrás a 0.98L.
    tracker.update(L * 0.98, 1000);
    drive(tracker, L * 0.98, L * 0.04); // re-cruce hacia adelante
    expect(tracker.lapsCompleted).toBe(0);
    drive(tracker, L * 0.02, L + 10); // vuelta limpia
    expect(tracker.lapsCompleted).toBe(1);
  });

  it('el puntero de sector exige orden: re-pisar atrás no descontiene el avance', () => {
    const tracker = newTracker();
    // Sectores 0-1 pisados; salto atrás al sector 0 y re-avanzo: los sectores
    // 0 y 1 re-pisados NO re-avanzan el puntero (sigue en 2), pero como los 8
    // quedaron pisados en orden desde el último cruce, la vuelta sí cuenta.
    drive(tracker, 0, L * 0.251); // sectores 0-1
    tracker.update(L * 0.02, 1000); // salto atrás al sector 0
    drive(tracker, L * 0.02, L - L * 0.02 + 10); // vuelta completa
    expect(tracker.lapsCompleted).toBe(1);
  });
});

describe('LapTracker — tiempos', () => {
  it('lastLapMs refleja el tiempo de vuelta a velocidad constante', () => {
    const tracker = newTracker();
    drive(tracker, 0, L + 10);
    const expected = (L / SPEED) * 1000;
    expect(tracker.lastLapMs).toBeGreaterThan(expected * 0.98);
    expect(tracker.lastLapMs).toBeLessThan(expected * 1.02);
    expect(tracker.bestLapMs).toBe(tracker.lastLapMs);
    expect(tracker.currentLapMs).toBeGreaterThan(0);
  });

  it('bestLapMs queda con la menor; currentLapMs se resetea por vuelta', () => {
    const tracker = newTracker();
    drive(tracker, 0, L + 10); // vuelta 1 a 250 px/s
    const first = tracker.lastLapMs;
    // Vuelta 2 "más rápida": mismos px con deltas a la mitad.
    drive(tracker, 10, L, 0.5);
    expect(tracker.lapsCompleted).toBe(2);
    expect(tracker.lastLapMs).toBeLessThan(first);
    expect(tracker.bestLapMs).toBe(tracker.lastLapMs);
  });

  it('totalMs acumula siempre; updates no finitos son no-op', () => {
    const tracker = newTracker();
    tracker.update(Number.NaN, 16);
    tracker.update(0, Number.NaN);
    expect(tracker.totalMs).toBe(0);
    expect(tracker.lapsCompleted).toBe(0);
    tracker.update(0, 16);
    expect(tracker.totalMs).toBe(16);
  });

  it('reset vuelve al estado inicial', () => {
    const tracker = newTracker();
    drive(tracker, 0, L + 10);
    expect(tracker.lapsCompleted).toBe(1);
    tracker.reset();
    expect(tracker.lapsCompleted).toBe(0);
    expect(tracker.lastLapMs).toBe(0);
    expect(tracker.bestLapMs).toBe(0);
    expect(tracker.totalMs).toBe(0);
    expect(tracker.finished).toBe(false);
    drive(tracker, 0, L + 10);
    expect(tracker.lapsCompleted).toBe(1);
  });
});
