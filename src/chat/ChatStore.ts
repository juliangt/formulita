/**
 * ChatStore — estado puro del chat social (issue #2, fase C0).
 *
 * El corazón del chat, 100% testeable y SIN Phaser y SIN red: ni siquiera
 * sabe que Trystero existe. Las escenas de UI (C1/C3) leen su estado para
 * dibujar y le pasan lo que el usuario escribe; el adaptador de red que
 * llegue después (C1) es el que transporta los mensajes:
 *
 * - SALIDA: la UI llama `sendRoomMessage`/`sendDm`; el store valida el
 *   cooldown y sanitiza el texto, y devuelve el `ChatMessage` listo o `null`
 *   (rechazado). Si no es null, QUIEN LLAMÓ lo envía por la red — el store
 *   no conoce el transporte. C3: `sendDm` ADEMÁS rechaza el envío hacia un
 *   peer BLOQUEADO (guarda de salida — ver `blockPeer`).
 * - ENTRADA: el adaptador de red llama `receiveRoomMessage`/`receiveDm` con
 *   lo que llegó; el store sanitiza de nuevo (misma regla), descarta los de
 *   peers bloqueados ANTES de que entren al estado de UI, aplica el
 *   rate-limit de flood POR EMISOR (issue #35: ráfaga + ritmo sostenido; el
 *   excedente se descarta en silencio) y devuelve el mensaje agregado o
 *   `null` (descartado). El historial de cada hilo se recorta a
 *   `CHAT_HISTORY_MAX` (FIFO).
 *
 * Además de los mensajes conversacionales, cada hilo puede recibir avisos de
 * SISTEMA locales (`appendSystemMessage`, C3): notas del propio cliente
 * ("BLOQUEASTE A NOMBRE") sin remitente que no suman no leídos.
 *
 * Hilos: `room` (el chat de la sala de partida, uno solo) + uno por `peerId`
 * (DM). Los hilos de DM se crean ON-DEMAND al primer mensaje (enviado o
 * recibido) y su estado es ACTIVO o DESCONECTADO (cuando el peer dejó la
 * sala pública de presencia — ver `setPeerAvailability`).
 *
 * El reloj es inyectable (`now` en el constructor) para testear el throttle
 * sin esperar tiempo real; cada método que marca tiempo acepta además un
 * `now` explícito que pisa al inyectado (misma convención que el resto de
 * los sistemas del juego).
 */

import {
  CHAT_FLOOD_BURST,
  CHAT_FLOOD_REFILL_MS,
  CHAT_HISTORY_MAX,
  CHAT_SEND_COOLDOWN_MS,
} from '../config/balance';
import { sanitizeChatText } from '../net/protocol';
import type { PlayerInfo } from '../net/protocol';

/**
 * threadId del hilo de sala (el único que no es un peerId). Los hilos de DM
 * usan el peerId del otro como threadId.
 */
export const ROOM_THREAD_ID = 'room';

/** Un mensaje de chat, ya sanitizado, tal como lo consume la UI. */
export interface ChatMessage {
  /** Hilo al que pertenece: `ROOM_THREAD_ID` o el peerId del DM. */
  readonly threadId: string;
  /** peerId de quien lo envió (el propio si `mine`). */
  readonly fromPeerId: string;
  /** Nombre visible del remitente al momento del mensaje. */
  readonly fromName: string;
  /** Color de paleta del remitente (derivado del roster). */
  readonly color: number;
  /** Texto ya sanitizado (trim + whitespace colapsado + máx 200). */
  readonly text: string;
  /** Timestamp del mensaje (ms) — reloj inyectable o explícito. */
  readonly at: number;
  /** true si lo envié yo (mensajes propios: no suman no leídos). */
  readonly mine: boolean;
  /**
   * true para los mensajes de SISTEMA (avisos locales del propio hilo: se
   * bloqueó a alguien, se invitó a una partida…). No son de nadie: no llevan
   * remitente ni suman no leídos, y la UI los pinta neutros y centrados.
   */
  readonly system?: boolean;
}

/** Opciones del store: identidad propia + reloj inyectable. */
export interface ChatStoreOptions {
  /** Identidad propia con la que se firman los mensajes que envío. */
  readonly self: PlayerInfo;
  /** Reloj inyectable para tests; default `() => Date.now()`. */
  readonly now?: () => number;
}

/** Estado del bucket de flood de un peer emisor (issue #35, qaT8). */
interface FloodBucket {
  /** Mensajes de presupuesto disponibles (fraccionarios entre recargas). */
  tokens: number;
  /** Instante (ms) de la última recarga/medición del bucket. */
  last: number;
}

/**
 * Store del chat: MENSAJERÍA + no leídos + bloqueo por sesión + estado de
 * disponibilidad de los hilos de DM. Ver doc del módulo para el contrato
 * entrada/salida con la red.
 */
export class ChatStore {
  private readonly threads = new Map<string, ChatMessage[]>();
  private readonly lastSentAt = new Map<string, number>();
  private readonly unread = new Map<string, number>();
  private readonly blocked = new Set<string>();
  private readonly available = new Map<string, boolean>();
  private readonly flood = new Map<string, FloodBucket>();
  private readonly nowFn: () => number;
  private self: PlayerInfo;

  constructor(options: ChatStoreOptions) {
    this.self = options.self;
    this.nowFn = options.now ?? (() => Date.now());
  }

  /* ---------------------------------------------------------------- */
  /* Identidad propia                                                  */
  /* ---------------------------------------------------------------- */

  /**
   * Refresca la identidad propia (nombre/color derivados del roster, que
   * cambia cuando entran/salen jugadores) sin perder mensajes ni contadores.
   */
  updateSelf(self: PlayerInfo): void {
    this.self = self;
  }

  /** Identidad propia actual. */
  getSelf(): PlayerInfo {
    return this.self;
  }

  /* ---------------------------------------------------------------- */
  /* Sanitización                                                      */
  /* ---------------------------------------------------------------- */

  /**
   * Sanitiza texto de chat (trim + colapso de whitespace interno + máx
   * `CHAT_MAX_LEN`), delegando en `sanitizeChatText` del protocolo: UNA sola
   * regla de texto para el wire y para el render. Todo texto pasa por acá
   * antes de enviarse Y al recibir. Vacío significa "no hay mensaje".
   */
  sanitizeText(raw: string): string {
    return sanitizeChatText(raw);
  }

  /* ---------------------------------------------------------------- */
  /* Throttle (1 mensaje cada 1,5 s POR HILO)                          */
  /* ---------------------------------------------------------------- */

  /**
   * true si el hilo acepta un envío en `now`: pasaron al menos
   * `CHAT_SEND_COOLDOWN_MS` desde el último envío ACEPTADO de ESE hilo (el
   * primer mensaje siempre pasa; los intentos rechazados no arman el reloj).
   * El cooldown es POR HILO: room y cada DM enfrian por separado.
   */
  canSend(threadId: string, now: number): boolean {
    const last = this.lastSentAt.get(threadId);
    if (last === undefined) {
      return true;
    }
    return now - last >= CHAT_SEND_COOLDOWN_MS;
  }

  /** Milisegundos restantes de cooldown del hilo (0 = se puede enviar). */
  cooldownRemainingMs(threadId: string, now: number): number {
    const last = this.lastSentAt.get(threadId);
    if (last === undefined) {
      return 0;
    }
    return Math.max(0, last + CHAT_SEND_COOLDOWN_MS - now);
  }

  /* ---------------------------------------------------------------- */
  /* Salida (UI → red): validan y devuelven el mensaje o null          */
  /* ---------------------------------------------------------------- */

  /**
   * Valida y arma un mensaje propio para el hilo de sala. Devuelve null (y
   * NO consume el cooldown) si el texto queda vacío o el hilo está en
   * cooldown. Si devuelve un mensaje, el llamador lo transmite por la red
   * (`makeChatPayload`); el mensaje ya queda agregado al hilo.
   */
  sendRoomMessage(text: string, now?: number): ChatMessage | null {
    return this.send(ROOM_THREAD_ID, text, now);
  }

  /**
   * Igual que `sendRoomMessage` pero para el hilo de DM de `peerId` (se crea
   * on-demand si no existía). C3 — GUARDA DE SALIDA DEL BLOQUEO: si el peer
   * está bloqueado, el envío se rechaza (null, sin consumir cooldown ni crear
   * el hilo): bloquear a alguien corta la conversación en AMBOS sentidos (sus
   * mensajes no entran por `receiveDm`, los míos no salen por acá). En cambio
   * se permite enviar aunque el peer esté marcado DESCONECTADO: el store solo
   * opina sobre cooldown/texto/bloqueo; la disponibilidad la decide la capa de
   * presencia y la UI deshabilita el input cuando el hilo está caído.
   */
  sendDm(peerId: string, text: string, now?: number): ChatMessage | null {
    if (this.isBlocked(peerId)) {
      return null;
    }
    return this.send(peerId, text, now);
  }

  /** Núcleo compartido de los envíos: valida, arma, agrega y devuelve. */
  private send(threadId: string, rawText: string, now?: number): ChatMessage | null {
    const text = this.sanitizeText(rawText);
    if (text.length === 0) {
      return null;
    }
    const at = now ?? this.nowFn();
    if (!this.canSend(threadId, at)) {
      return null;
    }
    this.lastSentAt.set(threadId, at);
    const message: ChatMessage = {
      threadId,
      fromPeerId: this.self.peerId,
      fromName: this.self.name,
      color: this.self.color,
      text,
      at,
      mine: true,
    };
    this.append(message);
    return message;
  }

  /* ---------------------------------------------------------------- */
  /* Entrada (red → store): descartan bloqueados/vacíos                */
  /* ---------------------------------------------------------------- */

  /**
   * Registra un mensaje ajeno del chat de sala. Sanitiza el texto de nuevo
   * (misma regla que el emisor: un cliente rogue no elude el límite) y
   * DESCARTA el mensaje — devuelve null sin tocar estado — si el remitente
   * está bloqueado o el texto queda vacío. Un eventual eco del propio
   * peerId cuenta como `mine` (no suma no leídos).
   */
  receiveRoomMessage(from: PlayerInfo, text: string, at: number): ChatMessage | null {
    return this.receive(ROOM_THREAD_ID, from, text, at);
  }

  /**
   * Igual que `receiveRoomMessage` pero para el hilo de DM de `from` (se
   * crea on-demand si no existía). NO cambia la disponibilidad del peer:
   * eso lo marca la capa de presencia (`setPeerAvailability`).
   */
  receiveDm(from: PlayerInfo, text: string, at: number): ChatMessage | null {
    return this.receive(from.peerId, from, text, at);
  }

  /**
   * true si la ENTRADA de un mensaje del peer en `at` tiene presupuesto de
   * flood (issue #35, qaT8): token bucket POR EMISOR — ráfaga de
   * `CHAT_FLOOD_BURST` y recarga de 1 mensaje cada `CHAT_FLOOD_REFILL_MS`.
   * El bucket es del EMISOR, no del hilo: un mismo peer no reparte su flood
   * entre room y sus DM. Cubre el hueco del throttle (que sólo mide el envío
   * PROPIO) sin tocar los mensajes locales (eco propio y sistema no pasan
   * por acá). Los rechazos no consumen token ni re-arman la ventana.
   */
  private allowsInflow(peerId: string, at: number): boolean {
    const bucket = this.flood.get(peerId);
    if (bucket === undefined) {
      this.flood.set(peerId, { tokens: CHAT_FLOOD_BURST - 1, last: at });
      return true;
    }
    const elapsed = Math.max(0, at - bucket.last);
    const tokens = Math.min(CHAT_FLOOD_BURST, bucket.tokens + elapsed / CHAT_FLOOD_REFILL_MS);
    if (tokens < 1) {
      this.flood.set(peerId, { tokens, last: at });
      return false;
    }
    this.flood.set(peerId, { tokens: tokens - 1, last: at });
    return true;
  }

  /** Núcleo compartido de la recepción: bloqueo → descarte temprano. */
  private receive(threadId: string, from: PlayerInfo, rawText: string, at: number): ChatMessage | null {
    if (this.isBlocked(from.peerId)) {
      return null;
    }
    const text = this.sanitizeText(rawText);
    if (text.length === 0) {
      return null;
    }
    const mine = from.peerId === this.self.peerId;
    // Rate-limit de ENTRADA (qaT8): sólo mensaje ajeno. El excedente de un
    // peer en flood se descarta EN SILENCIO: ni mensaje, ni hilo nuevo, ni
    // no leídos — nada de marcadores falsos en el historial.
    if (!mine && !this.allowsInflow(from.peerId, at)) {
      return null;
    }
    const message: ChatMessage = {
      threadId,
      fromPeerId: from.peerId,
      fromName: from.name,
      color: from.color,
      text,
      at,
      mine,
    };
    this.append(message);
    return message;
  }

  /**
   * Agrega el mensaje a su hilo (creándolo on-demand) y suma no leídos si es
   * ajeno. Único punto de entrada de mensajes al estado de UI. Los mensajes
   * de SISTEMA nunca suman no leídos: son avisos locales del propio hilo (el
   * usuario ya lo está mirando cuando se generan), no contenido de nadie.
   */
  private append(message: ChatMessage): void {
    let thread = this.threads.get(message.threadId);
    if (thread === undefined) {
      thread = [];
      this.threads.set(message.threadId, thread);
      this.unread.set(message.threadId, 0);
    }
    thread.push(message);
    if (!message.mine && !message.system) {
      this.unread.set(message.threadId, (this.unread.get(message.threadId) ?? 0) + 1);
    }
    // Tope de historial (issue #35, qaT8): FIFO — llegado CHAT_HISTORY_MAX,
    // cada mensaje nuevo recorta los más viejos. Y el badge no promete lo que
    // ya no está: los no leídos se clampean a los mensajes AJENOS que el hilo
    // conserva (los recortados sin leer ya no se pueden leer).
    const excess = thread.length - CHAT_HISTORY_MAX;
    if (excess > 0) {
      thread.splice(0, excess);
      let foreignKept = 0;
      for (const kept of thread) {
        if (!kept.mine && !kept.system) {
          foreignKept += 1;
        }
      }
      const current = this.unread.get(message.threadId) ?? 0;
      if (current > foreignKept) {
        this.unread.set(message.threadId, foreignKept);
      }
    }
  }

  /**
   * Agrega un aviso de SISTEMA local al hilo (C3): "BLOQUEASTE A NOMBRE",
   * "INVITASTE A …", etc. Se crea on-demand igual que un mensaje normal, NO
   * lleva remitente, NO suma no leídos y NO consume cooldown. Devuelve el
   * mensaje agregado para que la UI lo pinte (los de texto vacío se rechazan
   * con null, sin tocar el hilo).
   */
  appendSystemMessage(threadId: string, text: string, at?: number): ChatMessage | null {
    const clean = this.sanitizeText(text);
    if (clean.length === 0) {
      return null;
    }
    const message: ChatMessage = {
      threadId,
      fromPeerId: '',
      fromName: '',
      color: 0,
      text: clean,
      at: at ?? this.nowFn(),
      mine: false,
      system: true,
    };
    this.append(message);
    return message;
  }

  /* ---------------------------------------------------------------- */
  /* Hilos y lectura                                                   */
  /* ---------------------------------------------------------------- */

  /** Mensajes del hilo en orden de llegada ([] si el hilo no existe). */
  getMessages(threadId: string): readonly ChatMessage[] {
    return this.threads.get(threadId) ?? [];
  }

  /** true si el hilo ya existe (room existe recién con su primer mensaje). */
  hasThread(threadId: string): boolean {
    return this.threads.has(threadId);
  }

  /** threadIds existentes en orden de creación (`room` incluido si existe). */
  getThreadIds(): string[] {
    return [...this.threads.keys()];
  }

  /* ---------------------------------------------------------------- */
  /* No leídos (badge del menú/lista)                                  */
  /* ---------------------------------------------------------------- */

  /** No leídos de un hilo (solo mensajes AJENOS suman; los propios no). */
  getUnreadCount(threadId: string): number {
    return this.unread.get(threadId) ?? 0;
  }

  /** Total de no leídos de todos los hilos (para el badge del menú). */
  get totalUnread(): number {
    let total = 0;
    for (const count of this.unread.values()) {
      total += count;
    }
    return total;
  }

  /** Marca el hilo como leído (el usuario lo tiene abierto): contador a 0. */
  markRead(threadId: string): void {
    this.unread.set(threadId, 0);
  }

  /* ---------------------------------------------------------------- */
  /* Bloqueo por sesión                                                */
  /* ---------------------------------------------------------------- */

  /**
   * Bloquea un peer: la conversación se corta EN AMBOS SENTIDOS — sus
   * mensajes se DESCARTAN al recibir (`receiveDm` → null, ni entran al
   * estado de UI ni suman no leídos) y los míos hacia él se rechazan al
   * enviar (`sendDm` → null, guarda de salida de C3). Es POR SESIÓN: no se
   * persiste, porque los peerId de Trystero cambian en cada conexión
   * (bloquear un peerId viejo no serviría de nada al reconectar).
   */
  blockPeer(peerId: string): void {
    this.blocked.add(peerId);
  }

  /** Desbloquea un peer: sus mensajes vuelven a admitirse desde ya. */
  unblockPeer(peerId: string): void {
    this.blocked.delete(peerId);
  }

  /** true si el peer está bloqueado en esta sesión. */
  isBlocked(peerId: string): boolean {
    return this.blocked.has(peerId);
  }

  /* ---------------------------------------------------------------- */
  /* Disponibilidad de hilos de DM (sala pública de presencia)         */
  /* ---------------------------------------------------------------- */

  /**
   * Marca si un peer sigue en la sala pública de presencia. `false` ⇒ su
   * hilo de DM se muestra DESCONECTADO (C1 atenúa el hilo; C2 lo alimenta
   * desde los heartbeats: perdido `PRESENCE_STALE_MS` o `onPeerLeave`).
   * Es independiente de los mensajes: recibir/enviar un DM NO cambia la
   * disponibilidad (puede llegar un mensaje de cola tras la salida).
   */
  setPeerAvailability(peerId: string, available: boolean): void {
    this.available.set(peerId, available);
  }

  /**
   * true si el peer se considera presente (default: presente — un peer del
   * que aún no se sabe nada se asume activo hasta que la capa de presencia
   * diga lo contrario).
   */
  isPeerAvailable(peerId: string): boolean {
    return this.available.get(peerId) ?? true;
  }

  /** true si el hilo está DESCONECTADO (solo aplica a hilos de DM). */
  isThreadDisconnected(threadId: string): boolean {
    if (threadId === ROOM_THREAD_ID) {
      return false;
    }
    return !this.isPeerAvailable(threadId);
  }

  /* ---------------------------------------------------------------- */
  /* Ciclo de sesión                                                   */
  /* ---------------------------------------------------------------- */

  /**
   * Vacia UN hilo (mensajes, no leídos y cooldown) sin tocar los demás. C3 lo
   * usa cuando MUERE la sala de partida: el hilo `room` desaparece con su
   * sala, pero los hilos de DM SON de la sesión social y sobreviven (igual
   * que el bloqueo). La disponibilidad no se toca: la alimenta la capa de
   * presencia con la lista viva de disponibles.
   */
  clearThread(threadId: string): void {
    this.threads.delete(threadId);
    this.lastSentAt.delete(threadId);
    this.unread.delete(threadId);
  }

  /**
   * Vacia mensajes, no leídos, cooldowns, disponibilidad y estado de flood
   * (al salir de la partida / volver al menú). CONSERVA el bloqueo de la
   * sesión: es una decisión sobre QUIÉN es el otro jugador, no sobre una
   * partida puntual, y sigue vigente en la próxima sala a la que entre.
   */
  clear(): void {
    this.threads.clear();
    this.lastSentAt.clear();
    this.unread.clear();
    this.available.clear();
    this.flood.clear();
  }
}
