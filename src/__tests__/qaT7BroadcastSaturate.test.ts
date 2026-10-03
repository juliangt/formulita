import { describe, expect, it } from 'vitest';
import { scheduleRaceStateBroadcast } from '../race/raceBroadcast';

/**
 * qaT7 (issue #35) — saturación del acumulador del broadcast `rstate`.
 *
 * RaceScene acumulaba el delta crudo en un `while` sin techo de iteraciones:
 * un tramo gigante (vuelta del background en multi, sin auto-pausa) emite una
 * ráfaga de `rstate` idénticos en un solo frame. El cálculo se extrae a esta
 * función pura y adopta el patrón de referencia de GameScene: si el delta
 * acumulado alcanza el intervalo, se envía UNA vez y el acumulador se resetea
 * — nunca una ráfaga, y el tiempo ausente se descarta.
 */

const INTERVAL_MS = 1000 / 10; // STATE_HZ = 10

function runFrames(
  count: number,
  deltaMs: number,
): { sends: number; accumulatorMs: number } {
  let accumulatorMs = 0;
  let sends = 0;
  for (let i = 0; i < count; i += 1) {
    const next = scheduleRaceStateBroadcast(accumulatorMs, deltaMs, INTERVAL_MS);
    accumulatorMs = next.accumulatorMs;
    sends += next.sendCount;
  }
  return { sends, accumulatorMs };
}

describe('qaT7 broadcast — saturación del acumulador rstate (issue #35)', () => {
  it('qaT7: un delta gigante (5 s) produce a lo sumo 1 envío y resetea el acumulador', () => {
    const next = scheduleRaceStateBroadcast(0, 5000, INTERVAL_MS);

    expect(next.sendCount).toBeLessThanOrEqual(1);
    expect(next.sendCount).toBe(1);
    expect(next.accumulatorMs).toBe(0);
  });

  it('qaT7: por debajo del intervalo no envía y conserva el acumulado', () => {
    expect(scheduleRaceStateBroadcast(60, 20, INTERVAL_MS)).toEqual({
      accumulatorMs: 80,
      sendCount: 0,
    });
  });

  it('qaT7: frames normales mantienen la cadencia de 1/STATE_HZ sin ráfagas', () => {
    // 60 frames × 20 ms = 1200 ms a 10 Hz → 12 envíos, nunca más de 1 por frame.
    const { sends } = runFrames(60, 20);
    expect(sends).toBe(12);
  });

  it('qaT7: delta no finito o no positivo es inocuo para el acumulador', () => {
    expect(scheduleRaceStateBroadcast(80, Number.NaN, INTERVAL_MS)).toEqual({
      accumulatorMs: 80,
      sendCount: 0,
    });
    expect(scheduleRaceStateBroadcast(80, -50, INTERVAL_MS)).toEqual({
      accumulatorMs: 80,
      sendCount: 0,
    });
  });
});
