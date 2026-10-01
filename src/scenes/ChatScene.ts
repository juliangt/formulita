/**
 * ChatScene — overlay del chat social (issue #2: C1 sala, C2 presencia).
 *
 * Patrón PauseScene: se LANZA encima (`scene.launch('Chat', {...})`) con velo
 * oscuro interactivo y NO pausa lo de abajo. No está en el array de escenas
 * de `gameConfig.ts`: la registra quien la abre por primera vez on-demand con
 * `scene.add` (C1: LobbyScene; C2: también MenuScene).
 *
 * Tabs (C2):
 * - SALA: hilo `room` del ChatStore de la SESIÓN DE PARTIDA (lo publica
 *   LobbyScene). Sin lobby (chat abierto desde el MENÚ) la tab aparece
 *   DESHABILITADA con un aviso: el chat de sala solo existe en una partida.
 * - PÚBLICO: sala pública de presencia OPT-IN — toggle grande
 *   "MOSTRARME DISPONIBLE" (estado inicial desde `ChatSettingsRepository`,
 *   default NO = nunca conecta) + lista en vivo de los demás disponibles
 *   (excluyéndome) + detalle al tocar una fila. Mientras el toggle está OFF
 *   no hay conexión a la sala pública (privacy-by-default). Al tocar un
 *   elemento solo se muestran sus datos: el hilo DM llega en C3 (hook en
 *   `onPeerTapped`).
 *
 * Contrato por init data (parseo defensivo como PauseScene):
 * - `thread`: threadId a mostrar en SALA (default `ROOM_THREAD_ID`).
 * - `sendChat(text)`: callback del dueño del NetClient (el lobby) para
 *   difundir — el overlay NUNCA toca el transporte de partidas: cerrar el
 *   chat no rompe la sala y el lobby puede apagarse bajo el overlay sin
 *   efecto colateral.
 * - `tab`: tab inicial ('room' | 'public'; default 'room' — el lobby abre
 *   SALA, el menú abre PÚBLICO).
 *
 * La sala PÚBLICA vive en el ChatClient de SESIÓN (`chatClientSession`, uno
 * por pestaña): la escena solo sincroniza su disponibilidad con el ajuste
 * persistido — NUNCA lo destruye (cerrar el chat no desconecta a quien
 * eligió verse disponible).
 *
 * CERRAR (o ESC con el input sin foco): `markRead(thread)` + `scene.stop()`.
 */

import Phaser from 'phaser';
import { CHAT } from '../config/balance';
import { getSessionEventBus } from '../core/EventBus';
import { ROOM_THREAD_ID, type ChatStore } from '../chat/ChatStore';
import { getSessionChatStore } from '../chat/chatSession';
import { getChatClient } from '../chat/chatClientSession';
import {
  applyAvailabilitySetting,
  availabilityToggleLabel,
  CHAT_TAB_LABELS,
  CHAT_TAB_ORDER,
  EMPTY_PEERS_HINT,
  formatAvailablePeerRow,
  formatPeerDetail,
  parseChatTab,
  ROOM_TAB_MENU_HINT,
  toggleAvailability,
  visibleAvailablePeers,
  type ChatTabId,
} from '../chat/presenceView';
import { getChatSettingsRepository } from '../data/ChatSettingsRepository';
import { getPlayerProfileRepository } from '../data/PlayerProfileRepository';
import type { AvailablePeer, ChatClient } from '../net/ChatClient';
import { sanitizePlayerName } from '../net/protocol';
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

const TAB_INACTIVE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: `${CHAT.tabFontSize}px`,
  color: '#9aa0a8',
};

const HINT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: `${CHAT.messageFontSize}px`,
  color: '#525868',
  align: 'center',
  wordWrap: { width: CHAT.listWidth - CHAT.listPadding * 2 },
};

const PEER_DETAIL_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: `${CHAT.peerDetailFontSize}px`,
  color: '#9aa0a8',
};

/** Colores de los chips de tab (activo / inactivo / deshabilitado). */
const TAB_ACTIVE_FILL = 0x1d8f43;
const TAB_INACTIVE_FILL = 0x2a2a34;

/** Init data que el lanzador le pasa al overlay (todo opcional/defensivo). */
export interface ChatSceneData {
  readonly thread?: string;
  readonly sendChat?: (text: string) => void;
  readonly tab?: ChatTabId;
}

/** Parseo defensivo del init data (Phaser lo propaga como unknown). */
function parseChatData(raw: unknown): ChatSceneData {
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const thread = typeof record.thread === 'string' ? record.thread : undefined;
  const sendChat =
    typeof record.sendChat === 'function'
      ? (record.sendChat as (text: string) => void)
      : undefined;
  return { thread, sendChat, tab: parseChatTab(record.tab) };
}

export class ChatScene extends Phaser.Scene {
  static readonly KEY = 'Chat';

  private threadId = ROOM_THREAD_ID;
  private sendChat: ((text: string) => void) | null = null;
  private store: ChatStore | null = null;
  private panel: ChatPanel | null = null;
  private keyEsc: Phaser.Input.Keyboard.Key | null = null;

  /* C2 — tabs + contenido de PÚBLICO. */
  private activeTab: ChatTabId = 'room';
  private tabFills: Partial<Record<ChatTabId, Phaser.GameObjects.Rectangle>> = {};
  private tabLabels: Partial<Record<ChatTabId, Phaser.GameObjects.Text>> = {};
  /** Objetos del tab activo (se destruyen al cambiar de tab / apagarse). */
  private tabContent: Array<{ destroy(): void }> = [];
  /** Filas actuales de la lista de disponibles (se recrean en cada cambio). */
  private peerRows: Phaser.GameObjects.GameObject[] = [];
  /** Línea de detalle bajo la lista (peer tocado / error de presencia). */
  private peerDetailText: Phaser.GameObjects.Text | null = null;
  private availabilityButton: MenuButton | null = null;
  private chatClient: ChatClient | null = null;
  private unsubscribePeers: (() => void) | null = null;
  private unsubscribeChatError: (() => void) | null = null;

  constructor() {
    super(ChatScene.KEY);
  }

  init(data: unknown): void {
    const parsed = parseChatData(data);
    this.threadId = parsed.thread ?? ROOM_THREAD_ID;
    this.sendChat = parsed.sendChat ?? null;
    this.activeTab = parsed.tab ?? 'room';
    this.store = getSessionChatStore(this.registry);
    // Sin lobby no hay hilo de sala: la tab SALA está deshabilitada y el
    // overlay abre directo en PÚBLICO (p. ej. launch en caliente sin datos).
    if (this.activeTab === 'room' && !this.roomTabEnabled) {
      this.activeTab = 'public';
    }
    this.panel = null;
    this.tabContent = [];
    this.availabilityButton = null;
    this.chatClient = null;
    this.unsubscribePeers = null;
    this.unsubscribeChatError = null;
  }

  create(): void {
    const { width, height } = this.scale;
    const centerX = width / 2;
    const bus = getSessionEventBus(this.registry);

    // Velo interactivo que corta los taps atravesados: mientras el chat está
    // abierto, el input del juego no dispara los botones de la escena de abajo
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

    // C2 — tabs SALA (izquierda) y PÚBLICO (derecha), dentro del ancho de la
    // lista. Son chips interactivos: tocar el inactivo cambia de tab (SALA
    // solo si está habilitada — sin lobby no hay hilo de sala que mostrar).
    this.createTabChip('room', centerX - CHAT.listWidth / 2 + CHAT.tabWidth / 2);
    this.createTabChip('public', centerX + CHAT.listWidth / 2 - CHAT.tabWidth / 2);

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
      this.destroyTabContent();
      this.unsubscribePeers?.();
      this.unsubscribePeers = null;
      this.unsubscribeChatError?.();
      this.unsubscribeChatError = null;
      // El ChatClient de sesión NO se destruye: la sala pública es un
      // servicio de pestaña (ver chatClientSession), la escena solo apaga su
      // propia vista.
      this.store?.markRead(this.threadId);
      this.store = null;
    });

    this.switchTab(this.activeTab);
  }

  override update(): void {
    if (this.keyEsc && Phaser.Input.Keyboard.JustDown(this.keyEsc)) {
      this.close();
      return;
    }
    this.panel?.refresh(Date.now());
  }

  /** Marca el hilo como leído y se quita de encima (la escena de abajo sigue intacta). */
  private readonly close = (): void => {
    this.store?.markRead(this.threadId);
    this.scene.stop();
  };

  /* ---------------------------------------------------------------- */
  /* Tabs                                                              */
  /* ---------------------------------------------------------------- */

  /** true si la tab SALA tiene hilo que mostrar (store de partida + envío). */
  private get roomTabEnabled(): boolean {
    return this.store !== null && this.sendChat !== null;
  }

  private createTabChip(tab: ChatTabId, x: number): void {
    const fill = this.add
      .rectangle(x, CHAT.tabY, CHAT.tabWidth, CHAT.tabHeight, TAB_INACTIVE_FILL)
      .setStrokeStyle(4, 0x0c0c14)
      .setInteractive();
    fill.on('pointerdown', () => this.switchTab(tab));
    const label = this.add.text(x, CHAT.tabY, CHAT_TAB_LABELS[tab], TAB_INACTIVE_STYLE).setOrigin(0.5);
    this.tabFills[tab] = fill;
    this.tabLabels[tab] = label;
  }

  /** Repinta los chips según el tab activo y la habilitación de SALA. */
  private renderTabChips(): void {
    for (const tab of CHAT_TAB_ORDER) {
      const active = tab === this.activeTab;
      const disabled = tab === 'room' && !this.roomTabEnabled;
      this.tabFills[tab]?.setFillStyle(active ? TAB_ACTIVE_FILL : TAB_INACTIVE_FILL);
      this.tabFills[tab]?.setAlpha(disabled ? 0.55 : 1);
      this.tabLabels[tab]?.setStyle(active ? TAB_STYLE : TAB_INACTIVE_STYLE);
    }
  }

  /** Cambia de tab: destruye el contenido actual y renderiza el nuevo. */
  private switchTab(tab: ChatTabId): void {
    if (tab === this.activeTab && this.tabContent.length > 0) {
      return; // ya está renderizado (el toque sobre el chip activo no repinta)
    }
    if (tab === 'room' && !this.roomTabEnabled) {
      return; // sin lobby no hay chat de sala: la tab queda deshabilitada
    }
    this.activeTab = tab;
    this.destroyTabContent();
    this.renderTabChips();
    if (tab === 'room') {
      this.renderRoomTab();
    } else {
      this.renderPublicTab();
    }
  }

  /** Destruye TODO el contenido del tab activo (panel, botones, filas). */
  private destroyTabContent(): void {
    this.panel?.destroy();
    this.panel = null;
    this.availabilityButton?.destroy();
    this.availabilityButton = null;
    for (const object of this.tabContent) {
      object.destroy();
    }
    this.tabContent = [];
    for (const row of this.peerRows) {
      row.destroy();
    }
    this.peerRows = [];
    this.peerDetailText = null;
  }

  /* ---------------------------------------------------------------- */
  /* Tab SALA (hilo de partida — C1)                                   */
  /* ---------------------------------------------------------------- */

  private renderRoomTab(): void {
    const centerX = this.scale.width / 2;
    const bus = getSessionEventBus(this.registry);

    // Sin store (chat abierto desde el menú) o sin transporte de envío: la
    // tab está deshabilitada y su panel muestra el aviso del issue — el chat
    // de sala solo existe DENTRO de una partida.
    if (!this.store || !this.sendChat) {
      this.tabContent.push(
        this.add
          .text(centerX, (CHAT.listTopY + CHAT.listBottomY) / 2, ROOM_TAB_MENU_HINT, HINT_STYLE)
          .setOrigin(0.5),
      );
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

  /* ---------------------------------------------------------------- */
  /* Tab PÚBLICO (sala de presencia — C2)                              */
  /* ---------------------------------------------------------------- */

  private renderPublicTab(): void {
    const centerX = this.scale.width / 2;
    const bus = getSessionEventBus(this.registry);
    const repo = getChatSettingsRepository(this.registry);
    const client = getChatClient(this.registry);
    this.chatClient = client;

    // Identidad anunciada en la sala pública: el nombre del PERFIL persistido
    // (el color del wire es informativo — cada cliente deriva el visible).
    const profileName = sanitizePlayerName(getPlayerProfileRepository(this.registry).load().name);
    client.updateSelf({ name: profileName.length > 0 ? profileName : 'PILOTO', color: 0 });

    // Panel de la lista (mismo marco que los mensajes, anclado arriba).
    const listHeight = CHAT.listBottomY - CHAT.peerListTopY;
    this.tabContent.push(
      this.add
        .rectangle(centerX, (CHAT.peerListTopY + CHAT.listBottomY) / 2, CHAT.listWidth, listHeight, 0x14141c)
        .setStrokeStyle(6, 0x3a3a44),
    );

    // Detalle del peer tocado / errores de presencia (empieza vacío). Se
    // crea ANTES de suscribir/aplicar: un error sincrónico del join (appId
    // faltante) ya tiene dónde pintarse.
    const detail = this.add
      .text(centerX, CHAT.peerDetailY, '', PEER_DETAIL_STYLE)
      .setOrigin(0.5);
    this.peerDetailText = detail;
    this.tabContent.push(detail);

    // Suscripciones ANTES de aplicar el ajuste: encender/apagar emite la
    // lista ([...] al conectar, [] al desconectar) y la vista sigue sola.
    this.unsubscribePeers?.();
    this.unsubscribePeers = client.onAvailablePeers((peers) => this.renderPeerList(peers));
    this.unsubscribeChatError?.();
    this.unsubscribeChatError = client.onError((message) => {
      this.renderPeerDetail({ text: message, color: '#d63c3c' });
    });

    // Toggle grande: estado inicial desde el ajuste persistido (default NO:
    // applyAvailabilitySetting con false NO conecta nada — privacy-by-default).
    const available = applyAvailabilitySetting(repo, client);
    this.createAvailabilityButton(available, centerX, bus);

    // Pintado inicial con el estado vivo del cliente.
    this.renderPeerList(client.getAvailablePeers());
  }

  /** Crea (o recrea, al togglear) el botón de disponibilidad. */
  private createAvailabilityButton(available: boolean, centerX: number, bus: ReturnType<typeof getSessionEventBus>): void {
    this.availabilityButton?.destroy();
    this.availabilityButton = new MenuButton(this, {
      x: centerX,
      y: CHAT.publicToggleY,
      width: CHAT.publicToggleWidth,
      height: CHAT.publicToggleHeight,
      label: availabilityToggleLabel(available),
      tint: available ? 0x1d8f43 : 0x525868,
      fontSize: CHAT.publicToggleFontSize,
      bus,
      onPress: () => this.onToggleAvailability(),
    });
  }

  /**
   * El usuario tocó el toggle: invierte el ajuste persistido, lo guarda y
   * sincroniza la conexión (SÍ ⇒ join; NO ⇒ leave REAL). Toda la decisión
   * vive en `toggleAvailability` (pura, testeada); acá solo se repinta.
   */
  private onToggleAvailability(): void {
    if (!this.chatClient) {
      return;
    }
    const next = toggleAvailability(getChatSettingsRepository(this.registry), this.chatClient);
    this.createAvailabilityButton(next, this.scale.width / 2, getSessionEventBus(this.registry));
  }

  /** Repinta la lista de disponibles (filas nombre + swatch, o el aviso). */
  private renderPeerList(peers: readonly AvailablePeer[]): void {
    // Solo importa si la tab PÚBLICO sigue visible (el evento puede llegar
    // tras un cambio de tab — las suscripciones viven hasta el shutdown).
    if (this.activeTab !== 'public') {
      return;
    }
    for (const object of this.peerRows) {
      object.destroy();
    }
    this.peerRows = [];

    const centerX = this.scale.width / 2;
    const visible = visibleAvailablePeers(peers, CHAT.visiblePeers);

    if (visible.length === 0) {
      const hint = this.add
        .text(centerX, (CHAT.peerListTopY + CHAT.listBottomY) / 2, EMPTY_PEERS_HINT, HINT_STYLE)
        .setOrigin(0.5);
      this.peerRows.push(hint);
      return;
    }

    visible.forEach((peer, index) => {
      const row = formatAvailablePeerRow(peer);
      const y = CHAT.peerRowStartY + index * CHAT.peerRowHeight;
      const swatch = this.add
        .rectangle(
          centerX - CHAT.listWidth / 2 + CHAT.listPadding + CHAT.peerSwatchSize / 2,
          y,
          CHAT.peerSwatchSize,
          CHAT.peerSwatchSize,
          peer.color,
        )
        .setStrokeStyle(3, 0x0c0c14);
      const label = this.add
        .text(centerX - CHAT.listWidth / 2 + CHAT.listPadding + CHAT.peerSwatchSize + 16, y, row.text, {
          fontFamily: 'monospace',
          fontSize: `${CHAT.peerRowFontSize}px`,
          color: row.color,
        })
        .setOrigin(0, 0.5)
        .setInteractive({ useHandCursor: true });
      label.on('pointerdown', () => this.onPeerTapped(peer));
      this.peerRows.push(swatch, label);
    });
  }

  /**
   * Tocar un disponible: por ahora SOLO muestra sus datos (nombre + peerId).
   * HOOK DE C3: acá se abrirá el hilo de DM con este peer —
   * `ChatClient.sendDm`/`onDm` ya están declarados, y este callback del tap
   * es donde se enchufará `openDmThread(peer)` cuando llegue la fase.
   */
  private onPeerTapped(peer: AvailablePeer): void {
    this.renderPeerDetail(formatPeerDetail(peer));
  }

  /** Pinta (o limpia con texto vacío) la línea de detalle bajo la lista. */
  private renderPeerDetail(detail: { text: string; color: string }): void {
    this.peerDetailText?.setText(detail.text).setColor(detail.color);
  }
}
