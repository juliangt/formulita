/**
 * AudioManager — implementación de `ISfxEngine` con Web Audio API pura
 * (Fase 6). Sin Phaser y sin assets: cada SFX es síntesis programática
 * (osciladores, buffer de ruido propio, envelopes de ganancia) y el dron del
 * motor son dos osciladores (sawtooth + sine) cuya frecuencia sigue la
 * velocidad de la carrera (sube con el turbo).
 *
 * Decisiones de arquitectura:
 *
 * - **El bus es el desacoplador.** Las escenas/UI solo EMITEN por el
 *   EventBus de sesión (`coins`, `pickup`, `turbo`, `drs`, `speed`,
 *   `game-start`, `game-over`, `mute`, `ui-click`); este manager es el único
 *   que traduce eventos → síntesis, vía `attachBus`. Nadie más importa esta
 *   clase para sonar (solo Boot para resolverla del registry y el mute para
 *   leer su estado inicial, primitivas que se pasan al widget).
 * - **Desbloqueo por gesto.** El `AudioContext` se crea LAZY en el primer
 *   `unlock()` (primer pointerdown/keydown, `attachUnlockListeners`) para no
 *   disparar la política de autoplay al cargar la página.
 * - **Degradación total.** Si Web Audio no existe, la factory falla o un
 *   nodo lanza, todo queda en no-op silencioso: el juego nunca depende del
 *   sonido (todos los accesos van envueltos en try/catch).
 * - **Mute persistido en clave PROPIA versionada** (`formulita.audio.v1`,
 *   decisión documentada): es un ajuste de dispositivo, no progreso de
 *   carrera, así no se mezcla con `SaveData` ni depende del flujo de
 *   guardado de la Fase 5. Acceso al storage siempre en try/catch; si falla,
 *   el mute rige igualmente para la sesión (estado en memoria).
 *
 * Para que todo sea testeable sin un AudioContext real, el acceso al
 * contexto se abstrae en `AudioContextLike` (+ nodos mínimos) inyectable
 * por factory: los tests usan fakes que graban nodos y envelopes.
 */

import {
  AUDIO,
  DRS_MULTIPLIER,
  MAX_SPEED,
  MIN_SPEED,
  TURBO_MULTIPLIER,
} from '../config/balance';
import { EventBus, type GameEvents } from '../core/EventBus';
import { AUDIO_ENGINE_REGISTRY_KEY, type ISfxEngine, type SfxName } from './ISfxEngine';

/* ------------------------------------------------------------------ */
/* Abstracción mínima de Web Audio (inyectable / testeable)            */
/* ------------------------------------------------------------------ */

/** Porción de `AudioParam` que la síntesis usa (el real la satisface). */
export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, startTime: number): AudioParamLike;
  linearRampToValueAtTime(value: number, endTime: number): AudioParamLike;
  exponentialRampToValueAtTime(value: number, endTime: number): AudioParamLike;
  setTargetAtTime(value: number, startTime: number, timeConstant: number): AudioParamLike;
  cancelScheduledValues(startTime: number): AudioParamLike;
}

export interface AudioNodeLike {
  connect(destination: AudioNodeLike): AudioNodeLike;
  disconnect(): void;
}

export interface AudioDestinationNodeLike extends AudioNodeLike {}

export interface OscillatorNodeLike extends AudioNodeLike {
  type: OscillatorType;
  frequency: AudioParamLike;
  start(when?: number): void;
  stop(when?: number): void;
}

export interface GainNodeLike extends AudioNodeLike {
  gain: AudioParamLike;
}

export interface BiquadFilterNodeLike extends AudioNodeLike {
  type: BiquadFilterType;
  frequency: AudioParamLike;
  Q: AudioParamLike;
}

export interface AudioBufferLike {
  getChannelData(channel: number): Float32Array;
}

export interface AudioBufferSourceNodeLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  loop: boolean;
  start(when?: number): void;
  stop(when?: number): void;
}

/** Igual que `AudioContextState` del DOM (`'interrupted'` existe en Safari). */
export type AudioContextStateLike = 'running' | 'suspended' | 'closed' | 'interrupted';

/** Porción del `AudioContext` que el manager usa (el real la satisface). */
export interface AudioContextLike {
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly state: AudioContextStateLike;
  readonly destination: AudioDestinationNodeLike;
  resume(): Promise<void>;
  close(): Promise<void>;
  createOscillator(): OscillatorNodeLike;
  createGain(): GainNodeLike;
  createBiquadFilter(): BiquadFilterNodeLike;
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBufferLike;
  createBufferSource(): AudioBufferSourceNodeLike;
}

/** Factory del contexto: `null` = Web Audio no disponible (degradación). */
export type AudioContextFactory = () => AudioContextLike | null;

/** Objetivo de listeners para el desbloqueo (window lo satisface). */
export interface UnlockEventTarget {
  addEventListener(
    type: 'pointerdown' | 'pointerup' | 'touchend' | 'keydown',
    handler: () => void,
  ): void;
  removeEventListener(
    type: 'pointerdown' | 'pointerup' | 'touchend' | 'keydown',
    handler: () => void,
  ): void;
}

interface WindowWithWebAudio {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
}

/** Factory default: Web Audio del navegador, o `null` si no existe. */
export function defaultAudioContextFactory(): AudioContextLike | null {
  try {
    if (typeof window === 'undefined') {
      return null;
    }
    const w = window as unknown as WindowWithWebAudio;
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    return Ctor ? new Ctor() : null;
  } catch {
    return null;
  }
}

/** Storage default para el mute: localStorage, o null si está bloqueado. */
function defaultSettingsStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Clave versionada del ajuste de mute (independiente del save de carrera). */
export const AUDIO_SETTINGS_STORAGE_KEY = 'formulita.audio.v1';

/* ------------------------------------------------------------------ */
/* Constantes de síntesis                                              */
/* ------------------------------------------------------------------ */

/** Volumen general (post-mezcla de todos los SFX + dron). */
const MASTER_VOLUME = 0.9;
/** Rampas de mute (s) y de release del dron (s). */
const MUTE_RAMP_SECONDS = 0.05;
const ENGINE_ATTACK_SECONDS = 0.3;
const ENGINE_RELEASE_SECONDS = 0.25;
/** Filtro del dron: corte base (Hz) y corte con turbo (Hz). */
const ENGINE_FILTER_HZ = 1100;
const ENGINE_FILTER_TURBO_HZ = 2200;
/** Umbral de reprogramación de frecuencia del dron (Hz, anti-spam de eventos). */
const ENGINE_FREQ_EPSILON = 0.75;
/** Duración del buffer de ruido blanco compartido (s). */
const NOISE_BUFFER_SECONDS = 1;
/** Duración del buffer silencioso del desbloqueo iOS (s). */
const UNLOCK_PRIMER_SECONDS = 0.06;
/** Valor "casi cero" para ramps exponenciales (no admiten 0). */
const ALMOST_ZERO = 0.0001;

/**
 * Mapeo puro velocidad (px/s) → frecuencia del dron (Hz): lineal entre
 * `AUDIO.engineFreqMin` (a velocidad mínima) y `AUDIO.engineFreqMax` (a la
 * punta combinada turbo × DRS, mismo techo que `composeEffectiveSpeed`).
 * Monótona creciente; con turbo se realza por `AUDIO.engineTurboBoost`
 * (además del suba que ya trae la velocidad efectiva). Defensiva: NaN y
 * fuera de rango se clampean; siempre devuelve un número finito > 0.
 */
export function engineFrequencyForSpeed(speed: number, turboActive = false): number {
  const ceiling = MAX_SPEED * Math.max(1, TURBO_MULTIPLIER) * Math.max(1, DRS_MULTIPLIER);
  const clamped = Number.isFinite(speed) ? Math.min(Math.max(speed, MIN_SPEED), ceiling) : MIN_SPEED;
  const t = (clamped - MIN_SPEED) / (ceiling - MIN_SPEED);
  const base = AUDIO.engineFreqMin + (AUDIO.engineFreqMax - AUDIO.engineFreqMin) * t;
  return base * (turboActive ? Math.max(1, AUDIO.engineTurboBoost) : 1);
}

/* ------------------------------------------------------------------ */
/* AudioManager                                                        */
/* ------------------------------------------------------------------ */

export interface AudioManagerOptions {
  /** Factory del contexto (default: Web Audio del navegador). */
  readonly contextFactory?: AudioContextFactory;
  /** Storage para persistir el mute (default: localStorage; null = no persistir). */
  readonly storage?: Storage | null;
}

export class AudioManager implements ISfxEngine {
  /** Factory inyectada (default: navegador). */
  private readonly contextFactory: AudioContextFactory;

  /** Storage del mute (puede ser null: entonces no persiste). */
  private readonly storage: Storage | null;

  /** Contexto creado lazy (primer unlock / primer play). */
  private context: AudioContextLike | null = null;

  /** true si la factory ya falló una vez: no se reintenta en cada play. */
  private contextFailed = false;

  /** Cadena maestra (único punto de mute). */
  private masterGain: GainNodeLike | null = null;

  /** Buffer de ruido blanco compartido, creado lazy por contexto. */
  private noiseBuffer: AudioBufferLike | null = null;

  /** Estado de mute (persistido). */
  private muted: boolean;

  /* --- Dron del motor --- */
  private engineOsc: OscillatorNodeLike | null = null;
  private engineSub: OscillatorNodeLike | null = null;
  private engineFilter: BiquadFilterNodeLike | null = null;
  private engineGain: GainNodeLike | null = null;
  /** Última velocidad y turbo reportados (vía bus). */
  private latestSpeed = 0;
  private turboActive = false;
  /**
   * Último estado de turbo APLICADO al filtro del dron (anti-spam: la escena
   * emite `turbo` por frame; el `setTargetAtTime` del filtro solo en flanco).
   */
  private filterTurboActive = false;
  /** Última frecuencia programada (para no spamear setTargetAtTime por frame). */
  private scheduledEngineFreq = 0;

  /* --- Edge detection de eventos continuos (turbo/DRS activos) --- */
  private prevTurboActive = false;
  private prevDrsState: GameEvents['drs']['state'] = 'off';

  /* --- Listeners de desbloqueo --- */
  private unlockTarget: UnlockEventTarget | null = null;

  /**
   * El primer buffer silencioso ya se sirvió para el contexto vigente. iOS
   * Safari necesita UNA reproducción de buffer dentro de un gesto para abrir
   * el pipeline de audio de verdad (un `resume()` a estado `running` no
   * alcanza: los nodos sintéticos quedan mudos); después no hace falta
   * repetirlo (tras una interrupción, el `resume` alcanza).
   */
  private primedContext = false;

  private readonly handleGestureUnlock = (): void => {
    this.unlock();
  };

  constructor(options: AudioManagerOptions = {}) {
    this.contextFactory = options.contextFactory ?? defaultAudioContextFactory;
    this.storage = options.storage === undefined ? defaultSettingsStorage() : options.storage;
    this.muted = this.loadMuted();
  }

  /** Estado de silencio actual (refleja lo persistido + toggles de la sesión). */
  get isMuted(): boolean {
    return this.muted;
  }

  /* ---------------------------------------------------------------- */
  /* ISfxEngine — SFX                                                  */
  /* ---------------------------------------------------------------- */

  /** Dispara un SFX. Muteado o sin audio = no-op; nunca lanza. */
  play(sfx: SfxName): void {
    if (this.muted) {
      return; // Muteado: ni siquiera se crean nodos.
    }
    const graph = this.ensureMaster();
    if (!graph) {
      return; // Sin Web Audio (o falló): degradación silenciosa.
    }
    const { ctx, master } = graph;
    try {
      switch (sfx) {
        case 'click':
          this.playClick(ctx, master);
          break;
        case 'coin':
          this.playCoin(ctx, master);
          break;
        case 'pickup':
          this.playPickup(ctx, master);
          break;
        case 'turbo':
          this.playTurbo(ctx, master);
          break;
        case 'drs':
          this.playDrs(ctx, master);
          break;
        case 'crash':
          this.playCrash(ctx, master);
          break;
      }
    } catch {
      // La síntesis jamás puede romper el juego.
    }
  }

  /* ------------------------- SFX concretos ------------------------- */

  /** Click de UI: blip cuadrado de dos pasos, cortito. */
  private playClick(ctx: AudioContextLike, master: GainNodeLike): void {
    const t = ctx.currentTime + 0.01;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.setValueAtTime(1245, t + 0.03);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(ALMOST_ZERO, t);
    gain.gain.linearRampToValueAtTime(0.14, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(ALMOST_ZERO, t + 0.07);

    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + 0.09);
  }

  /** Moneda: blip clásico de dos tonos (B5 → E6) con cola rápida. */
  private playCoin(ctx: AudioContextLike, master: GainNodeLike): void {
    const t = ctx.currentTime + 0.01;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(988, t);
    osc.frequency.setValueAtTime(1319, t + 0.06);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(ALMOST_ZERO, t);
    gain.gain.linearRampToValueAtTime(0.16, t + 0.005);
    gain.gain.setValueAtTime(0.16, t + 0.055);
    gain.gain.exponentialRampToValueAtTime(ALMOST_ZERO, t + 0.18);

    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  /** Pickup: barrido triangular ascendente (brillante, "power-up"). */
  private playPickup(ctx: AudioContextLike, master: GainNodeLike): void {
    const t = ctx.currentTime + 0.01;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(520, t);
    osc.frequency.exponentialRampToValueAtTime(1560, t + 0.14);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(ALMOST_ZERO, t);
    gain.gain.linearRampToValueAtTime(0.15, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(ALMOST_ZERO, t + 0.2);

    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + 0.22);
  }

  /** Turbo: whoosh de ruido con bandpass barriendo hacia arriba. */
  private playTurbo(ctx: AudioContextLike, master: GainNodeLike): void {
    const t = ctx.currentTime + 0.01;
    const noise = ctx.createBufferSource();
    noise.buffer = this.getNoiseBuffer(ctx);
    noise.loop = true;

    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 1.2;
    band.frequency.setValueAtTime(280, t);
    band.frequency.exponentialRampToValueAtTime(2600, t + 0.3);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(ALMOST_ZERO, t);
    gain.gain.linearRampToValueAtTime(0.22, t + 0.08);
    gain.gain.exponentialRampToValueAtTime(ALMOST_ZERO, t + 0.38);

    noise.connect(band);
    band.connect(gain);
    gain.connect(master);
    noise.start(t);
    noise.stop(t + 0.4);
  }

  /** DRS: hiss agudo de ruido con highpass, típico "sss" de fuga de aire. */
  private playDrs(ctx: AudioContextLike, master: GainNodeLike): void {
    const t = ctx.currentTime + 0.01;
    const noise = ctx.createBufferSource();
    noise.buffer = this.getNoiseBuffer(ctx);
    noise.loop = true;

    const high = ctx.createBiquadFilter();
    high.type = 'highpass';
    high.Q.value = 0.7;
    high.frequency.value = 2800;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(ALMOST_ZERO, t);
    gain.gain.linearRampToValueAtTime(0.14, t + 0.03);
    gain.gain.setValueAtTime(0.14, t + 0.22);
    gain.gain.exponentialRampToValueAtTime(ALMOST_ZERO, t + 0.42);

    noise.connect(high);
    high.connect(gain);
    gain.connect(master);
    noise.start(t);
    noise.stop(t + 0.45);
  }

  /** Crash: estallido de ruido grave + sawtooth con caída de tono. */
  private playCrash(ctx: AudioContextLike, master: GainNodeLike): void {
    const t = ctx.currentTime + 0.01;

    // Ruido con lowpass que se cierra (el "golpe" pierde brillo).
    const noise = ctx.createBufferSource();
    noise.buffer = this.getNoiseBuffer(ctx);
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.setValueAtTime(3200, t);
    low.frequency.exponentialRampToValueAtTime(220, t + 0.45);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(ALMOST_ZERO, t);
    noiseGain.gain.linearRampToValueAtTime(0.5, t + 0.012);
    noiseGain.gain.exponentialRampToValueAtTime(ALMOST_ZERO, t + 0.5);

    noise.connect(low);
    low.connect(noiseGain);
    noiseGain.connect(master);
    noise.start(t);
    noise.stop(t + 0.55);

    // Caída de tono (el motor "muere").
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(185, t);
    osc.frequency.exponentialRampToValueAtTime(36, t + 0.4);

    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(ALMOST_ZERO, t);
    oscGain.gain.linearRampToValueAtTime(0.28, t + 0.01);
    oscGain.gain.exponentialRampToValueAtTime(ALMOST_ZERO, t + 0.45);

    osc.connect(oscGain);
    oscGain.connect(master);
    osc.start(t);
    osc.stop(t + 0.5);
  }

  /* ---------------------------------------------------------------- */
  /* ISfxEngine — ciclo de vida                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Desbloquea el audio (política de autoplay móvil): crea el contexto si
   * falta, hace `resume()` si no está operativo (suspendido, o interrumpido
   * — estado `'interrupted'` de Safari tras una llamada) y, la primera vez,
   * sirve un buffer silencioso: iOS Safari deja los nodos sintéticos mudos
   * hasta que UN buffer suena dentro de un gesto, aunque el contexto esté
   * `running`. Idempotente: llamarlo en cada gesto es barato y seguro.
   */
  unlock(): void {
    const ctx = this.ensureContext();
    if (!ctx || ctx.state === 'running' || ctx.state === 'closed') {
      return;
    }
    try {
      void ctx.resume().catch(() => {
        // El resume puede rechazar (pestaña oculta, política estricta): no importa.
      });
      if (!this.primedContext) {
        this.playUnlockPrimer(ctx);
        this.primedContext = true;
      }
    } catch {
      // Degradación: el juego sigue sin sonido.
    }
  }

  /**
   * Reproduce un buffer de silencio a destination DENTRO del gesto: es la
   * segunda mitad del ritual de desbloqueo de iOS (la primera es `resume`).
   * Sin buffer de ruido compartido: este buffer es desechable y de ceros,
   * así no ensucia el pool que usan los SFX (los tests cuentan nodos).
   */
  private playUnlockPrimer(ctx: AudioContextLike): void {
    try {
      const length = Math.max(1, Math.floor(ctx.sampleRate * UNLOCK_PRIMER_SECONDS));
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      const t = ctx.currentTime;
      source.start(t);
      source.stop(t + UNLOCK_PRIMER_SECONDS);
    } catch {
      // Sin primer el ritual puede no alcanzar en iOS viejo: degradación.
    }
  }

  /** Aplica el mute (master a 0), corta los SFX y persiste el ajuste. */
  setMuted(muted: boolean): void {
    this.muted = muted;
    this.persistMuted(muted);

    const master = this.masterGain;
    const ctx = this.context;
    if (!master || !ctx) {
      return;
    }
    try {
      const t = ctx.currentTime;
      const gain = master.gain;
      gain.cancelScheduledValues(t);
      gain.setValueAtTime(Math.max(0, gain.value), t);
      gain.linearRampToValueAtTime(muted ? 0 : MASTER_VOLUME, t + MUTE_RAMP_SECONDS);
    } catch {
      // Sin ramps no hay problema: el estado lógico ya cambió.
    }
  }

  /** Libera listeners, dron y contexto. No usar el manager después. */
  dispose(): void {
    this.detachUnlockListeners();
    this.stopEngine();
    const ctx = this.context;
    this.context = null;
    this.masterGain = null;
    this.noiseBuffer = null;
    this.contextFailed = false;
    this.primedContext = false;
    if (ctx) {
      try {
        void ctx.close().catch(() => {
          // Cerrar un contexto ya cerrado lanza: es indiferente acá.
        });
      } catch {
        // Idem.
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* Dron del motor (la escena lo dispara vía bus, no a mano)          */
  /* ---------------------------------------------------------------- */

  /**
   * Arranca el dron (dos osciladores → lowpass → ganancia → master). La
   * ganancia entra con un ataque suave. Idempotente: si ya suena, no hace
   * nada. También desbloquea por si el primer gesto fue tecla de arranque.
   */
  startEngine(): void {
    if (this.engineOsc || this.engineSub) {
      return;
    }
    this.unlock();
    const graph = this.ensureMaster();
    if (!graph) {
      return;
    }
    const { ctx, master } = graph;
    try {
      const t = ctx.currentTime;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = ENGINE_FILTER_HZ;
      filter.Q.value = 0.9;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(ALMOST_ZERO, t);
      gain.gain.exponentialRampToValueAtTime(AUDIO.engineVolume, t + ENGINE_ATTACK_SECONDS);

      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      const sub = ctx.createOscillator();
      sub.type = 'sine';
      this.scheduledEngineFreq = engineFrequencyForSpeed(this.latestSpeed, this.turboActive);
      osc.frequency.value = this.scheduledEngineFreq;
      sub.frequency.value = this.scheduledEngineFreq / 2;

      osc.connect(filter);
      sub.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      osc.start(t);
      sub.start(t);

      this.engineOsc = osc;
      this.engineSub = sub;
      this.engineFilter = filter;
      this.engineGain = gain;

      // El filtro arranca en el brillo que corresponda al turbo vigente (y el
      // estado queda sincronizado para el guard de flancos de setTurboActive).
      filter.frequency.value = this.turboActive ? ENGINE_FILTER_TURBO_HZ : ENGINE_FILTER_HZ;
      this.filterTurboActive = this.turboActive;
    } catch {
      this.engineOsc = null;
      this.engineSub = null;
      this.engineFilter = null;
      this.engineGain = null;
    }
  }

  /**
   * Para el dron con un release suave (el motor se "apaga"). Los nodos se
   * frenan un poco después del fade; las referencias se sueltan ya.
   */
  stopEngine(): void {
    const { engineOsc, engineSub, engineFilter, engineGain } = this;
    if (!engineOsc || !engineSub || !engineFilter || !engineGain) {
      return;
    }
    this.engineOsc = null;
    this.engineSub = null;
    this.engineFilter = null;
    this.engineGain = null;

    const ctx = this.context;
    if (!ctx) {
      return;
    }
    try {
      const t = ctx.currentTime;
      const stopAt = t + ENGINE_RELEASE_SECONDS + 0.05;
      engineGain.gain.cancelScheduledValues(t);
      // Arranca el fade desde el valor ACTUAL (evita un click de salto a 0).
      engineGain.gain.setValueAtTime(Math.max(ALMOST_ZERO, engineGain.gain.value), t);
      engineGain.gain.exponentialRampToValueAtTime(ALMOST_ZERO, t + ENGINE_RELEASE_SECONDS);
      engineOsc.stop(stopAt);
      engineSub.stop(stopAt);
    } catch {
      // Si el stop programado falla, los osciladores quedan huérfanos pero
      // inaudibles (su ganancia ya no tiene dueño con volumen).
    }
  }

  /** Reporta la velocidad efectiva actual (la escena lo hace vía bus). */
  setEngineSpeed(speed: number): void {
    this.latestSpeed = speed;
    this.applyEngineFrequency();
  }

  /** Reporta si el turbo está empujando (realza frecuencia y brillo). */
  setTurboActive(active: boolean): void {
    this.turboActive = active;
    this.applyEngineFrequency();
    // Anti-spam: la escena emite `turbo` por frame; el brillo del filtro solo
    // se reprograma en el flanco (el estado se sincroniza también en
    // startEngine, por si el dron se re-crea con el turbo ya activo).
    if (active === this.filterTurboActive) {
      return;
    }
    try {
      if (this.engineFilter && this.context) {
        this.engineFilter.frequency.setTargetAtTime(
          active ? ENGINE_FILTER_TURBO_HZ : ENGINE_FILTER_HZ,
          this.context.currentTime,
          0.08,
        );
        this.filterTurboActive = active;
      }
    } catch {
      // El brillo extra es cosmético: sin filtro activo se sigue sonando.
    }
  }

  /** Reprograma la frecuencia del dron según velocidad + turbo (con umbral). */
  private applyEngineFrequency(): void {
    const { engineOsc, engineSub, context } = this;
    if (!engineOsc || !engineSub || !context) {
      return;
    }
    const target = engineFrequencyForSpeed(this.latestSpeed, this.turboActive);
    if (Math.abs(target - this.scheduledEngineFreq) < ENGINE_FREQ_EPSILON) {
      return;
    }
    this.scheduledEngineFreq = target;
    try {
      const t = context.currentTime;
      engineOsc.frequency.setTargetAtTime(target, t, 0.06);
      engineSub.frequency.setTargetAtTime(target / 2, t, 0.06);
    } catch {
      // El dron sigue con la última frecuencia programada.
    }
  }

  /* ---------------------------------------------------------------- */
  /* Integración por EventBus (el desacoplador elegido)                */
  /* ---------------------------------------------------------------- */

  /**
   * Conecta el manager al bus de sesión: es el ÚNICO punto donde los
   * eventos de gameplay/UI se traducen a audio. Las escenas no saben que el
   * audio existe (solo emiten); el manager no conoce escenas.
   *
   * Mapeo de eventos → sonido:
   * - `game-start` → arranca el dron (y resetea los edge detectors).
   * - `speed` / `turbo` → el dron sigue la velocidad (el turbo la realza).
   * - `turbo`/`drs` en estado `active` con borde ascendente → whoosh/hiss
   *   (son eventos por-frame: el SFX solo en la transición a activo).
   * - `coins` → SFX de moneda; `pickup` → SFX de pickup.
   * - `game-over` → SFX de crash + apaga el dron.
   * - `game-paused` / `game-resumed` (Fase 7) → apaga y re-arranca el dron
   *   (la carrera está congelada: el motor no sigue sonando en pausa).
   * - `game-aborted` (Fase 7) → apaga el dron sin SFX de crash (MENÚ desde
   *   la pausa).
   * - `ui-click` → click; `mute` → aplica y persiste el mute.
   *
   * @returns función de desuscripción (el audio vive toda la sesión: no se
   * desuscribe en el shutdown de escenas).
   */
  attachBus(bus: EventBus<GameEvents>): () => void {
    const offs = [
      bus.on('game-start', () => {
        this.prevTurboActive = false;
        this.prevDrsState = 'off';
        this.startEngine();
      }),
      bus.on('speed', (speed) => this.setEngineSpeed(speed)),
      bus.on('turbo', ({ active }) => {
        this.setTurboActive(active);
        if (active && !this.prevTurboActive) {
          this.play('turbo');
        }
        this.prevTurboActive = active;
      }),
      bus.on('drs', ({ state }) => {
        if (state === 'active' && this.prevDrsState !== 'active') {
          this.play('drs');
        }
        this.prevDrsState = state;
      }),
      bus.on('coins', () => this.play('coin')),
      bus.on('pickup', () => this.play('pickup')),
      bus.on('game-over', () => {
        this.play('crash');
        this.stopEngine();
      }),
      bus.on('game-paused', () => this.stopEngine()),
      bus.on('game-resumed', () => this.startEngine()),
      bus.on('game-aborted', () => this.stopEngine()),
      bus.on('ui-click', () => this.play('click')),
      bus.on('mute', (muted) => this.setMuted(muted)),
    ];
    let detached = false;
    return () => {
      if (detached) {
        return;
      }
      detached = true;
      for (const off of offs) {
        off();
      }
    };
  }

  /**
   * Instala los listeners de desbloqueo (política de autoplay móvil): el
   * primer gesto del documento hace `unlock()`. Se cubren los CUATRO gestos
   * relevantes: `pointerdown`/`keydown` (desktop) y `touchend`/`pointerup` —
   * iOS Safari libera el audio recién en el fin del toque en algunas
   * versiones, y iOS < 13 no emite eventos pointer en absoluto. Idempotente;
   * el target es inyectable para testear sin window real.
   */
  attachUnlockListeners(target: UnlockEventTarget | null = defaultUnlockTarget()): void {
    if (!target || this.unlockTarget) {
      return;
    }
    try {
      target.addEventListener('pointerdown', this.handleGestureUnlock);
      target.addEventListener('pointerup', this.handleGestureUnlock);
      target.addEventListener('touchend', this.handleGestureUnlock);
      target.addEventListener('keydown', this.handleGestureUnlock);
      this.unlockTarget = target;
    } catch {
      // Sin listeners el desbloqueo manual (unlock()) sigue disponible.
    }
  }

  /** Quita los listeners instalados por `attachUnlockListeners` (si hay). */
  detachUnlockListeners(): void {
    const target = this.unlockTarget;
    if (!target) {
      return;
    }
    this.unlockTarget = null;
    try {
      target.removeEventListener('pointerdown', this.handleGestureUnlock);
      target.removeEventListener('pointerup', this.handleGestureUnlock);
      target.removeEventListener('touchend', this.handleGestureUnlock);
      target.removeEventListener('keydown', this.handleGestureUnlock);
    } catch {
      // Nada que hacer: el target ya no sirve.
    }
  }

  /* ---------------------------------------------------------------- */
  /* Internos                                                          */
  /* ---------------------------------------------------------------- */

  /** Crea el contexto lazy una sola vez; cachea el fallo (degradación). */
  private ensureContext(): AudioContextLike | null {
    if (this.context) {
      return this.context;
    }
    if (this.contextFailed) {
      return null;
    }
    try {
      this.context = this.contextFactory();
    } catch {
      this.context = null;
    }
    if (!this.context) {
      this.contextFailed = true;
    }
    return this.context;
  }

  /**
   * Asegura contexto + cadena maestra (gain → destination). Devuelve null
   * si el audio no está disponible; el master se crea lazy con la primera
   * reproducción y se reutiliza.
   */
  private ensureMaster(): { ctx: AudioContextLike; master: GainNodeLike } | null {
    const ctx = this.ensureContext();
    if (!ctx) {
      return null;
    }
    if (!this.masterGain) {
      try {
        const master = ctx.createGain();
        master.gain.value = this.muted ? 0 : MASTER_VOLUME;
        master.connect(ctx.destination);
        this.masterGain = master;
      } catch {
        this.masterGain = null;
        return null;
      }
    }
    return { ctx, master: this.masterGain };
  }

  /** Buffer de ruido blanco compartido (mono), creado lazy por contexto. */
  private getNoiseBuffer(ctx: AudioContextLike): AudioBufferLike {
    if (this.noiseBuffer) {
      return this.noiseBuffer;
    }
    const length = Math.max(1, Math.floor(ctx.sampleRate * NOISE_BUFFER_SECONDS));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buffer;
    return buffer;
  }

  /** Lee el mute persistido (defensivo: corrupto/ausente → false). */
  private loadMuted(): boolean {
    if (!this.storage) {
      return false;
    }
    try {
      const raw = this.storage.getItem(AUDIO_SETTINGS_STORAGE_KEY);
      if (raw === null) {
        return false;
      }
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) {
        return false;
      }
      const muted = (parsed as { muted?: unknown }).muted;
      return typeof muted === 'boolean' ? muted : false;
    } catch {
      return false;
    }
  }

  /** Persiste el mute (si el storage falla, rige igualmente en memoria). */
  private persistMuted(muted: boolean): void {
    if (!this.storage) {
      return;
    }
    try {
      this.storage.setItem(AUDIO_SETTINGS_STORAGE_KEY, JSON.stringify({ muted }));
    } catch {
      // Modo privado / cuota: el ajuste vive solo en esta sesión.
    }
  }
}

/** Shape-check mínimo de `ISfxEngine` (para el valor del registry). */
function looksLikeSfxEngine(value: unknown): value is AudioManager {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { play?: unknown; setMuted?: unknown };
  return typeof candidate.play === 'function' && typeof candidate.setMuted === 'function';
}

/** Target default de desbloqueo: la window del navegador (o null). */
function defaultUnlockTarget(): UnlockEventTarget | null {
  try {
    return typeof window === 'undefined' ? null : window;
  } catch {
    return null;
  }
}

/**
 * Resuelve el motor de audio para las escenas (registry de Phaser), igual
 * que `getSaveRepository`: si otro módulo ya inyectó uno se respeta; si no,
 * crea el default y lo cachea para que toda la sesión comparta la instancia
 * (el mute persistido se carga una vez).
 */
export function getAudioEngine(
  registry: { get(key: string): unknown; set(key: string, value: unknown): unknown },
): AudioManager {
  const existing = registry.get(AUDIO_ENGINE_REGISTRY_KEY);
  if (looksLikeSfxEngine(existing)) {
    return existing;
  }
  const created = new AudioManager();
  registry.set(AUDIO_ENGINE_REGISTRY_KEY, created);
  return created;
}
