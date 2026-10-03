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
 * - **Interruptor Ring/Silent del iPhone (Fase 2, issue #4).** Safari en iOS
 *   silencia TODA la Web Audio con el switch físico en silencio, aunque el
 *   contexto esté desbloqueado y `running`; no hay API para detectarlo ni
 *   bypasearlo. Dos redes, ambas sin assets: en el primer gesto se arranca
 *   un `<audio>` con un WAV silencioso en data URI (loop, volumen casi 0)
 *   que mantiene la sesión de audio en modo playback — en varias versiones
 *   de iOS hace que la Web Audio posterior ignore el switch — y, si el
 *   contexto igualmente no queda `running`, se dispara `onAudioBlocked`
 *   (default: overlay DOM con un hint discreto, una sola vez por sesión).
 * - **Recuperación tras interrupción (Fase 3, issue #4).** Tras una llamada,
 *   Siri o el bloqueo de pantalla, Safari pasa el contexto a `interrupted`
 *   (o `suspended`) y el audio queda mudo hasta el próximo gesto. Con
 *   `onstatechange` del contexto y `visibilitychange` del documento se
 *   reintenta `resume()` automáticamente, SOLO si el documento está visible
 *   (iOS deniega el resume en background) y solo si ya hubo desbloqueo por
 *   gesto (la política de autoplay no se fuerza). El handler es idempotente
 *   (solo actúa en estados problemáticos: el propio `resume()` re-dispara
 *   `onstatechange` en `running`) y los listeners tienen cleanup en
 *   `dispose()`.
 * - **Perfil del dron para móvil (Fase 4, issue #4).** Los parlantes de un
 *   celular apenas reproducen por debajo de ~400 Hz: el dron desktop
 *   (55–235 Hz) puede ser físicamente inaudible en móvil aunque todo el
 *   pipeline funcione. El manager elige el perfil del dron al construirse
 *   (autodetección por user agent vía `isMobileLikeDevice`, inyectable como
 *   `mobileProfile` para los tests): en móvil el dron suena una octava
 *   arriba, con el lowpass más abierto y más ganancia (números en
 *   `AUDIO`, bloque de perfil móvil en `balance.ts`).
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
import { isMobileLikeDevice } from '../core/device';
import { AUDIO_ENGINE_REGISTRY_KEY, type ISfxEngine, type SfxName } from './ISfxEngine';
import { showAudioBlockedHint } from './AudioBlockedHint';

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

/**
 * Porción de `HTMLMediaElement` que el workaround Ring/Silent usa (el real
 * la satisface; inyectable para testear sin DOM real).
 */
export interface MediaElementLike {
  loop: boolean;
  volume: number;
  play(): Promise<void>;
  pause(): void;
}

/** Factory del media element silencioso: `null` = desactiva el workaround. */
export type MediaElementFactory = () => MediaElementLike | null;

/** Igual que `AudioContextState` del DOM (`'interrupted'` existe en Safari). */
export type AudioContextStateLike = 'running' | 'suspended' | 'closed' | 'interrupted';

/**
 * Porción del `AudioContext` que el manager usa (el real la satisface).
 * `onstatechange` usa la firma DOM (`event: Event`) para que el contexto
 * real sea estructuralmente asignable; el manager solo lo ASIGNA, jamás lo
 * dispara.
 */
export interface AudioContextLike {
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly state: AudioContextStateLike;
  readonly destination: AudioDestinationNodeLike;
  onstatechange: ((event: Event) => unknown) | null;
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

/** Estados de visibilidad del documento que importan acá (el DOM los tiene). */
export type DocumentVisibilityStateLike = 'visible' | 'hidden';

/**
 * Objetivo de listeners de visibilidad para la recuperación tras
 * interrupción (el `document` del navegador lo satisface; inyectable para
 * testear sin DOM real).
 */
export interface VisibilityEventTarget {
  readonly visibilityState: DocumentVisibilityStateLike;
  addEventListener(type: 'visibilitychange', handler: () => void): void;
  removeEventListener(type: 'visibilitychange', handler: () => void): void;
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
/* Workaround Ring/Silent: WAV silencioso en data URI                  */
/* ------------------------------------------------------------------ */

const SILENT_WAV_SAMPLE_RATE = 8000;
/** Duración del WAV (s): es silencio en loop, no necesita durar. */
const SILENT_WAV_SECONDS = 0.1;
/** Volumen del media element: "audible" para iOS, inaudible para humanos. */
const SILENT_MEDIA_VOLUME = 0.001;

/** Data URI del WAV silencioso, memoizado (es constante de la sesión). */
let silentWavDataUri: string | null = null;

/**
 * Construye el data URI de un WAV PCM 16-bit mono con todas las muestras en
 * cero (44 bytes de header + datos). Generado en código — cero assets: es el
 * "keep-alive" que mantiene la sesión de audio de iOS en modo playback para
 * esquivar el switch Ring/Silent. Los datos nunca se tocan: nacen en cero.
 */
export function buildSilentWavDataUri(): string {
  if (silentWavDataUri) {
    return silentWavDataUri;
  }
  const samples = Math.max(1, Math.floor(SILENT_WAV_SAMPLE_RATE * SILENT_WAV_SECONDS));
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const writeAscii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) {
      bytes[offset + i] = text.charCodeAt(i);
    }
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // tamaño del chunk fmt (PCM sin extra)
  view.setUint16(20, 1, true); // formato PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SILENT_WAV_SAMPLE_RATE, true);
  view.setUint32(28, SILENT_WAV_SAMPLE_RATE * 2, true); // byteRate (16-bit)
  view.setUint16(32, 2, true); // blockAlign (un frame = 2 bytes)
  view.setUint16(34, 16, true); // bits por muestra
  writeAscii(36, 'data');
  view.setUint32(40, samples * 2, true);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  silentWavDataUri = `data:audio/wav;base64,${btoa(binary)}`;
  return silentWavDataUri;
}

/** Factory default del media element: `<audio>` inline, sin agregar al DOM. */
function defaultMediaElementFactory(): MediaElementLike | null {
  try {
    if (typeof document === 'undefined') {
      return null;
    }
    const el = document.createElement('audio');
    el.setAttribute('playsinline', '');
    el.setAttribute('preload', 'auto');
    el.src = buildSilentWavDataUri();
    return el;
  } catch {
    return null;
  }
}

/**
 * Decisión PURA del hint de audio bloqueado (issue #4, testeable): mostrar
 * solo si hay contexto, este NO terminó en `running` tras el gesto y el hint
 * no salió ya en esta sesión. Sin contexto (Web Audio ausente) no hay hint:
 * ahí el switch del teléfono no es ni la causa ni la solución.
 */
export function shouldShowAudioBlockedHint(
  state: AudioContextStateLike | null,
  alreadyShown: boolean,
): boolean {
  if (alreadyShown || state === null) {
    return false;
  }
  return state !== 'running';
}

/* ------------------------------------------------------------------ */
/* Constantes de síntesis                                              */
/* ------------------------------------------------------------------ */

/** Volumen general (post-mezcla de todos los SFX + dron). */
const MASTER_VOLUME = 0.9;
/** Rampas de mute (s) y de release del dron (s). */
const MUTE_RAMP_SECONDS = 0.05;
const ENGINE_ATTACK_SECONDS = 0.3;
const ENGINE_RELEASE_SECONDS = 0.25;
/**
 * Ventana de gracia del release (fade + margen hasta el stop real): un
 * `startEngine` dentro de esta ventana readopta el grafo en fade en vez de
 * crear uno nuevo superpuesto (qaT9, issue #35). Fuera de la ventana los
 * osciladores ya se frenaron y no hay nada que readoptar.
 */
const ENGINE_RELEASE_WINDOW_SECONDS = ENGINE_RELEASE_SECONDS + 0.05;
/**
 * Stop "lejos" con el que un dron readoptado reemplaza su stop pendiente:
 * por spec de Web Audio el ÚLTIMO `stop()` es el que vale; el próximo
 * `stopEngine` lo vuelve a pautar en su momento real.
 */
const ENGINE_REARM_STOP_SECONDS = 3600;
// (El corte del lowpass del dron vive en `AUDIO`: `engineFilterHz` desktop y
// `engineFilterHzMobile` móvil, issue #4 H4.)
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
 * (además del suba que ya trae la velocidad efectiva). Con `mobileProfile`
 * se usan las frecuencias del perfil móvil (`engineFreqMinMobile` /
 * `engineFreqMaxMobile`, una octava arriba: los parlantes de un celular
 * apenas reproducen < ~400 Hz — issue #4 H4). Defensiva: NaN y fuera de
 * rango se clampean; siempre devuelve un número finito > 0.
 */
export function engineFrequencyForSpeed(
  speed: number,
  turboActive = false,
  mobileProfile = false,
): number {
  const freqMin = mobileProfile ? AUDIO.engineFreqMinMobile : AUDIO.engineFreqMin;
  const freqMax = mobileProfile ? AUDIO.engineFreqMaxMobile : AUDIO.engineFreqMax;
  const ceiling = MAX_SPEED * Math.max(1, TURBO_MULTIPLIER) * Math.max(1, DRS_MULTIPLIER);
  const clamped = Number.isFinite(speed) ? Math.min(Math.max(speed, MIN_SPEED), ceiling) : MIN_SPEED;
  const t = (clamped - MIN_SPEED) / (ceiling - MIN_SPEED);
  const base = freqMin + (freqMax - freqMin) * t;
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
  /**
   * Factory del media element silencioso del workaround Ring/Silent
   * (default: `<audio>` con WAV en data URI; `null` = desactivarlo).
   */
  readonly mediaElementFactory?: MediaElementFactory | null;
  /**
   * Aviso de audio bloqueado: se dispara UNA vez por sesión si tras el gesto
   * el contexto no queda `running` (default: overlay DOM discreto).
   */
  readonly onAudioBlocked?: () => void;
  /**
   * Objetivo de listeners de visibilidad para la recuperación tras
   * interrupción (default: el `document`; `null` = sin red de visibilidad,
   * se asume visible).
   */
  readonly visibilityTarget?: VisibilityEventTarget | null;
  /**
   * Perfil del dron del motor para móvil (issue #4, H4): frecuencias una
   * octava arriba, lowpass más abierto y más ganancia — los parlantes de un
   * celular apenas reproducen < ~400 Hz, el perfil desktop puede ser
   * físicamente inaudible ahí. `undefined` = autodetectar vía `core/device`
   * (user agent); pasar `true`/`false` lo fija (los tests fijan `false` para
   * el perfil desktop, el default estable).
   */
  readonly mobileProfile?: boolean;
}

export class AudioManager implements ISfxEngine {
  /** Factory inyectada (default: navegador). */
  private readonly contextFactory: AudioContextFactory;

  /** Storage del mute (puede ser null: entonces no persiste). */
  private readonly storage: Storage | null;

  /** Factory del media element del workaround Ring/Silent (null = off). */
  private readonly mediaElementFactory: MediaElementFactory | null;

  /** Aviso de audio bloqueado (default: overlay DOM). */
  private readonly onAudioBlocked: () => void;

  /** Target de visibilidad para la recuperación (null = se asume visible). */
  private readonly visibilityTarget: VisibilityEventTarget | null;

  /** true si el dron usa el perfil móvil (parlantes chicos, issue #4 H4). */
  private readonly mobileProfile: boolean;

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
  /**
   * Dron en fade de release (entre stopEngine y el stop real programado): si
   * `startEngine` llega dentro de la ventana, este grafo se READOPTA en vez
   * de superponer uno nuevo (qaT9, issue #35).
   */
  private releasingEngine: {
    osc: OscillatorNodeLike;
    sub: OscillatorNodeLike;
    filter: BiquadFilterNodeLike;
    gain: GainNodeLike;
    /** Instante del contexto en que los osciladores se frenan. */
    stopAt: number;
  } | null = null;
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

  /* --- Recuperación tras interrupción (Fase 3, issue #4) --- */
  /**
   * El desbloqueo por gesto ya ocurrió al menos una vez: es el permiso de la
   * política de autoplay para los re-resume automáticos (sin gesto previo,
   * el contexto NO se despierta solo).
   */
  private unlockedOnce = false;

  /** Los listeners de recuperación ya están instalados (una vez por contexto). */
  private recoveryAttached = false;

  /**
   * El primer buffer silencioso ya se sirvió para el contexto vigente. iOS
   * Safari necesita UNA reproducción de buffer dentro de un gesto para abrir
   * el pipeline de audio de verdad (un `resume()` a estado `running` no
   * alcanza: los nodos sintéticos quedan mudos); después no hace falta
   * repetirlo (tras una interrupción, el `resume` alcanza).
   */
  private primedContext = false;

  /**
   * Media element silencioso del workaround Ring/Silent, si ya se creó. El
   * elemento se deja sonando (loop, volumen casi 0) toda la sesión.
   */
  private mediaElement: MediaElementLike | null = null;

  /**
   * El arranque del media element ya se INTENTÓ una vez: no se reintenta en
   * cada gesto, ni siquiera si el `play()` rechazó (el elemento queda creado
   * y en uso; reintentar solo acumularía promesas rechazadas).
   */
  private mediaElementAttempted = false;

  /** El hint de audio bloqueado ya se mostró en esta sesión (flag en memoria). */
  private blockedHintShown = false;

  private readonly handleGestureUnlock = (): void => {
    this.unlock();
  };

  /** Cambio de estado del contexto (llamada/Siri/bloqueo → recuperación). */
  private readonly handleContextStateChange = (): void => {
    this.tryAutoResume();
  };

  /** La pestaña volvió a visible (reintenta si el contexto quedó mudo). */
  private readonly handleVisibilityChange = (): void => {
    this.tryAutoResume();
  };

  constructor(options: AudioManagerOptions = {}) {
    this.contextFactory = options.contextFactory ?? defaultAudioContextFactory;
    this.storage = options.storage === undefined ? defaultSettingsStorage() : options.storage;
    this.mediaElementFactory =
      options.mediaElementFactory === undefined
        ? defaultMediaElementFactory
        : options.mediaElementFactory;
    this.onAudioBlocked = options.onAudioBlocked ?? showAudioBlockedHint;
    this.visibilityTarget =
      options.visibilityTarget === undefined ? defaultVisibilityTarget() : options.visibilityTarget;
    this.mobileProfile = options.mobileProfile ?? defaultIsMobileProfile();
    this.muted = this.loadMuted();
  }

  /**
   * Volumen, corte del lowpass y corte con turbo según el perfil vigente
   * (desktop o móvil): seleccionados una sola vez por el flag, cero números
   * mágicos afuera de `balance.ts`.
   */
  private get engineVolumeProfile(): number {
    return this.mobileProfile ? AUDIO.engineVolumeMobile : AUDIO.engineVolume;
  }

  private get engineFilterProfile(): number {
    return this.mobileProfile ? AUDIO.engineFilterHzMobile : AUDIO.engineFilterHz;
  }

  private get engineFilterTurboProfile(): number {
    return this.mobileProfile ? AUDIO.engineFilterTurboHzMobile : AUDIO.engineFilterTurboHz;
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
        case 'damage':
          this.playDamage(ctx, master);
          break;
        case 'crash':
          this.playCrash(ctx, master);
          break;
        case 'go':
          this.playGo(ctx, master);
          break;
        case 'overtake':
          this.playOvertake(ctx, master);
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

  /**
   * Golpe no letal (issue #10, H2): "golpe seco" grave y corto — thump de
   * sawtooth con caída de tono + ráfaga de ruido lowpass, muy por debajo del
   * crash (menos ganancia y cola mínima: los impactos pueden encadenarse).
   */
  private playDamage(ctx: AudioContextLike, master: GainNodeLike): void {
    const t = ctx.currentTime + 0.01;

    // Ráfaga grave de impacto (el "golpe" del chasis).
    const noise = ctx.createBufferSource();
    noise.buffer = this.getNoiseBuffer(ctx);
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.setValueAtTime(900, t);
    low.frequency.exponentialRampToValueAtTime(160, t + 0.14);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(ALMOST_ZERO, t);
    noiseGain.gain.linearRampToValueAtTime(0.28, t + 0.008);
    noiseGain.gain.exponentialRampToValueAtTime(ALMOST_ZERO, t + 0.16);

    noise.connect(low);
    low.connect(noiseGain);
    noiseGain.connect(master);
    noise.start(t);
    noise.stop(t + 0.18);

    // Thump tonal que cae rápido (el "duro" metálico).
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(130, t);
    osc.frequency.exponentialRampToValueAtTime(48, t + 0.12);

    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(ALMOST_ZERO, t);
    oscGain.gain.linearRampToValueAtTime(0.2, t + 0.008);
    oscGain.gain.exponentialRampToValueAtTime(ALMOST_ZERO, t + 0.14);

    osc.connect(oscGain);
    oscGain.connect(master);
    osc.start(t);
    osc.stop(t + 0.16);
  }

  /**
   * Largada del GRAN PREMIO (issue #14, V3): arpegio ascendente de tres
   * notas cuadradas (sol-si-re cortos) — el "¡ya!" sobre el GO!. Más largo y
   * más brillante que el click de UI para que se distinga del blip de
   * botones; agudo (banda > 400 Hz) para que los parlantes de un celular lo
   * reproduzcan sin depender del perfil móvil del dron.
   */
  private playGo(ctx: AudioContextLike, master: GainNodeLike): void {
    const notes = [784, 988, 1319];
    const noteSeconds = 0.09;
    for (let i = 0; i < notes.length; i += 1) {
      const t = ctx.currentTime + 0.01 + i * noteSeconds;
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(notes[i], t);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(ALMOST_ZERO, t);
      gain.gain.linearRampToValueAtTime(0.14, t + 0.006);
      gain.gain.exponentialRampToValueAtTime(ALMOST_ZERO, t + noteSeconds);

      osc.connect(gain);
      gain.connect(master);
      osc.start(t);
      osc.stop(t + noteSeconds + 0.02);
    }
  }

  /**
   * Cambio de posición en el GRAN PREMIO (#14, V3): "zip" cortito de
   * barrido triangular ascendente — suena igual al ganar o al perder el
   * lugar (la dirección se lee en el badge Pn/N; el sonido sólo avisa que la
   * pelea se movió). Distinto de la moneda (sine de dos tonos) y del pickup
   * (barrido largo de 0.14 s): acá es un glissando rápido y suave.
   */
  private playOvertake(ctx: AudioContextLike, master: GainNodeLike): void {
    const t = ctx.currentTime + 0.01;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(430, t);
    osc.frequency.exponentialRampToValueAtTime(1040, t + 0.1);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(ALMOST_ZERO, t);
    gain.gain.linearRampToValueAtTime(0.13, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(ALMOST_ZERO, t + 0.14);

    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + 0.16);
  }

  /* ---------------------------------------------------------------- */
  /* ISfxEngine — ciclo de vida                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Desbloquea el audio (política de autoplay móvil): crea el contexto si
   * falta, hace `resume()` solo si no está operativo (suspendido, o
   * interrumpido — estado `'interrupted'` de Safari tras una llamada) y, en
   * el PRIMER gesto, sirve un buffer silencioso SIEMPRE, independiente del
   * estado reportado: iOS Safari puede crear el contexto ya `running` y aun
   * así dejar los nodos sintéticos mudos hasta que UN buffer suena dentro
   * del gesto (por eso el primer no puede quedar detrás del guard de
   * estado). Idempotente: llamarlo en cada gesto es barato y seguro.
   */
  unlock(): void {
    const ctx = this.ensureContext();
    if (!ctx) {
      return;
    }
    // Hubo gesto: a partir de acá los re-resume automáticos están permitidos.
    this.unlockedOnce = true;
    if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
      try {
        // El veredicto del hint es POST-resume: el estado del contexto se
        // actualiza asincrónico, un chequeo sincrónico daría falsos positivos.
        void ctx.resume().then(
          () => this.notifyAudioBlockedHint(),
          () => this.notifyAudioBlockedHint(),
        );
      } catch {
        this.notifyAudioBlockedHint(); // resume lanzó sincrónico
      }
    }
    if (this.primedContext) {
      return;
    }
    this.primeMediaElement();
    try {
      this.playUnlockPrimer(ctx);
      this.primedContext = true;
    } catch {
      // Degradación: el juego sigue sin sonido.
    }
  }

  /**
   * Arranca UNA vez el media element silencioso (workaround Ring/Silent, ver
   * header): un `<audio>` en loop con volumen casi 0 mantiene la sesión de
   * audio de iOS en modo playback, lo que en varias versiones hace que la
   * Web Audio posterior ignore el switch físico. Best-effort total: un
   * `play()` rechazado (u otras rarezas) se traga sin romper el unlock.
   */
  private primeMediaElement(): void {
    if (this.mediaElementAttempted) {
      return;
    }
    this.mediaElementAttempted = true;
    const factory = this.mediaElementFactory;
    if (!factory) {
      return;
    }
    try {
      const el = factory();
      if (!el) {
        return;
      }
      el.loop = true;
      el.volume = SILENT_MEDIA_VOLUME;
      this.mediaElement = el;
      const played = el.play();
      if (played && typeof played.catch === 'function') {
        played.catch(() => {
          // Sin gesto válido (o switch en mods estrictos): no se reintenta.
        });
      }
    } catch {
      // El workaround es una red extra: su fallo no toca el ritual Web Audio.
    }
  }

  /** Evalúa y dispara (una vez por sesión) el aviso de audio bloqueado. */
  private notifyAudioBlockedHint(): void {
    const state = this.context?.state ?? null;
    if (!shouldShowAudioBlockedHint(state, this.blockedHintShown)) {
      return;
    }
    this.blockedHintShown = true;
    try {
      this.onAudioBlocked();
    } catch {
      // El hint es cosmético: su callback no puede romper el audio.
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

  /** Libera listeners, dron, media element y contexto. No usar después. */
  dispose(): void {
    this.detachUnlockListeners();
    this.detachRecoveryListeners();
    this.stopEngine();
    // El grafo en fade muere con el contexto: nada que readoptar después.
    this.releasingEngine = null;
    const ctx = this.context;
    this.context = null;
    this.masterGain = null;
    this.noiseBuffer = null;
    this.contextFailed = false;
    this.primedContext = false;
    this.mediaElementAttempted = false;
    this.blockedHintShown = false;
    this.unlockedOnce = false;
    const media = this.mediaElement;
    this.mediaElement = null;
    if (media) {
      try {
        media.pause();
      } catch {
        // Ya no hay dueño: si el pause falla, el volumen ~0 lo hace inofensivo.
      }
    }
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
   * nada (y si hay uno en fade de release, lo readopta en vez de superponer
   * otro). También desbloquea por si el primer gesto fue tecla de arranque.
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
    // Un dron en fade sigue audible: readoptarlo evita dos drones superpuestos
    // cuando la pausa y la reanudación caen en la misma ventana (< 0.30 s).
    if (this.adoptReleasingEngine(ctx)) {
      return;
    }
    try {
      const t = ctx.currentTime;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = this.engineFilterProfile;
      filter.Q.value = 0.9;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(ALMOST_ZERO, t);
      gain.gain.exponentialRampToValueAtTime(this.engineVolumeProfile, t + ENGINE_ATTACK_SECONDS);

      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      const sub = ctx.createOscillator();
      sub.type = 'sine';
      this.scheduledEngineFreq = engineFrequencyForSpeed(
        this.latestSpeed,
        this.turboActive,
        this.mobileProfile,
      );
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
      filter.frequency.value = this.turboActive
        ? this.engineFilterTurboProfile
        : this.engineFilterProfile;
      this.filterTurboActive = this.turboActive;
    } catch {
      this.engineOsc = null;
      this.engineSub = null;
      this.engineFilter = null;
      this.engineGain = null;
    }
  }

  /**
   * Readopta el dron que está en fade de release (qaT9, issue #35): cancela
   * el fade, vuelve a subir la ganancia con el ataque normal, reemplaza el
   * stop ya programado por uno "lejos" (el último stop gana por spec) y
   * restaura las referencias vivas. Devuelve `true` si readoptó. Fuera de la
   * ventana (osciladores ya frenados) descarta el pendiente y devuelve
   * `false` para que `startEngine` cree grafo nuevo.
   */
  private adoptReleasingEngine(ctx: AudioContextLike): boolean {
    const pending = this.releasingEngine;
    if (!pending) {
      return false;
    }
    if (ctx.currentTime >= pending.stopAt) {
      this.releasingEngine = null;
      return false;
    }
    this.releasingEngine = null;
    try {
      const t = ctx.currentTime;
      pending.gain.gain.cancelScheduledValues(t);
      // Re-ataque desde el valor ACTUAL del fade (evita saltos de ganancia).
      pending.gain.gain.setValueAtTime(Math.max(ALMOST_ZERO, pending.gain.gain.value), t);
      pending.gain.gain.exponentialRampToValueAtTime(
        this.engineVolumeProfile,
        t + ENGINE_ATTACK_SECONDS,
      );
      // El stop del release ya estaba agendado: se reemplaza por uno lejos.
      const rearmAt = t + ENGINE_REARM_STOP_SECONDS;
      pending.osc.stop(rearmAt);
      pending.sub.stop(rearmAt);
    } catch {
      // Re-armar falló: los osciladores viejos frenan solos (inaudibles, la
      // ganancia ya cayó) y `startEngine` sigue con grafo nuevo.
      return false;
    }
    this.engineOsc = pending.osc;
    this.engineSub = pending.sub;
    this.engineFilter = pending.filter;
    this.engineGain = pending.gain;
    // El filtro arranca en el brillo que corresponda al turbo vigente (mismo
    // re-sincronizado de estado que hace la creación desde cero).
    pending.filter.frequency.value = this.turboActive
      ? this.engineFilterTurboProfile
      : this.engineFilterProfile;
    this.filterTurboActive = this.turboActive;
    return true;
  }

  /**
   * Para el dron con un release suave (el motor se "apaga"). Los nodos se
   * frenan un poco después del fade; las referencias se sueltan ya, pero el
   * grafo queda en `releasingEngine` por si `startEngine` llega dentro de la
   * ventana (readopción, qaT9).
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
      const stopAt = t + ENGINE_RELEASE_WINDOW_SECONDS;
      engineGain.gain.cancelScheduledValues(t);
      // Arranca el fade desde el valor ACTUAL (evita un click de salto a 0).
      engineGain.gain.setValueAtTime(Math.max(ALMOST_ZERO, engineGain.gain.value), t);
      engineGain.gain.exponentialRampToValueAtTime(ALMOST_ZERO, t + ENGINE_RELEASE_SECONDS);
      engineOsc.stop(stopAt);
      engineSub.stop(stopAt);
      this.releasingEngine = { osc: engineOsc, sub: engineSub, filter: engineFilter, gain: engineGain, stopAt };
    } catch {
      // Si el stop programado falla, los osciladores quedan huérfanos pero
      // inaudibles (su ganancia ya no tiene dueño con volumen).
      this.releasingEngine = null;
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
          active ? this.engineFilterTurboProfile : this.engineFilterProfile,
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
    const target = engineFrequencyForSpeed(this.latestSpeed, this.turboActive, this.mobileProfile);
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
   * - `damage` (issue #10, H2) → SFX de golpe no letal. Evento aparte de
   *   `health`: el roce con pared drena HP por frame y ese evento no sirve
   *   para sonar (solo viajan acá los impactos puntuales aplicados).
   * - `game-over` → SFX de crash + apaga el dron.
   * - `game-paused` / `game-resumed` (Fase 7) → apaga y re-arranca el dron
   *   (la carrera está congelada: el motor no sigue sonando en pausa).
   * - `game-aborted` (Fase 7) → apaga el dron sin SFX de crash (MENÚ desde
   *   la pausa).
   * - `race-go` (issue #14, V3) → SFX de largada del GRAN PREMIO (la escena
   *   vs CPU lo emite en el GO!; práctica y multi no lo emiten).
   * - `race-overtake` (#14, V3) → SFX de cambio de posición en el ranking
   *   vivo (la escena ya viene con el enfriamiento aplicado).
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
      bus.on('damage', () => this.play('damage')),
      bus.on('game-over', () => {
        this.play('crash');
        this.stopEngine();
      }),
      bus.on('game-paused', () => this.stopEngine()),
      bus.on('game-resumed', () => this.startEngine()),
      bus.on('game-aborted', () => this.stopEngine()),
      bus.on('race-go', () => this.play('go')),
      bus.on('race-overtake', () => this.play('overtake')),
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
  /* Recuperación tras interrupción (Fase 3, issue #4)                 */
  /* ---------------------------------------------------------------- */

  /**
   * Instala los listeners de recuperación: `onstatechange` del contexto y
   * `visibilitychange` del documento. Se llama UNA vez, al crear el contexto
   * (que puede existir antes del primer gesto si un `play()` lo creó): el
   * handler decide con el estado vigente, así que instalarlo temprano no
   * viola la política de autoplay.
   */
  private attachRecoveryListeners(ctx: AudioContextLike): void {
    if (this.recoveryAttached) {
      return;
    }
    try {
      ctx.onstatechange = this.handleContextStateChange;
    } catch {
      // Sin onstatechange queda la red de visibilitychange y los gestos.
    }
    const visibility = this.visibilityTarget;
    if (visibility) {
      try {
        visibility.addEventListener('visibilitychange', this.handleVisibilityChange);
      } catch {
        // Idem: el desbloqueo por gesto sigue disponible igualmente.
      }
    }
    this.recoveryAttached = true;
  }

  /** Quita los listeners instalados por `attachRecoveryListeners` (si hay). */
  private detachRecoveryListeners(): void {
    const ctx = this.context;
    if (ctx) {
      try {
        ctx.onstatechange = null;
      } catch {
        // El contexto ya no es nuestro: nada que hacer.
      }
    }
    const visibility = this.visibilityTarget;
    if (visibility) {
      try {
        visibility.removeEventListener('visibilitychange', this.handleVisibilityChange);
      } catch {
        // Idem.
      }
    }
    this.recoveryAttached = false;
  }

  /**
   * Reintenta `resume()` sin nuevo gesto. Guards, en orden: contexto creado,
   * desbloqueo previo (política de autoplay: sin gesto no se despierta),
   * estado problemático (idempotencia: el propio `resume()` re-dispara
   * `onstatechange` en `running` y corta acá, sin loops) y documento visible
   * (iOS deniega el resume con la pestaña oculta).
   */
  private tryAutoResume(): void {
    const ctx = this.context;
    if (!ctx || !this.unlockedOnce) {
      return;
    }
    if (ctx.state !== 'suspended' && ctx.state !== 'interrupted') {
      return;
    }
    if (!this.isDocumentVisible()) {
      return;
    }
    try {
      // Veredicto del hint POST-resume, igual que en unlock() (fase 2): el
      // estado se actualiza asincrónico y en `running` el hint no corresponde.
      void ctx.resume().then(
        () => this.notifyAudioBlockedHint(),
        () => this.notifyAudioBlockedHint(),
      );
    } catch {
      this.notifyAudioBlockedHint(); // resume lanzó sincrónico
    }
  }

  /** false solo con documento OCULTO (sin target inyectado se asume visible). */
  private isDocumentVisible(): boolean {
    return this.visibilityTarget?.visibilityState !== 'hidden';
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
      return null;
    }
    this.attachRecoveryListeners(this.context);
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

/** Target default de visibilidad: el document del navegador (o null). */
function defaultVisibilityTarget(): VisibilityEventTarget | null {
  try {
    return typeof document === 'undefined' ? null : document;
  } catch {
    return null;
  }
}

/**
 * Perfil default del dron (issue #4, H4): móvil si el user agent lo dice
 * (`isMobileLikeDevice`, pura en `core/device`), desktop en cualquier otro
 * caso (tests de Node, navegadores sin `navigator`, errores).
 */
function defaultIsMobileProfile(): boolean {
  try {
    if (typeof navigator === 'undefined') {
      return false;
    }
    return isMobileLikeDevice(navigator);
  } catch {
    return false;
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
