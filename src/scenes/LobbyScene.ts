/**
 * LobbyScene — sala multijugador (M1 — Trystero + lobby).
 *
 * Dos modos vía init data (`{mode:'create', name}` / `{mode:'join', name}`):
 *
 * - CREAR: genera y muestra la PALABRA de sala en grande (es el roomId de
 *   Trystero), roster en vivo (nombre + color derivado) y botón INICIAR —
 *   solo lo ve el anfitrión (incluido un joiner que heredó el mando por
 *   migración) y se habilita con 2+ jugadores. SALIR vuelve al menú.
 * - UNIRSE: input DOM de palabra + ENTRAR; feedback de sala llena
 *   (roomFull) y de errores de red/appId visibles, nunca conexiones en
 *   silencio. Dentro: roster en vivo + "ESPERANDO AL ANFITRIÓN…".
 *
 * Al recibir `start {seed, players, startAt}` arranca la carrera multi:
 * `scene.start(Game, {mode:'multi', seed, players, myPeerId, roomWord})` —
 * cada cliente corre su countdown 3-2-1 y la pista determinista de M0.
 *
 * C1 (issue #2) — chat de SALA: dentro de la sala aparece el botón CHAT que
 * lanza el overlay `ChatScene` (tab SALA) sobre el hilo `room` del ChatStore
 * de sesión. El lobby alimenta el store con los `chat` que llegan por la
 * malla y difunde los envíos del overlay; cerrar el chat NO toca la sala (la
 * carrera activa no tiene chat — decisión cerrada del issue).
 *
 * El nombre se pidió ANTES en el menú (persistido en el
 * PlayerProfileRepository); si llegara vacío (arranque en caliente), la
 * escena pide un input de nombre defensivo antes de conectar.
 *
 * Es un SHELL FINO de UI sobre `NetClient`: toda la lógica de sala vive en
 * TrysteroNetClient/lobbyState (testeados aparte); esta escena solo orquesta
 * y pinta, por eso no tiene tests de escena.
 */

import Phaser from 'phaser';
import { LOBBY, MENU, MULTIPLAYER, TRACK } from '../config/balance';
import { ChatStore, ROOM_THREAD_ID } from '../chat/ChatStore';
import { ensureSessionChatStore } from '../chat/chatSession';
import { receiveRoomChat } from '../chat/roomChat';
import { getSessionEventBus } from '../core/EventBus';
import { getPlayerProfileRepository } from '../data/PlayerProfileRepository';
import {
  isValidRoomWord,
  parseRaceInit,
  sanitizePlayerName,
  sanitizeRoomWord,
  type GameMode,
  type PlayerInfo,
  type StartPayload,
} from '../net/protocol';
import type { NetClient } from '../net/NetClient';
import { handoffNetClient } from '../net/netClientSession';
import { randomRoomSeed } from '../net/roomRng';
import { resolveAppId, TrysteroNetClient } from '../net/TrysteroNetClient';
import { buildTrackPath, getTrackById, TRACKS, type TrackId } from '../race/tracks';
import { trackEvent } from '../telemetry/analytics';
import { TEXTURE_KEYS } from '../systems/TextureFactory';
import { applyMobileInputAttributes } from '../ui/ChatPanel';
import { TrackThumb } from '../ui/TrackThumb';
import { ChatScene } from './ChatScene';
import { GameScene } from './GameScene';
import { MenuScene } from './MenuScene';
import { RaceScene } from './RaceScene';
import { MenuButton } from '../ui/MenuButton';

/** Estilos monospace del repo. */
const TITLE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '64px',
  color: '#f2f2f2',
};

const WORD_LABEL_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '28px',
  color: '#9aa0a8',
};

const WORD_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: `${LOBBY.wordFontSize}px`,
  color: '#f7c531',
};

const ROSTER_LABEL_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '30px',
  color: '#9aa0a8',
};

const STATUS_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: `${LOBBY.statusFontSize}px`,
  color: '#9aa0a8',
};

/** Input DOM de la palabra de sala. */
const WORD_INPUT_CSS = {
  'font-family': 'monospace',
  'font-size': `${LOBBY.inputFontSize}px`,
  width: `${LOBBY.inputWidth}px`,
  height: `${LOBBY.inputHeight}px`,
  'text-align': 'center',
  'text-transform': 'uppercase',
  'letter-spacing': '8px',
  color: '#f2f2f2',
  'background-color': '#0c0c14',
  border: '4px solid #3a3a44',
  'border-radius': '8px',
  outline: 'none',
  'pointer-events': 'auto',
};

/** Init data que MenuScene le pasa a LobbyScene. */
export interface LobbySceneData {
  readonly mode: 'create' | 'join';
  readonly name?: string;
  /**
   * C3 — palabra de sala PRECARGADA (invitación aceptada): si llega, el
   * input de UNIRSE arranca con este valor.
   */
  readonly keyword?: string;
}

/** Parseo defensivo del init data (Phaser lo propaga como unknown). */
function parseLobbyData(raw: unknown): LobbySceneData {
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const mode = record.mode === 'join' ? 'join' : 'create';
  const name = typeof record.name === 'string' ? record.name : undefined;
  const keyword = typeof record.keyword === 'string' ? record.keyword : undefined;
  return { mode, name, keyword };
}

export class LobbyScene extends Phaser.Scene {
  static readonly KEY = 'Lobby';

  private lobbyData: LobbySceneData = { mode: 'create' };
  private client: NetClient | null = null;
  private appId = '';
  private playerName = '';
  /** C3 — palabra precargada del flujo UNIRSE (invitación aceptada). */
  private joinKeyword = '';
  /** true una vez que la escena entró a una sala (create o join exitoso). */
  private joined = false;
  /**
   * M2 — true al arrancar la carrera: la propiedad del NetClient pasa a
   * GameScene (handoff por registry), así que el SHUTDOWN del lobby ya NO
   * debe destruirlo.
   */
  private handedOff = false;
  private road!: Phaser.GameObjects.TileSprite;

  /* Widgets vivos (se recrean/actualizan por evento). */
  private wordText!: Phaser.GameObjects.Text;
  private wordLabel!: Phaser.GameObjects.Text;
  private rosterLabel!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private rosterRows: Phaser.GameObjects.GameObject[] = [];
  private wordInput: Phaser.GameObjects.DOMElement | null = null;
  private nameInput: Phaser.GameObjects.DOMElement | null = null;
  private startButton: MenuButton | null = null;
  private enterButton: MenuButton | null = null;

  /* C1 (issue #2) — chat de sala. */
  /** Store de la sesión (compartido con el overlay por `chatSession`). */
  private chatStore: ChatStore | null = null;
  /** Botón CHAT (solo DENTRO de la sala; la carrera no tiene chat). */
  private chatButton: MenuButton | null = null;
  /** Desuscripción de `onChat` del NetClient (limpia en SHUTDOWN). */
  private unsubscribeChat: (() => void) | null = null;

  /* V2 (issue #9) — MODO y PISTA del anfitrión. El `start` viaja extendido
   * (gameMode + trackId); los invitados conocen la elección al arrancar (el
   * lobby no difunde estado, igual que #1). La fila de controles es visible
   * SOLO para el anfitrión (incluido el migrado). */
  /** Modo elegido por el anfitrión (default: BATALLA, compatibilidad #1). */
  private gameMode: GameMode = 'battle';
  /** Pista elegida (sólo con sentido en CARRERA; default MÓNACO). */
  private selectedTrackId: TrackId = TRACKS[0].id;
  private battleChip: MenuButton | null = null;
  private raceChip: MenuButton | null = null;
  private trackButton: MenuButton | null = null;
  /** Overlay del picker de pistas (miniaturas TrackThumb). */
  private trackOverlay: Phaser.GameObjects.Container | null = null;

  constructor() {
    super(LobbyScene.KEY);
  }

  init(data: unknown): void {
    this.lobbyData = parseLobbyData(data);
    this.playerName = sanitizePlayerName(this.lobbyData.name ?? '');
    // C3 — invitación aceptada: la palabra viaja sanitizada (el input la
    // muestra y ENTRAR la valida de nuevo — flujo de unirse de #1 intacto).
    this.joinKeyword = sanitizeRoomWord(this.lobbyData.keyword ?? '');
    this.joined = false;
    this.handedOff = false;
    // V2 — el modo/pista del anfitrión arranca en el default (BATALLA) en
    // cada lobby nuevo; los widgets se (re)crean al entrar a la sala.
    this.gameMode = 'battle';
    this.selectedTrackId = TRACKS[0].id;
    this.battleChip = null;
    this.raceChip = null;
    this.trackButton = null;
    this.trackOverlay = null;
  }

  create(): void {
    const { width, height } = this.scale;
    const centerX = width / 2;
    const bus = getSessionEventBus(this.registry);
    this.cameras.main.setBackgroundColor('#000000');

    // Fondo: la misma pista scrolleando del menú bajo el velo.
    this.road = this.add.tileSprite(centerX, height / 2, width, height, TEXTURE_KEYS.roadTile);
    this.add.rectangle(centerX, height / 2, width, height, 0x000000, 0.7);

    this.add
      .text(centerX, LOBBY.titleY, this.lobbyData.mode === 'create' ? 'CREAR SALA' : 'UNIRSE', TITLE_STYLE)
      .setOrigin(0.5)
      .setStroke('#0c0c14', 10);
    this.wordLabel = this.add
      .text(centerX, LOBBY.wordLabelY, 'PALABRA DE SALA', WORD_LABEL_STYLE)
      .setOrigin(0.5);
    this.wordText = this.add
      .text(centerX, LOBBY.wordY, '', WORD_STYLE)
      .setOrigin(0.5)
      .setStroke('#0c0c14', 8)
      .setVisible(false);
    this.rosterLabel = this.add
      .text(centerX, LOBBY.rosterLabelY, `JUGADORES 0/${MULTIPLAYER.maxPlayers}`, ROSTER_LABEL_STYLE)
      .setOrigin(0.5);
    this.statusText = this.add.text(centerX, LOBBY.statusY, '', STATUS_STYLE).setOrigin(0.5);

    // Botones: SALIR siempre; INICIAR (host) o ENTRAR (join) según modo.
    new MenuButton(this, {
      x: LOBBY.exitX,
      y: LOBBY.buttonY,
      width: LOBBY.buttonWidth,
      height: LOBBY.buttonHeight,
      label: 'SALIR',
      tint: 0x3c6cd6,
      fontSize: LOBBY.buttonFontSize,
      bus,
      onPress: () => this.exitToMenu(),
    });

    // Fail-fast del appId: sin VITE_TRYSTERO_APP_ID no hay matchmaking; el
    // error se muestra en pantalla en vez de conectar en silencio.
    try {
      this.appId = resolveAppId();
    } catch (error) {
      this.setStatus(String(error instanceof Error ? error.message : error), '#d63c3c');
      return;
    }

    this.client = new TrysteroNetClient();
    this.client.onError((message) => this.setStatus(message, '#d63c3c'));
    this.client.onRoomFull(() => {
      this.joined = false;
      this.wordText.setVisible(false);
      this.closeChatEntry();
      this.showWordInput();
      this.setStatus(`SALA LLENA (${MULTIPLAYER.maxPlayers}/${MULTIPLAYER.maxPlayers})`, '#d63c3c');
    });
    this.client.onRosterChange((roster) => this.renderRoster(roster));
    this.client.onHostChange(() => this.syncStartButton());
    this.client.onStart((payload) => this.startRace(payload));

    // C1 — chat de sala: los mensajes que llegan por la malla entran al store
    // de la sesión (el overlay los lee de ahí, abierto o cerrado). El
    // remitente se resuelve contra el roster LOCAL (wire = solo texto).
    this.unsubscribeChat = this.client.onChat((fromPeerId, payload) => {
      if (!this.chatStore || !this.client) {
        return;
      }
      receiveRoomChat(this.chatStore, this.client.getRoster(), fromPeerId, payload, Date.now());
    });

    if (this.playerName.length === 0) {
      // Arranque defensivo sin nombre (el flujo normal lo pide en el menú).
      this.showNameInput();
      return;
    }

    if (this.lobbyData.mode === 'create') {
      this.createRoom();
    } else {
      this.showWordInput();
      this.setStatus('INGRESÁ LA PALABRA DE LA SALA');
    }

    // Al apagarse la escena (SALIR o restart) el cliente se destruye: sale
    // de la sala y limpia todos los handlers. EXCEPCIÓN (M2): si la carrera
    // ya arrancó, la propiedad pasó a GameScene por registry (handoff) y el
    // dueño nuevo lo destruye en su propio shutdown.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      // El overlay de chat muere con el lobby (p. ej. llegó `start` con el
      // chat abierto): su propio shutdown destruye el panel y restaura la
      // captura de teclado del juego.
      this.scene.stop(ChatScene.KEY);
      this.unsubscribeChat?.();
      this.unsubscribeChat = null;
      if (this.handedOff) {
        // La sala SIGUE VIVA en la carrera: el store queda publicado para
        // el modo espectador (C3 lee/escribe el hilo room desde GameScene).
        this.client = null;
        return;
      }
      // La sala murió con el lobby: SOLO muere su hilo `room` — el store de
      // sesión (C3) sigue publicado con los DM, sus no leídos y los bloqueos
      // (el chat social es de la PESTAÑA, no de la partida). El cliente de
      // red sí se destruye: la próxima sala arranca con transporte fresco.
      this.chatStore?.clearThread(ROOM_THREAD_ID);
      this.chatStore = null;
      this.chatButton = null;
      this.client?.destroy();
      this.client = null;
    });
  }

  /* ---------------------------------------------------------------- */
  /* Entrada a la sala                                                 */
  /* ---------------------------------------------------------------- */

  /** Modo CREAR: palabra aleatoria + meta de anfitrión. */
  private createRoom(): void {
    const client = this.requireClient();
    client.create({ appId: this.appId, name: this.playerName });
    this.joined = true;
    this.openChatEntry();
    const word = client.roomWord ?? '';
    this.wordInput?.destroy();
    this.wordInput = null;
    this.wordText.setText(word).setVisible(true);
    this.wordLabel.setVisible(true);
    this.createStartButton();
    this.setStatus('COMPARTÍ LA PALABRA PARA INVITAR JUGADORES');
    this.syncStartButton();
  }

  /** Modo UNIRSE: input de palabra + ENTRAR. */
  private showWordInput(): void {
    // Si había un INICIAR (p. ej. tras sala llena), se esconde hasta re-entrar.
    this.startButton?.container.setVisible(false);
    this.wordLabel.setVisible(true);
    this.wordInput?.destroy();
    this.wordInput = this.add.dom(
      this.scale.width / 2,
      LOBBY.wordY,
      'input',
      WORD_INPUT_CSS,
    ) as Phaser.GameObjects.DOMElement;
    const node = this.wordInput.node as HTMLInputElement;
    applyMobileInputAttributes(node, 'roomWord');
    node.placeholder = 'PALABRA';
    // C3 — invitación aceptada: la palabra llega PRECARGADA y el jugador
    // confirma con ENTRAR (mismo flujo de unirse de #1, sin atajos).
    if (this.joinKeyword.length > 0) {
      node.value = this.joinKeyword;
    }
    this.wordInput.setOrigin(0.5);

    this.enterButton?.destroy();
    this.enterButton = new MenuButton(this, {
      x: LOBBY.primaryX,
      y: LOBBY.buttonY,
      width: LOBBY.buttonWidth,
      height: LOBBY.buttonHeight,
      label: 'ENTRAR',
      tint: 0x1d8f43,
      fontSize: LOBBY.buttonFontSize,
      bus: getSessionEventBus(this.registry),
      onPress: () => this.tryJoin(),
    });
  }

  /** ENTRAR: valida palabra y nombre, y se une a la sala. */
  private tryJoin(): void {
    const client = this.requireClient();
    const word = sanitizeRoomWord(this.readInput(this.wordInput));
    const name = this.playerName.length > 0 ? this.playerName : sanitizePlayerName(this.readInput(this.nameInput));
    if (name.length === 0) {
      this.setStatus('INGRESÁ TU NOMBRE', '#d63c3c');
      return;
    }
    if (!isValidRoomWord(word)) {
      this.setStatus(`PALABRA INVÁLIDA (${MULTIPLAYER.roomWordMinLength}-${MULTIPLAYER.roomWordMaxLength} LETRAS A-Z)`, '#d63c3c');
      return;
    }
    this.playerName = name;
    getPlayerProfileRepository(this.registry).save({ name });
    client.join({ appId: this.appId, roomWord: word, name });
    this.joined = true;
    this.openChatEntry();
    this.enterButton?.destroy();
    this.enterButton = null;
    this.wordInput?.destroy();
    this.wordInput = null;
    this.wordText.setText(word).setVisible(true);
    this.setStatus('BUSCANDO SALA…');
    // El botón INICIAR también existe en modo unirse: si el creador se va y
    // la migración me hace anfitrión, yo decido cuándo arrancar.
    this.createStartButton();
    this.syncStartButton();
  }

  /** Input de nombre defensivo (flujo normal: el menú ya lo pidió). */
  private showNameInput(): void {
    this.nameInput = this.add.dom(
      this.scale.width / 2,
      LOBBY.wordY - 140,
      'input',
      WORD_INPUT_CSS,
    ) as Phaser.GameObjects.DOMElement;
    const node = this.nameInput.node as HTMLInputElement;
    applyMobileInputAttributes(node, 'name');
    node.placeholder = 'TU NOMBRE';
    this.nameInput.setOrigin(0.5);

    const confirm = new MenuButton(this, {
      x: LOBBY.primaryX,
      y: LOBBY.buttonY,
      width: LOBBY.buttonWidth,
      height: LOBBY.buttonHeight,
      label: 'CONTINUAR',
      tint: 0x1d8f43,
      fontSize: LOBBY.buttonFontSize,
      bus: getSessionEventBus(this.registry),
      onPress: () => {
        const name = sanitizePlayerName(this.readInput(this.nameInput));
        if (name.length === 0) {
          this.setStatus('INGRESÁ TU NOMBRE', '#d63c3c');
          return;
        }
        this.playerName = name;
        getPlayerProfileRepository(this.registry).save({ name });
        this.nameInput?.destroy();
        this.nameInput = null;
        confirm.destroy();
        if (this.lobbyData.mode === 'create') {
          this.createRoom();
        } else {
          this.showWordInput();
          this.setStatus('INGRESÁ LA PALABRA DE LA SALA');
        }
      },
    });
  }

  /* ---------------------------------------------------------------- */
  /* Roster e inicio                                                   */
  /* ---------------------------------------------------------------- */

  /** Pinta el roster (nombre + swatch de color) y habilita INICIAR. */
  private renderRoster(roster: PlayerInfo[]): void {
    // M4 — colisión de palabra: si el cliente regeneró la sala durante la
    // ventana de asentamiento, la palabra en pantalla puede quedar vieja;
    // se re-sincroniza con cada roster (roomWord === palabra vigente).
    if (this.wordText.visible) {
      this.wordText.setText(this.client?.roomWord ?? this.wordText.text);
    }
    // C1 — la identidad propia del chat sigue al roster (nombre/color pueden
    // cambiar al entrar/salir jugadores) sin perder los mensajes.
    const chatSelf = roster.find((player) => player.peerId === this.client?.selfPeerId);
    if (chatSelf) {
      this.chatStore?.updateSelf(chatSelf);
    }
    for (const row of this.rosterRows) {
      row.destroy();
    }
    this.rosterRows = [];
    this.rosterLabel.setText(`JUGADORES ${roster.length}/${MULTIPLAYER.maxPlayers}`);

    const centerX = this.scale.width / 2;
    roster.forEach((player, index) => {
      const y = LOBBY.rosterStartY + index * LOBBY.rosterLineHeight;
      const swatch = this.add
        .rectangle(
          centerX - 150,
          y,
          LOBBY.swatchSize,
          LOBBY.swatchSize,
          player.color,
        )
        .setStrokeStyle(3, 0x0c0c14);
      const label = this.add
        .text(centerX - 110, y, player.name, {
          fontFamily: 'monospace',
          fontSize: `${LOBBY.rosterFontSize}px`,
          color: '#f2f2f2',
        })
        .setOrigin(0, 0.5);
      this.rosterRows.push(swatch, label);
    });

    if (this.joined && roster.length > 1) {
      this.setStatus(
        this.client?.isHost() ? 'LISTO PARA INICIAR' : 'ESPERANDO AL ANFITRIÓN…',
      );
    }
    this.syncStartButton();
  }

  /** Crea el botón INICIAR (lo ve solo el anfitrión, también migrado). */
  private createStartButton(): void {
    this.startButton?.destroy();
    this.startButton = new MenuButton(this, {
      x: LOBBY.primaryX,
      y: LOBBY.buttonY,
      width: LOBBY.buttonWidth,
      height: LOBBY.buttonHeight,
      label: 'INICIAR',
      tint: 0x1d8f43,
      fontSize: LOBBY.buttonFontSize,
      bus: getSessionEventBus(this.registry),
      onPress: () => this.tryStart(),
    });
    this.startButton.container.setVisible(false);
  }

  /** Visibilidad/habilitado de INICIAR según anfitrión y cantidad. */
  private syncStartButton(): void {
    if (!this.startButton || !this.client) {
      return;
    }
    const isHost = this.client.isHost();
    const rosterSize = this.client.getRoster().length;
    const ready = isHost && rosterSize >= MULTIPLAYER.minPlayersToStart;
    this.startButton.container.setVisible(isHost);
    this.startButton.container.setAlpha(ready ? 1 : 0.45);
    // V2 — la fila de modo comparte la visibilidad del INICIAR (host only).
    this.syncModeControls();
  }

  /* ---------------------------------------------------------------- */
  /* V2 — MODO (BATALLA/CARRERA) y PISTA del anfitrión                  */
  /* ---------------------------------------------------------------- */

  /** Crea (una vez) la fila de controles de modo: chips + botón de pista. */
  private createModeControls(): void {
    if (this.battleChip) {
      return;
    }
    const bus = getSessionEventBus(this.registry);
    this.battleChip = new MenuButton(this, {
      x: LOBBY.battleChipX,
      y: LOBBY.modeRowY,
      width: LOBBY.modeChipWidth,
      height: LOBBY.modeChipHeight,
      label: 'BATALLA',
      tint: 0x3c6cd6,
      fontSize: LOBBY.modeChipFontSize,
      bus,
      onPress: () => this.setGameMode('battle'),
    });
    this.raceChip = new MenuButton(this, {
      x: LOBBY.raceChipX,
      y: LOBBY.modeRowY,
      width: LOBBY.modeChipWidth,
      height: LOBBY.modeChipHeight,
      label: 'CARRERA',
      tint: 0xb04ee0,
      fontSize: LOBBY.modeChipFontSize,
      bus,
      onPress: () => this.setGameMode('race'),
    });
    this.trackButton = new MenuButton(this, {
      x: LOBBY.trackButtonX,
      y: LOBBY.modeRowY,
      width: LOBBY.trackButtonWidth,
      height: LOBBY.trackButtonHeight,
      label: this.trackButtonLabel(),
      tint: 0x1d8f43,
      fontSize: LOBBY.trackButtonFontSize,
      bus,
      onPress: () => this.openTrackPicker(),
    });
    this.syncModeControls();
  }

  /** Etiqueta del botón de pista con la elegida (o default). */
  private trackButtonLabel(): string {
    return `PISTA: ${getTrackById(this.selectedTrackId)?.name ?? ''}`;
  }

  /** Elección de modo: realza el chip activo y muestra/oculta la pista. */
  private setGameMode(mode: GameMode): void {
    this.gameMode = mode;
    this.battleChip?.container.setAlpha(mode === 'battle' ? 1 : 0.45);
    this.raceChip?.container.setAlpha(mode === 'race' ? 1 : 0.45);
    this.trackButton?.container.setVisible(mode === 'race');
    this.setStatus(
      mode === 'race'
        ? `CARRERA — ${getTrackById(this.selectedTrackId)?.name ?? ''}`
        : 'BATALLA — ÚLTIMO EN PIE',
    );
  }

  /** Visibilidad de la fila de modo: SOLO el anfitrión la ve/gobierna. */
  private syncModeControls(): void {
    this.createModeControls();
    const visible = this.joined && (this.client?.isHost() ?? false);
    this.battleChip?.container.setVisible(visible);
    this.raceChip?.container.setVisible(visible);
    this.trackButton?.container.setVisible(visible && this.gameMode === 'race');
  }

  /** Picker de pistas: overlay con UNA miniatura TrackThumb por pista. */
  private openTrackPicker(): void {
    if (this.trackOverlay) {
      return;
    }
    const centerX = this.scale.width / 2;
    const bus = getSessionEventBus(this.registry);

    const overlay = this.add.container(0, 0).setDepth(100);
    const dim = this.add
      .rectangle(centerX, this.scale.height / 2, this.scale.width, this.scale.height, 0x000000, 0.86)
      .setInteractive();
    dim.on(
      'pointerdown',
      (
        _pointer: Phaser.Input.Pointer,
        _x: number,
        _y: number,
        event: Phaser.Types.Input.EventData,
      ) => {
        event.stopPropagation();
      },
    );
    const panel = this.add
      .rectangle(centerX, LOBBY.trackPanelY, LOBBY.trackPanelWidth, LOBBY.trackPanelHeight, 0x14141c)
      .setStrokeStyle(6, 0x3a3a44);
    overlay.add([dim, panel]);
    overlay.add(
      this.add
        .text(centerX, LOBBY.trackTitleY, 'ELEGÍ PISTA', {
          fontFamily: 'monospace',
          fontSize: '56px',
          color: '#f2f2f2',
        })
        .setOrigin(0.5)
        .setStroke('#0c0c14', 8),
    );

    // Una fila por pista: miniatura del trazado (TrackPath a escala, la
    // misma matemática del minimapa) + botón con el nombre.
    TRACKS.forEach((track, index) => {
      const y = LOBBY.trackRowStartY + index * LOBBY.trackRowStep;
      const row = this.add.container(0, 0);
      row.add(
        new TrackThumb(this, buildTrackPath(track), {
          x: LOBBY.trackThumbX,
          y,
          size: LOBBY.trackThumbSize,
          depth: 1,
        }).container,
      );
      row.add(
        new MenuButton(this, {
          x: LOBBY.trackRowButtonX,
          y,
          width: LOBBY.trackRowButtonWidth,
          height: LOBBY.trackRowButtonHeight,
          label: track.name,
          tint: 0x3c6cd6,
          fontSize: LOBBY.trackRowButtonFontSize,
          bus,
          onPress: () => this.selectTrack(track.id),
        }).container,
      );
      overlay.add(row);
    });

    overlay.add(
      new MenuButton(this, {
        x: centerX,
        y: LOBBY.trackCloseY,
        width: LOBBY.trackCloseWidth,
        height: LOBBY.trackCloseHeight,
        label: 'CERRAR',
        tint: 0x525868,
        fontSize: 34,
        bus,
        onPress: () => this.closeTrackPicker(),
      }).container,
    );

    this.trackOverlay = overlay;
  }

  /** Elige pista, cierra el picker y repinta el botón de pista. */
  private selectTrack(trackId: TrackId): void {
    this.selectedTrackId = trackId;
    this.closeTrackPicker();
    this.trackButton?.setLabel(this.trackButtonLabel());
    this.setGameMode(this.gameMode);
  }

  private closeTrackPicker(): void {
    this.trackOverlay?.destroy();
    this.trackOverlay = null;
  }

  /** INICIAR: el anfitrión difunde start y arranca SU carrera local. */
  private tryStart(): void {
    const client = this.requireClient();
    const roster = client.getRoster();
    if (!client.isHost() || roster.length < MULTIPLAYER.minPlayersToStart) {
      this.setStatus(`SE NECESITAN ${MULTIPLAYER.minPlayersToStart}+ JUGADORES`, '#d63c3c');
      return;
    }
    // V2 — el start viaja extendido con el modo (y la pista en CARRERA).
    // Campos AUSENTES en batalla: un receptor viejo degrada a batalla igual.
    const payload: StartPayload = {
      seed: randomRoomSeed(),
      players: roster,
      startAt: Date.now(),
      gameMode: this.gameMode,
      ...(this.gameMode === 'race' ? { trackId: this.selectedTrackId } : {}),
    };
    client.start(payload);
    this.startRace(payload);
  }

  /**
   * `start` recibido (o propio): decide la escena según el MODO extendido.
   * CARRERA → RaceScene (`mode:'race'` con seed/roster/pista); BATALLA o
   * start viejo sin `gameMode` → GameScene (flujo de #1 intacto). El
   * parseo defensivo (`parseRaceInit`) garantiza la degradación.
   */
  private startRace(payload: StartPayload): void {
    // M2 — handoff del NetClient: la carrera es la nueva dueña del transporte
    // (difunde state/eliminated/match-over o rstate/rfin/race-over). Este
    // SHUTDOWN ya no lo destruye.
    if (this.client) {
      handoffNetClient(this.registry, this.client);
      this.handedOff = true;
    }
    const raceInit = parseRaceInit(payload);
    if (raceInit?.gameMode === 'race' && raceInit.trackId) {
      // Issue #27 — telemetría (fire-and-forget, sin PII): en CARRERA cada
      // cliente reporta SU arranque local (una emisión por cliente: lo corre
      // el anfitrión vía tryStart y cada invitado vía onStart). La pista es
      // el TrackId elegido por el anfitrión; NUNCA viajan nombres, peerIds
      // ni presencia (esos viven en el payload y no se tocan acá).
      trackEvent('partida_iniciada', { modo: 'multijugador', pista: raceInit.trackId });
      this.scene.start(RaceScene.KEY, {
        mode: 'race',
        trackId: raceInit.trackId,
        seed: raceInit.seed,
        players: raceInit.players,
        myPeerId: this.client?.selfPeerId ?? '',
        roomWord: this.client?.roomWord ?? '',
      });
      return;
    }
    // Issue #27 — BATALLA (o start viejo sin `gameMode` degradado): sin
    // circuito, la property `pista` se OMITE (ni null ni undefined: no está
    // en el objeto, PostHog no necesita la key ausente).
    trackEvent('partida_iniciada', { modo: 'multijugador' });
    this.scene.start(GameScene.KEY, {
      mode: 'multi',
      seed: payload.seed,
      players: payload.players,
      myPeerId: this.client?.selfPeerId ?? '',
      roomWord: this.client?.roomWord ?? '',
    });
  }

  /* ---------------------------------------------------------------- */
  /* C1 — chat de sala (store de sesión + botón + overlay)              */
  /* ---------------------------------------------------------------- */

  /**
   * Entrada a una sala con chat: asegura el ChatStore de la sesión (C3: lo
   * REUSA si la sesión social ya lo creó — menú/DM — refrescando su
   * identidad con el roster de la partida; los hilos de DM y los bloqueos
   * sobreviven a las partidas) y publica el botón CHAT.
   */
  private openChatEntry(): void {
    const client = this.requireClient();
    const self =
      client.getRoster().find((player) => player.peerId === client.selfPeerId) ??
      { peerId: client.selfPeerId, name: this.playerName, color: 0 };
    this.chatStore = ensureSessionChatStore(this.registry, self);
    this.createChatButton();
  }

  /**
   * Retira el chat al salir de la sala (SALIR, sala llena, re-entrada): muere
   * SOLO el hilo `room` de esta partida; el store de sesión (DM + bloqueos)
   * queda publicado para el chat social y el badge del menú (C3).
   */
  private closeChatEntry(): void {
    this.chatButton?.destroy();
    this.chatButton = null;
    this.chatStore?.clearThread(ROOM_THREAD_ID);
    this.chatStore = null;
  }

  /** Botón CHAT de la esquina superior derecha (solo existe dentro de la sala). */
  private createChatButton(): void {
    this.chatButton?.destroy();
    this.chatButton = new MenuButton(this, {
      x: LOBBY.chatButtonX,
      y: LOBBY.chatButtonY,
      width: LOBBY.chatButtonWidth,
      height: LOBBY.chatButtonHeight,
      label: 'CHAT',
      tint: 0xb04ee0,
      fontSize: LOBBY.chatButtonFontSize,
      bus: getSessionEventBus(this.registry),
      onPress: () => this.openChatOverlay(),
    });
  }

  /**
   * Abre el overlay de chat ENCIMA del lobby (patrón PauseScene: launch, sin
   * pausar nada). La escena NO está en el array de `gameConfig.ts` — se
   * registra on-demand la primera vez y queda disponible para la sesión. El
   * envío viaja como callback: el overlay nunca toca el NetClient, así que
   * cerrar el chat no rompe la sala. C2: se pide la tab SALA explícita.
   * C3: además pasa el proveedor de la palabra de sala activa — es lo que
   * habilita el botón INVITAR de los hilos de DM del overlay.
   */
  private openChatOverlay(): void {
    if (!this.chatStore) {
      return;
    }
    if (!this.scene.get(ChatScene.KEY)) {
      this.scene.add(ChatScene.KEY, ChatScene, false);
    }
    this.scene.launch(ChatScene.KEY, {
      thread: ROOM_THREAD_ID,
      tab: 'room',
      sendChat: (text: string) => this.client?.sendChat(text),
      inviteKeyword: () => (this.joined ? (this.client?.roomWord ?? null) : null),
    });
  }

  /* ---------------------------------------------------------------- */
  /* Utilidades                                                        */
  /* ---------------------------------------------------------------- */

  private exitToMenu(): void {
    this.scene.start(MenuScene.KEY);
  }

  private setStatus(message: string, color = '#9aa0a8'): void {
    this.statusText.setText(message).setColor(color);
  }

  private readInput(element: Phaser.GameObjects.DOMElement | null): string {
    if (!element) {
      return '';
    }
    return (element.node as HTMLInputElement).value ?? '';
  }

  private requireClient(): NetClient {
    if (!this.client) {
      throw new Error('LobbyScene: cliente de red no inicializado');
    }
    return this.client;
  }

  /** Scroll del fondo, igual que MenuScene (wrap por alto de tile). */
  override update(_time: number, delta: number): void {
    const scroll = MENU.roadScrollSpeed * (delta / 1000);
    this.road.tilePositionY = Phaser.Math.Wrap(
      this.road.tilePositionY - scroll,
      0,
      TRACK.tileHeight,
    );
  }
}
