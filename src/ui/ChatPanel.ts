/**
 * ChatPanel — widget de chat reutilizable (issue #2, C1).
 *
 * Lista de mensajes de UN hilo + input DOM de texto + botón ENVIAR + estado
 * visible del cooldown. Lo consume el overlay ChatScene (tab SALA) y en C2/C3
 * lo reutilizan el menú y el modo espectador; no sabe EN QUÉ escena vive ni
 * cómo viajan los mensajes: lee el `ChatStore` del hilo y delega el envío en
 * un `ChatSender` (adaptador `sendRoomChat` de `chat/roomChat.ts`; los hilos
 * de DM de C3 inyectan `sendDirectMessage` de `chat/dmChat.ts` vía
 * `sendOverride` y un estado de envío bloqueado vía `sendBlockedState`).
 *
 * RENDER SIN HTML: los mensajes son `Phaser.GameObjects.Text` (jamás
 * innerHTML — sin vector XSS) con wrap al ancho del panel, anclados ABAJO
 * (siempre se ven los últimos) y limitados a `CHAT.visibleMessages`. SIN
 * scroll táctil a propósito (decisión v1 del issue #2): la lista siempre
 * muestra los últimos N y los que no caben simplemente no se dibujan —
 * el scroll real llega si la v2 lo pide.
 *
 * AISLAMIENTO DE FOCO (la parte delicada): mientras el input DOM tiene foco,
 * el teclado del juego NO debe capturar — ni "P" pausa, ni ESPACIO dispara
 * botones, ni las flechas mueven. Phaser escucha keydown/keyup en `window`,
 * así que el patrón del input de nombre del menú (guard "si el overlay está
 * abierto, ignoro la tecla" en cada handler) NO alcanza: las teclas igual
 * ENTRAN a Phaser (JustDown, keydown-SPACE de cualquier escena) y además un
 * key CAPTURADO (`addKey('P')` llama a `addCapture`) dispara `preventDefault`
 * y BLOQUEARÍA tipear esa letra en el input. La solución es doble (ver
 * `isolateChatInput`, testeada aparte):
 *
 * 1. `stopPropagation` en keydown/keyup del NODO del input: el evento nunca
 *    burbujea a window → Phaser no lo recibe ni lo procesa.
 * 2. `disableGlobalCapture` al ganar foco / `enableGlobalCapture` al perderlo
 *    (API pensada para esto: "if you swap to a DOM element"): aún si algún
 *    evento llegara por otro camino, Phaser no hace preventDefault y el
 *    tipeo nunca queda bloqueado.
 *
 * Enter envía (atajo de teclado) y Escape cancela (cierra el overlay), ambos
 * resueltos DENTRO del guard antes de cortar la propagación.
 */

import Phaser from 'phaser';
import { CHAT, CHAT_MAX_LEN, MULTIPLAYER } from '../config/balance';
import type { EventBus, GameEvents } from '../core/EventBus';
import type { ChatMessage, ChatStore } from '../chat/ChatStore';
import type { DmBlockedSendState } from '../chat/dmView';
import { DM_SEND_OPEN } from '../chat/dmView';
import type { ChatSender } from '../chat/roomChat';
import { sendRoomChat } from '../chat/roomChat';
import { MenuButton } from './MenuButton';

/* ------------------------------------------------------------------ */
/* Lógica de presentación PURA (testeada en chatPanel.test.ts)          */
/* ------------------------------------------------------------------ */

/** Una línea lista para renderizar: texto final + color CSS + propio/ajeno. */
export interface ChatLine {
  readonly text: string;
  readonly color: string;
  readonly mine: boolean;
}

/** Nombre que se muestra si el remitente no tiene nombre usable. */
const FALLBACK_NAME = 'PILOTO';

/** Etiqueta de los mensajes propios (destacados como "VOS"). */
export const SELF_LABEL = 'VOS';

/** Convierte un color numérico (0xrrggbb) a CSS '#rrggbb' (defensivo). */
export function colorNumberToCss(color: number): string {
  if (!Number.isFinite(color) || color < 0) {
    return '#f2f2f2';
  }
  return `#${Math.floor(color).toString(16).padStart(6, '0')}`;
}

/**
 * Formatea un mensaje como línea de chat: "NOMBRE: texto" coloreado con el
 * color del peer; los propios quedan "VOS: texto" en el color destacado
 * `CHAT.selfColor` (la escena además los alinea a la derecha). Los mensajes
 * de SISTEMA (avisos locales: "BLOQUEASTE A NOMBRE") van SIN remitente, en
 * el gris neutro de la UI — son del hilo, no de nadie.
 */
export function formatChatLine(message: ChatMessage): ChatLine {
  if (message.system) {
    return { text: message.text, color: CHAT.systemColor, mine: false };
  }
  if (message.mine) {
    return { text: `${SELF_LABEL}: ${message.text}`, color: CHAT.selfColor, mine: true };
  }
  const name = message.fromName.length > 0 ? message.fromName : FALLBACK_NAME;
  return { text: `${name}: ${message.text}`, color: colorNumberToCss(message.color), mine: false };
}

/**
 * Los últimos `maxVisible` mensajes en orden de llegada (lo que el panel
 * renderiza): `maxVisible <= 0` no muestra nada; más mensajes que el tope
 * recorta los MÁS VIEJOS (la lista siempre muestra los últimos).
 */
export function visibleChatMessages(
  messages: readonly ChatMessage[],
  maxVisible: number,
): readonly ChatMessage[] {
  if (maxVisible <= 0) {
    return [];
  }
  return messages.slice(Math.max(0, messages.length - maxVisible));
}

/**
 * true si la lista del hilo quedó vieja y hay que re-renderizar (issue #35,
 * qaT8): cambió la cantidad de mensajes O el ÚLTIMO. La cola se compara por
 * IDENTIDAD porque con el tope de historial (`CHAT_HISTORY_MAX`) el largo se
 * clava y un mensaje nuevo sólo se nota por la cola — cada mensaje aceptado
 * es un objeto nuevo del store, así que la comparación es exacta y barata.
 */
export function chatListStale(
  messages: readonly ChatMessage[],
  lastCount: number,
  lastTail: ChatMessage | null,
): boolean {
  const tail = messages.length > 0 ? messages[messages.length - 1] : null;
  return messages.length !== lastCount || tail !== lastTail;
}

/** Estado del botón ENVIAR según el cooldown restante del hilo. */
export interface ChatSendState {
  readonly label: string;
  readonly disabled: boolean;
}

/** Etiqueta/deshabilitado del ENVIAR: en cooldown muestra "ESPERÁ…". */
export function chatSendState(cooldownRemainingMs: number): ChatSendState {
  return cooldownRemainingMs > 0
    ? { label: 'ESPERÁ…', disabled: true }
    : { label: 'ENVIAR', disabled: false };
}

/* ------------------------------------------------------------------ */
/* Atributos móviles del input DOM (testeable con happy-dom)            */
/* ------------------------------------------------------------------ */

/**
 * Preset de atributos móviles de un input DOM del juego. El teclado virtual
 * (iOS/Android) se configura con estos hints — cada uno elegido para lo que
 * el input espera, para que el teclado AYUDE en vez de estorbar:
 *
 * - `maxLength`: tope duro del dominio (200 chat / 12 nombre / 9 palabra de
 *   sala): el usuario no puede tipear de más y el sanitize recorta igual.
 * - `enterKeyHint`: la tecla Enter del teclado virtual se etiqueta con la
 *   acción real (chat: "enviar"; palabra de sala: "ir" → ENTRAR; nombre:
 *   "listo").
 * - `autoCapitalize`: SOLO la palabra de sala fuerza MAYÚSCULAS (el dominio
 *   es A–Z); en chat explícitamente "none" para no gritar, y en nombre
 *   "words" como cortesía.
 * - `autoComplete`/`autoCorrect`/`spellCheck` OFF: nada acá se completa ni
 *   corrige contra diccionarios (y el autocorrect de iOS reescribiría
 *   palabras de sala).
 * - `inputMode: 'text'` explícito: es el default, pero declararlo documenta
 *   la intención (teclado completo, no numérico).
 */
export interface MobileInputPreset {
  readonly maxLength: number;
  readonly enterKeyHint: 'send' | 'go' | 'done';
  readonly autoCapitalize: 'none' | 'characters' | 'words';
}

/** Presets por clase de input (los consumen ChatPanel y los inputs del lobby/menú). */
export const MOBILE_INPUT_PRESETS: Readonly<Record<'chat' | 'name' | 'roomWord', MobileInputPreset>> = {
  /** Input de mensaje de chat: 200 caracteres, Enter = ENVIAR, sin mayúsculas forzadas. */
  chat: { maxLength: CHAT_MAX_LEN, enterKeyHint: 'send', autoCapitalize: 'none' },
  /** Input de nombre de jugador: 12 caracteres, Enter = listo. */
  name: { maxLength: MULTIPLAYER.maxPlayerNameLength, enterKeyHint: 'done', autoCapitalize: 'words' },
  /** Input de palabra de sala: 9 caracteres A–Z, Enter = ENTRAR, TODO mayúsculas. */
  roomWord: { maxLength: MULTIPLAYER.roomWordMaxLength, enterKeyHint: 'go', autoCapitalize: 'characters' },
};

/**
 * Aplica el preset móvil a un nodo de input DOM. Los tres atributos que el
 * resto del repo ya usa como PROPIEDAD reflejada (`maxLength`, `autocomplete`,
 * `autocapitalize`) siguen por propiedad; los hints que no garantizan estar
 * en las defs de DOM de todas las versiones de TS (`enterkeyhint`, `inputmode`,
 * `autocorrect`, `spellcheck`) van por atributo — mismo efecto en el navegador.
 */
export function applyMobileInputAttributes(node: HTMLInputElement, kind: 'chat' | 'name' | 'roomWord'): void {
  const preset = MOBILE_INPUT_PRESETS[kind];
  node.maxLength = preset.maxLength;
  node.autocomplete = 'off';
  node.autocapitalize = preset.autoCapitalize;
  node.setAttribute('enterkeyhint', preset.enterKeyHint);
  node.setAttribute('inputmode', 'text');
  node.setAttribute('autocorrect', 'off'); // WebKit no estándar, inofensivo afuera de iOS
  node.setAttribute('spellcheck', 'false');
}

/* ------------------------------------------------------------------ */
/* Aislamiento de foco del input DOM (testeable con happy-dom)          */
/* ------------------------------------------------------------------ */

/** Porción del KeyboardPlugin de Phaser que el aislamiento necesita. */
export interface GlobalCaptureKeyboard {
  disableGlobalCapture(): unknown;
  enableGlobalCapture(): unknown;
}

/** Manejo del aislamiento instalado en un input (se retira con detach). */
export interface ChatInputIsolation {
  detach(): void;
}

/**
 * Instala el aislamiento de teclado sobre el nodo del input de chat:
 * corta la propagación de keydown/keyup (Phaser escucha en window y así no
 * recibe NADA de lo tipeado), apaga la captura global al ganar foco y la
 * restaura al perderlo. Enter → `onSubmit`, Escape → `onCancel`. `detach()`
 * retira los listeners y restaura la captura por si el blur no llegó.
 */
export function isolateChatInput(
  node: HTMLElement,
  keyboard: GlobalCaptureKeyboard | null,
  onSubmit: () => void,
  onCancel?: () => void,
): ChatInputIsolation {
  const stopPropagation = (event: Event): void => {
    event.stopPropagation();
  };
  const handleKeyDown = (event: KeyboardEvent): void => {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      onSubmit();
    } else if (event.key === 'Escape' && onCancel) {
      event.preventDefault();
      onCancel();
    }
  };
  const disableCapture = (): void => {
    keyboard?.disableGlobalCapture();
  };
  const enableCapture = (): void => {
    keyboard?.enableGlobalCapture();
  };
  node.addEventListener('keydown', handleKeyDown);
  node.addEventListener('keyup', stopPropagation);
  node.addEventListener('focus', disableCapture);
  node.addEventListener('blur', enableCapture);
  return {
    detach(): void {
      node.removeEventListener('keydown', handleKeyDown);
      node.removeEventListener('keyup', stopPropagation);
      node.removeEventListener('focus', disableCapture);
      node.removeEventListener('blur', enableCapture);
      enableCapture(); // restaura la captura aunque el blur nunca disparó
    },
  };
}

/* ------------------------------------------------------------------ */
/* Input DOM                                                           */
/* ------------------------------------------------------------------ */

/**
 * Estilo del input de texto del chat (mismo lenguaje que el del lobby).
 * La fuente es 34 px de juego: al escala FIT más chica de iPhone (~0,52)
 * quedan ~18 px CSS — por encima de los 16 px que disparan el auto-zoom de
 * foco de iOS Safari (el input nunca agranda la página al tocarlo).
 */
const CHAT_INPUT_CSS = {
  'font-family': 'monospace',
  'font-size': `${CHAT.inputFontSize}px`,
  width: `${CHAT.inputWidth}px`,
  height: `${CHAT.inputHeight}px`,
  'text-align': 'center',
  color: '#f2f2f2',
  'background-color': '#0c0c14',
  border: '4px solid #3a3a44',
  'border-radius': '8px',
  outline: 'none',
  'pointer-events': 'auto',
};

/** Placeholder del panel vacío. */
const EMPTY_HINT = 'SIN MENSAJES TODAVÍA';

/** Placeholder del input cuando el envío está HABILITADO. */
const INPUT_PLACEHOLDER = 'ESCRIBÍ UN MENSAJE…';

/** Configuración del panel (todo inyectado; el panel no crea stores). */
export interface ChatPanelConfig {
  /** Hilo que muestra y al que envía (`ROOM_THREAD_ID` o el peerId del DM). */
  readonly threadId: string;
  /** Store de la sesión (compartido lobby ↔ overlay por `chatSession`). */
  readonly store: ChatStore;
  /**
   * Transporte del envío del hilo de SALA (adaptador puro de `roomChat`).
   * Opcional para los hilos de DM de C3, que envían con `sendOverride`.
   */
  readonly sender?: ChatSender;
  /**
   * C3 — estrategia de envío del hilo: se le pasa a los hilos de DM
   * (`sendDirectMessage` de `dmChat`, que valida bloqueo/desconexión); sin
   * esto el panel usa el adaptador de sala (`sendRoomChat` + `sender`).
   */
  readonly sendOverride?: (rawText: string) => ChatMessage | null;
  /**
   * C3 — estado de envío BLOQUEADO del hilo (`dmBlockedSendState` de
   * `dmView`: desconectado/bloqueado) o el estado abierto; consultado en
   * cada refresh y en cada submit. Mientras haya razón, el input queda
   * deshabilitado con ese aviso de placeholder y el botón muestra el label
   * del estado (DESCONECTADO/BLOQUEADO).
   */
  readonly sendBlockedState?: () => DmBlockedSendState;
  /** Bus de sesión para el SFX de click del botón ENVIAR. */
  readonly bus?: EventBus<GameEvents> | null;
  /** Escape dentro del input (cierra el overlay). */
  readonly onCancel?: () => void;
  /** Reloj inyectable (default `Date.now`). */
  readonly now?: () => number;
}

/**
 * Panel de chat: lista + input + ENVIAR + cooldown. La escena llama
 * `refresh(now)` por frame (repinta solo si la lista cambió — ver
 * `chatListStale` — o el estado del botón) y lo destruye en su SHUTDOWN.
 */
export class ChatPanel {
  private readonly scene: Phaser.Scene;
  private readonly threadId: string;
  private readonly store: ChatStore;
  private readonly sender: ChatSender | null;
  private readonly sendOverride: ((rawText: string) => ChatMessage | null) | null;
  private readonly sendBlockedState: () => DmBlockedSendState;
  private readonly now: () => number;

  private readonly listBg: Phaser.GameObjects.Rectangle;
  private readonly input: Phaser.GameObjects.DOMElement;
  private readonly inputNode: HTMLInputElement;
  private readonly isolation: ChatInputIsolation;
  private readonly sendButton: MenuButton;
  private messageTexts: Phaser.GameObjects.Text[] = [];
  private lastMessageCount = -1;
  private lastTail: ChatMessage | null = null;
  private lastSendLabel = '';

  constructor(scene: Phaser.Scene, config: ChatPanelConfig) {
    this.scene = scene;
    this.threadId = config.threadId;
    this.store = config.store;
    this.sender = config.sender ?? null;
    this.sendOverride = config.sendOverride ?? null;
    this.sendBlockedState = config.sendBlockedState ?? (() => DM_SEND_OPEN);
    this.now = config.now ?? (() => Date.now());

    const centerX = scene.scale.width / 2;

    // Panel de mensajes (borde + fondo oscuro).
    const listHeight = CHAT.listBottomY - CHAT.listTopY;
    this.listBg = scene.add
      .rectangle(centerX, (CHAT.listTopY + CHAT.listBottomY) / 2, CHAT.listWidth, listHeight, 0x14141c)
      .setStrokeStyle(6, 0x3a3a44);

    // Input DOM con foco aislado del teclado del juego y atributos móviles
    // (teclado virtual que AYUDA: Enter = ENVIAR, sin autocorrect ni
    // autocapitalize; máx 200 hard). Ancla abajo del layout (inputY 948 con
    // ENVIAR/CERRAR debajo): en Android/desktop táctil el teclado redimensiona
    // la ventana y Scale.FIT re-encaja TODO el lienzo sobre el teclado; el
    // caso iOS (teclado que solapa sin resize) queda para QA manual.
    this.input = scene.add.dom(centerX, CHAT.inputY, 'input', CHAT_INPUT_CSS) as Phaser.GameObjects.DOMElement;
    this.inputNode = this.input.node as HTMLInputElement;
    applyMobileInputAttributes(this.inputNode, 'chat');
    this.inputNode.placeholder = INPUT_PLACEHOLDER;
    this.input.setOrigin(0.5);
    this.isolation = isolateChatInput(
      this.inputNode,
      scene.input.keyboard ?? null,
      () => this.submit(),
      config.onCancel,
    );

    this.sendButton = new MenuButton(scene, {
      x: centerX,
      y: CHAT.sendY,
      width: CHAT.sendWidth,
      height: CHAT.sendHeight,
      label: 'ENVIAR',
      tint: 0x1d8f43,
      fontSize: CHAT.sendFontSize,
      bus: config.bus ?? undefined,
      onPress: () => this.submit(),
    });

    this.refresh(this.now());
    // El foco arranca en el input (táctil primero: teclado listo para escribir).
    this.inputNode.focus();
  }

  /**
   * Sincroniza la vista con el store: repinta la lista cuando cambió (largo
   * o último mensaje — con el tope de historial el largo se clava, ver
   * `chatListStale`), el botón ENVIAR según el cooldown visible y el input
   * según el estado de envío del hilo (C3: desconectado o peer bloqueado —
   * el input se deshabilita con el aviso de placeholder).
   */
  refresh(now?: number): void {
    const at = now ?? this.now();
    const messages = this.store.getMessages(this.threadId);
    if (chatListStale(messages, this.lastMessageCount, this.lastTail)) {
      this.lastMessageCount = messages.length;
      this.lastTail = messages.length > 0 ? messages[messages.length - 1] : null;
      this.renderMessages(messages);
    }
    const blockedState = this.sendBlockedState();
    const blocked = blockedState.reason !== null;
    if (this.inputNode.disabled !== blocked) {
      this.inputNode.disabled = blocked;
    }
    const placeholder = blocked ? blockedState.reason : INPUT_PLACEHOLDER;
    if (this.inputNode.placeholder !== placeholder) {
      this.inputNode.placeholder = placeholder;
    }
    const label = blocked ? blockedState.sendLabel : chatSendState(this.store.cooldownRemainingMs(this.threadId, at)).label;
    if (label !== this.lastSendLabel) {
      this.lastSendLabel = label;
      this.sendButton.setLabel(label);
    }
    this.sendButton.container.setAlpha(blocked ? 0.45 : this.cooldownAlpha(at));
  }

  /** Alfa del botón ENVIAR según el cooldown (tenue mientras espera). */
  private cooldownAlpha(at: number): number {
    return this.store.cooldownRemainingMs(this.threadId, at) > 0 ? 0.45 : 1;
  }

  /**
   * Envía lo tipeado: si el hilo está bloqueado (C3) no intenta nada (el
   * texto se conserva); si no, valida cooldown/texto contra el store y
   * difunde por la red solo si fue aceptado (el hilo de DM usa su propia
   * estrategia `sendOverride`; el de sala, `sendRoomChat`). Limpia el input
   * solo cuando el mensaje salió (si quedó vacío o en cooldown, el texto se
   * conserva para reintentar).
   */
  submit(): void {
    if (this.sendBlockedState().reason !== null) {
      return; // hilo bloqueado (desconectado/bloqueado): ni intenta enviar
    }
    if (this.sendOverride) {
      const sent = this.sendOverride(this.inputNode.value);
      if (sent) {
        this.inputNode.value = '';
        this.refresh(this.now());
      }
      return;
    }
    if (!this.sender) {
      return; // hilo sin transporte de envío (defensivo): no hay nada que hacer
    }
    const message = sendRoomChat(this.store, this.sender, this.inputNode.value, this.now());
    if (message) {
      this.inputNode.value = '';
      this.refresh(this.now());
    }
  }

  /** Libera TODO (llamarlo en el SHUTDOWN de la escena): restaura la captura. */
  destroy(): void {
    this.isolation.detach();
    this.input.destroy();
    this.sendButton.destroy();
    for (const text of this.messageTexts) {
      text.destroy();
    }
    this.messageTexts = [];
    this.listBg.destroy();
  }

  /* ---------------------------------------------------------------- */
  /* Render de la lista (anclada abajo: siempre se ven los últimos)     */
  /* ---------------------------------------------------------------- */

  private renderMessages(messages: readonly ChatMessage[]): void {
    for (const text of this.messageTexts) {
      text.destroy();
    }
    this.messageTexts = [];

    const centerX = this.scene.scale.width / 2;
    const wrapWidth = CHAT.listWidth - CHAT.listPadding * 2;

    if (messages.length === 0) {
      const hint = this.scene.add
        .text(centerX, (CHAT.listTopY + CHAT.listBottomY) / 2, EMPTY_HINT, {
          fontFamily: 'monospace',
          fontSize: `${CHAT.messageFontSize}px`,
          color: '#525868',
        })
        .setOrigin(0.5);
      this.messageTexts.push(hint);
      return;
    }

    // Se apilan de ABAJO hacia arriba: el más nuevo queda pegado al borde
    // inferior y los viejos suben hasta agotar el panel (los que no caben,
    // que ya quedaron fuera de `visibleMessages`, no se dibujan).
    const visible = visibleChatMessages(messages, CHAT.visibleMessages);
    let bottom = CHAT.listBottomY - CHAT.listPadding;
    for (let index = visible.length - 1; index >= 0; index -= 1) {
      const line = formatChatLine(visible[index]);
      const text = this.scene.add
        .text(
          line.mine ? centerX + CHAT.listWidth / 2 - CHAT.listPadding : centerX - CHAT.listWidth / 2 + CHAT.listPadding,
          bottom,
          line.text,
          {
            fontFamily: 'monospace',
            fontSize: `${CHAT.messageFontSize}px`,
            color: line.color,
            wordWrap: { width: wrapWidth },
            align: line.mine ? 'right' : 'left',
          },
        )
        .setOrigin(line.mine ? 1 : 0, 1);
      if (text.y - text.height < CHAT.listTopY) {
        // No cabe ni este: el panel ya está lleno con los más nuevos.
        text.destroy();
        break;
      }
      this.messageTexts.push(text);
      bottom = text.y - text.height - CHAT.messageGap;
    }
  }
}
