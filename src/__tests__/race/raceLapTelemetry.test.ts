import { afterEach, describe, expect, it, vi } from 'vitest';
import { LapTracker, type LapCompletedEvent } from '../../race/lapTracker';
import { buildTrackPath, getTrackById } from '../../race/tracks';
import { RaceScene } from '../../scenes/RaceScene';

/**
 * Telemetría #27 — `vuelta_completada` en RaceScene (issue #27).
 *
 * RaceScene no tiene harness de escena (los flujos de carrera del repo son
 * headless: física + LapTracker + ranking SIN Phaser, ver raceFlow.test.ts),
 * así que el gancho se testea DIRIGIDO sobre la escena real:
 * `new RaceScene()` + `init(data)` (parseo puro del init data) + la llamada
 * al método privado `trackLapCompleted` — exactamente el cuerpo que
 * `create()` cablea en `lapTracker.onLapCompleted`.
 *
 * `lapTracker` es SÓLO el del jugador local: cada rival (vs CPU) y cada
 * par remoto (multi) tiene su PROPIO LapTracker y ésos NO reportan — no
 * hay evento por rival. El test de flujo mínimo wirea un LapTracker REAL
 * (el mismo módulo que la escena usa) para probar que el `lapMs` del
 * evento viaja tal cual como `duracion_ms`.
 */

/** Crea la escena con init data parseado (sin Phaser: init es parseo puro). */
function createSceneHarness(init: Record<string, unknown>): {
  lapCompleted(event: LapCompletedEvent): void;
} {
  const scene = new RaceScene();
  scene.init(init);
  const internals = scene as unknown as {
    trackLapCompleted(event: LapCompletedEvent): void;
  };
  return { lapCompleted: (event) => internals.trackLapCompleted(event) };
}

function installCapture(): ReturnType<typeof vi.fn> {
  const capture = vi.fn();
  window.posthog = { capture };
  return capture;
}

/** Longitud y paso del piloto sintético (px y px/step), como lapTracker.test. */
const SPEED = 250;

function driveOneLap(tracker: LapTracker): void {
  const path = buildTrackPath(getTrackById('monza')!);
  const total = path.totalLength + 10;
  const step = 25;
  let done = 0;
  while (done < total) {
    const advance = Math.min(step, total - done);
    done += advance;
    const s = (done % path.totalLength + path.totalLength) % path.totalLength;
    tracker.update(s, (advance / SPEED) * 1000);
  }
}

describe('RaceScene — telemetría vuelta_completada (issue #27)', () => {
  afterEach(() => {
    delete window.posthog;
  });

  it('GRAN PREMIO (vs-cpu): reporta { pista, duracion_ms } con el lapMs del evento', () => {
    const capture = installCapture();
    const scene = createSceneHarness({
      trackId: 'monza',
      mode: 'vs-cpu',
      difficulty: 'hard',
      seed: 7,
    });

    scene.lapCompleted({ lap: 1, lapMs: 61234.5, bestLapMs: 61234.5, totalMs: 61234.5 });

    expect(capture).toHaveBeenCalledTimes(1);
    // Igualdad EXACTA: sólo pista y duración — ni dificultad, ni rivales,
    // ni nombres (que en vs CPU ni siquiera existen en el evento).
    expect(capture).toHaveBeenCalledWith('vuelta_completada', {
      pista: 'monza',
      duracion_ms: 61234.5,
    });
  });

  it('CARRERA multijugador (race): misma property pista, la de ESTA escena', () => {
    const capture = installCapture();
    const scene = createSceneHarness({
      trackId: 'spa',
      mode: 'race',
      seed: 3,
      players: [{ peerId: 'host-1', name: 'Ana', color: 0 }],
      myPeerId: 'host-1',
    });

    scene.lapCompleted({ lap: 2, lapMs: 59000, bestLapMs: 59000, totalMs: 120000 });

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith('vuelta_completada', {
      pista: 'spa',
      duracion_ms: 59000,
    });
  });

  it('la ÚLTIMA vuelta también reporta (el banner se salta, la telemetría no)', () => {
    const capture = installCapture();
    const scene = createSceneHarness({ trackId: 'galvez', mode: 'vs-cpu', difficulty: 'easy' });

    scene.lapCompleted({ lap: 3, lapMs: 60000, bestLapMs: 58000, totalMs: 181000 });

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith('vuelta_completada', {
      pista: 'galvez',
      duracion_ms: 60000,
    });
  });

  it('flujo mínimo con un LapTracker REAL: el lapMs de la vuelta viaja como duracion_ms', () => {
    const capture = installCapture();
    const scene = createSceneHarness({ trackId: 'monza', mode: 'vs-cpu', difficulty: 'normal' });

    const tracker = new LapTracker(buildTrackPath(getTrackById('monza')!));
    // Mismo cableado que hace create() (los rivales NO lo tienen).
    tracker.onLapCompleted = (event) => scene.lapCompleted(event);

    driveOneLap(tracker);

    expect(tracker.lapsCompleted).toBe(1);
    expect(capture).toHaveBeenCalledTimes(1);
    const [, properties] = capture.mock.calls[0] as [
      string,
      { pista: string; duracion_ms: number },
    ];
    expect(properties.pista).toBe('monza');
    // El tiempo reportado es EXACTAMENTE el lapMs del tracker (no totalMs ni
    // bestLapMs): una vuelta a 250 px/s sobre monza, en el orden de ~72 s.
    expect(properties.duracion_ms).toBe(tracker.lastLapMs);
    expect(properties.duracion_ms).toBeGreaterThan(0);
    expect(properties.duracion_ms).toBeLessThanOrEqual(tracker.totalMs);
  });

  it('capture roto NO rompe el reporte de la vuelta (fire-and-forget del wrapper)', () => {
    window.posthog = {
      capture: () => {
        throw new Error('red caída');
      },
    };
    const scene = createSceneHarness({ trackId: 'monza', mode: 'vs-cpu', difficulty: 'normal' });

    expect(() =>
      scene.lapCompleted({ lap: 1, lapMs: 1000, bestLapMs: 1000, totalMs: 1000 }),
    ).not.toThrow();
  });

  it('sin SDK cargado la vuelta se procesa igual (no-op seguro)', () => {
    delete window.posthog;
    const scene = createSceneHarness({ trackId: 'monza', mode: 'vs-cpu', difficulty: 'normal' });

    expect(() =>
      scene.lapCompleted({ lap: 1, lapMs: 1000, bestLapMs: 1000, totalMs: 1000 }),
    ).not.toThrow();
  });
});
