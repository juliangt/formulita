/**
 * FakeNetClient — doble en memoria de `NetClient` para tests (M1).
 *
 * Un `FakeNetHub` hace de "red": las instancias conectadas al mismo hub y a
 * la misma palabra de sala se ven entre sí (join/leave, acciones de
 * meta/start/estado), sin WebRTC ni señalización. Réplica fiel de la
 * SEMÁNTICA de TrysteroNetClient (mismas reglas de roster/anfitrión/color/
 * capacidad, todas sacadas de `lobbyState`), así los tests de integración
 * del lobby prueban comportamiento, no transporte.
 *
 * Todo es síncrono: `clientA.start(...)` dispara `onStart` en B y C dentro
 * de la propia llamada a `start`.
 */

import { hashStringToSeed, mulberry32 } from '../../net/roomRng';
import { pickRoomWord, ROOM_WORDS } from '../../net/roomWords';
import type { NetClient } from '../../net/NetClient';
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
} from '../../net/protocol';
import { assignColors, isRoomFull, resolveHostPeerId } from '../../net/lobbyState';

/** Un handler por evento (los guarda el cliente hasta destroy). */
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

/** Mensaje que viaja por el hub (acción + payload + destinatario opcional). */
interface HubMessage {
  readonly from: string;
  readonly action: string;
  readonly payload: unknown;
  /** null = broadcast a toda la sala; un peerId = entrega dirigida. */
  readonly target: string | null;
}

/**
 * La "red": salas por palabra. Sin lógica de juego — solo membresía y
 * entrega de mensajes (lo que en Trystero hacen los DataChannels en malla).
 */
export class FakeNetHub {
  /** Sala por palabra: los clientes actualmente conectados. */
  private readonly rooms = new Map<string, Set<FakeNetClient>>();

  /** Conecta un cliente a la sala `word` y avisa a los presentes. */
  connect(client: FakeNetClient, word: string): void {
    let room = this.rooms.get(word);
    if (!room) {
      room = new Set();
      this.rooms.set(word, room);
    }
    room.add(client);
    // Trystero dispara onPeerJoin en AMBOS lados de cada conexión nueva:
    // el presente ve llegar al nuevo, y el nuevo ve a cada presente.
    for (const member of room) {
      if (member === client) {
        continue;
      }
      member.handlePeerConnected(client.peerId);
      client.handlePeerConnected(member.peerId);
    }
  }

  /** Desconecta un cliente y avisa a los restantes (si estaba). */
  disconnect(client: FakeNetClient, word: string): void {
    const room = this.rooms.get(word);
    if (!room || !room.has(client)) {
      return;
    }
    room.delete(client);
    if (room.size === 0) {
      this.rooms.delete(word);
    }
    for (const member of room) {
      member.handlePeerDisconnected(client.peerId);
    }
  }

  /** Entrega un mensaje a la sala (broadcast o dirigido). */
  deliver(word: string, message: HubMessage): void {
    const room = this.rooms.get(word);
    if (!room) {
      return;
    }
    for (const member of room) {
      if (member.peerId === message.from) {
        continue; // Trystero no echa las acciones al emisor.
      }
      if (message.target !== null && member.peerId !== message.target) {
        continue;
      }
      member.handleMessage(message);
    }
  }

  /** Cantidad de clientes conectados a la palabra (para tests). */
  roomSize(word: string): number {
    return this.rooms.get(word)?.size ?? 0;
  }

  /** true si la palabra ya tiene sala activa (para tests). */
  hasRoom(word: string): boolean {
    return this.rooms.has(word);
  }
}

/** Opciones del cliente fake. */
export interface FakeNetClientOptions {
  /** peerId fijo (determinista en tests); default: id autoincremental. */
  readonly peerId?: string;
  /** rng para elegir palabra al crear sala (default: sembrado por peerId). */
  readonly rng?: () => number;
}

let nextAutoPeerId = 1;

/**
 * Cliente de red fake: implementa `NetClient` sobre un `FakeNetHub` con la
 * MISMA semántica que TrysteroNetClient (reglas compartidas de lobbyState).
 */
export class FakeNetClient implements NetClient {
  readonly peerId: string;

  private readonly hub: FakeNetHub;
  private readonly rng: () => number;
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

  private word: string | null = null;
  /** Metas conocidas: la propia + las anunciadas por los peers de la sala. */
  private metas = new Map<string, PeerMeta>();
  /** Último anfitrión emitido (para disparar hostChange solo al cambiar). */
  private lastHost: string | null = null;

  constructor(hub: FakeNetHub, options: FakeNetClientOptions = {}) {
    this.hub = hub;
    this.peerId = options.peerId ?? `fake-${nextAutoPeerId++}`;
    this.rng = options.rng ?? mulberry32(hashStringToSeed(this.peerId));
  }

  get selfPeerId(): string {
    return this.peerId;
  }

  get roomWord(): string | null {
    return this.word;
  }

  create({ appId: _appId, name }: { appId: string; name: string }): void {
    // Palabra fresca: si el hub ya tiene sala con la sorteada, re-sortea
    // (elige de la misma lista que producción, sin Math.random).
    let word = pickRoomWord(this.rng);
    for (let attempt = 0; this.hub.hasRoom(word) && attempt < ROOM_WORDS.length; attempt += 1) {
      word = pickRoomWord(this.rng);
    }
    this.enterRoom(word, name, true);
  }

  join({ appId: _appId, roomWord, name }: { appId: string; roomWord: string; name: string }): void {
    if (!isValidRoomWord(roomWord)) {
      this.emitError(`Palabra de sala inválida: "${roomWord}"`);
      return;
    }
    // Capacidad ANTES de entrar: si la sala ya tiene 10, este sería el 11º.
    if (isRoomFull(this.hub.roomSize(roomWord) + 1)) {
      for (const handler of this.handlers.roomFull) {
        handler();
      }
      return;
    }
    this.enterRoom(roomWord, name, false);
  }

  getRoster(): PlayerInfo[] {
    return assignColors(this.rosterEntries());
  }

  getHostPeerId(): string | null {
    return resolveHostPeerId(this.rosterEntries());
  }

  isHost(): boolean {
    return this.getHostPeerId() === this.peerId;
  }

  start(payload: StartPayload): void {
    if (!this.isHost()) {
      this.emitError('Solo el anfitrión puede iniciar la partida');
      return;
    }
    this.send('start', payload, null);
  }

  sendState(payload: StatePayload): void {
    this.send('state', payload, null);
  }

  sendEliminated(payload: EliminatedPayload): void {
    this.send('eliminated', payload, null);
  }

  sendMatchOver(payload: MatchOverPayload): void {
    this.send('match-over', payload, null);
  }

  leave(): void {
    if (this.word) {
      this.hub.disconnect(this, this.word);
    }
    this.word = null;
    this.metas.clear();
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

  /* ---------------- internos del "transporte" ---------------- */

  private enterRoom(word: string, rawName: string, isCreator: boolean): void {
    const name = sanitizePlayerName(rawName);
    if (name.length === 0) {
      this.emitError('Nombre de jugador inválido');
      return;
    }
    this.word = word;
    const meta: PeerMeta = { name, color: 0, isCreator };
    this.metas = new Map([[this.peerId, meta]]);
    this.hub.connect(this, word);
    this.emitRoster();
  }

  private rosterEntries(): RosterEntry[] {
    return [...this.metas.entries()].map(([peerId, meta]) => ({
      peerId,
      name: meta.name,
      isCreator: meta.isCreator,
    }));
  }

  /** Conexión nueva (par o propio ingreso): anuncia SU meta al otro lado. */
  handlePeerConnected(peerId: string): void {
    for (const handler of this.handlers.peerJoin) {
      handler(peerId);
    }
    const own = this.metas.get(this.peerId);
    if (own) {
      this.send('meta', own, peerId);
    }
  }

  handlePeerDisconnected(peerId: string): void {
    const hadMeta = this.metas.delete(peerId);
    for (const handler of this.handlers.peerLeave) {
      handler(peerId);
    }
    if (hadMeta) {
      this.emitRoster();
    }
  }

  handleMessage(message: HubMessage): void {
    switch (message.action) {
      case 'meta': {
        const meta = message.payload as PeerMeta;
        this.metas.set(message.from, { ...meta, name: sanitizePlayerName(meta.name) });
        this.emitRoster();
        break;
      }
      case 'start':
        for (const handler of this.handlers.start) {
          handler(message.payload as StartPayload);
        }
        break;
      case 'state':
        for (const handler of this.handlers.peerState) {
          handler(message.from, message.payload as StatePayload);
        }
        break;
      case 'eliminated':
        for (const handler of this.handlers.eliminated) {
          handler(message.from, message.payload as EliminatedPayload);
        }
        break;
      case 'match-over':
        for (const handler of this.handlers.matchOver) {
          handler(message.from, message.payload as MatchOverPayload);
        }
        break;
    }
  }

  /** Roster/anfitrión recalculados + eventos (tras cualquier cambio). */
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

  private send(action: string, payload: unknown, target: string | null): void {
    if (!this.word) {
      return;
    }
    this.hub.deliver(this.word, { from: this.peerId, action, payload, target });
  }

  private emitError(message: string): void {
    for (const handler of this.handlers.error) {
      handler(message);
    }
  }
}
