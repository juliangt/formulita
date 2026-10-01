/**
 * ChatScene — overlay del chat social (issue #2: C1 sala, C2 presencia,
 * C3 DM + bloqueo + invitaciones).
 *
 * Patrón PauseScene: se LANZA encima (`scene.launch('Chat', {...})`) con velo
 * oscuro interactivo y NO pausa lo de abajo. No está en el array de escenas
 * de `gameConfig.ts`: la registra quien la abre por primera vez on-demand con
 * `scene.add` (C1: LobbyScene; C2: también MenuScene; C3: también GameScene
 * en modo espectador).
 *
 * Tabs (C2):
 * - SALA: hilo `room` del ChatStore de la SESIÓN (C3: el store de sesión vive
 *   toda la pestaña — lo asegura `socialChatSession`; el lobby lo reusa).
 *   Sin lobby (chat abierto desde el MENÚ) la tab aparece DESHABILITADA con
 *   un aviso: el chat de sala solo existe en una partida.
 * - PÚBLICO: sala pública de presencia OPT-IN — toggle grande
 *   "MOSTRARME DISPONIBLE" (estado inicial desde `ChatSettingsRepository`,
 *   default NO = nunca conecta) + lista en vivo de los demás disponibles
 *   (excluyéndome) con BADGE de no leídos del hilo de DM (C3).
 *
 * C3 — HILO DE DM: tocar una fila de la lista abre el hilo con ese peer
 * (sub-vista de PÚBLICO): header con nombre/color, panel de chat reutilizado
 * (ChatPanel) con envío DIRIGIDO, botón VOLVER a la lista, botón
 * BLOQUEAR/DESBLOQUEAR (mensaje de sistema en el hilo) y botón INVITAR (solo
 * si YO estoy en un lobby con palabra activa — la pasa el lanzador como
 * `inviteKeyword`). Si el peer se va de la sala pública (toggle OFF, pestaña
 * cerrada, stale) el hilo queda DESCONECTADO: input deshabilitado con aviso
 * (la disponibilidad la sincroniza `socialChatSession` desde la lista viva).
 *
 * C3 — INVITACIONES: una invitación recibida (con el chat abierto o no —
 * queda pendiente en la sesión social) se muestra como banner en la tab
 * PÚBLICO: "N TE INVITÓ A «PALABRA»" + UNIRSE / IGNORAR. UNIRSE resuelve el
 * destino con `inviteJoinTarget` (pura) y arranca el flujo UNIRSE de #1 con
 * la palabra PRECARGADA.
 *
 * Contrato por init data (parseo defensivo como PauseScene):
 * - `thread`: threadId a mostrar en SALA (default `ROOM_THREAD_ID`).
 * - `sendChat(text)`: callback del dueño del NetClient (el lobby o el
 *   espectador de GameScene) para difundir — el overlay NUNCA toca el
 *   transporte de partidas.
 * - `inviteKeyword()`: proveedor de la palabra de MI sala de partida (solo
 *   el lobby lo pasa; si devuelve null, el botón INVITAR no se crea).
 * - `tab`: tab inicial ('room' | 'public'; default 'room' — el lobby y el
 *   espectador abren SALA, el menú abre PÚBLICO).
 *
 * El ChatClient/ChatStore de sesión y su cableado vivo (onDm/onAvailablePeers/
 * onInvite → store) viven en `socialChatSession` (C3): llegan DM aunque el
 * overlay esté cerrado (el badge del menú los cuenta). La escena solo
 * sincroniza la disponibilidad con el ajuste persistido y NUNCA destruye la
 * sesión social (cerrar el chat no desconecta a quien eligió verse visible).
 *
 * CERRAR (o ESC con el input sin foco): `markRead` del hilo abierto +
 * `scene.stop()`.
 */

import Phaser from 'phaser';
import { CHAT } from '../config/balance';
import { getSessionEventBus } from '../core/EventBus';
import { ROOM_THREAD_ID, type ChatStore } from '../chat/ChatStore';
import { getSocialChatSession, type SocialChatSession } from '../chat/socialChatSession';
import { sendDirectMessage } from '../chat/dmChat';
import {
  blockedSystemNote,
  dmBlockButtonLabel,
  dmBlockedSendState,
  dmHeaderLabel,
  inviteBannerText,
  invitedSystemNote,
  inviteJoinTarget,
  unblockedSystemNote,
} from '../chat/dmView';
import {
  applyAvailabilitySetting,
  availabilityToggleLabel,
  CHAT_TAB_LABELS,
  CHAT_TAB_ORDER,
  EMPTY_PEERS_HINT,
  formatAvailablePeerRow,
  parseChatTab,
  ROOM_TAB_MENU_HINT,
  toggleAvailability,
  visibleAvailablePeers,
  type ChatTabId,
} from '../chat/presenceView';
import { getChatSettingsRepository } from '../data/ChatSettingsRepository';
import { getPlayerProfileRepository } from '../data/PlayerProfileRepository';
import type { AvailablePeer, ChatClient } from '../net/ChatClient';
import { isValidRoomWord, sanitizePlayerName, sanitizeRoomWord } from '../net/protocol';
import { ChatPanel } from '../ui/ChatPanel';
import { MenuButton } from '../ui/MenuButton';
import { GameScene } from './GameScene';
import { LobbyScene } from './LobbyScene';
import { MenuScene } from './MenuScene';

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

/** Color del texto del banner de invitación (amarillo destacado del repo). */
const INVITE_BANNER_COLOR = '#f7c531';

/** Colores de los chips de tab (activo / inactivo / deshabilitado). */
const TAB_ACTIVE_FILL = 0x1d8f43;
const TAB_INACTIVE_FILL = 0x2a2a34;

/** Init data que el lanzador le pasa al overlay (todo opcional/defensivo). */
export interface ChatSceneData {
  readonly thread?: string;
  readonly sendChat?: (text: string) => void;
  readonly inviteKeyword?: () => string | null;
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
  const inviteKeyword =
    typeof record.inviteKeyword === 'function'
      ? (record.inviteKeyword as () => string | null)
      : undefined;
  return { thread, sendChat, inviteKeyword, tab: parseChatTab(record.tab) };
}

export class ChatScene extends Phaser.Scene {
  static readonly KEY = 'Chat';

  private threadId = ROOM_THREAD_ID;
  private sendChat: ((text: string) => void) | null = null;
  private inviteKeyword: (() => string | null) | null = null;
  private store: ChatStore | null = null;
  private social: SocialChatSession | null = null;
  private panel: ChatPanel | null = null;
  private keyEsc: Phaser.Input.Keyboard.Key | null = null;
  private closeButton: MenuButton | null = null;

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
  private unsubscribeInvite: (() => void) | null = null;

  /* C3 — hilo de DM abierto (null = vista de lista de la tab PÚBLICO). */
  private dmPeer: AvailablePeer | null = null;
  /** Botones del banner de invitación (UNIRSE / IGNORAR). */
  private inviteObjects: Array<{ destroy(): void }> = [];

  constructor() {
    super(ChatScene.KEY);
  }

  init(data: unknown): void {
    const parsed = parseChatData(data);
    this.threadId = parsed.thread ?? ROOM_THREAD_ID;
    this.sendChat = parsed.sendChat ?? null;
    this.inviteKeyword = parsed.inviteKeyword ?? null;
    this.activeTab = parsed.tab ?? 'room';
    this.dmPeer = null;
    // C3: el store de sesión vive TODA la pestaña (lo asegura la sesión
    // social) — el overlay siempre tiene hilos que mostrar, venga del menú,
    // del lobby o del espectador.
    this.social = getSocialChatSession(this.registry);
    this.store = this.social.store;
    // Sin lobby no hay hilo de sala: la tab SALA está deshabilitada y el
    // overlay abre directo en PÚBLICO (p. ej. launch en caliente sin datos).
    if (this.activeTab === 'room' && !this.roomTabEnabled) {
      this.activeTab = 'public';
    }
    this.panel = null;
    this.tabContent = [];
    this.inviteObjects = [];
    this.availabilityButton = null;
    this.chatClient = null;
    this.unsubscribePeers = null;
    this.unsubscribeChatError = null;
    this.unsubscribeInvite = null;
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

    // CERRAR siempre disponible (marca el hilo abierto como leído al salir).
    this.closeButton = new MenuButton(this, {
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
      this.destroyInviteBanner();
      this.unsubscribePeers?.();
      this.unsubscribePeers = null;
      this.unsubscribeChatError?.();
      this.unsubscribeChatError = null;
      this.unsubscribeInvite?.();
      this.unsubscribeInvite = null;
      // La sesión social NO se destruye: DM/presencia/invitaciones son
      // servicios de pestaña (ver socialChatSession); la escena solo apaga
      // su propia vista.
      this.store?.markRead(this.activeThreadId());
      this.store = null;
      this.social = null;
      this.closeButton = null;
    });

    // C3 — invitaciones en vivo: si el chat está en la vista de lista de la
    // tab PÚBLICO, el banner aparece al instante; si no, queda pendiente en
    // la sesión y se muestra la próxima vez que se pinte la lista.
    this.unsubscribeInvite = this.social?.onInviteReceived(() => {
      if (this.activeTab === 'public' && !this.dmPeer) {
        this.renderInviteBanner();
      }
    }) ?? null;

    this.switchTab(this.activeTab);
  }

  override update(): void {
    if (this.keyEsc && Phaser.Input.Keyboard.JustDown(this.keyEsc)) {
      this.close();
      return;
    }
    // El hilo que el usuario está MIRANDO queda leído (los que no se ven
    // siguen sumando para el badge del menú).
    if (this.dmPeer) {
      this.store?.markRead(this.dmPeer.peerId);
    } else if (this.activeTab === 'room') {
      this.store?.markRead(this.threadId);
    }
    this.panel?.refresh(Date.now());
  }

  /** threadId abierto (el DM si hay un hilo de DM en pantalla). */
  private activeThreadId(): string {
    return this.dmPeer?.peerId ?? this.threadId;
  }

  /** Marca el hilo como leído y se quita de encima (la escena de abajo sigue intacta). */
  private readonly close = (): void => {
    this.store?.markRead(this.activeThreadId());
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
    this.dmPeer = null; // cambiar de tab vuelve a la vista de lista
    this.setDmChromeVisible(false);
    this.destroyTabContent();
    this.destroyInviteBanner();
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

  /** Muestra/oculta el chrome de tabs + CERRAR (oculto en el hilo de DM). */
  private setDmChromeVisible(visible: boolean): void {
    for (const tab of CHAT_TAB_ORDER) {
      this.tabFills[tab]?.setVisible(!visible);
      this.tabLabels[tab]?.setVisible(!visible);
    }
    this.closeButton?.container.setVisible(!visible);
  }

  /* ---------------------------------------------------------------- */
  /* Tab SALA (hilo de partida — C1)                                   */
  /* ---------------------------------------------------------------- */

  private renderRoomTab(): void {
    const centerX = this.scale.width / 2;
    const bus = getSessionEventBus(this.registry);

    // Sin store (no debería pasar: la sesión social lo asegura) o sin
    // transporte de envío: la tab está deshabilitada y su panel muestra el
    // aviso del issue — el chat de sala solo existe DENTRO de una partida.
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
  /* Tab PÚBLICO (sala de presencia — C2; hilo de DM — C3)             */
  /* ---------------------------------------------------------------- */

  private renderPublicTab(): void {
    const centerX = this.scale.width / 2;
    const bus = getSessionEventBus(this.registry);
    const repo = getChatSettingsRepository(this.registry);
    const client = this.social?.client ?? null;
    if (!client || !this.social) {
      return; // defensivo: sin sesión social no hay tab PÚBLICO
    }
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
      if (!this.dmPeer) {
        this.renderPeerDetail({ text: message, color: '#d63c3c' });
      }
    });

    // Toggle grande: estado inicial desde el ajuste persistido (default NO:
    // applyAvailabilitySetting con false NO conecta nada — privacy-by-default).
    const available = applyAvailabilitySetting(repo, client);
    this.createAvailabilityButton(available, centerX, bus);

    // Pintado inicial con el estado vivo del cliente.
    this.renderPeerList(client.getAvailablePeers());

    // C3 — invitación pendiente de antes de abrir el chat (si la hay).
    if (this.social.getLatestInvite()) {
      this.renderInviteBanner();
    }
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
    if (this.activeTab !== 'public' || this.dmPeer) {
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
      // C3 — badge de no leídos del hilo de DM con este peer.
      const row = formatAvailablePeerRow(peer, this.store?.getUnreadCount(peer.peerId) ?? 0);
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
   * Tocar un disponible (HOOK de C3 resuelto): abre el hilo de DM con ese
   * peer — header con su identidad, ChatPanel reutilizado con envío DIRIGIDO
   * y botones VOLVER / BLOQUEAR / INVITAR.
   */
  private onPeerTapped(peer: AvailablePeer): void {
    this.openDmThread(peer);
  }

  /** Pinta (o limpia con texto vacío) la línea de detalle bajo la lista. */
  private renderPeerDetail(detail: { text: string; color: string }): void {
    this.peerDetailText?.setText(detail.text).setColor(detail.color);
  }

  /* ---------------------------------------------------------------- */
  /* C3 — hilo de DM (sub-vista de la tab PÚBLICO)                     */
  /* ---------------------------------------------------------------- */

  /** Abre el hilo de DM con `peer` (la vista de lista se destruye). */
  private openDmThread(peer: AvailablePeer): void {
    if (!this.store || !this.chatClient) {
      return;
    }
    this.dmPeer = peer;
    this.destroyTabContent();
    this.destroyInviteBanner();
    this.setDmChromeVisible(true); // oculta tabs + CERRAR
    const store = this.store;
    const dmPeerId = peer.peerId;

    // Header: swatch + nombre del peer en la fila de los tabs.
    const centerX = this.scale.width / 2;
    const name = this.add
      .text(centerX, CHAT.tabY, dmHeaderLabel(peer.name), {
        fontFamily: 'monospace',
        fontSize: `${CHAT.dmHeaderFontSize}px`,
        color: '#f2f2f2',
      })
      .setOrigin(0.5)
      .setStroke('#0c0c14', 6);
    const swatch = this.add
      .rectangle(
        centerX - name.width / 2 - CHAT.dmHeaderGap - CHAT.dmHeaderSwatchSize / 2,
        CHAT.tabY,
        CHAT.dmHeaderSwatchSize,
        CHAT.dmHeaderSwatchSize,
        peer.color,
      )
      .setStrokeStyle(3, 0x0c0c14);
    this.tabContent.push(name, swatch);

    // Panel reutilizado: el envío va por `sendDirectMessage` (dm DIRIGIDO +
    // guardas de bloqueo/desconexión) y el input se bloquea si el hilo cayó.
    this.panel = new ChatPanel(this, {
      threadId: dmPeerId,
      store,
      sendOverride: (rawText) =>
        sendDirectMessage(
          store,
          { sendDm: (peerId, text) => this.chatClient?.sendDm(peerId, text) },
          dmPeerId,
          rawText,
          Date.now(),
        ),
      sendBlockedState: () =>
        dmBlockedSendState(store.isThreadDisconnected(dmPeerId), store.isBlocked(dmPeerId)),
      bus: getSessionEventBus(this.registry),
      onCancel: this.close,
    });
    store.markRead(dmPeerId);

    this.createDmButtons(peer);
  }

  /** Vuelve de un hilo de DM a la vista de lista de la tab PÚBLICO. */
  private backToPeerList(): void {
    this.dmPeer = null;
    this.destroyTabContent();
    this.destroyInviteBanner();
    this.setDmChromeVisible(false);
    this.renderPublicTab();
  }

  /**
   * Fila inferior del hilo de DM: VOLVER · BLOQUEAR/DESBLOQUEAR · INVITAR
   * (INVITAR solo si el lanzador pasó `inviteKeyword` y devuelve una palabra
   * de sala válida — solo el lobby en una sala activa puede invitar).
   */
  private createDmButtons(peer: AvailablePeer): void {
    const bus = getSessionEventBus(this.registry);
    // VOLVER — siempre.
    this.tabContent.push(
      new MenuButton(this, {
        x: CHAT.dmBackX,
        y: CHAT.dmButtonY,
        width: CHAT.dmButtonWidth,
        height: CHAT.dmButtonHeight,
        label: 'VOLVER',
        tint: 0x525868,
        fontSize: CHAT.dmButtonFontSize,
        bus,
        onPress: () => this.backToPeerList(),
      }),
    );
    // BLOQUEAR / DESBLOQUEAR — según el estado actual del store.
    const blocked = this.store?.isBlocked(peer.peerId) ?? false;
    this.tabContent.push(
      new MenuButton(this, {
        x: CHAT.dmBlockX,
        y: CHAT.dmButtonY,
        width: CHAT.dmButtonWidth,
        height: CHAT.dmButtonHeight,
        label: dmBlockButtonLabel(blocked),
        tint: blocked ? 0x3c6cd6 : 0xd63c3c,
        fontSize: CHAT.dmButtonFontSize,
        bus,
        onPress: () => this.toggleBlock(peer),
      }),
    );
    // INVITAR — solo con palabra de sala activa (lobby).
    const keyword = this.inviteKeyword?.() ?? null;
    if (keyword && isValidRoomWord(sanitizeRoomWord(keyword))) {
      this.tabContent.push(
        new MenuButton(this, {
          x: CHAT.dmInviteX,
          y: CHAT.dmButtonY,
          width: CHAT.dmButtonWidth,
          height: CHAT.dmButtonHeight,
          label: 'INVITAR',
          tint: 0x1d8f43,
          fontSize: CHAT.dmButtonFontSize,
          bus,
          onPress: () => this.sendInviteTo(peer, keyword),
        }),
      );
    }
  }

  /**
   * BLOQUEAR/DESBLOQUEAR al peer del hilo: corta la conversación en AMBOS
   * sentidos (sus mensajes se descartan al llegar, los míos no salen) y deja
   * el aviso de sistema en el hilo ("BLOQUEASTE A NOMBRE").
   */
  private toggleBlock(peer: AvailablePeer): void {
    const store = this.store;
    if (!store) {
      return;
    }
    if (store.isBlocked(peer.peerId)) {
      store.unblockPeer(peer.peerId);
      store.appendSystemMessage(peer.peerId, unblockedSystemNote(peer.name));
    } else {
      store.blockPeer(peer.peerId);
      store.appendSystemMessage(peer.peerId, blockedSystemNote(peer.name));
    }
    // Se recrea la fila de botones (label BLOQUEAR ↔ DESBLOQUEAR) sin tocar
    // el header ni el panel: el update() del overlay refresca el historial.
    this.destroyDmButtons();
    this.createDmButtons(peer);
    this.panel?.refresh(Date.now());
  }

  /** Destruye SOLO los botones de la fila del hilo de DM (VOLVER/BLOQUEAR/INVITAR). */
  private destroyDmButtons(): void {
    // Los botones de DM son los últimos objetos agregados a tabContent tras
    // el header; se marcan destruyéndolos y filtrando el array.
    const remaining: Array<{ destroy(): void }> = [];
    for (const object of this.tabContent) {
      if (object instanceof MenuButton) {
        object.destroy();
      } else {
        remaining.push(object);
      }
    }
    this.tabContent = remaining;
  }

  /** INVITAR: difunde la invitación DIRIGIDA y deja nota de sistema. */
  private sendInviteTo(peer: AvailablePeer, keyword: string): void {
    const word = sanitizeRoomWord(keyword);
    if (!isValidRoomWord(word)) {
      return;
    }
    this.chatClient?.sendInvite(peer.peerId, word);
    this.store?.appendSystemMessage(peer.peerId, invitedSystemNote(peer.name, word));
    this.panel?.refresh(Date.now());
  }

  /* ---------------------------------------------------------------- */
  /* C3 — banner de invitación (vista de lista)                        */
  /* ---------------------------------------------------------------- */

  /**
   * Pinta el banner de la invitación pendiente (texto en la línea de detalle
   * + UNIRSE / IGNORAR). Sin invitación pendiente no pinta nada.
   */
  private renderInviteBanner(): void {
    if (this.activeTab !== 'public' || this.dmPeer) {
      return;
    }
    this.destroyInviteBanner();
    const invite = this.social?.getLatestInvite() ?? null;
    if (!invite) {
      return;
    }
    const bus = getSessionEventBus(this.registry);
    this.renderPeerDetail({
      text: inviteBannerText(invite.from.name, invite.keyword),
      color: INVITE_BANNER_COLOR,
    });
    this.inviteObjects.push(
      new MenuButton(this, {
        x: CHAT.inviteJoinX,
        y: CHAT.inviteButtonY,
        width: CHAT.inviteButtonWidth,
        height: CHAT.inviteButtonHeight,
        label: 'UNIRSE',
        tint: 0x1d8f43,
        fontSize: CHAT.inviteButtonFontSize,
        bus,
        onPress: () => this.joinFromInvite(invite.keyword),
      }),
      new MenuButton(this, {
        x: CHAT.inviteDismissX,
        y: CHAT.inviteButtonY,
        width: CHAT.inviteButtonWidth,
        height: CHAT.inviteButtonHeight,
        label: 'IGNORAR',
        tint: 0x525868,
        fontSize: CHAT.inviteButtonFontSize,
        bus,
        onPress: () => {
          this.social?.clearLatestInvite();
          this.destroyInviteBanner();
          this.renderPeerDetail({ text: '', color: '#9aa0a8' });
        },
      }),
    );
  }

  /** Destruye los botones del banner de invitación (el texto vive en el detalle). */
  private destroyInviteBanner(): void {
    for (const object of this.inviteObjects) {
      object.destroy();
    }
    this.inviteObjects = [];
  }

  /**
   * UNIRSE de una invitación: resuelve el destino con `inviteJoinTarget`
   * (pura: palabra inválida → ni se navega), descarta la invitación y arranca
   * el flujo UNIRSE de #1 con la palabra PRECARGADA. Cierra el overlay y las
   * escenas base que pudieran quedar debajo (patrón MENÚ de PauseScene), así
   * el lobby arranca limpio sin botones atravesados.
   */
  private joinFromInvite(keyword: string): void {
    const profileName = getPlayerProfileRepository(this.registry).load().name;
    const target = inviteJoinTarget(keyword, profileName);
    if (!target) {
      return;
    }
    this.social?.clearLatestInvite();
    if (this.scene.isActive(MenuScene.KEY)) {
      this.scene.stop(MenuScene.KEY);
    }
    if (this.scene.isActive(GameScene.KEY)) {
      this.scene.stop(GameScene.KEY);
    }
    // scene.start apaga ESTE overlay y arranca el lobby (si había un lobby
    // vivo debajo, se apaga con su limpieza de sala y arranca de nuevo).
    this.scene.start(LobbyScene.KEY, {
      mode: target.mode,
      name: target.name.length > 0 ? target.name : undefined,
      keyword: target.keyword,
    });
  }
}
