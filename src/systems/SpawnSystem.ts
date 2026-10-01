import Phaser from 'phaser';
import {
  BASE_SPEED,
  ENTITY_POOL_LIMITS,
  MIN_SPEED,
  PLAYER_START_Y,
  SPAWN,
  laneCenterX,
} from '../config/balance';
import {
  ENTITY_DEFINITIONS,
  closingSpeed,
  pickWeightedKind,
  type EntityDefinition,
  type EntityFamily,
  type EntityKind,
} from '../entities/entityTypes';
import { Coin } from '../entities/Coin';
import { Hazard } from '../entities/Hazard';
import { Pickup } from '../entities/Pickup';
import { RivalCar } from '../entities/RivalCar';
import { TrackEntity } from '../entities/TrackEntity';
import type { DifficultyParams } from './DifficultySystem';

/**
 * SpawnSystem — entidades de pista y generación procedural (Fase 4).
 *
 * Tres piezas, de adentro hacia afuera:
 *
 * 1. `ObjectPool` (puro): pool genérico con límite estricto. `acquire` reusa
 *    instancias liberadas antes de crear nuevas y devuelve `null` al llegar
 *    al tope: jamás crea objetos por frame ni crece sin límite.
 *
 * 2. `SpawnScheduler` (puro, testeable sin Phaser): decide CUÁNDO y QUÉ
 *    spawnear. Las posiciones/carriles son datos (`SpawnRequest`); Phaser
 *    solo instancia. Garantiza pasabilidad: modela qué carriles están
 *    ocupados (con vencimiento según la velocidad de cierre de cada entidad)
 *    y jamás bloquea el último carril libre. El ritmo depende de la
 *    velocidad actual (más rápido = más frecuente) y de la densidad de
 *    DifficultySystem; los patrones se desbloquean por nivel de dificultad.
 *
 * 3. `SpawnSystem` (Phaser): adapta los `SpawnRequest` a sprites arcade de
 *    4 pools (uno por familia, límites en `ENTITY_POOL_LIMITS`), les asigna
 *    la velocidad de cierre por frame y los recicla al salir de pantalla.
 *    Las colisiones viven en GameScene (Arcade overlap sobre los grupos).
 */

/** dt máximo aceptado por un `update` (anti-espiral de la muerte). */
const MAX_DT = 0.25;

function sanitizeDt(dt: number): number {
  if (!Number.isFinite(dt) || dt <= 0) {
    return 0;
  }
  return Math.min(dt, MAX_DT);
}

/* ================================================================== */
/* 1) ObjectPool (puro)                                                */
/* ================================================================== */

/**
 * Pool genérico con límite duro. `factory` solo se invoca mientras haya
 * cupo; después, `acquire` devuelve instancias liberadas (`release`) o
 * `null` si el pool está agotado. Reciclar = reusar la MISMA instancia.
 */
export class ObjectPool<T> {
  private readonly all: T[] = [];
  private readonly free: T[] = [];
  private readonly active = new Set<T>();

  constructor(
    private readonly factory: () => T,
    readonly maxSize: number,
  ) {
    if (!Number.isInteger(maxSize) || maxSize < 1) {
      throw new Error(`ObjectPool: maxSize debe ser un entero ≥ 1 (recibido ${maxSize})`);
    }
  }

  /** Instancias creadas en total (nunca supera `maxSize`). */
  get createdCount(): number {
    return this.all.length;
  }

  /** Instancias actualmente en uso. */
  get activeCount(): number {
    return this.active.size;
  }

  /** Instancias libres esperando reuso. */
  get freeCount(): number {
    return this.free.length;
  }

  /**
   * Toma una instancia: reusa una liberada si la hay, si no crea una nueva
   * (mientras haya cupo). Devuelve `null` cuando el pool está al tope.
   */
  acquire(): T | null {
    const reused = this.free.pop();
    if (reused !== undefined) {
      this.active.add(reused);
      return reused;
    }
    if (this.all.length >= this.maxSize) {
      return null;
    }
    const item = this.factory();
    this.all.push(item);
    this.active.add(item);
    return item;
  }

  /**
   * Libera una instancia para su reuso. Idempotente e ignorante de elementos
   * ajenos al pool o ya liberados (defensa contra dobles releases).
   */
  release(item: T): void {
    if (!this.active.delete(item)) {
      return;
    }
    this.free.push(item);
  }

  /** Libera todo lo activo (reset de carrera). */
  releaseAll(): void {
    for (const item of [...this.active]) {
      this.release(item);
    }
  }

  /** Itera las instancias activas (para moverlas/reciclarlas por frame). */
  forEachActive(fn: (item: T) => void): void {
    this.active.forEach(fn);
  }

  /** Itera TODAS las creadas (activas o no), en orden de creación. */
  forEachCreated(fn: (item: T) => void): void {
    for (const item of this.all) {
      fn(item);
    }
  }
}

/* ================================================================== */
/* 2) SpawnScheduler (puro, sin Phaser)                                */
/* ================================================================== */

/** Generador de azar en [0, 1); inyectable para tests determinísticos. */
export type Rng = () => number;

/** Pedido de spawn: datos puros que el adaptador Phaser instancia. */
export interface SpawnRequest {
  readonly kind: EntityKind;
  /** Índice de carril (0 = izquierda). */
  readonly lane: number;
  /** X absoluta del centro del carril (px). */
  readonly x: number;
  /** Y absoluta (fuera de pantalla, arriba; offsets negativos hacia arriba). */
  readonly y: number;
}

/** Patrones de oleada; se desbloquean por nivel de dificultad. */
export type WavePattern =
  | 'coin-line'
  | 'coin-zigzag'
  | 'single-rival'
  | 'rival-duo'
  | 'slalom'
  | 'scattered-hazards'
  | 'blocked-gap';

/** Patrones nuevos que aporta cada nivel (los niveles acumulan). */
const PATTERN_LEVELS: readonly (readonly WavePattern[])[] = [
  ['coin-line', 'single-rival', 'scattered-hazards'],
  ['coin-zigzag', 'rival-duo', 'slalom'],
  ['blocked-gap'],
];

/** Y extra del pickup dentro de la oleada (intercalado con las monedas). */
const PICKUP_Y_OFFSET = 55;

/** Oleada construida por un patrón. */
interface BuiltWave {
  readonly name: WavePattern;
  readonly requests: SpawnRequest[];
  /** Alto vertical de la oleada (px): espacia la siguiente. */
  readonly spanY: number;
}

/** Configurable por constructor (defaults de balance; tests inyectan rng). */
export interface SpawnSchedulerConfig {
  readonly rng: Rng;
  readonly playerY: number;
  readonly spawnY: number;
  readonly laneCount: number;
}

/** Ocupación de un carril por un bloqueo, con vencimiento por distancia. */
interface LaneOccupancy {
  readonly kind: EntityKind;
  /** Px que faltan para que la entidad alcance al jugador. */
  distanceRemaining: number;
}

/**
 * Scheduler de oleadas. Puro: `update(dt, speed, params)` devuelve los
 * `SpawnRequest` del frame (normalmente vacío). Garantía de pasabilidad:
 * los bloqueos (rivales/hazards) reservan su carril hasta pasar al jugador
 * y jamás se coloca un bloqueo que deje los carriles todos ocupados.
 */
export class SpawnScheduler {
  private readonly rng: Rng;
  private readonly playerY: number;
  private readonly spawnY: number;
  private readonly laneCount: number;
  private readonly occupancy = new Map<number, LaneOccupancy>();
  private nextWaveIn: number;
  private lastPattern: WavePattern | null = null;

  constructor(config: Partial<SpawnSchedulerConfig> = {}) {
    this.rng = config.rng ?? Math.random;
    this.playerY = config.playerY ?? PLAYER_START_Y;
    this.spawnY = config.spawnY ?? SPAWN.spawnY;
    this.laneCount = config.laneCount ?? SPAWN.laneCount;
    this.nextWaveIn = SPAWN.initialWaveDelay;
  }

  /** Carriles actualmente bloqueados (ordenados; debug y tests). */
  get blockedLanes(): readonly number[] {
    return [...this.occupancy.keys()].sort((a, b) => a - b);
  }

  /** Segundos hasta la próxima oleada (debug y tests). */
  get timeToNextWave(): number {
    return this.nextWaveIn;
  }

  /** Último patrón construido (debug y tests). */
  get lastWavePattern(): WavePattern | null {
    return this.lastPattern;
  }

  /** Reinicia oleadas y ocupaciones (arranque de carrera). */
  reset(): void {
    this.occupancy.clear();
    this.nextWaveIn = SPAWN.initialWaveDelay;
    this.lastPattern = null;
  }

  /**
   * Avanza un paso de simulación. Devuelve los pedidos de spawn del frame.
   * `dt` inválido es un no-op estricto (no vence oleadas ni ocupaciones).
   */
  update(dt: number, speed: number, difficulty: DifficultyParams): SpawnRequest[] {
    const step = sanitizeDt(dt);
    if (step === 0) {
      return [];
    }

    this.tickOccupancies(step, speed, difficulty.rivalSpeedFactor);
    this.nextWaveIn -= step;
    if (this.nextWaveIn > 0) {
      return [];
    }

    let wave = this.buildWave(difficulty);
    if (wave.requests.length === 0) {
      // Pista congestionada: el patrón sorteado no encontró dónde entrar.
      // Fallback: línea de monedas, siempre construible porque la garantía
      // de pasabilidad deja al menos un carril libre.
      wave = this.waveCoinLine();
      if (wave.requests.length === 0) {
        this.nextWaveIn = SPAWN.minWaveInterval;
        return [];
      }
      this.lastPattern = wave.name;
    }

    // Reservar los carriles bloqueados (rivales y hazards; monedas/pickups no).
    for (const request of wave.requests) {
      const family: EntityFamily = ENTITY_DEFINITIONS[request.kind].family;
      if (family === 'coin' || family === 'pickup') {
        continue;
      }
      this.occupancy.set(request.lane, {
        kind: request.kind,
        distanceRemaining: this.playerY - request.y,
      });
    }

    // Bonus: a veces una oleada trae un pickup en un carril libre.
    const pickup = this.tryPickup();
    const requests = pickup ? [...wave.requests, pickup] : wave.requests;

    // Ritmo: intervalo por velocidad + densidad, más el tiempo de cruzar el
    // alto de la oleada a la velocidad de cierre del elemento más lento.
    let minClosing = Number.POSITIVE_INFINITY;
    for (const request of wave.requests) {
      minClosing = Math.min(minClosing, closingSpeed(request.kind, speed, difficulty.rivalSpeedFactor));
    }
    if (!Number.isFinite(minClosing) || minClosing <= 0) {
      minClosing = Math.max(speed, 1);
    }
    this.nextWaveIn = this.waveIntervalSeconds(speed, difficulty.spawnDensity) + wave.spanY / minClosing;
    this.lastPattern = wave.name;

    return requests;
  }

  /* --------------------- ritmo y ocupación --------------------- */

  /**
   * Intervalo base entre oleadas (s): a más velocidad, más frecuente
   * (escala con BASE_SPEED / speed); la densidad de dificultad divide.
   * Piso y techo clampeados (nunca infinito ni cero).
   */
  private waveIntervalSeconds(speed: number, spawnDensity: number): number {
    const safeSpeed = Number.isFinite(speed) && speed > 0 ? speed : BASE_SPEED;
    const safeDensity = Number.isFinite(spawnDensity) && spawnDensity > 0 ? spawnDensity : 1;
    const raw = (SPAWN.baseWaveInterval * (BASE_SPEED / safeSpeed)) / safeDensity;
    return Math.min(Math.max(raw, SPAWN.minWaveInterval), SPAWN.baseWaveInterval * 2);
  }

  /** Vence las ocupaciones según la velocidad de cierre de cada entidad. */
  private tickOccupancies(dt: number, speed: number, rivalSpeedFactor: number): void {
    for (const [lane, occupancy] of this.occupancy) {
      occupancy.distanceRemaining -= closingSpeed(occupancy.kind, speed, rivalSpeedFactor) * dt;
      if (occupancy.distanceRemaining <= 0) {
        this.occupancy.delete(lane);
      }
    }
  }

  private freeLanes(): number[] {
    const free: number[] = [];
    for (let lane = 0; lane < this.laneCount; lane += 1) {
      if (!this.occupancy.has(lane)) {
        free.push(lane);
      }
    }
    return free;
  }

  /* --------------------- patrones --------------------- */

  private buildWave(difficulty: DifficultyParams): BuiltWave {
    switch (this.pickPattern(difficulty.patternLevel)) {
      case 'coin-line':
        return this.waveCoinLine();
      case 'coin-zigzag':
        return this.waveCoinZigzag();
      case 'single-rival':
        return this.waveSingleRival();
      case 'rival-duo':
        return this.waveRivalDuo();
      case 'slalom':
        return this.waveSlalom();
      case 'scattered-hazards':
        return this.waveScatteredHazards();
      case 'blocked-gap':
        return this.waveBlockedGap();
    }
  }

  /** Elige patrón entre los desbloqueados, evitando repetir el último. */
  private pickPattern(patternLevel: number): WavePattern {
    const level = Math.min(Math.max(Math.round(patternLevel), 1), PATTERN_LEVELS.length);
    const unlocked = PATTERN_LEVELS.slice(0, level).flat();
    const candidates = unlocked.filter((pattern) => pattern !== this.lastPattern);
    return this.pick(candidates.length > 0 ? candidates : unlocked);
  }

  /** Línea de monedas en un carril libre (no bloquea). */
  private waveCoinLine(): BuiltWave {
    const free = this.freeLanes();
    if (free.length === 0) {
      return { name: 'coin-line', requests: [], spanY: 0 };
    }
    const lane = this.pick(free);
    const count = SPAWN.coinLineMin + Math.floor(this.rng() * (SPAWN.coinLineMax - SPAWN.coinLineMin + 1));
    const requests: SpawnRequest[] = [];
    for (let i = 0; i < count; i += 1) {
      requests.push(this.coinRequest(lane, this.spawnY - i * SPAWN.coinGap));
    }
    return { name: 'coin-line', requests, spanY: (count - 1) * SPAWN.coinGap };
  }

  /** Monedas en zigzag entre dos carriles vecinos libres (no bloquea). */
  private waveCoinZigzag(): BuiltWave {
    const free = new Set(this.freeLanes());
    if (free.size === 0) {
      return { name: 'coin-zigzag', requests: [], spanY: 0 };
    }
    const laneA = this.pick([...free]);
    const neighbours = [laneA - 1, laneA + 1].filter((lane) => free.has(lane));
    const laneB = neighbours.length > 0 ? this.pick(neighbours) : laneA;
    const count = SPAWN.coinLineMin + 1 + Math.floor(this.rng() * 2);
    const requests: SpawnRequest[] = [];
    for (let i = 0; i < count; i += 1) {
      requests.push(this.coinRequest(i % 2 === 0 ? laneA : laneB, this.spawnY - i * SPAWN.coinGap));
    }
    return { name: 'coin-zigzag', requests, spanY: (count - 1) * SPAWN.coinGap };
  }

  /** Un rival en un carril que no quede todo bloqueado. */
  private waveSingleRival(): BuiltWave {
    const request = this.tryPlaceBlocker(pickWeightedKind('rival', this.rng), this.spawnY, new Set<number>());
    return request
      ? { name: 'single-rival', requests: [request], spanY: 0 }
      : { name: 'single-rival', requests: [], spanY: 0 };
  }

  /** Dos rivales escalonados en carriles distintos. */
  private waveRivalDuo(): BuiltWave {
    const taken = new Set<number>();
    const requests: SpawnRequest[] = [];
    const first = this.tryPlaceBlocker(pickWeightedKind('rival', this.rng), this.spawnY, taken);
    if (first) {
      requests.push(first);
    }
    const second = this.tryPlaceBlocker(pickWeightedKind('rival', this.rng), this.spawnY - SPAWN.waveGap, taken);
    if (second) {
      requests.push(second);
    }
    return {
      name: 'rival-duo',
      requests,
      spanY: requests.length > 1 ? SPAWN.waveGap : 0,
    };
  }

  /** Tres rivales alternando dos carriles: slalomear por los libres. */
  private waveSlalom(): BuiltWave {
    const free = this.freeLanes();
    // Necesita 2 carriles para tejer + 1 garantizado libre.
    if (free.length < 3) {
      return { name: 'slalom', requests: [], spanY: 0 };
    }
    const laneA = this.pick(free);
    const laneB = this.pick(free.filter((lane) => lane !== laneA));
    const requests: SpawnRequest[] = [];
    for (let i = 0; i < 3; i += 1) {
      const lane = i % 2 === 0 ? laneA : laneB;
      requests.push(
        this.blockerRequest(pickWeightedKind('rival', this.rng), lane, this.spawnY - i * SPAWN.slalomGap),
      );
    }
    return { name: 'slalom', requests, spanY: 2 * SPAWN.slalomGap };
  }

  /** Uno o dos hazards dispersos (pesos debris/aceite de entityTypes). */
  private waveScatteredHazards(): BuiltWave {
    const taken = new Set<number>();
    const requests: SpawnRequest[] = [];
    const first = this.tryPlaceBlocker(pickWeightedKind('hazard', this.rng), this.spawnY, taken);
    if (first) {
      requests.push(first);
    }
    if (this.rng() < 0.4) {
      const second = this.tryPlaceBlocker(pickWeightedKind('hazard', this.rng), this.spawnY - SPAWN.waveGap, taken);
      if (second) {
        requests.push(second);
      }
    }
    return {
      name: 'scattered-hazards',
      requests,
      spanY: requests.length > 1 ? SPAWN.waveGap : 0,
    };
  }

  /** Muro: bloquea laneCount-1 carriles y deja UNO libre, señalizado con monedas. */
  private waveBlockedGap(): BuiltWave {
    if (this.freeLanes().length < this.laneCount) {
      // El muro exige pista despejada: los bloqueos previos deben pasar.
      return { name: 'blocked-gap', requests: [], spanY: 0 };
    }
    const taken = new Set<number>();
    const requests: SpawnRequest[] = [];
    for (let i = 0; i < this.laneCount - 1; i += 1) {
      const kind = this.rng() < 0.6 ? pickWeightedKind('rival', this.rng) : pickWeightedKind('hazard', this.rng);
      const request = this.tryPlaceBlocker(kind, this.spawnY - i * SPAWN.waveGap, taken);
      if (request) {
        requests.push(request);
      }
    }
    // Guía: línea de monedas por el hueco.
    const freeLane = this.freeLanes().find((lane) => !taken.has(lane));
    if (freeLane !== undefined) {
      for (let i = 0; i < 4; i += 1) {
        requests.push(this.coinRequest(freeLane, this.spawnY - PICKUP_Y_OFFSET - i * SPAWN.coinGap));
      }
    }
    return {
      name: 'blocked-gap',
      requests,
      spanY: Math.max((this.laneCount - 2) * SPAWN.waveGap, 3 * SPAWN.coinGap),
    };
  }

  /* --------------------- helpers de colocación --------------------- */

  private pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.rng() * items.length)];
  }

  private coinRequest(lane: number, y: number): SpawnRequest {
    return { kind: 'coin', lane, x: laneCenterX(lane, this.laneCount), y };
  }

  private blockerRequest(kind: EntityKind, lane: number, y: number): SpawnRequest {
    return { kind, lane, x: laneCenterX(lane, this.laneCount), y };
  }

  /**
   * Coloca un bloqueo (rival/hazard) en un carril libre SOLO si tras hacerlo
   * queda al menos un carril libre en total (garantía de pasabilidad).
   * `taken` acumula los bloqueos ya colocados en esta misma oleada.
   */
  private tryPlaceBlocker(kind: EntityKind, y: number, taken: Set<number>): SpawnRequest | null {
    const candidates = this.freeLanes().filter((lane) => !taken.has(lane));
    if (candidates.length < 2) {
      return null;
    }
    const lane = this.pick(candidates);
    taken.add(lane);
    return this.blockerRequest(kind, lane, y);
  }

  /** Pickup opcional en un carril libre (no bloquea; nunca garantizado). */
  private tryPickup(): SpawnRequest | null {
    if (this.rng() >= SPAWN.pickupChance) {
      return null;
    }
    const free = this.freeLanes();
    if (free.length === 0) {
      return null;
    }
    const lane = this.pick(free);
    return this.blockerRequest(
      pickWeightedKind('pickup', this.rng),
      lane,
      this.spawnY - PICKUP_Y_OFFSET,
    );
  }
}

/* ================================================================== */
/* 3) SpawnSystem (Phaser: pooling + movimiento de sprites)            */
/* ================================================================== */

/** Dependencias inyectadas (inversión: sin acoplarse a GameScene). */
export interface SpawnSystemDeps {
  /** Velocidad compuesta actual de la carrera (px/s). */
  readonly speedProvider: () => number;
  /** Rampa de dificultad (solo lectura de `params`). */
  readonly difficulty: { readonly params: DifficultyParams };
}

/**
 * Fuente de rng por entidad (M0, multijugador): devuelve el stream sembrado
 * para la entidad (`family`, `spawnIndex`). El índice es el contador GLOBAL
 * de pedidos despachados, función pura de la salida del scheduler, así que
 * la semilla no depende del estado local de los pools (determinista).
 */
export type EntityRngSource = (family: EntityFamily, spawnIndex: number) => Rng;

/**
 * Opciones inyectables del SpawnSystem (M0, multijugador). Ambas opcionales
 * y con defaults EXACTAMENTE iguales al comportamiento de siempre: sin
 * opciones, el sistema crea su propio `SpawnScheduler` (rng = Math.random)
 * y no asigna rng a las entidades — el modo solo no cambia en nada.
 */
export interface SpawnSystemOptions {
  /** Scheduler propio de la sala (p. ej. alimentado por VirtualClock). */
  readonly scheduler?: SpawnScheduler;
  /** Semillas por entidad (rivales con cambio de carril determinista). */
  readonly entityRng?: EntityRngSource;
}

const FAMILY_KEYS: readonly EntityFamily[] = ['rival', 'coin', 'hazard', 'pickup'];

/**
 * Adaptador Phaser del scheduler: pools por familia (grupos arcade para los
 * overlaps), despacho de `SpawnRequest` y movimiento/reciclaje por frame.
 */
export class SpawnSystem {
  readonly rivalGroup: Phaser.Physics.Arcade.Group;
  readonly coinGroup: Phaser.Physics.Arcade.Group;
  readonly hazardGroup: Phaser.Physics.Arcade.Group;
  readonly pickupGroup: Phaser.Physics.Arcade.Group;

  private readonly deps: SpawnSystemDeps;
  private readonly pools: Record<EntityFamily, ObjectPool<TrackEntity>>;
  private readonly entityRng: EntityRngSource | undefined;
  /** Scheduler de oleadas (público: el mismo de la sala, espiable en tests). */
  readonly scheduler: SpawnScheduler;
  /** Contador global de pedidos despachados (semilla por entidad; se resetea con la carrera). */
  private spawnIndex = 0;
  private running = true;

  constructor(scene: Phaser.Scene, deps: SpawnSystemDeps, options: SpawnSystemOptions = {}) {
    this.deps = deps;
    this.scheduler = options.scheduler ?? new SpawnScheduler();
    this.entityRng = options.entityRng;

    // Un grupo arcade por familia: los overlaps de GameScene se registran
    // una sola vez por grupo y los bodies deshabilitados no colisionan.
    this.rivalGroup = scene.physics.add.group();
    this.coinGroup = scene.physics.add.group();
    this.hazardGroup = scene.physics.add.group();
    this.pickupGroup = scene.physics.add.group();

    // Pools con límite duro (balance): las factories crean bajo demanda.
    this.pools = {
      rival: new ObjectPool<TrackEntity>(() => {
        const rival = new RivalCar(scene);
        this.rivalGroup.add(rival);
        return rival;
      }, ENTITY_POOL_LIMITS.rival),
      coin: new ObjectPool<TrackEntity>(() => {
        const coin = new Coin(scene);
        this.coinGroup.add(coin);
        return coin;
      }, ENTITY_POOL_LIMITS.coin),
      hazard: new ObjectPool<TrackEntity>(() => {
        const hazard = new Hazard(scene);
        this.hazardGroup.add(hazard);
        return hazard;
      }, ENTITY_POOL_LIMITS.hazard),
      pickup: new ObjectPool<TrackEntity>(() => {
        const pickup = new Pickup(scene);
        this.pickupGroup.add(pickup);
        return pickup;
      }, ENTITY_POOL_LIMITS.pickup),
    };
  }

  /** Carriles bloqueados ahora mismo (debug/HUD futuro). */
  get blockedLanes(): readonly number[] {
    return this.scheduler.blockedLanes;
  }

  /** `false` tras un crash: deja de spawnear y mover (escena congelada). */
  get isRunning(): boolean {
    return this.running;
  }

  setEnabled(enabled: boolean): void {
    this.running = enabled;
  }

  /** Un frame de generación + movimiento. `dt` en segundos. */
  update(dt: number): void {
    if (!this.running) {
      return;
    }
    const speed = this.deps.speedProvider();
    const difficulty = this.deps.difficulty.params;

    for (const request of this.scheduler.update(dt, speed, difficulty)) {
      this.dispatch(request);
    }

    this.moveActives(speed, difficulty.rivalSpeedFactor);
  }

  /** Devuelve una entidad al pool (reciclaje, no destrucción). */
  release(entity: TrackEntity): void {
    this.pools[entity.family].release(entity);
    entity.recycle();
  }

  /** Vacia pools y oleadas (arranque de una carrera nueva). */
  reset(): void {
    this.scheduler.reset();
    this.spawnIndex = 0;
    for (const family of FAMILY_KEYS) {
      const pool = this.pools[family];
      pool.forEachActive((entity) => entity.recycle());
      pool.releaseAll();
    }
  }

  /** Destruye los grupos arcade (shutdown de la escena). */
  destroy(): void {
    this.rivalGroup.destroy(true);
    this.coinGroup.destroy(true);
    this.hazardGroup.destroy(true);
    this.pickupGroup.destroy(true);
  }

  /* --------------------- internos --------------------- */

  /**
   * Instancia un pedido: pool por familia; si está al tope, se descarta.
   * Multijugador: los pedidos de familia rival reciben (antes de `spawn()`)
   * su rng sembrado por `entityRng(family, spawnIndex)`. El índice avanza
   * por PEDIDO (no por adquisición exitosa) para que la semilla sea función
   * pura de la salida del scheduler y no del estado local de los pools.
   */
  private dispatch(request: SpawnRequest): void {
    const definition: EntityDefinition = ENTITY_DEFINITIONS[request.kind];
    const spawnIndex = this.spawnIndex;
    this.spawnIndex += 1;
    const entity = this.pools[definition.family].acquire();
    if (!entity) {
      return;
    }
    if (this.entityRng && entity instanceof RivalCar) {
      entity.setRng(this.entityRng('rival', spawnIndex));
    }
    entity.spawn(request.x, request.y, definition);
  }

  /**
   * Velocidad de cierre por familia: estáticos viajan con la pista, rivales
   * restan su avance (escalado por dificultad). Fuera de pantalla abajo →
   * reciclar. Defensa extra: velocidad nunca NaN.
   */
  private moveActives(speed: number, rivalSpeedFactor: number): void {
    const safeSpeed = Number.isFinite(speed) ? speed : MIN_SPEED;
    for (const family of FAMILY_KEYS) {
      this.pools[family].forEachActive((entity) => {
        const body = entity.body as Phaser.Physics.Arcade.Body;
        body.velocity.y = closingSpeed(entity.kind, safeSpeed, rivalSpeedFactor);
        if (entity.y > SPAWN.despawnY) {
          this.release(entity);
        }
      });
    }
  }
}
