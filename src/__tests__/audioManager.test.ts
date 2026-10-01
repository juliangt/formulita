import { describe, expect, it } from 'vitest';
import {
  AUDIO_SETTINGS_STORAGE_KEY,
  AudioManager,
  engineFrequencyForSpeed,
  getAudioEngine,
  type AudioBufferLike,
  type AudioBufferSourceNodeLike,
  type AudioContextFactory,
  type AudioContextLike,
  type AudioContextStateLike,
  type AudioDestinationNodeLike,
  type AudioNodeLike,
  type AudioParamLike,
  type BiquadFilterNodeLike,
  type GainNodeLike,
  type OscillatorNodeLike,
  type UnlockEventTarget,
} from '../audio/AudioManager';
import { AUDIO_ENGINE_REGISTRY_KEY } from '../audio/ISfxEngine';
import { AUDIO, DRS_MULTIPLIER, MAX_SPEED, TURBO_MULTIPLIER } from '../config/balance';
import { EventBus, type GameEvents } from '../core/EventBus';
import { FakeStorage } from './fakeStorage';

/**
 * Tests del AudioManager (Fase 6) SIN Web Audio real: el acceso al
 * AudioContext está abstraído detrás de `AudioContextLike` (inyectable por
 * factory), así que acá se usan fakes que GRABAN nodos creados, arranques/
 * paradas y envelopes programados. Se cubren: el mapeo velocidad→frecuencia
 * del motor (monótono, con y sin turbo), envelopes no negativos, mute sin
 * emisión de nodos, unlock idempotente, degradación (factory null o que
 * lanza) y la persistencia del mute con un storage fake.
 */

/* ------------------------------------------------------------------ */
/* Fakes de Web Audio                                                  */
/* ------------------------------------------------------------------ */

type ScheduledEvent = { kind: string; value: number; time: number };

class FakeAudioParam implements AudioParamLike {
  readonly scheduled: ScheduledEvent[] = [];

  constructor(public value: number = 0) {}

  setValueAtTime(value: number, startTime: number): AudioParamLike {
    this.scheduled.push({ kind: 'setValueAtTime', value, time: startTime });
    this.value = value;
    return this;
  }

  linearRampToValueAtTime(value: number, endTime: number): AudioParamLike {
    this.scheduled.push({ kind: 'linearRamp', value, time: endTime });
    return this;
  }

  exponentialRampToValueAtTime(value: number, endTime: number): AudioParamLike {
    this.scheduled.push({ kind: 'exponentialRamp', value, time: endTime });
    return this;
  }

  setTargetAtTime(value: number, startTime: number, _timeConstant: number): AudioParamLike {
    this.scheduled.push({ kind: 'setTarget', value, time: startTime });
    return this;
  }

  cancelScheduledValues(startTime: number): AudioParamLike {
    this.scheduled.push({ kind: 'cancel', value: Number.NaN, time: startTime });
    return this;
  }

  /** Valores programados de un tipo (para asertar envelopes). */
  valuesOf(kind: string): number[] {
    return this.scheduled.filter((e) => e.kind === kind).map((e) => e.value);
  }
}

class FakeNode {
  readonly connections: unknown[] = [];
  disconnected = 0;

  connect(destination: AudioNodeLike): AudioNodeLike {
    this.connections.push(destination);
    return destination;
  }

  disconnect(): void {
    this.disconnected += 1;
  }
}

class FakeOscillator extends FakeNode implements OscillatorNodeLike {
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
}

class FakeGain extends FakeNode implements GainNodeLike {
  readonly gain = new FakeAudioParam(1);
}

class FakeFilter extends FakeNode implements BiquadFilterNodeLike {
  type: BiquadFilterType = 'lowpass';
  readonly frequency = new FakeAudioParam(350);
  readonly Q = new FakeAudioParam(1);
}

class FakeBufferSource extends FakeNode implements AudioBufferSourceNodeLike {
  buffer: AudioBufferLike | null = null;
  loop = false;
  readonly started: number[] = [];
  readonly stopped: number[] = [];

  start(when?: number): void {
    this.started.push(when ?? 0);
  }

  stop(when?: number): void {
    this.stopped.push(when ?? 0);
  }
}

class FakeBuffer implements AudioBufferLike {
  constructor(
    readonly channels: number,
    readonly length: number,
    readonly rate: number,
  ) {}

  getChannelData(channel: number): Float32Array {
    if (channel < 0 || channel >= this.channels) {
      throw new Error('canal inválido (fake)');
    }
    return new Float32Array(this.length);
  }
}

class FakeAudioContext implements AudioContextLike {
  currentTime = 0;
  readonly sampleRate = 48000;
  state: AudioContextStateLike = 'suspended';
  readonly destination: AudioDestinationNodeLike = new FakeNode();

  resumeCount = 0;
  closeCount = 0;
  readonly oscillators: FakeOscillator[] = [];
  readonly gains: FakeGain[] = [];
  readonly filters: FakeFilter[] = [];
  readonly sources: FakeBufferSource[] = [];
  readonly buffers: FakeBuffer[] = [];

  resume(): Promise<void> {
    this.resumeCount += 1;
    this.state = 'running';
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closeCount += 1;
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

  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBufferLike {
    const buffer = new FakeBuffer(numberOfChannels, length, sampleRate);
    this.buffers.push(buffer);
    return buffer;
  }

  createBufferSource(): AudioBufferSourceNodeLike {
    const source = new FakeBufferSource();
    this.sources.push(source);
    return source;
  }
}

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */

interface Harness {
  manager: AudioManager;
  ctx: FakeAudioContext;
  factoryCalls: () => number;
  bus: EventBus<GameEvents>;
}

/** Manager + contexto fake + bus conectado (el flujo real de Boot). */
function makeHarness(options?: {
  throws?: boolean;
  storage?: Storage | null;
  withBus?: boolean;
}): Harness {
  let calls = 0;
  const ctx = new FakeAudioContext();
  const factory: AudioContextFactory = () => {
    calls += 1;
    if (options?.throws) {
      throw new Error('audio roto (fake)');
    }
    return ctx;
  };
  const manager = new AudioManager({
    contextFactory: factory,
    storage: options?.storage === undefined ? new FakeStorage() : options.storage,
  });
  const bus = new EventBus<GameEvents>();
  if (options?.withBus) {
    manager.attachBus(bus);
  }
  return { manager, ctx, factoryCalls: () => calls, bus };
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe('engineFrequencyForSpeed — mapeo velocidad → frecuencia', () => {
  const CEILING = MAX_SPEED * Math.max(1, TURBO_MULTIPLIER) * Math.max(1, DRS_MULTIPLIER);

  it('es monótona creciente sin turbo', () => {
    let prev = engineFrequencyForSpeed(0, false);
    for (let speed = 10; speed <= 900; speed += 10) {
      const next = engineFrequencyForSpeed(speed, false);
      expect(next).toBeGreaterThanOrEqual(prev);
      prev = next;
    }
  });

  it('es monótona creciente con turbo activo', () => {
    let prev = engineFrequencyForSpeed(0, true);
    for (let speed = 10; speed <= 900; speed += 10) {
      const next = engineFrequencyForSpeed(speed, true);
      expect(next).toBeGreaterThanOrEqual(prev);
      prev = next;
    }
  });

  it('el turbo sube (o iguala) la frecuencia a igual velocidad', () => {
    for (let speed = 0; speed <= 900; speed += 25) {
      expect(engineFrequencyForSpeed(speed, true)).toBeGreaterThanOrEqual(
        engineFrequencyForSpeed(speed, false),
      );
    }
  });

  it('clampea y siempre devuelve un número finito positivo', () => {
    expect(engineFrequencyForSpeed(Number.NaN)).toBe(engineFrequencyForSpeed(0));
    expect(engineFrequencyForSpeed(-1000, true)).toBeGreaterThan(0);
    // Por encima del techo combinado turbo × DRS se queda en el máximo.
    expect(engineFrequencyForSpeed(CEILING + 5000)).toBe(engineFrequencyForSpeed(CEILING));
    expect(Number.isFinite(engineFrequencyForSpeed(Number.POSITIVE_INFINITY))).toBe(true);
  });

  it('mapea la punta combinada al máximo configurado', () => {
    expect(engineFrequencyForSpeed(CEILING)).toBeCloseTo(AUDIO.engineFreqMax, 5);
  });
});

describe('AudioManager — síntesis de SFX', () => {
  it('coin crea oscilador de dos tonos + ganancia y lo arranca', () => {
    const { manager, ctx } = makeHarness();

    manager.play('coin');

    expect(ctx.oscillators.length).toBe(1);
    expect(ctx.oscillators[0].type).toBe('sine');
    // Master + ganancia del SFX.
    expect(ctx.gains.length).toBe(2);
    expect(ctx.oscillators[0].started.length).toBe(1);
    expect(ctx.oscillators[0].frequency.valuesOf('setValueAtTime')).toEqual([988, 1319]);
  });

  it('los SFX de ruido comparten UN buffer de ruido blanco', () => {
    const { manager, ctx } = makeHarness();

    manager.play('turbo');
    manager.play('drs');
    manager.play('crash');

    expect(ctx.buffers.length).toBe(1);
    expect(ctx.sources.length).toBe(3);
    expect(ctx.filters.length).toBeGreaterThanOrEqual(3);
  });

  it('todos los SFX se sintetizan sin lanzar', () => {
    const names = ['click', 'coin', 'pickup', 'turbo', 'drs', 'crash'] as const;
    for (const name of names) {
      const { manager } = makeHarness();
      expect(() => manager.play(name)).not.toThrow();
    }
  });

  it('los envelopes de ganancia nunca son negativos y los exponenciales > 0', () => {
    const names = ['click', 'coin', 'pickup', 'turbo', 'drs', 'crash'] as const;
    for (const name of names) {
      const { manager, ctx } = makeHarness();
      manager.play(name);
      for (const gain of ctx.gains) {
        for (const event of gain.gain.scheduled) {
          if (event.kind === 'cancel') {
            continue;
          }
          expect(event.value, `${name}: valor ${event.kind}`).toBeGreaterThanOrEqual(0);
          if (event.kind === 'exponentialRamp') {
            expect(event.value, `${name}: exponencial hasta 0`).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it('muteado NO emite nodos', () => {
    const { manager, ctx } = makeHarness();
    manager.setMuted(true);

    manager.play('coin');
    manager.play('crash');
    manager.play('click');

    expect(ctx.oscillators.length).toBe(0);
    expect(ctx.gains.length).toBe(0);
    expect(ctx.sources.length).toBe(0);
    expect(ctx.buffers.length).toBe(0);
  });

  it('degrada a no-op cuando Web Audio no existe (factory null)', () => {
    let calls = 0;
    const manager = new AudioManager({
      contextFactory: () => {
        calls += 1;
        return null;
      },
      storage: new FakeStorage(),
    });

    expect(() => {
      manager.play('coin');
      manager.unlock();
      manager.startEngine();
      manager.setEngineSpeed(400);
      manager.stopEngine();
      manager.setMuted(true);
    }).not.toThrow();
    expect(manager.isMuted).toBe(true);
    expect(calls).toBe(1); // el fallo se cachea: no reintenta en cada uso
  });

  it('una factory que lanza degrada y cachea el fallo (no reintenta por play)', () => {
    const { manager, factoryCalls } = makeHarness({ throws: true });

    expect(() => manager.play('coin')).not.toThrow();
    expect(() => manager.play('crash')).not.toThrow();
    expect(() => manager.unlock()).not.toThrow();

    expect(factoryCalls()).toBe(1);
  });
});

describe('AudioManager — unlock (política de autoplay)', () => {
  it('es idempotente: crea el contexto una vez y resume solo lo suspendido', () => {
    const { manager, ctx, factoryCalls } = makeHarness();
    expect(ctx.state).toBe('suspended');

    manager.unlock();
    manager.unlock();
    manager.unlock();

    expect(factoryCalls()).toBe(1); // el contexto se cachea
    expect(ctx.resumeCount).toBe(1); // ya corriendo → sin más resume
  });

  it('con el contexto ya corriendo no vuelve a resume', () => {
    const { manager, ctx } = makeHarness();
    ctx.state = 'running';

    manager.unlock();

    expect(ctx.resumeCount).toBe(0);
  });

  it('unlock tolera el contexto que lanza en resume', () => {
    const { manager, ctx } = makeHarness();
    ctx.resume = () => {
      throw new Error('resume bloqueado (fake)');
    };

    expect(() => manager.unlock()).not.toThrow();
  });
});

describe('AudioManager — listeners de desbloqueo por gesto', () => {
  class FakeEventTarget implements UnlockEventTarget {
    readonly listeners = new Map<string, () => void>();
    removed = 0;

    addEventListener(
      type: 'pointerdown' | 'pointerup' | 'touchend' | 'keydown',
      handler: () => void,
    ): void {
      this.listeners.set(type, handler);
    }

    removeEventListener(
      type: 'pointerdown' | 'pointerup' | 'touchend' | 'keydown',
      _handler: () => void,
    ): void {
      this.listeners.delete(type);
      this.removed += 1;
    }

    /** Simula el gesto del usuario. */
    gesture(type: 'pointerdown' | 'pointerup' | 'touchend' | 'keydown'): void {
      this.listeners.get(type)?.();
    }
  }

  it('pointerdown y keydown desbloquean (una sola vez cada uno)', () => {
    const { manager, ctx, factoryCalls } = makeHarness();
    const target = new FakeEventTarget();

    manager.attachUnlockListeners(target);
    manager.attachUnlockListeners(new FakeEventTarget()); // idempotente

    target.gesture('pointerdown');
    target.gesture('keydown');

    expect(factoryCalls()).toBe(1);
    expect(ctx.resumeCount).toBe(1);
  });

  it('touchend y pointerup también desbloquean (iOS libera el audio al soltar)', () => {
    const { manager, ctx, factoryCalls } = makeHarness();
    const target = new FakeEventTarget();

    manager.attachUnlockListeners(target);

    target.gesture('touchend');
    expect(factoryCalls()).toBe(1);
    expect(ctx.resumeCount).toBe(1);

    // Contexto ya corriendo: el segundo gesto no vuelve a resume.
    target.gesture('pointerup');
    expect(ctx.resumeCount).toBe(1);
  });

  it('el desbloqueo sirve el primer buffer silencioso UNA vez (ritual iOS)', () => {
    const { manager, ctx } = makeHarness();

    manager.unlock();
    manager.unlock();

    // Un buffer de silencio de 1 canal, conectado a destination y arrancado.
    expect(ctx.buffers.length).toBe(1);
    expect(ctx.sources.length).toBe(1);
    expect(ctx.sources[0].connections.length).toBeGreaterThan(0);
    expect(ctx.sources[0].started.length).toBe(1);
    // Con el contexto ya corriendo no vuelve a primar ni a resume.
    manager.unlock();
    expect(ctx.buffers.length).toBe(1);
    expect(ctx.resumeCount).toBe(1);
  });

  it('dispose quita los listeners instalados', () => {
    const { manager } = makeHarness();
    const target = new FakeEventTarget();

    manager.attachUnlockListeners(target);
    manager.dispose();

    expect(target.removed).toBe(4);
    target.gesture('pointerdown'); // ya no llega a nada
    expect(target.listeners.size).toBe(0);
  });
});

describe('AudioManager — mute persistido (clave formulita.audio.v1)', () => {
  it('setMuted(true) persiste {muted:true} bajo la clave versionada', () => {
    const storage = new FakeStorage();
    const { manager } = makeHarness({ storage });

    manager.setMuted(true);

    expect(storage.raw(AUDIO_SETTINGS_STORAGE_KEY)).toBe(JSON.stringify({ muted: true }));
    expect(manager.isMuted).toBe(true);
  });

  it('una nueva instancia sobre el mismo storage arranca muteada (recarga simulada)', () => {
    const storage = new FakeStorage();
    const first = makeHarness({ storage });
    first.manager.setMuted(true);

    const second = makeHarness({ storage });

    expect(second.manager.isMuted).toBe(true);
  });

  it('JSON corrupto o con tipos inválidos cae a unmuteado sin lanzar', () => {
    const corrupt = new FakeStorage();
    corrupt.setItem(AUDIO_SETTINGS_STORAGE_KEY, '{no es json');
    expect(makeHarness({ storage: corrupt }).manager.isMuted).toBe(false);

    const garbage = new FakeStorage();
    garbage.setItem(AUDIO_SETTINGS_STORAGE_KEY, JSON.stringify({ muted: 'sí', extra: 1 }));
    expect(makeHarness({ storage: garbage }).manager.isMuted).toBe(false);

    const notObject = new FakeStorage();
    notObject.setItem(AUDIO_SETTINGS_STORAGE_KEY, '42');
    expect(makeHarness({ storage: notObject }).manager.isMuted).toBe(false);
  });

  it('storage que bloquea la escritura: el mute rige en la sesión sin lanzar', () => {
    const storage = new FakeStorage();
    storage.failWrites = true;
    const { manager } = makeHarness({ storage });

    expect(() => manager.setMuted(true)).not.toThrow();
    expect(manager.isMuted).toBe(true);
    expect(storage.length).toBe(0);
  });

  it('storage null: el mute funciona solo en memoria', () => {
    const { manager } = makeHarness({ storage: null });

    manager.setMuted(true);
    expect(manager.isMuted).toBe(true);
  });
});

describe('AudioManager — dron del motor', () => {
  it('arranca dos osciladores (sawtooth + sine) con ataque suave', () => {
    const { manager, ctx } = makeHarness();

    manager.startEngine();

    expect(ctx.oscillators.length).toBe(2);
    expect(ctx.oscillators[0].type).toBe('sawtooth');
    expect(ctx.oscillators[1].type).toBe('sine');
    expect(ctx.oscillators[0].started.length).toBe(1);
    expect(ctx.oscillators[1].started.length).toBe(1);
    // El sub suena una octava abajo.
    expect(ctx.oscillators[1].frequency.value).toBe(ctx.oscillators[0].frequency.value / 2);
    // Master + gain del dron: el dron entra con rampa exponencial al volumen.
    const engineGain = ctx.gains[1].gain;
    expect(engineGain.valuesOf('exponentialRamp')).toEqual([AUDIO.engineVolume]);
    // Idempotente: un segundo start no duplica osciladores.
    manager.startEngine();
    expect(ctx.oscillators.length).toBe(2);
  });

  it('programa la frecuencia según la velocidad con umbral anti-spam', () => {
    const { manager, ctx } = makeHarness();
    manager.startEngine();
    const sawFreq = ctx.oscillators[0].frequency;

    manager.setEngineSpeed(300);
    const afterFirst = sawFreq.valuesOf('setTarget').length;
    expect(afterFirst).toBe(1);
    expect(sawFreq.valuesOf('setTarget')[0]).toBe(engineFrequencyForSpeed(300));

    // Variación menor al umbral (0.75 Hz) → no reprograma.
    manager.setEngineSpeed(300.5);
    expect(sawFreq.valuesOf('setTarget').length).toBe(afterFirst);

    // Cambio grande → reprograma monótono.
    manager.setEngineSpeed(700);
    const targets = sawFreq.valuesOf('setTarget');
    expect(targets.length).toBe(2);
    expect(targets[1]).toBeGreaterThan(targets[0]);
  });

  it('con turbo activo la frecuencia programada sube', () => {
    const { manager, ctx } = makeHarness();
    manager.startEngine();
    const sawFreq = ctx.oscillators[0].frequency;
    const lastTarget = (): number => {
      const values = sawFreq.valuesOf('setTarget');
      return values[values.length - 1];
    };

    manager.setEngineSpeed(400);
    const withoutTurbo = engineFrequencyForSpeed(400, false);
    expect(lastTarget()).toBe(withoutTurbo);

    manager.setTurboActive(true);
    const withTurbo = engineFrequencyForSpeed(400, true);
    expect(withTurbo).toBeGreaterThan(withoutTurbo);
    expect(lastTarget()).toBe(withTurbo);
  });

  it('stopEngine para los osciladores y libera las referencias', () => {
    const { manager, ctx } = makeHarness();
    manager.startEngine();

    manager.stopEngine();

    expect(ctx.oscillators[0].stopped.length).toBe(1);
    expect(ctx.oscillators[1].stopped.length).toBe(1);
    // Sin referencias: seguir reportando velocidad es un no-op seguro.
    manager.setEngineSpeed(500);
    expect(ctx.oscillators[0].frequency.valuesOf('setTarget').length).toBe(0);
  });

  it('pausa y reanudar (Fase 7) apagan y vuelven a encender el dron', () => {
    const { ctx, bus } = makeHarness({ withBus: true });

    bus.emit('game-start', undefined);
    expect(ctx.oscillators.length).toBe(2);

    // Pausa: el dron se apaga y deja de seguir la velocidad.
    bus.emit('game-paused', undefined);
    expect(ctx.oscillators[0].stopped.length).toBe(1);
    const targetsWhilePaused = ctx.oscillators[0].frequency.valuesOf('setTarget').length;
    bus.emit('speed', 600);
    expect(ctx.oscillators[0].frequency.valuesOf('setTarget').length).toBe(targetsWhilePaused);

    // Reanudar: dos osciladores NUEVOS (los viejos quedaron con stop programado).
    bus.emit('game-resumed', undefined);
    expect(ctx.oscillators.length).toBe(4);
    expect(ctx.oscillators[2].started.length).toBe(1);
    expect(ctx.oscillators[3].started.length).toBe(1);

    // Abandono (MENÚ desde la pausa): corta el dron sin SFX de crash.
    const sourcesBefore = ctx.sources.length;
    bus.emit('game-aborted', undefined);
    expect(ctx.oscillators[2].stopped.length).toBe(1);
    expect(ctx.sources.length).toBe(sourcesBefore);
  });
});

describe('AudioManager — integración por EventBus', () => {
  it('game-start arranca el dron; game-over suena el crash y lo apaga', () => {
    const { ctx, bus } = makeHarness({ withBus: true });

    bus.emit('game-start', undefined);
    expect(ctx.oscillators.length).toBe(2);

    bus.emit('game-over', { score: 100, distance: 500, coins: 2 });

    // El crash suma su oscilador de caída de tono y un source de ruido; hay
    // que sumar también el PRIMER de desbloqueo iOS (game-start → startEngine
    // → unlock resume por primera vez y sirve el buffer de silencio).
    expect(ctx.sources.length).toBe(2);
    expect(ctx.oscillators.length).toBe(3);
    // Los osciladores del dron quedaron con stop programado a futuro.
    expect(ctx.oscillators[0].stopped.length).toBe(1);
    expect(ctx.oscillators[0].stopped[0]).toBeGreaterThan(ctx.currentTime);
    // Y el dron ya no responde a más velocidad.
    const sawTargets = ctx.oscillators[0].frequency.valuesOf('setTarget').length;
    bus.emit('speed', 800);
    expect(ctx.oscillators[0].frequency.valuesOf('setTarget').length).toBe(sawTargets);
  });

  it('coins, pickup y ui-click disparan sus SFX por el bus', () => {
    const { ctx, bus } = makeHarness({ withBus: true });

    bus.emit('coins', 1);
    bus.emit('coins', 2);
    bus.emit('pickup', 'turbo');
    bus.emit('ui-click', undefined);

    // 2 monedas + 1 pickup + 1 click = 4 osciladores; el pickup es barrido
    // de oscilador (sin ruido) y el click no arranca el dron.
    expect(ctx.oscillators.length).toBe(4);
    expect(ctx.sources.length).toBe(0);
  });

  it('mute viaja por el bus: master a cero y ajuste persistido', () => {
    const storage = new FakeStorage();
    const { manager, ctx, bus } = makeHarness({ withBus: true, storage });
    manager.play('click'); // asegura la cadena maestra (gains[0] = master)
    const masterGain = ctx.gains[0].gain;

    bus.emit('mute', true);

    expect(masterGain.valuesOf('linearRamp')).toEqual([0]);
    expect(storage.raw(AUDIO_SETTINGS_STORAGE_KEY)).toBe(JSON.stringify({ muted: true }));

    bus.emit('mute', false);
    const ramps = masterGain.valuesOf('linearRamp');
    expect(ramps[ramps.length - 1]).toBeGreaterThan(0);
  });

  it('turbo y drs suenan SOLO en el borde ascendente a activo', () => {
    const { ctx, bus } = makeHarness({ withBus: true });

    bus.emit('turbo', { level: 50, active: true });
    bus.emit('turbo', { level: 40, active: true }); // sigue activo: sin SFX
    bus.emit('turbo', { level: 0, active: false });
    bus.emit('turbo', { level: 60, active: true });
    expect(ctx.sources.length).toBe(2); // dos whooshes

    bus.emit('drs', { state: 'active', cooldownRatio: 0, cooldownSeconds: 0 });
    bus.emit('drs', { state: 'active', cooldownRatio: 0, cooldownSeconds: 0 });
    bus.emit('drs', { state: 'cooldown', cooldownRatio: 0.5, cooldownSeconds: 4 });
    bus.emit('drs', { state: 'ready', cooldownRatio: 0, cooldownSeconds: 0 });
    bus.emit('drs', { state: 'active', cooldownRatio: 0, cooldownSeconds: 0 });
    expect(ctx.sources.length).toBe(4); // + dos hisses
  });

  it('game-start resetea los bordes: DRS activo al arrancar vuelve a sonar', () => {
    const { ctx, bus } = makeHarness({ withBus: true });

    bus.emit('drs', { state: 'active', cooldownRatio: 0, cooldownSeconds: 0 });
    bus.emit('drs', { state: 'active', cooldownRatio: 0, cooldownSeconds: 0 });
    bus.emit('game-start', undefined);
    bus.emit('drs', { state: 'active', cooldownRatio: 0, cooldownSeconds: 0 });

    // Dos hisses + el primer silencioso del unlock que dispara game-start.
    expect(ctx.sources.length).toBe(3);
  });

  it('el detacher de attachBus corta la conexión', () => {
    const { manager, ctx, bus } = makeHarness(); // sin conexión previa
    const detach = manager.attachBus(bus);

    bus.emit('coins', 1);
    expect(ctx.oscillators.length).toBe(1);

    detach();
    detach(); // idempotente

    bus.emit('coins', 2);
    expect(ctx.oscillators.length).toBe(1);
  });
});

describe('getAudioEngine — resolución desde el registry', () => {
  /** Registry fake mínimo (la misma porción que Phaser.Data.DataManager). */
  class FakeRegistry {
    private readonly map = new Map<string, unknown>();

    get(key: string): unknown {
      return this.map.get(key);
    }

    set(key: string, value: unknown): this {
      this.map.set(key, value);
      return this;
    }
  }

  it('crea y cachea el motor default si el registry está vacío', () => {
    const registry = new FakeRegistry();

    const engine = getAudioEngine(registry);

    expect(engine).toBeInstanceOf(AudioManager);
    expect(registry.get(AUDIO_ENGINE_REGISTRY_KEY)).toBe(engine); // misma instancia
  });

  it('devuelve SIEMPRE la misma instancia en resoluciones repetidas', () => {
    const registry = new FakeRegistry();

    const first = getAudioEngine(registry);
    const second = getAudioEngine(registry);

    expect(second).toBe(first);
  });

  it('respeta un motor inyectado previamente (inversión de dependencias)', () => {
    const registry = new FakeRegistry();
    const injected = new AudioManager({ storage: new FakeStorage() });
    registry.set(AUDIO_ENGINE_REGISTRY_KEY, injected);

    expect(getAudioEngine(registry)).toBe(injected);
  });

  it('el shape-check acepta cualquier ISfxEngine con play + setMuted (Liskov)', () => {
    const registry = new FakeRegistry();
    const calls: string[] = [];
    const injected = {
      play: (sfx: string) => calls.push(`play:${sfx}`),
      setMuted: (muted: boolean) => calls.push(`muted:${muted}`),
    };
    registry.set(AUDIO_ENGINE_REGISTRY_KEY, injected);

    const resolved = getAudioEngine(registry);

    expect(resolved).toBe(injected as unknown as AudioManager);
  });

  it('un valor ajeno en la clave del motor se reemplaza por uno propio', () => {
    const registry = new FakeRegistry();
    registry.set(AUDIO_ENGINE_REGISTRY_KEY, 42);

    const engine = getAudioEngine(registry);

    expect(engine).toBeInstanceOf(AudioManager);
    expect(registry.get(AUDIO_ENGINE_REGISTRY_KEY)).toBe(engine);
  });
});
