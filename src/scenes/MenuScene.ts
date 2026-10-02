import Phaser from 'phaser';
import { getAudioEngine } from '../audio/AudioManager';
import { MUTE_BUTTON, MENU, TRACK } from '../config/balance';
import { prefersTouchControls } from '../core/device';
import { EventBus, getSessionEventBus, type GameEvents } from '../core/EventBus';
import { getSaveRepository } from '../data/LocalStorageSaveRepository';
import { getPlayerProfileRepository } from '../data/PlayerProfileRepository';
import { TRACKS, type TrackId } from '../race/tracks';
import { chatMenuButtonLabel } from '../chat/dmView';
import { getSocialChatSession } from '../chat/socialChatSession';
import { sanitizePlayerName } from '../net/protocol';
import { TEXTURE_KEYS } from '../systems/TextureFactory';
import { applyMobileInputAttributes } from '../ui/ChatPanel';
import { ChatScene } from './ChatScene';
import { GameScene } from './GameScene';
import { LobbyScene } from './LobbyScene';
import { RaceScene } from './RaceScene';
import { MenuButton } from '../ui/MenuButton';
import { MuteButton } from '../ui/MuteButton';

/** Estilos de texto de la pantalla (monospace, coherente con el resto). */
const TITLE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '96px',
  color: '#f2f2f2',
};

const SUBTITLE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '30px',
  color: '#9aa0a8',
};

const STAT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: `${MENU.statFontSize}px`,
  color: '#f2f2f2',
};

const HELP_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '24px',
  color: '#9aa0a8',
};

/** Etiqueta del botón fullscreen según el estado (Fase 7). */
const FS_LABEL_WINDOWED = 'PANTALLA COMPLETA';
const FS_LABEL_FULLSCREEN = 'VENTANA';

/**
 * Layout del overlay selector de pistas (V1, issue #9): panel centrado con
 * título, una fila por pista (botón con el nombre + hint del circuito real
 * que lo inspira) y CERRAR. Mismo patrón del overlay multijugador.
 */
const TRACK_PICKER = {
  /** Opacidad del velo oscuro sobre el menú (0–1). */
  dimAlpha: 0.86,
  /** Centro Y y tamaño del panel. */
  panelY: 700,
  panelWidth: 620,
  panelHeight: 950,
  /** Y del título ENTRENAR y del subtítulo (centros). */
  titleY: 300,
  subtitleY: 368,
  /** Filas de pistas: centro Y de la primera y paso entre filas. */
  rowStartY: 470,
  rowStep: 120,
  /** Tamaño del botón de cada fila. */
  rowWidth: 540,
  rowHeight: 84,
  /** Hint del circuito inspirador: hueco bajo el botón y fuente. */
  hintGap: 12,
  hintFontSize: 16,
  /** Botón CERRAR. */
  closeY: 1090,
  closeWidth: 300,
  closeHeight: 88,
} as const;

/** Input DOM del nombre multijugador (overlay simple sobre el menú). */
const NAME_INPUT_CSS = {
  'font-family': 'monospace',
  'font-size': '44px',
  width: '440px',
  height: '80px',
  'text-align': 'center',
  color: '#f2f2f2',
  'background-color': '#0c0c14',
  border: '4px solid #3a3a44',
  'border-radius': '8px',
  outline: 'none',
  'pointer-events': 'auto',
};

/**
 * MenuScene — pantalla principal (Fase 5).
 *
 * - Título pixel-art con estética 100% procedural: texto 8-bit con sombra
 *   dura + el auto del jugador horneado por TextureFactory. Cero assets.
 * - Fondo vivo: la pista del juego scrolleando lenta bajo un velo oscuro.
 * - Botón JUGAR grande (táctil + teclado Enter/Espacio).
 * - Récord y total de monedas del repositorio de guardado, resuelto del
 *   registry de Phaser (inyectado en Boot — inversión de dependencias).
 * - Ayuda de controles según dispositivo: teclas en desktop, botones del
 *   HUD táctil en móvil (detección: touch real = capacidad táctil fuera de
 *   un OS desktop; los laptops con pantalla táctil reportan ambas y en
 *   desktop mandan las teclas).
 * - Fase 7 — fullscreen opcional en desktop: botón en la esquina superior
 *   izquierda (espejo del mute) + tecla F. La etiqueta sigue al estado real
 *   vía los eventos ENTER/LEAVE_FULLSCREEN del ScaleManager.
 */
export class MenuScene extends Phaser.Scene {
  static readonly KEY = 'Menu';

  private road!: Phaser.GameObjects.TileSprite;
  private muteButton!: MuteButton;
  private fullscreenButton: MenuButton | null = null;
  /** C3 — botón CHAT con badge de no leídos de la sesión social. */
  private chatButton: MenuButton | null = null;
  /** Último label del badge (evita repintar el texto en cada frame). */
  private lastChatLabel = '';

  /* M1 — overlay multijugador (nombre + crear/unirse), null si cerrado. */
  private multiOverlay: Phaser.GameObjects.Container | null = null;
  private multiNameInput: Phaser.GameObjects.DOMElement | null = null;

  /* V1 (issue #9) — overlay del selector de pistas de ENTRENAR. */
  private trackOverlay: Phaser.GameObjects.Container | null = null;

  constructor() {
    super(MenuScene.KEY);
  }

  create(): void {
    const { width, height } = this.scale;
    const centerX = width / 2;
    // Bus de sesión (Fase 6): un solo canal para `ui-click` y `mute`.
    const bus = getSessionEventBus(this.registry);

    this.cameras.main.setBackgroundColor('#000000');

    // Fondo: pista scrolleando lenta + velo para que el texto respire.
    this.road = this.add.tileSprite(centerX, height / 2, width, height, TEXTURE_KEYS.roadTile);
    this.add.rectangle(centerX, height / 2, width, height, 0x000000, MENU.veilAlpha);

    // Título con sombra dura 8-bit (doble capa desplazada) + subtítulo.
    this.add
      .text(centerX + 6, MENU.titleY + 6, 'FORMULITA', TITLE_STYLE)
      .setOrigin(0.5)
      .setColor('#7a1f1f');
    this.add
      .text(centerX, MENU.titleY, 'FORMULITA', TITLE_STYLE)
      .setOrigin(0.5)
      .setStroke('#0c0c14', 10);
    this.add.text(centerX, MENU.subtitleY, 'GRAN PREMIO RETRO 8-BIT', SUBTITLE_STYLE).setOrigin(0.5);

    // Auto del jugador (textura procedural) con vaivén suave.
    const car = this.add
      .image(centerX, MENU.carY, TEXTURE_KEYS.playerCar)
      .setScale(MENU.carScale);
    this.tweens.add({
      targets: car,
      y: MENU.carY + 10,
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    });

    // Progreso persistido (repositorio resuelto del registry).
    const save = getSaveRepository(this.registry).load();
    this.add
      .text(centerX, MENU.recordY, `RÉCORD ${save.bestScore}`, STAT_STYLE)
      .setOrigin(0.5)
      .setColor('#f7c531');

    const coinsText = this.add
      .text(centerX, MENU.coinsY, `MONEDAS ${save.totalCoins}`, STAT_STYLE)
      .setOrigin(0.5);
    // Moneda pixel junto al contador (a la izquierda del texto).
    this.add.image(coinsText.x - coinsText.width / 2 - 30, MENU.coinsY, TEXTURE_KEYS.coin);

    // JUGAR: botón táctil grande + teclado (Enter / Espacio). El bus de
    // sesión inyectado hace que la activación emita `ui-click` (SFX).
    new MenuButton(this, {
      x: centerX,
      y: MENU.playY,
      width: MENU.playWidth,
      height: MENU.playHeight,
      label: 'JUGAR',
      tint: 0x1d8f43,
      fontSize: MENU.playFontSize,
      bus,
      onPress: this.startGame,
    });
    this.input.keyboard?.on('keydown-ENTER', this.startGame);
    this.input.keyboard?.on('keydown-SPACE', this.startGame);

    // M1 — MULTIJUGADOR: abre el overlay de nombre + crear/unirse (el flujo
    // pide el nombre UNA vez acá, persistido en PlayerProfileRepository, y
    // luego pasa a LobbyScene con el modo elegido).
    new MenuButton(this, {
      x: centerX,
      y: MENU.multiY,
      width: MENU.multiWidth,
      height: MENU.multiHeight,
      label: 'MULTIJUGADOR',
      tint: 0xb04ee0,
      fontSize: MENU.multiFontSize,
      bus,
      onPress: this.openMultiplayerOverlay,
    });

    // V1 (issue #9) — ENTRENAR: abre el selector de pistas y lanza la
    // RaceScene en modo práctica local (una persona, 3 vueltas, sin red).
    new MenuButton(this, {
      x: centerX,
      y: MENU.trainY,
      width: MENU.trainWidth,
      height: MENU.trainHeight,
      label: 'ENTRENAR',
      tint: 0x3c6cd6,
      fontSize: MENU.trainFontSize,
      bus,
      onPress: this.openTrackPicker,
    });

    // C2 (issue #2) — CHAT: abre el overlay social con la tab PÚBLICO por
    // default (en el menú no hay sala de partida: SALA llega deshabilitada).
    // El overlay NO está en gameConfig: se registra on-demand como en C1.
    // C3 — el label lleva el BADGE de no leídos de la sesión (sala + DMs):
    // la sesión social ya existe desde el Boot (eager, auditoría #2) y su
    // constructor aplicó el ajuste persistido — acá solo se lee el store.
    const social = getSocialChatSession(this.registry);
    this.lastChatLabel = chatMenuButtonLabel(social.store.totalUnread);
    this.chatButton = new MenuButton(this, {
      x: centerX,
      y: MENU.chatY,
      width: MENU.chatWidth,
      height: MENU.chatHeight,
      label: this.lastChatLabel,
      tint: 0xb04ee0,
      fontSize: MENU.chatFontSize,
      bus,
      onPress: this.openChatOverlay,
    });

    // Ayuda de controles y extras según el dispositivo. El fullscreen (Fase
    // 7) es OPCIONAL y solo desktop: en móvil el HUD táctil ya ocupa los
    // pulgares y el navegador maneja la pantalla completa a su manera.
    const isTouch = prefersTouchControls(this.game.device);
    this.createControlsHelp(centerX, isTouch);
    this.createMuteButton(width, bus);
    if (!isTouch) {
      this.createFullscreenButton(bus);
    }

    // El plugin de teclado se resetea al apagar la escena; el off explícito
    // es cinturón y suspenders contra restarts. El botón de mute desuscribe
    // su handler del bus en su destroy (el bus es de sesión, no se limpia).
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.off('keydown-ENTER', this.startGame);
      this.input.keyboard?.off('keydown-SPACE', this.startGame);
      this.input.keyboard?.off('keydown-F', this.toggleFullscreen);
      this.scale.off(Phaser.Scale.Events.ENTER_FULLSCREEN, this.syncFullscreenLabel);
      this.scale.off(Phaser.Scale.Events.LEAVE_FULLSCREEN, this.syncFullscreenLabel);
      this.muteButton.destroy();
    });
  }

  override update(_time: number, delta: number): void {
    const scroll = MENU.roadScrollSpeed * (delta / 1000);
    this.road.tilePositionY = Phaser.Math.Wrap(
      this.road.tilePositionY - scroll,
      0,
      TRACK.tileHeight,
    );
    // C3 — badge en vivo: los DM pueden llegar con el menú abierto (la sala
    // pública sigue viva detrás); el label solo se toca si cambió de verdad.
    const label = chatMenuButtonLabel(getSocialChatSession(this.registry).store.totalUnread);
    if (label !== this.lastChatLabel) {
      this.lastChatLabel = label;
      this.chatButton?.setLabel(label);
    }
  }

  /** Ayuda de controles según el dispositivo (táctil vs teclado). */
  private createControlsHelp(centerX: number, isTouch: boolean): void {
    const lines = isTouch
      ? ['DOBLA CON ◀ ▶', 'GAS ACELERA · BRK FRENA', 'TURBO Y DRS EN PANTALLA', 'BOTÓN II PAUSA']
      : [
          '←→ / A·D  DOBLAR  ·  ESPACIO  ACELERAR',
          'SHIFT  TURBO  ·  Z  FRENO  ·  X  DRS',
          'P  PAUSA  ·  F  PANTALLA COMPLETA',
          'ENTER O ESPACIO PARA JUGAR',
        ];

    const startY = MENU.helpY - ((lines.length - 1) * MENU.helpLineHeight) / 2;
    lines.forEach((line, index) => {
      this.add
        .text(centerX, startY + index * MENU.helpLineHeight, line, HELP_STYLE)
        .setOrigin(0.5);
    });
  }

  /**
   * Botón de mute (Fase 6) en la esquina superior derecha. El estado
   * inicial sale del motor de audio resuelto del registry (la escena
   * orquesta, la UI solo emite `mute` por el bus de sesión).
   */
  private createMuteButton(width: number, bus: EventBus<GameEvents>): void {
    const y = MUTE_BUTTON.margin + MUTE_BUTTON.size / 2;
    this.muteButton = new MuteButton(this, {
      x: width - MUTE_BUTTON.margin - MUTE_BUTTON.size / 2,
      y,
      bus,
      initiallyMuted: getAudioEngine(this.registry).isMuted,
    });
  }

  private readonly startGame = (): void => {
    // Con un overlay abierto (multijugador o selector de pistas), Enter/
    // Espacio son del input de ese overlay: no arrancan una carrera sola
    // atravesada.
    if (this.multiOverlay || this.trackOverlay) {
      return;
    }
    this.scene.start(GameScene.KEY);
  };

  /* ---------------------------------------------------------------- */
  /* M1 — overlay multijugador: nombre + crear/unirse                   */
  /* ---------------------------------------------------------------- */

  /**
   * Overlay DOM/Phaser sobre el menú: pide el nombre (una sola vez — se
   * precarga el guardado) y ofrece CREAR SALA / UNIRSE. La capa oscura es
   * interactiva y corta la propagación para que los botones de abajo no
   * disparen taps atravesados.
   */
  private readonly openMultiplayerOverlay = (): void => {
    if (this.multiOverlay) {
      return;
    }
    const centerX = this.scale.width / 2;
    const bus = getSessionEventBus(this.registry);
    const storedName = getPlayerProfileRepository(this.registry).load().name;

    const overlay = this.add.container(0, 0).setDepth(100);
    const dim = this.add
      .rectangle(centerX, this.scale.height / 2, this.scale.width, this.scale.height, 0x000000, 0.86)
      .setInteractive();
    dim.on('pointerdown', (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
    });
    const panel = this.add.rectangle(centerX, 660, 620, 820, 0x14141c).setStrokeStyle(6, 0x3a3a44);
    overlay.add([dim, panel]);

    overlay.add(
      this.add
        .text(centerX, 340, 'MULTIJUGADOR', {
          fontFamily: 'monospace',
          fontSize: '56px',
          color: '#f2f2f2',
        })
        .setOrigin(0.5)
        .setStroke('#0c0c14', 8),
    );
    overlay.add(
      this.add
        .text(centerX, 470, 'TU NOMBRE', {
          fontFamily: 'monospace',
          fontSize: '28px',
          color: '#9aa0a8',
        })
        .setOrigin(0.5),
    );

    this.multiNameInput = this.add.dom(centerX, 570, 'input', NAME_INPUT_CSS) as Phaser.GameObjects.DOMElement;
    const inputNode = this.multiNameInput.node as HTMLInputElement;
    applyMobileInputAttributes(inputNode, 'name');
    inputNode.value = storedName;
    inputNode.placeholder = 'PILOTO';
    this.multiNameInput.setOrigin(0.5).setDepth(101);

    const goLobby = (mode: 'create' | 'join'): void => {
      const name = sanitizePlayerName(inputNode.value);
      if (name.length === 0) {
        return; // Sin nombre no hay lobby: el input queda enfocado.
      }
      getPlayerProfileRepository(this.registry).save({ name });
      this.closeMultiplayerOverlay();
      this.scene.start(LobbyScene.KEY, { mode, name });
    };

    overlay.add(
      new MenuButton(this, {
        x: centerX,
        y: 740,
        width: 440,
        height: 110,
        label: 'CREAR SALA',
        tint: 0x1d8f43,
        fontSize: 42,
        bus,
        onPress: () => goLobby('create'),
      }).container,
    );
    overlay.add(
      new MenuButton(this, {
        x: centerX,
        y: 880,
        width: 440,
        height: 110,
        label: 'UNIRSE',
        tint: 0x3c6cd6,
        fontSize: 42,
        bus,
        onPress: () => goLobby('join'),
      }).container,
    );
    overlay.add(
      new MenuButton(this, {
        x: centerX,
        y: 1020,
        width: 300,
        height: 96,
        label: 'CERRAR',
        tint: 0x525868,
        fontSize: 34,
        bus,
        onPress: this.closeMultiplayerOverlay,
      }).container,
    );

    this.multiOverlay = overlay;
  };

  private readonly closeMultiplayerOverlay = (): void => {
    this.multiNameInput?.destroy();
    this.multiNameInput = null;
    this.multiOverlay?.destroy();
    this.multiOverlay = null;
  };

  /* ---------------------------------------------------------------- */
  /* V1 (issue #9) — selector de pistas de ENTRENAR                     */
  /* ---------------------------------------------------------------- */

  /**
   * Overlay simple de selección de pista (patrón del overlay multijugador):
   * las 5 pistas del registro por nombre + CERRAR. V1 NO usa miniaturas
   * (`TrackThumb` llega con el lobby de V2): para entrenar, el nombre de la
   * pista alcanza. La elección lanza RaceScene en modo práctica local.
   */
  private readonly openTrackPicker = (): void => {
    if (this.trackOverlay || this.multiOverlay) {
      return;
    }
    const centerX = this.scale.width / 2;
    const bus = getSessionEventBus(this.registry);

    const overlay = this.add.container(0, 0).setDepth(100);
    const dim = this.add
      .rectangle(centerX, this.scale.height / 2, this.scale.width, this.scale.height, 0x000000, TRACK_PICKER.dimAlpha)
      .setInteractive();
    dim.on('pointerdown', (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
    });
    const panel = this.add
      .rectangle(centerX, TRACK_PICKER.panelY, TRACK_PICKER.panelWidth, TRACK_PICKER.panelHeight, 0x14141c)
      .setStrokeStyle(6, 0x3a3a44);
    overlay.add([dim, panel]);

    overlay.add(
      this.add
        .text(centerX, TRACK_PICKER.titleY, 'ENTRENAR', {
          fontFamily: 'monospace',
          fontSize: '56px',
          color: '#f2f2f2',
        })
        .setOrigin(0.5)
        .setStroke('#0c0c14', 8),
    );
    overlay.add(
      this.add
        .text(centerX, TRACK_PICKER.subtitleY, 'ELEGÍ PISTA — 3 VUELTAS', SUBTITLE_STYLE)
        .setOrigin(0.5),
    );

    // Una fila por pista: nombre grande, circuito que la inspira como hint.
    TRACKS.forEach((track, index) => {
      const y = TRACK_PICKER.rowStartY + index * TRACK_PICKER.rowStep;
      overlay.add(this.trackRow(centerX, y, track.name, track.inspiration, track.id));
    });

    overlay.add(
      new MenuButton(this, {
        x: centerX,
        y: TRACK_PICKER.closeY,
        width: TRACK_PICKER.closeWidth,
        height: TRACK_PICKER.closeHeight,
        label: 'CERRAR',
        tint: 0x525868,
        fontSize: 34,
        bus,
        onPress: this.closeTrackPicker,
      }).container,
    );

    this.trackOverlay = overlay;
  };

  /** Fila de pista: botón con el nombre + hint del circuito real debajo. */
  private trackRow(
    centerX: number,
    y: number,
    name: string,
    inspiration: string,
    trackId: TrackId,
  ): Phaser.GameObjects.Container {
    const row = this.add.container(0, 0);
    row.add(
      new MenuButton(this, {
        x: centerX,
        y,
        width: TRACK_PICKER.rowWidth,
        height: TRACK_PICKER.rowHeight,
        label: name,
        tint: 0x3c6cd6,
        fontSize: 40,
        bus: getSessionEventBus(this.registry),
        onPress: () => this.startPractice(trackId),
      }).container,
    );
    row.add(
      this.add
        .text(
          centerX,
          y + TRACK_PICKER.rowHeight / 2 + TRACK_PICKER.hintGap,
          inspiration.split(' (')[0].toUpperCase(),
          {
            fontFamily: 'monospace',
            fontSize: `${TRACK_PICKER.hintFontSize}px`,
            color: '#9aa0a8',
          },
        )
        .setOrigin(0.5, 0),
    );
    return row;
  }

  private readonly startPractice = (trackId: TrackId): void => {
    this.closeTrackPicker();
    this.scene.start(RaceScene.KEY, { trackId, mode: 'practice' });
  };

  private readonly closeTrackPicker = (): void => {
    this.trackOverlay?.destroy();
    this.trackOverlay = null;
  };

  /**
   * C2 (issue #2) — abre el overlay de chat ENCIMA del menú (launch, patrón
   * PauseScene) con la tab PÚBLICO activa por default: en el menú no hay sala
   * de partida y la tab SALA aparece deshabilitada con su aviso. ChatScene se
   * registra on-demand (igual que en el lobby): gameConfig no se toca.
   */
  private readonly openChatOverlay = (): void => {
    // Con el overlay multijugador abierto, CHAT no pisa el foco del nombre.
    if (this.multiOverlay) {
      return;
    }
    if (!this.scene.get(ChatScene.KEY)) {
      this.scene.add(ChatScene.KEY, ChatScene, false);
    }
    this.scene.launch(ChatScene.KEY, { tab: 'public' });
  };

  /**
   * Botón FULLSCREEN (Fase 7, solo desktop): esquina superior izquierda,
   * espejo del botón de mute. Toggle + tecla F; la etiqueta se sincroniza
   * con los eventos del ScaleManager (el navegador puede denegar el pedido
   * o forzar la salida por fuera del juego).
   */
  private createFullscreenButton(bus: EventBus<GameEvents>): void {
    this.fullscreenButton = new MenuButton(this, {
      x: MENU.fullscreenMargin + MENU.fullscreenWidth / 2,
      y: MENU.fullscreenMargin + MENU.fullscreenHeight / 2,
      width: MENU.fullscreenWidth,
      height: MENU.fullscreenHeight,
      label: this.scale.isFullscreen ? FS_LABEL_FULLSCREEN : FS_LABEL_WINDOWED,
      tint: 0x525868,
      fontSize: MENU.fullscreenFontSize,
      bus,
      onPress: this.toggleFullscreen,
    });

    this.scale.on(Phaser.Scale.Events.ENTER_FULLSCREEN, this.syncFullscreenLabel);
    this.scale.on(Phaser.Scale.Events.LEAVE_FULLSCREEN, this.syncFullscreenLabel);
    this.input.keyboard?.on('keydown-F', this.toggleFullscreen);
  }

  private readonly toggleFullscreen = (): void => {
    try {
      if (this.scale.isFullscreen) {
        this.scale.stopFullscreen();
      } else {
        this.scale.startFullscreen();
      }
    } catch {
      // Navegador sin soporte o permiso denegado: queda como está.
    }
    this.syncFullscreenLabel();
  };

  private readonly syncFullscreenLabel = (): void => {
    this.fullscreenButton?.setLabel(
      this.scale.isFullscreen ? FS_LABEL_FULLSCREEN : FS_LABEL_WINDOWED,
    );
  };
}
