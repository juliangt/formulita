/**
 * MatchTracker — estado de la partida distribuida (M2), el corazón puro.
 *
 * Cada cliente mantiene UNO de estos con la misma información observable y
 * las mismas REGLAS DETERMINÍSTICAS, de modo que todos llegan al MISMO
 * leaderboard sin negociar nada por la red:
 *
 * - Vivos/eliminados: un jugador muere por `eliminated` (su crash), por
 *   `onPeerLeave` (se fue de la sala), por STALENESS (> PLAYER_STALE_MS sin
 *   `state` — pestaña muerta) o al recibirse su `match-over` (superviviente
 *   que congela sus stats finales exactas).
 * - Stats congeladas: las de `eliminated`/`match-over` (exactas). Solo si
 *   NUNCA llegaron (desconexión abrupta) se usa el último `state` recibido.
 * - Fin de la partida: queda ≤1 vivo (la decisión cerrada del issue: termina
 *   apenas queda 1) o se recibió un `match-over`. Idempotente: varios
 *   clientes pueden difundir `match-over` (caso 0 vivos — los últimos mueren
 *   casi juntos) y el resultado no cambia.
 * - Ranking final: monedas DESC → kilómetros DESC → puntaje DESC → peerId
 *   ASC (último desempate, determinístico). El último en pie NO gana por
 *   sobrevivir — solo tuvo más tiempo para juntar monedas.
 *
 * El reloj (`now`, ms) es INYECTABLE: la escena pasa el de Phaser y los
 * tests uno manual. Todo el tracker es puro (sin Phaser, sin red).
 */

import { PLAYER_STALE_MS } from '../config/balance';
import type {
  FinalStanding,
  PlayerInfo,
  PlayerStats,
  StatePayload,
} from '../net/protocol';

/** Cómo murió (o congeló stats) un jugador — para debug/tests. */
export type EliminationReason = 'crash' | 'peer-leave' | 'stale' | 'match-over';

/** Resultado de una operación de eliminación (idempotencia observable). */
export type EliminationResult = 'eliminated' | 'already-eliminated' | 'unknown-peer';

/** Vista de un jugador seguido (copia inmutable para la UI). */
export interface TrackedPlayerView {
  readonly peerId: string;
  readonly name: string;
  readonly color: number;
  readonly alive: boolean;
  readonly frozenStats: PlayerStats | null;
  readonly lastState: StatePayload | null;
  readonly eliminationOrder: number | null;
  readonly eliminationReason: EliminationReason | null;
}

/** Jugador interno (mutable, privado del tracker). */
interface TrackedPlayer {
  readonly peerId: string;
  readonly name: string;
  readonly color: number;
  alive: boolean;
  frozenStats: PlayerStats | null;
  lastState: StatePayload | null;
  lastStateAt: number | null;
  eliminationOrder: number | null;
  eliminationReason: EliminationReason | null;
}

/** Opciones del tracker. */
export interface MatchTrackerOptions {
  /** Reloj inyectable en ms (default: Date.now — en escena va el de Phaser). */
  readonly now?: () => number;
  /** Umbral de staleness en ms (default PLAYER_STALE_MS). */
  readonly staleMs?: number;
  /**
   * peerId propio (M2): su "stream" no llega por red (lo genera este
   * cliente), así que el barrido de staleness NUNCA lo toca — sin esto, a
   * los 20 s de carrera uno se auto-eliminaría.
   */
  readonly selfPeerId?: string;
}

/** Stats a partir de un `state` del stream (fallback de desconexión). */
export function statsFromState(payload: StatePayload): PlayerStats {
  return {
    coins: payload.coins,
    score: payload.score,
    distance: payload.distance,
  };
}

export class MatchTracker {
  private readonly now: () => number;
  private readonly staleMs: number;
  private readonly selfPeerId: string | null;
  private readonly players = new Map<string, TrackedPlayer>();
  /** Arranque de la partida (base del stale para quien nunca mandó state). */
  private readonly startedAt: number;
  /** Contador de eliminaciones vistas localmente (1, 2, 3…). */
  private eliminationsSoFar = 0;
  private matchOverReceived = false;
  private selfBroadcastDone = false;

  constructor(players: readonly PlayerInfo[], options: MatchTrackerOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.staleMs = options.staleMs ?? PLAYER_STALE_MS;
    this.selfPeerId = options.selfPeerId ?? null;
    this.startedAt = this.now();
    for (const player of players) {
      this.players.set(player.peerId, {
        peerId: player.peerId,
        name: player.name,
        color: player.color,
        alive: true,
        frozenStats: null,
        lastState: null,
        lastStateAt: null,
        eliminationOrder: null,
        eliminationReason: null,
      });
    }
  }

  /* ---------------------------------------------------------------- */
  /* Registro de eventos de red                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Llegó un `state` del stream: refresca presencia/último estado del peer
   * (sus stats para el leaderboard siguen siendo las CONGELADAS — el stream
   * puede estar desfasado). false si el peer no pertenece a la partida.
   */
  recordState(peerId: string, payload: StatePayload): boolean {
    const player = this.players.get(peerId);
    if (!player) {
      return false;
    }
    player.lastState = payload;
    player.lastStateAt = this.now();
    return true;
  }

  /**
   * Un jugador murió (crash propio visto por red, o el propio del cliente
   * local): congela SUS stats exactas y le asigna orden de eliminación
   * (eliminados antes que él + 1). Idempotente: si ya estaba muerto, las
   * primeras stats congeladas ganan y el orden no cambia.
   */
  eliminate(peerId: string, stats: PlayerStats): EliminationResult {
    const player = this.players.get(peerId);
    if (!player) {
      return 'unknown-peer';
    }
    if (!player.alive) {
      return 'already-eliminated';
    }
    this.eliminationsSoFar += 1;
    player.alive = false;
    player.frozenStats = sanitizeStats(stats);
    player.eliminationOrder = this.eliminationsSoFar;
    player.eliminationReason = 'crash';
    return 'eliminated';
  }

  /**
   * Un peer dejó la sala (`onPeerLeave`): se lo trata como eliminado con su
   * última estadística conocida (el stream que tenía al irse).
   */
  markPeerLeft(peerId: string): EliminationResult {
    const player = this.players.get(peerId);
    if (!player) {
      return 'unknown-peer';
    }
    if (!player.alive) {
      return 'already-eliminated';
    }
    this.eliminationsSoFar += 1;
    player.alive = false;
    player.frozenStats = player.lastState ? statsFromState(player.lastState) : zeroStats();
    player.eliminationOrder = this.eliminationsSoFar;
    player.eliminationReason = 'peer-leave';
    return 'eliminated';
  }

  /**
   * Barrido de staleness (la escena lo llama ~1 vez por segundo): todo vivo
   * que lleva más de `staleMs` sin `state` — contando desde el arranque si
   * NUNCA mandó nada — pasa a eliminado con su última stats conocida. El
   * peerId propio (si se declaró) queda exento: su estado no llega por red.
   * Devuelve los peerIds recién marcados (para que la escena mate fantasmas).
   */
  sweepStale(): string[] {
    const now = this.now();
    const stalePeers: string[] = [];
    for (const player of this.players.values()) {
      if (!player.alive || player.peerId === this.selfPeerId) {
        continue;
      }
      const reference = player.lastStateAt ?? this.startedAt;
      if (now - reference > this.staleMs) {
        this.eliminationsSoFar += 1;
        player.alive = false;
        player.frozenStats = player.lastState ? statsFromState(player.lastState) : zeroStats();
        player.eliminationOrder = this.eliminationsSoFar;
        player.eliminationReason = 'stale';
        stalePeers.push(player.peerId);
      }
    }
    return stalePeers;
  }

  /**
   * Llegó un `match-over` (lo difunde el último en pie): congela las stats
   * finales EXACTAS del emisor y marca la partida concluida. Idempotente:
   * varios `match-over` (caso 0 vivos) solo re-freezan a quien faltara.
   */
  recordMatchOver(peerId: string, stats: PlayerStats): void {
    this.matchOverReceived = true;
    const player = this.players.get(peerId);
    if (player && !player.frozenStats) {
      player.frozenStats = sanitizeStats(stats);
      player.eliminationReason = player.eliminationReason ?? 'match-over';
    }
  }

  /* ---------------------------------------------------------------- */
  /* Consultas                                                         */
  /* ---------------------------------------------------------------- */

  /** Total de jugadores de la partida (roster congelado al iniciar). */
  get totalCount(): number {
    return this.players.size;
  }

  /** Vivos restantes. */
  get aliveCount(): number {
    let count = 0;
    for (const player of this.players.values()) {
      if (player.alive) {
        count += 1;
      }
    }
    return count;
  }

  /** true si ya se recibió un `match-over` (la partida está concluida). */
  get hasReceivedMatchOver(): boolean {
    return this.matchOverReceived;
  }

  /** Vista de un jugador (null si no está en la partida). */
  getPlayer(peerId: string): TrackedPlayerView | null {
    const player = this.players.get(peerId);
    return player ? toView(player) : null;
  }

  /** Vistas de todos los jugadores (orden del roster: por peerId). */
  getAllPlayers(): TrackedPlayerView[] {
    return [...this.players.values()].map(toView).sort((a, b) => (a.peerId < b.peerId ? -1 : 1));
  }

  /** Vivos restantes (vistas). */
  getAlivePlayers(): TrackedPlayerView[] {
    return this.getAllPlayers().filter((player) => player.alive);
  }

  /**
   * Puesto de eliminación de un jugador: cantidad de eliminados antes que él
   * + 1 (el orden lo asigna cada cliente al OBSERVAR las eliminaciones — es
   * el mismo en todos salvo diferencias de milisegundos de red entre muertes
   * casi simultáneas, y solo se usa para el cartel "ELIMINADO — PUESTO N").
   */
  eliminationPlaceOf(peerId: string): number | null {
    return this.players.get(peerId)?.eliminationOrder ?? null;
  }

  /**
   * ¿Terminó la partida? Al quedar ≤1 vivo (decisión cerrada del issue:
   * termina apenas queda 1) o al recibir cualquier `match-over`.
   */
  isFinished(): boolean {
    return this.matchOverReceived || this.aliveCount <= 1;
  }

  /**
   * ¿Este cliente debe difundir `match-over` con SUS stats finales? Solo una
   * vez por cliente (idempotente) y solo si: la partida terminó, no llegó
   * `match-over` de nadie, y uno mismo es el SUPERVIVIENTE — o, en el caso
   * 0 vivos (los últimos mueren casi juntos), el último eliminado que se
   * observa localmente: alguien tiene que cerrar la partida.
   */
  shouldBroadcastMatchOver(selfPeerId: string): boolean {
    if (!this.isFinished() || this.matchOverReceived || this.selfBroadcastDone) {
      return false;
    }
    const self = this.players.get(selfPeerId);
    if (!self) {
      return false;
    }
    if (self.alive) {
      return true;
    }
    // Muerto: con un superviviente en pie el cierre es de ÉL; sin ninguno
    // (0 vivos), lo difunde el último eliminado observado localmente.
    return this.aliveCount === 0 && self.eliminationOrder === this.eliminationsSoFar;
  }

  /** Marca que este cliente ya difundió su `match-over` (idempotencia). */
  markSelfBroadcastDone(): void {
    this.selfBroadcastDone = true;
  }

  /* ---------------------------------------------------------------- */
  /* Ranking final determinístico                                      */
  /* ---------------------------------------------------------------- */

  /**
   * Puestos finales: monedas DESC → distancia DESC → puntaje DESC → peerId
   * ASC. Stats de cada jugador = las CONGELADAS (eliminated/match-over,
   * exactas) o, si nunca llegaron, las de su último `state` (fallback de
   * desconexión) — jamás las vivas del stream. Con las mismas entradas,
   * TODOS los clientes computan el mismo orden y el mismo ganador.
   */
  finalRanking(): FinalStanding[] {
    const entries = [...this.players.values()].map((player) => {
      const stats =
        player.frozenStats ??
        (player.lastState ? statsFromState(player.lastState) : zeroStats());
      return {
        peerId: player.peerId,
        name: player.name,
        color: player.color,
        coins: stats.coins,
        score: stats.score,
        distance: stats.distance,
      };
    });
    entries.sort(compareStandings);
    return entries.map((entry, index) => ({
      ...entry,
      place: index + 1,
      isWinner: index === 0,
    }));
  }
}

/** Compara dos jugadores por el orden determinístico del leaderboard. */
function compareStandings(
  a: { peerId: string; coins: number; score: number; distance: number },
  b: { peerId: string; coins: number; score: number; distance: number },
): number {
  if (a.coins !== b.coins) {
    return b.coins - a.coins;
  }
  if (a.distance !== b.distance) {
    return b.distance - a.distance;
  }
  if (a.score !== b.score) {
    return b.score - a.score;
  }
  return a.peerId < b.peerId ? -1 : a.peerId > b.peerId ? 1 : 0;
}

/** Copia inmutable y saneada de stats (enteros ≥ 0). */
function sanitizeStats(stats: PlayerStats): PlayerStats {
  const clean = (value: number): number =>
    Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  return {
    coins: clean(stats.coins),
    score: clean(stats.score),
    distance: clean(stats.distance),
  };
}

function zeroStats(): PlayerStats {
  return { coins: 0, score: 0, distance: 0 };
}

function toView(player: TrackedPlayer): TrackedPlayerView {
  return {
    peerId: player.peerId,
    name: player.name,
    color: player.color,
    alive: player.alive,
    frozenStats: player.frozenStats,
    lastState: player.lastState,
    eliminationOrder: player.eliminationOrder,
    eliminationReason: player.eliminationReason,
  };
}
