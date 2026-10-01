/**
 * ChatClient.ts — interfaz del cliente de la sala pública de presencia
 * (issue #2, C2) y, más adelante, del chat directo (C3).
 *
 * El juego habla con la presencia SOLO a través de esta interfaz (mismo
 * contrato que `NetClient` para el transporte de partidas): hoy la implementa
 * `TrysteroChatClient` (sala `${appId}-social` de Trystero); los tests usan
 * dobles estructurales y cualquier transporte futuro (relay Node) implementaría
 * lo mismo sin tocar las escenas.
 *
 * PRIVACIDAD BY DEFAULT: la sala pública es OPT-IN. Mientras `setAvailable`
 * no se haya llamado con `true` (el default del ajuste persistido es NO), el
 * cliente NO conecta a nada — ni joinRoom, ni heartbeats, ni exposición de
 * identidad/IP a peers. `setAvailable(false)` desconecta de verdad (leave).
 *
 * La lista de disponibles SIEMPRE excluye al propio peer: uno no se chatea
 * consigo mismo, y la UI no necesita filtrar.
 *
 * Los métodos de C3 (`sendDm`/`onDm`/`sendInvite`/`onInvite`) ya están
 * declarados para que el protocolo no cambie cuando lleguen; la implementación
 * actual los registra/lanza como placeholders documentados.
 */

import type { DmPayload, InvitePayload } from './protocol';

/** Un peer disponible de la sala pública, tal como lo consume la UI. */
export interface AvailablePeer {
  readonly peerId: string;
  /** Nombre visible (sanitizado al recibir: máx `maxPlayerNameLength`). */
  readonly name: string;
  /** Color de paleta derivado del conjunto de presentes (determinista). */
  readonly color: number;
}

/**
 * Meta que cada peer anuncia al conectarse a la sala pública (acción `meta`
 * dirigida, mismo patrón de intercambio que el lobby de partidas): la
 * identidad del issue #1 `{name, color}`. El color del wire es INFORMATIVO —
 * cada cliente deriva el color visible del conjunto de presentes, igual que
 * `lobbyState.assignColors` hace con el roster.
 */
export interface PresenceMeta {
  readonly name: string;
  readonly color: number;
}

/** Cliente de presencia/chat social (sala pública, C2; DM/invitas, C3). */
export interface ChatClient {
  /** peerId propio (lo decide el transporte; estable por pestaña). */
  readonly selfPeerId: string;

  /**
   * Fija la disponibilidad propia en la sala pública:
   * - `true`: join a la sala pública + anuncio de meta + heartbeat periódico.
   * - `false`: leave + limpieza de roster/timers (desconecta DE VERDAD).
   * Idempotente: re-llamar con el mismo estado no reconecta ni duplica.
   * Si el appId no se puede resolver (env sin `VITE_TRYSTERO_APP_ID`),
   * emite `onError` y permanece NO disponible.
   */
  setAvailable(available: boolean): void;

  /** true si este cliente está actualmente disponible en la sala pública. */
  isAvailable(): boolean;

  /**
   * Lista en vivo de los demás peers disponibles (sin incluirme), ordenada
   * por peerId, con colores derivados del conjunto de presentes.
   */
  getAvailablePeers(): AvailablePeer[];

  /**
   * Actualiza la identidad propia anunciada en la sala pública (nombre del
   * perfil persistido). No cambia la disponibilidad; si ya estoy disponible,
   * la implementación re-anuncia la meta a los peers conocidos.
   */
  updateSelf(self: PresenceMeta): void;

  /** La lista de disponibles cambió (entrada, meta, salida o stale). */
  onAvailablePeers(handler: (peers: AvailablePeer[]) => void): () => void;

  /* ---------------- C3 (declarados, llegan con el DM) ---------------- */

  /**
   * Envía un mensaje directo a un peer de la sala pública (C3): la acción
   * `dm {text, targetPeerId}` de la sala pública. Placeholder en C2.
   */
  sendDm(peerId: string, text: string): void;

  /**
   * Un peer de la sala pública me envió un DM (C3): llega con SU peerId y el
   * payload sanitizado. Placeholder en C2 (se puede suscribir, nunca dispara).
   */
  onDm(handler: (fromPeerId: string, payload: DmPayload) => void): () => void;

  /** Invita a un peer a la partida por palabra de sala (C3). Placeholder. */
  sendInvite(peerId: string, keyword: string): void;

  /** Un peer me invitó a su partida (C3). Placeholder en C2. */
  onInvite(handler: (fromPeerId: string, payload: InvitePayload) => void): () => void;

  /* ---------------- lifecycle / errores ---------------- */

  /** Desconecta y limpia TODO (handlers incluidos). Idempotente. */
  destroy(): void;

  /** Error del transporte o de configuración (appId faltante, join fallido). */
  onError(handler: (message: string) => void): () => void;
}
