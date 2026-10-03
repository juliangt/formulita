import { describe, expect, it } from 'vitest';
import {
  AudioManager,
  type AudioBufferLike,
  type AudioContextStateLike,
  type BiquadFilterNodeLike,
  type GainNodeLike,
  type OscillatorNodeLike,
} from '../audio/AudioManager';
import { AUDIO } from '../config/balance';
import { FakeStorage } from './fakeStorage';

/**
 * qaT9 (issue #35) — el dron del motor no debe SUPERPONERSE consigo mismo:
 * `stopEngine` agenda el stop real a +0.30 s (fade de 0.25 s + margen) pero
 * suelta las referencias de inmediato; `startEngine` solo mira referencias,
 * así que una pausa+reanudar en menos de 0.30 s creaba un SEGUNDO grafo de
 * dron mientras el viejo todavía se oía (dos drones en paralelo).
 *
 * Contrato nuevo: `startEngine` dentro de la ventana de release READOPTA el
 * grafo en fade (cancela el fade, vuelve a subir la ganancia y reagenda el
 * stop lejos — por spec de Web Audio, el ÚLTIMO `stop()` es el que vale).
 * Fuera de la ventana los osciladores ya se frenaron y se crea grafo nuevo
 * (comportamiento previo, intacto).
 */

const RELEASE_STOP_MARGIN_SECONDS = 0.3; // 0.25 de fade + 0.05 de margen

/* --- Fakes mínimos de Web Audio (mismo patrón que audioManager.test.ts) --- */

type ScheduledEvent = { kind: string; value: number; time: number };

class FakeAudioParam {
  readonly scheduled: ScheduledEvent[] = [];

  constructor(public value: number = 0) {}

  setValueAtTime(value: number, startTime: number): FakeAudioParam {
    this.scheduled.push({ kind: 'setValueAtTime', value, time: startTime });
    this.value = value;
    return this;
  }

  linearRampToValueAtTime(value: number, endTime: number): FakeAudioParam {
    this.scheduled.push({ kind: 'linearRamp', value, time: endTime });
    return this;
  }

  exponentialRampToValueAtTime(value: number, endTime: number): FakeAudioParam {
    this.scheduled.push({ kind: 'exponentialRamp', value, time: endTime });
    return this;
  }

  setTargetAtTime(value: number, startTime: number, _tc: number): FakeAudioParam {
    this.scheduled.push({ kind: 'setTarget', value, time: startTime });
    return this;
  }

  cancelScheduledValues(startTime: number): FakeAudioParam {
    this.scheduled.push({ kind: 'cancel', value: Number.NaN, time: startTime });
    return this;
  }

  valuesOf(kind: string): number[] {
    return this.scheduled.filter((e) => e.kind === kind).map((e) => e.value);
  }
}

class FakeOscillator implements OscillatorNodeLike {
  type: OscillatorType = 'sine';
  readonly frequency = new FakeAudioParam(440);
  readonly started: number[] = [];
  readonly stopped: number[] = [];
  start(when?: number): void {
    this.started.push(when ?? 0);
  }
  stop(when?: number): void {
    this.stopped.push(when ?? 0);
  }
  connect(): FakeOscillator {
    return this;
  }
  disconnect(): void {}
}

class FakeGain implements GainNodeLike {
  readonly gain = new FakeAudioParam(1);
  connect(): FakeGain {
    return this;
  }
  disconnect(): void {}
}

class FakeFilter implements BiquadFilterNodeLike {
  type: BiquadFilterType = 'lowpass';
  readonly frequency = new FakeAudioParam(350);
  readonly Q = new FakeAudioParam(1);
  connect(): FakeFilter {
    return this;
  }
  disconnect(): void {}
}

class FakeAudioContext {
  currentTime = 0;
  readonly sampleRate = 48000;
  state: AudioContextStateLike = 'running';
  readonly destination = { connect: (): void => {} };
  onstatechange: (() => void) | null = null;

  readonly oscillators: FakeOscillator[] = [];
  readonly gains: FakeGain[] = [];
  readonly filters: FakeFilter[] = [];

  resume(): Promise<void> {
    this.state = 'running';
    this.onstatechange?.();
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.state = 'closed';
    return Promise.resolve();
  }

  createOscillator(): OscillatorNodeLike {
    const osc = new FakeOscillator();
    this.oscillators.push(osc);
    return osc;
  }

  createGain(): GainNodeLike {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }

  createBiquadFilter(): BiquadFilterNodeLike {
    const filter = new FakeFilter();
    this.filters.push(filter);
    return filter;
  }

  createBuffer(_channels: number, length: number, _rate: number): AudioBufferLike {
    return {
      getChannelData: () => new Float32Array(length),
    };
  }

  createBufferSource(): {
    buffer: AudioBufferLike | null;
    loop: boolean;
    started: number[];
    stopped: number[];
    connect: () => void;
    start: (when?: number) => void;
    stop: (when?: number) => void;
  } {
    const source = {
      buffer: null as AudioBufferLike | null,
      loop: false,
      started: [] as number[],
      stopped: [] as number[],
      connect: (): void => {},
      start: (when?: number) => {
        source.started.push(when ?? 0);
      },
      stop: (when?: number) => {
        source.stopped.push(when ?? 0);
      },
    };
    return source;
  }
}

function makeManager(ctx: FakeAudioContext): AudioManager {
  return new AudioManager({
    contextFactory: () => ctx as unknown as AudioContext,
    storage: new FakeStorage(),
    mediaElementFactory: () => null,
    visibilityTarget: null,
    onAudioBlocked: () => {},
    mobileProfile: false,
  });
}

describe('qaT9 — AudioManager: pausa+reanudar en la ventana de release no duplica el dron', () => {
  it('startEngine dentro de la ventana readopta el MISMO grafo (no crea otro)', () => {
    const ctx = new FakeAudioContext();
    const manager = makeManager(ctx);

    manager.startEngine();
    expect(ctx.oscillators.length).toBe(2);
    const [saw, sub] = ctx.oscillators;

    manager.stopEngine();
    expect(saw.stopped.length).toBe(1);

    // Reanudar inmediato (currentTime sin avanzar: dentro de la ventana).
    manager.startEngine();

    // El grafo es el MISMO: cero osciladores nuevos, el stop quedó re-agendado
    // lejos (el último stop gana por spec) y la ganancia vuelve a subir.
    expect(ctx.oscillators.length).toBe(2);
    expect(ctx.oscillators[0]).toBe(saw);
    expect(ctx.oscillators[1]).toBe(sub);
    expect(saw.started.length).toBe(1);
  });

  it('readoptar cancela el fade y vuelve a subir la ganancia al volumen del dron', () => {
    const ctx = new FakeAudioContext();
    const manager = makeManager(ctx);

    manager.startEngine();
    manager.stopEngine();
    manager.startEngine();

    const gain = ctx.gains[1].gain;
    // Tres rampas: ataque del primer arranque, fade del release (a casi cero)
    // y la re-subida del rearme (al volumen del dron, no a casi cero).
    const ramps = gain.valuesOf('exponentialRamp');
    expect(ramps.length).toBe(3);
    expect(ramps[1]).toBeLessThan(0.001);
    expect(ramps[2]).toBe(AUDIO.engineVolume);
    // Y el stop quedó re-agendado lejos del instante actual (no a +0.30 s).
    const stops = ctx.oscillators[0].stopped;
    expect(stops.length).toBe(2);
    expect(stops[1]).toBeGreaterThan(RELEASE_STOP_MARGIN_SECONDS);
  });

  it('el dron readoptado responde de nuevo a la velocidad reportada', () => {
    const ctx = new FakeAudioContext();
    const manager = makeManager(ctx);

    manager.startEngine();
    manager.stopEngine();
    manager.startEngine();

    const targetsBefore = ctx.oscillators[0].frequency.valuesOf('setTarget').length;
    manager.setEngineSpeed(650);
    expect(ctx.oscillators[0].frequency.valuesOf('setTarget').length).toBe(targetsBefore + 1);
  });

  it('un stopEngine posterior al rearme vuelve a programar el release real', () => {
    const ctx = new FakeAudioContext();
    const manager = makeManager(ctx);

    manager.startEngine();
    manager.stopEngine();
    manager.startEngine();
    manager.stopEngine();

    // Último stop = release real (currentTime + fade + margen), no el horizonte.
    const stops = ctx.oscillators[0].stopped;
    expect(stops.length).toBe(3); // release, re-agendado del adopt, release final
    expect(stops[2]).toBeCloseTo(RELEASE_STOP_MARGIN_SECONDS, 5);
  });

  it('startEngine FUERA de la ventana crea grafo nuevo (los osciladores ya frenaron)', () => {
    const ctx = new FakeAudioContext();
    const manager = makeManager(ctx);

    manager.startEngine();
    manager.stopEngine();

    // Pasó el tiempo del release: los osciladores viejos ya se frenaron y no
    // hay nada que readoptar.
    ctx.currentTime = RELEASE_STOP_MARGIN_SECONDS + 1;
    manager.startEngine();

    expect(ctx.oscillators.length).toBe(4);
    expect(ctx.oscillators[0].started.length).toBe(1);
    expect(ctx.oscillators[2].started.length).toBe(1);
  });
});
