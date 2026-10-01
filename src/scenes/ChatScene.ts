/**
 * ChatScene — overlay del chat social sobre el lobby (issue #2, C1).
 *
 * Patrón PauseScene: se LANZA encima (`scene.launch('Chat', {...})`) con velo
 * oscuro interactivo y NO pausa lo de abajo (el lobby no tiene mundo que
 * pausar; su update sigue corriendo, solo queda tapado). No está en el array
 * de escenas de `gameConfig.ts`: la registra LobbyScene on-demand con
 * `scene.add` antes del primer launch — el overlay vive y muere con el lobby.
 *
 * Tab visible en C1: SALA (hilo `room` del ChatStore de sesión). En C2 se
 * agrega PÚBLICO (sala de presencia) sobre el mismo esqueleto de tabs.
 *
 * Contrato por init data (parseo defensivo como PauseScene):
 * - `thread`: threadId a mostrar (default `ROOM_THREAD_ID`).
 * - `sendChat(text)`: callback del dueño del NetClient (el lobby) para
 *   difundir — el overlay NUNCA toca el transporte: cerrar el chat no rompe
 *   la sala y el lobby puede apagarse bajo el overlay sin efecto colateral.
 *
 * CERRAR (o ESC con el input sin foco): `markRead(thread)` + `scene.stop()`
 * — el lobby de abajo queda intacto y recupera el input (el panel restaura
 * la captura de teclado del juego en su destroy).
 */

import Phaser from 'phaser';
import { CHAT } from '../config/balance';
import { getSessionEventBus } from '../core/EventBus';
import { ROOM_THREAD_ID, type ChatStore } from '../chat/ChatStore';
import { getSessionChatStore } from '../chat/chatSession';
import { ChatPanel } from '../ui/ChatPanel';
import { MenuButton } from '../ui/MenuButton';

const TITLE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: `${CHAT.titleFontSize}px`,
  color: '#f2f2f2',
};

const TAB_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: `${CHAT.tabFontSize}px`,
  color: '#f2f2f2',
};

const ERROR_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '28px',
  color: '#d63c3c',
};

/** Init data que LobbyScene le pasa al overlay (todo opcional/defensivo). */
export interface ChatSceneData {
  readonly thread?: string;
  readonly sendChat?: (text: string) => void;
}

/** Parseo defensivo del init data (Phaser lo propaga como unknown). */
function parseChatData(raw: unknown): ChatSceneData {
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const thread = typeof record.thread === 'string' ? record.thread : undefined;
  const sendChat =
    typeof record.sendChat === 'function'
      ? (record.sendChat as (text: string) => void)
      : undefined;
  return { thread, sendChat };
}

export class ChatScene extends Phaser.Scene {
  static readonly KEY = 'Chat';

  private threadId = ROOM_THREAD_ID;
  private sendChat: ((text: string) => void) | null = null;
  private store: ChatStore | null = null;
  private panel: ChatPanel | null = null;
  private keyEsc: Phaser.Input.Keyboard.Key | null = null;

  constructor() {
    super(ChatScene.KEY);
  }

  init(data: unknown): void {
    const parsed = parseChatData(data);
    this.threadId = parsed.thread ?? ROOM_THREAD_ID;
    this.sendChat = parsed.sendChat ?? null;
    this.store = getSessionChatStore(this.registry);
    this.panel = null;
  }

  create(): void {
    const { width, height } = this.scale;
    const centerX = width / 2;
    const bus = getSessionEventBus(this.registry);

    // Velo interactivo que corta los taps atravesados: mientras el chat está
    // abierto, el input del juego no dispara los botones del lobby de abajo
    // (mismo patrón que el overlay multijugador del menú).
    const veil = this.add
      .rectangle(centerX, height / 2, width, height, 0x000000, CHAT.veilAlpha)
      .setInteractive();
    veil.on('pointerdown', (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
    });

    this.add
      .text(centerX, CHAT.titleY, 'CHAT', TITLE_STYLE)
      .setOrigin(0.5)
      .setStroke('#0c0c14', 10);

    // Tab SALA (el único de C1; en C2 se suma PÚBLICO a su derecha).
    this.add
      .rectangle(centerX - CHAT.listWidth / 2 + CHAT.tabWidth / 2, CHAT.tabY, CHAT.tabWidth, CHAT.tabHeight, 0x1d8f43)
      .setStrokeStyle(4, 0x0c0c14);
    this.add.text(centerX - CHAT.listWidth / 2 + CHAT.tabWidth / 2, CHAT.tabY, 'SALA', TAB_STYLE).setOrigin(0.5);

    // CERRAR siempre disponible (marca el hilo como leído al salir).
    new MenuButton(this, {
      x: centerX,
      y: CHAT.closeY,
      width: CHAT.closeWidth,
      height: CHAT.closeHeight,
      label: 'CERRAR',
      tint: 0x525868,
      fontSize: CHAT.closeFontSize,
      bus,
      onPress: this.close,
    });

    // ESC cierra con JustDown (anti auto-repeat). Con el input enfocado no
    // llega: el aislamiento del panel corta la propagación y resuelve Escape
    // él mismo (mismo close()).
    this.keyEsc = this.input.keyboard?.addKey('ESC') ?? null;

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      // El panel restaura la captura global del teclado del juego y saca el
      // DOM input; el hilo queda leído aunque el cierre sea externo (p. ej.
      // el lobby arrancó la carrera con el chat abierto).
      this.panel?.destroy();
      this.panel = null;
      this.store?.markRead(this.threadId);
      this.store = null;
    });

    // Sin store (no hay sala) o sin transporte de envío (launch en caliente):
    // degradación honesta — historia no, chat no; CERRAR sigue disponible.
    if (!this.store || !this.sendChat) {
      this.add.text(centerX, CHAT.inputY, 'EL CHAT NO ESTÁ DISPONIBLE', ERROR_STYLE).setOrigin(0.5);
      return;
    }

    this.panel = new ChatPanel(this, {
      threadId: this.threadId,
      store: this.store,
      sender: { sendChat: (text: string) => this.sendChat?.(text) },
      bus,
      onCancel: this.close,
    });
  }

  override update(): void {
    if (this.keyEsc && Phaser.Input.Keyboard.JustDown(this.keyEsc)) {
      this.close();
      return;
    }
    this.panel?.refresh(Date.now());
  }

  /** Marca el hilo como leído y se quita de encima (el lobby sigue intacto). */
  private readonly close = (): void => {
    this.store?.markRead(this.threadId);
    this.scene.stop();
  };
}
