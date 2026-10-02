/**
 * NetClient.ts — interfaz de transporte del multijugador (M1).
 *
 * El juego habla con la red SOLO a través de esta interfaz: hoy la implementa
 * `TrysteroNetClient` (WebRTC en malla, señalización torrent); el relay Node
 * previsto para más adelante implementaría la MISMA interfaz y las escenas no
 * cambiarían una línea (swap de transporte).
 *
 * Para tests (y para el futuro modo offline) existe `FakeNetClient`
 * (`src/__tests__/fakes/FakeNetClient.ts`): un hub en memoria que conecta
 * varias instancias entre sí sin red.
 *
 * Diseño de eventos: cada `onX` devuelve su función de desuscripción (mismo
 * contrato que `EventBus.on`), así ninguna escena queda enganchada a un
 * cliente muerto. Las acciones de M2 (`sendState`/`sendEliminated`/
 * `sendMatchOver` y sus eventos) ya están declaradas para que el protocolo
 * no cambie cuando lleguen.
 */

import type {
  ChatPayload,
  EliminatedPayload,
  MatchOverPayload,
  PlayerInfo,
  RaceFinishPayload,
  RaceOverPayload,
  RaceStatePayload,
  StartPayload,
  StatePayload,
} from './protocol';

/** Opciones de `create` (anfitrión): genera la palabra de sala. */
export interface CreateRoomOptions {
  /** Namespace de matchmaking de Trystero (resolveAppId de la escena). */
  readonly appId: string;
  /** Nombre propio ya sanitizado. */
  readonly name: string;
}

/** Opciones de `join`: se une a la sala identificada por la palabra. */
export interface JoinRoomOptions {
  readonly appId: string;
  /** Palabra de sala (ya validada con isValidRoomWord). */
  readonly roomWord: string;
  readonly name: string;
}

/** Implementación de red para el lobby y (en M2) la carrera. */
export interface NetClient {
  /** peerId propio (lo decide el transporte; estable mientras viva la sala). */
  readonly selfPeerId: string;
  /** Palabra de la sala actual, o null si todavía no entró a ninguna. */
  readonly roomWord: string | null;

  /**
   * Crea una sala: elige palabra aleatoria, entra y anuncia meta con
   * `isCreator: true`. Falta el roster hasta que otros se unan.
   */
  create(options: CreateRoomOptions): void;

  /**
   * Se une a la sala de `roomWord` anunciando meta con `isCreator: false`.
   * Si al entrar ya está llena (≥10 además de uno), emite `roomFull` y deja
   * la sala. Una palabra inválida emite `error`.
   */
  join(options: JoinRoomOptions): void;

  /** Roster vivo con colores derivados (ver `lobbyState.assignColors`). */
  getRoster(): PlayerInfo[];

  /** peerId del anfitrión según las reglas de `lobbyState.resolveHostPeerId`. */
  getHostPeerId(): string | null;

  /** true si uno mismo es el anfitrión. */
  isHost(): boolean;

  /**
   * Arranca la carrera (SOLO anfitrión): difunde `start {seed, players,
   * startAt}`. Todos los demás lo reciben por `onStart`; el anfitrión
   * arranca su propia carrera localmente al presionar INICIAR.
   */
  start(payload: StartPayload): void;

  /* ---------------- M2 (declarados, sin uso en M1) ---------------- */

  /** Difunde el estado propio de este frame (M2). */
  sendState(payload: StatePayload): void;

  /** Difunde la eliminación propia (M2). */
  sendEliminated(payload: EliminatedPayload): void;

  /** Difunde el fin de la partida (M2, último superviviente). */
  sendMatchOver(payload: MatchOverPayload): void;

  /**
   * Difunde un mensaje del chat de SALA a todos los peers (C1, issue #2):
   * broadcast de la acción `chat` con `{text}` YA sanitizado por
   * `makeChatPayload` (trim + colapso + máx `CHAT_MAX_LEN`). El remitente se
   * deduce del peerId al recibir, así que NO viaja nada más.
   */
  sendChat(text: string): void;

  /* ---------------- carrera en circuito (issue #9, V2) ---------------- */

  /**
   * Difunde el estado propio del circuito a STATE_HZ (acción `rstate`):
   * {s, o, v, lap} YA normalizado por `roundRaceStatePayload`.
   */
  sendRaceState(payload: RaceStatePayload): void;

  /** Difunde el fin de las 3 vueltas propias (acción `rfin`, UNA vez). */
  sendRaceFinish(payload: RaceFinishPayload): void;

  /** Difunde la clasificación final (acción `race-over`, el ganador, UNA vez). */
  sendRaceOver(payload: RaceOverPayload): void;

  /* ---------------- lifecycle ---------------- */

  /** Sale de la sala (los demás ven el peer irse). Idempotente. */
  leave(): void;

  /** leave + limpieza total de listeners. Idempotente. */
  destroy(): void;

  /* ---------------- eventos ---------------- */

  /** Un peer entró a la sala (antes de conocer su meta). */
  onPeerJoin(handler: (peerId: string) => void): () => void;

  /** Un peer se fue de la sala. */
  onPeerLeave(handler: (peerId: string) => void): () => void;

  /** El roster cambió (entrada, salida o meta nueva) — ya con colores. */
  onRosterChange(handler: (roster: PlayerInfo[], hostPeerId: string | null) => void): () => void;

  /** El anfitrión cambió (migración al irse el creador). */
  onHostChange(handler: (hostPeerId: string) => void): () => void;

  /** El anfitrión difundió `start`. */
  onStart(handler: (payload: StartPayload) => void): () => void;

  /** Estado por frame de un rival (M2). */
  onPeerState(handler: (peerId: string, payload: StatePayload) => void): () => void;

  /** Un rival fue eliminado (M2). */
  onEliminated(handler: (peerId: string, payload: EliminatedPayload) => void): () => void;

  /** La partida terminó (M2). */
  onMatchOver(handler: (peerId: string, payload: MatchOverPayload) => void): () => void;

  /**
   * Un peer difundió un mensaje del chat de sala (C1): llega con SU peerId y
   * el payload sanitizado. El receptor resuelve nombre/color contra SU roster
   * local (si el peer ya no está, la UI muestra "PILOTO").
   */
  onChat(handler: (fromPeerId: string, payload: ChatPayload) => void): () => void;

  /* ---------------- carrera en circuito (issue #9, V2) ---------------- */

  /** Estado del circuito de un rival a STATE_HZ (acción `rstate`). */
  onRaceState(handler: (peerId: string, payload: RaceStatePayload) => void): () => void;

  /** Un rival completó las 3 vueltas (acción `rfin`). */
  onRaceFinish(handler: (peerId: string, payload: RaceFinishPayload) => void): () => void;

  /** El ganador difundió la clasificación final (acción `race-over`). */
  onRaceOver(handler: (peerId: string, payload: RaceOverPayload) => void): () => void;

  /** La sala estaba llena al intentar entrar: salir y avisar al usuario. */
  onRoomFull(handler: () => void): () => void;

  /** Error del transporte o de validación (appId faltante, palabra inválida). */
  onError(handler: (message: string) => void): () => void;
}
