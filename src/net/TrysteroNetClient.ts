/**
 * TrysteroNetClient — transporte P2P real del multijugador (M1).
 *
 * PAQUETE (decisión cerrada y verificada contra npm): el plan mencionaba
 * `trystero-torrent`, que NO existe. Se instalan `trystero` (paraguas) y
 * `@trystero-p2p/torrent` — en Trystero v0.25.x el subpath `trystero/torrent`
 * quedó como shim de deprecación que LANZA al importarlo ("Install and
 * import from @trystero-p2p/torrent instead"), así que la estrategia torrent
 * (WebRTC DataChannels en malla, señalización por trackers BitTorrent) se
 * importa de SU paquete: `import {joinRoom} from '@trystero-p2p/torrent'`.
 *
 * La sala de Trystero es la PALABRA clave: `joinRoom({appId}, 'PARRILLA')`.
 * El appId (`VITE_TRYSTERO_APP_ID`) es el namespace de matchmaking — NO es
 * un secreto, solo separa aplicaciones que comparten trackers.
 *
 * Testeabilidad: todo lo que toca la red pasa por dependencias inyectables:
 * - `roomFactory`: default = `joinRoom` real; los tests inyectan un doble
 *   estructural de la room (makeAction/onPeerJoin/onPeerLeave/getPeers/leave).
 * - `selfIdProvider`: default = `selfId` de trystero.
 * - `env`: default = `import.meta.env` (para `resolveAppId` en tests).
 *
 * Intercambio de meta (patrón Trystero): no hay metadata de join en el
 * protocolo — cada peer, al ver `onPeerJoin` (que dispara en AMBOS extremos
 * de cada conexión nueva), envía SU meta al recién conectado con la acción
 * `meta` dirigida. Así el roster se completa solo, sin handshake extra.
 */

import { joinRoom, selfId as trysteroSelfId } from '@trystero-p2p/torrent';
import { MULTIPLAYER } from '../config/balance';
import { assignColors, isRoomFull, resolveHostPeerId } from './lobbyState';
import type { NetClient, CreateRoomOptions, JoinRoomOptions } from './NetClient';
import {
  isValidRoomWord,
  sanitizePlayerName,
  type EliminatedPayload,
  type MatchOverPayload,
  type PeerMeta,
  type PlayerInfo,
  type RosterEntry,
  type StartPayload,
  type StatePayload,
} from './protocol';
import { hashStringToSeed, mulberry32, type Rng } from './roomRng';
import { pickRoomWord } from './roomWords';

/* ------------------------------------------------------------------ */
/* Vista estructural mínima de una room de Trystero                    */
/* ------------------------------------------------------------------ */

/** Opciones de envío de una acción (target = peer/s destinatario/s). */
export interface ActionSendOptions {
  readonly target?: string | readonly string[] | null;
}

/** Acción de mensajería de Trystero (subconjunto estructural). */
export interface TrysteroAction<T> {
  send(data: T, options?: ActionSendOptions): Promise<void> | void;
  onMessage: ((data: T, context: { peerId: string }) => void | Promise<void>) | null;
}

/**
 * Room de Trystero vista como subconjunto estructural (lo único que usa el
 * cliente). La room real la satisface de sobra en runtime; el cast del
 * default factory es solo tipado (documentado ahí).
 */
export interface TrysteroRoom {
  makeAction<T>(namespace: string): TrysteroAction<T>;
  onPeerJoin: ((peerId: string) => void) | null;
  onPeerLeave: ((peerId: string) => void) | null;
  getPeers(): Readonly<Record<string, unknown>>;
  leave(): Promise<void> | void;
}

/** Fábrica de room inyectable: `(appId, roomId) => room`. */
export type RoomFactory = (appId: string, roomId: string) => TrysteroRoom;

/**
 * Factory default: `joinRoom` real de la estrategia torrent. El cast es de
 * TIPOS únicamente: `Room` de Trystero es un tipo sobrecargado (acciones
 * message/request) y acá solo interesa el subconjunto estructural declarado
 * en `TrysteroRoom`, que la room real cumple en runtime.
 */
const defaultRoomFactory: RoomFactory = (appId, roomId) =>
  joinRoom({ appId }, roomId) as unknown as TrysteroRoom;

/** Entorno de Vite (por defecto el real; los tests inyectan el suyo). */
export interface NetEnvSource {
  readonly VITE_TRYSTERO_APP_ID?: string;
}

/**
 * Resuelve el appId de Trystero desde el entorno. Fail-fast: sin
 * `VITE_TRYSTERO_APP_ID` no hay matchmaking posible, y conectar "en
 * silencio" con un appId vacío daría salas fantasma — mejor un error claro
 * que la UI del lobby muestra. (Definirlo en `.env.local` para dev y en el
 * CI para producción; ver `.env.example`.)
 */
export function resolveAppId(env: NetEnvSource = import.meta.env): string {
  const appId = env.VITE_TRYSTERO_APP_ID?.trim();
  if (!appId) {
    throw new Error('falta VITE_TRYSTERO_APP_ID (namespace de matchmaking de Trystero; ver .env.example)');
  }
  return appId;
}

/** Opciones del constructor (todas con default = red real). */
export interface TrysteroNetClientOptions {
  readonly roomFactory?: RoomFactory;
  /** Proveedor del peerId propio (default: `selfId` de Trystero). */
  readonly selfIdProvider?: () => string;
  /** rng para elegir la palabra al CREAR sala (default: crypto → mulberry32). */
  readonly wordRng?: Rng;
  readonly env?: NetEnvSource;
}

/** Handlers por evento (misma forma que el FakeNetClient). */
type HandlerMap = {
  peerJoin: Set<(peerId: string) => void>;
  peerLeave: Set<(peerId: string) => void>;
  rosterChange: Set<(roster: PlayerInfo[], hostPeerId: string | null) => void>;
  hostChange: Set<(hostPeerId: string) => void>;
  start: Set<(payload: StartPayload) => void>;
  peerState: Set<(peerId: string, payload: StatePayload) => void>;
  eliminated: Set<(peerId: string, payload: EliminatedPayload) => void>;
  matchOver: Set<(peerId: string, payload: MatchOverPayload) => void>;
  roomFull: Set<() => void>;
  error: Set<(message: string) => void>;
};

/** rng de palabras sembrado con crypto si existe (creación de sala). */
function defaultWordRng(): Rng {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const buffer = new Uint32Array(1);
    crypto.getRandomValues(buffer);
    return mulberry32(buffer[0] >>> 0);
  }
  // Fallback (entornos sin crypto): semilla temporal. Solo elige UNA palabra
  // de sala — nunca entra al pipeline determinista de generación de pista.
  return mulberry32(hashStringToSeed(`${Date.now()}-${Math.random()}`));
}

/** Implementación de `NetClient` sobre Trystero (malla P2P torrent). */
export class TrysteroNetClient implements NetClient {
  readonly selfPeerId: string;

  private readonly roomFactory: RoomFactory;
  private readonly wordRng: Rng;
  private readonly handlers: HandlerMap = {
    peerJoin: new Set(),
    peerLeave: new Set(),
    rosterChange: new Set(),
    hostChange: new Set(),
    start: new Set(),
    peerState: new Set(),
    eliminated: new Set(),
    matchOver: new Set(),
    roomFull: new Set(),
    error: new Set(),
  };

  private room: TrysteroRoom | null = null;
  private currentWord: string | null = null;
  private metaAction: TrysteroAction<PeerMeta> | null = null;
  private startAction: TrysteroAction<StartPayload> | null = null;
  /** Metas conocidas: la propia + las anunciadas por los peers. */
  private metas = new Map<string, PeerMeta>();
  private lastHost: string | null = null;
  /** true si esta instancia CREÓ la sala (anfitrión original). */
  private isCreator = false;

  constructor(options: TrysteroNetClientOptions = {}) {
    this.roomFactory = options.roomFactory ?? defaultRoomFactory;
    // `selfId` de Trystero es un valor (const) estable por pestaña: se
    // envuelve en función para que los tests puedan inyectar el suyo.
    this.selfPeerId = (options.selfIdProvider ?? (() => trysteroSelfId))();
    this.wordRng = options.wordRng ?? defaultWordRng();
  }

  get roomWord(): string | null {
    return this.currentWord;
  }

  /* ---------------- join/create ---------------- */

  create({ appId, name }: CreateRoomOptions): void {
    const cleanName = sanitizePlayerName(name);
    if (cleanName.length === 0) {
      this.emitError('Nombre de jugador inválido');
      return;
    }
    this.enterRoom(appId, pickRoomWord(this.wordRng), cleanName, true);
  }

  join({ appId, roomWord, name }: JoinRoomOptions): void {
    const cleanName = sanitizePlayerName(name);
    if (cleanName.length === 0) {
      this.emitError('Nombre de jugador inválido');
      return;
    }
    if (!isValidRoomWord(roomWord)) {
      this.emitError(`Palabra de sala inválida: "${roomWord}"`);
      return;
    }
    this.enterRoom(appId, roomWord, cleanName, false);
  }

  private enterRoom(appId: string, word: string, name: string, isCreator: boolean): void {
    this.leave();
    this.isCreator = isCreator;
    this.currentWord = word;
    this.metas = new Map([[this.selfPeerId, { name, color: 0, isCreator }]]);

    let room: TrysteroRoom;
    try {
      room = this.roomFactory(appId, word);
    } catch (error) {
      this.currentWord = null;
      this.metas.clear();
      this.emitError(`No se pudo conectar a la sala: ${String(error)}`);
      return;
    }
    this.room = room;

    // Acción de meta: cada peer anuncia {name, color, isCreator}. El color
    // del wire es informativo (se recalcula del roster en todos lados).
    this.metaAction = room.makeAction<PeerMeta>('meta');
    this.metaAction.onMessage = (meta, context) => {
      this.metas.set(context.peerId, { ...meta, name: sanitizePlayerName(meta.name) });
      this.emitRoster();
    };

    const startAction = room.makeAction<StartPayload>('start');
    startAction.onMessage = (payload) => {
      for (const handler of this.handlers.start) {
        handler(payload);
      }
    };
    this.startAction = startAction;

    const stateAction = room.makeAction<StatePayload>('state');
    stateAction.onMessage = (payload, context) => {
      for (const handler of this.handlers.peerState) {
        handler(context.peerId, payload);
      }
    };

    const eliminatedAction = room.makeAction<EliminatedPayload>('eliminated');
    eliminatedAction.onMessage = (payload, context) => {
      for (const handler of this.handlers.eliminated) {
        handler(context.peerId, payload);
      }
    };

    const matchOverAction = room.makeAction<MatchOverPayload>('match-over');
    matchOverAction.onMessage = (payload, context) => {
      for (const handler of this.handlers.matchOver) {
        handler(context.peerId, payload);
      }
    };

    room.onPeerJoin = (peerId) => this.handlePeerJoin(peerId);
    room.onPeerLeave = (peerId) => this.handlePeerLeave(peerId);

    this.emitRoster();
  }

  /* ---------------- roster / anfitrión ---------------- */

  getRoster(): PlayerInfo[] {
    return assignColors(this.rosterEntries());
  }

  getHostPeerId(): string | null {
    return resolveHostPeerId(this.rosterEntries());
  }

  isHost(): boolean {
    return this.getHostPeerId() === this.selfPeerId;
  }

  private rosterEntries(): RosterEntry[] {
    return [...this.metas.entries()].map(([peerId, meta]) => ({
      peerId,
      name: meta.name,
      isCreator: meta.isCreator,
    }));
  }

  /**
   * Conexión nueva: se anuncia la meta propia al recién conectado (patrón
   * Trystero — no hay metadata de join) y se controla la CAPACIDAD: un
   * JOINER que al entrar ya encuentra la sala llena (más de 10 contándose)
   * se auto-rechaza (roomFull + leave). El creador nunca se auto-rechaza.
   */
  private handlePeerJoin(peerId: string): void {
    for (const handler of this.handlers.peerJoin) {
      handler(peerId);
    }
    const own = this.metas.get(this.selfPeerId);
    if (own && this.metaAction) {
      void this.metaAction.send(own, { target: peerId });
    }
    if (!this.isCreator && isRoomFull(this.peerCountIncludingSelf())) {
      for (const handler of this.handlers.roomFull) {
        handler();
      }
      this.leave();
    }
  }

  private handlePeerLeave(peerId: string): void {
    const hadMeta = this.metas.delete(peerId);
    for (const handler of this.handlers.peerLeave) {
      handler(peerId);
    }
    if (hadMeta) {
      this.emitRoster();
    }
  }

  private peerCountIncludingSelf(): number {
    return Object.keys(this.room?.getPeers() ?? {}).length + 1;
  }

  private emitRoster(): void {
    const previousHost = this.lastHost;
    const host = this.getHostPeerId();
    this.lastHost = host;
    const roster = this.getRoster();
    for (const handler of this.handlers.rosterChange) {
      handler(roster, host);
    }
    if (host !== null && host !== previousHost) {
      for (const handler of this.handlers.hostChange) {
        handler(host);
      }
    }
  }

  /* ---------------- acciones ---------------- */

  start(payload: StartPayload): void {
    if (!this.isHost()) {
      this.emitError('Solo el anfitrión puede iniciar la partida');
      return;
    }
    if (!this.startAction) {
      this.emitError('No hay sala activa');
      return;
    }
    void this.startAction.send(payload);
  }

  sendState(payload: StatePayload): void {
    this.withRoom((room) => void room.makeAction<StatePayload>('state').send(payload));
  }

  sendEliminated(payload: EliminatedPayload): void {
    this.withRoom((room) => void room.makeAction<EliminatedPayload>('eliminated').send(payload));
  }

  sendMatchOver(payload: MatchOverPayload): void {
    this.withRoom((room) => void room.makeAction<MatchOverPayload>('match-over').send(payload));
  }

  private withRoom(fn: (room: TrysteroRoom) => void): void {
    if (!this.room) {
      this.emitError('No hay sala activa');
      return;
    }
    fn(this.room);
  }

  /* ---------------- lifecycle ---------------- */

  leave(): void {
    if (this.room) {
      this.room.onPeerJoin = null;
      this.room.onPeerLeave = null;
      void this.room.leave();
    }
    this.room = null;
    this.metaAction = null;
    this.startAction = null;
    this.currentWord = null;
    this.metas.clear();
    this.isCreator = false;
  }

  destroy(): void {
    this.leave();
    for (const set of Object.values(this.handlers)) {
      set.clear();
    }
  }

  /* ---------------- eventos ---------------- */

  onPeerJoin(handler: (peerId: string) => void): () => void {
    this.handlers.peerJoin.add(handler);
    return () => this.handlers.peerJoin.delete(handler);
  }

  onPeerLeave(handler: (peerId: string) => void): () => void {
    this.handlers.peerLeave.add(handler);
    return () => this.handlers.peerLeave.delete(handler);
  }

  onRosterChange(handler: (roster: PlayerInfo[], hostPeerId: string | null) => void): () => void {
    this.handlers.rosterChange.add(handler);
    return () => this.handlers.rosterChange.delete(handler);
  }

  onHostChange(handler: (hostPeerId: string) => void): () => void {
    this.handlers.hostChange.add(handler);
    return () => this.handlers.hostChange.delete(handler);
  }

  onStart(handler: (payload: StartPayload) => void): () => void {
    this.handlers.start.add(handler);
    return () => this.handlers.start.delete(handler);
  }

  onPeerState(handler: (peerId: string, payload: StatePayload) => void): () => void {
    this.handlers.peerState.add(handler);
    return () => this.handlers.peerState.delete(handler);
  }

  onEliminated(handler: (peerId: string, payload: EliminatedPayload) => void): () => void {
    this.handlers.eliminated.add(handler);
    return () => this.handlers.eliminated.delete(handler);
  }

  onMatchOver(handler: (peerId: string, payload: MatchOverPayload) => void): () => void {
    this.handlers.matchOver.add(handler);
    return () => this.handlers.matchOver.delete(handler);
  }

  onRoomFull(handler: () => void): () => void {
    this.handlers.roomFull.add(handler);
    return () => this.handlers.roomFull.delete(handler);
  }

  onError(handler: (message: string) => void): () => void {
    this.handlers.error.add(handler);
    return () => this.handlers.error.delete(handler);
  }

  private emitError(message: string): void {
    for (const handler of this.handlers.error) {
      handler(message);
    }
  }

  /** Capacidad de la sala (expuesta para documentación/debug). */
  static readonly maxPlayers = MULTIPLAYER.maxPlayers;
}
