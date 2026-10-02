import Phaser from 'phaser';
import { getAudioEngine } from '../audio/AudioManager';
import { MUTE_BUTTON, MENU, TRACK, TRACK_PICKER } from '../config/balance';
import { prefersTouchControls } from '../core/device';
import { EventBus, getSessionEventBus, type GameEvents } from '../core/EventBus';
import { getSaveRepository } from '../data/LocalStorageSaveRepository';
import { getPlayerProfileRepository } from '../data/PlayerProfileRepository';
import { TRACKS, type TrackId } from '../race/tracks';
import {
  CPU_DIFFICULTY_LABELS,
  DEFAULT_CPU_DIFFICULTY,
  parseCpuDifficulty,
  type CpuDifficulty,
} from '../race/results';
import { onlineMenuButtonLabel } from '../chat/dmView';
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
 * Issue #22 — layout de la subpantalla EN LÍNEA (evolución del overlay
 * multijugador): título, identidad TU NOMBRE (input precargado del perfil),
 * aviso "INGRESÁ TU NOMBRE" (#21), botones CREAR SALA / UNIRSE (lobby), CHAT
 * (ChatScene con identidad compartida) y CERRAR. Mismo panel centrado del
 * selector de pistas; los botones de acción van al mismo paso de 130 px.
 */
const ONLINE = {
  /** Centro Y y tamaño del panel. */
  panelY: 712,
  panelWidth: 620,
  panelHeight: 952,
  /** Y del título EN LÍNEA (centro). */
  titleY: 320,
  /** Y del rótulo TU NOMBRE y del input DOM (centros). */
  nameLabelY: 440,
  inputY: 530,
  /** Y del aviso "INGRESÁ TU NOMBRE" (centro), entre el input y CREAR SALA. */
  warningY: 606,
  /** Centros Y de las filas de botones: CREAR SALA / UNIRSE / CHAT, al mismo
   * paso de 130 px (20 px de aire entre botones de 110 px). */
  createY: 700,
  joinY: 830,
  chatY: 960,
  /** Tamaño de los tres botones de acción y fuente de su etiqueta. */
  actionWidth: 440,
  actionHeight: 110,
  actionFontSize: 42,
  /** Botón CERRAR. */
  closeY: 1090,
  closeWidth: 300,
  closeHeight: 96,
  closeFontSize: 34,
} as const;

/** Input DOM del nombre compartido por multijugador y chat (issue #22). */
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
 * Issue #21 — aviso cuando se toca CREAR SALA/UNIRSE/CHAT sin nombre. Antes
 * era un `return` silencioso (botones que parecían muertos): ahora un texto
 * efímero bajo el input (mismo rojo de error que usa el lobby en setStatus).
 */
const NAME_WARNING_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '26px',
  color: '#d63c3c',
};
const NAME_WARNING_MESSAGE = 'INGRESÁ TU NOMBRE';
/** MS que el aviso queda visible antes del fade (se corta si el usuario escribe). */
const NAME_WARNING_VISIBLE_MS = 2200;
/** MS del fade de salida del aviso. */
const NAME_WARNING_FADE_MS = 400;

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
 * - Issue #22 — EN LÍNEA: MULTIJUGADOR y CHAT se unifican en UN botón que
 *   abre la subpantalla con la identidad compartida (TU NOMBRE, precargada
 *   del perfil), el flujo CREAR SALA/UNIRSE (goLobby de M1) y el CHAT (la
 *   ChatScene de C2/C3, que ahora también guarda el nombre editado antes de
 *   lanzarse). El badge de no leídos (C3) vive en el botón EN LÍNEA.
 */
export class MenuScene extends Phaser.Scene {
  static readonly KEY = 'Menu';

  private road!: Phaser.GameObjects.TileSprite;
  private muteButton!: MuteButton;
  private fullscreenButton: MenuButton | null = null;
  /**
   * C3 + issue #22 — botón EN LÍNEA con badge de no leídos de la sesión
   * social. DECISIÓN del badge: va en el botón EN LÍNEA (no en el subbotón
   * CHAT de la subpantalla) porque es la única superficie siempre visible y
   * ya se actualiza en vivo desde `update()`; el subbotón CHAT sólo existe
   * con la subpantalla abierta, cuando el badge ya cumplió su trabajo.
   */
  private onlineButton: MenuButton | null = null;
  /** Último label del badge (evita repintar el texto en cada frame). */
  private lastOnlineLabel = '';

  /* Issue #22 — subpantalla EN LÍNEA (nombre + crear/unirse + chat), null
   * si cerrada. Antes era el overlay multijugador de M1. */
  private onlineOverlay: Phaser.GameObjects.Container | null = null;
  private onlineNameInput: Phaser.GameObjects.DOMElement | null = null;
  /** Issue #21 — aviso "INGRESÁ TU NOMBRE" (muere con el overlay). */
  private onlineNameWarning: Phaser.GameObjects.Text | null = null;

  /* V1 (issue #9) — overlay del selector de pistas de ENTRENAR. */
  private trackOverlay: Phaser.GameObjects.Container | null = null;

  /* #14 — dificultad elegida para el GRAN PREMIO (default NORMAL; viaja en
   * el init data de RaceScene aunque V0 sólo use 'normal'). */
  private selectedDifficulty: CpuDifficulty = DEFAULT_CPU_DIFFICULTY;
  /** Botones del selector (se reconstruyen al cambiar la selección). */
  private difficultyButtons: MenuButton[] = [];

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

    // #14 — GRAN PREMIO: abre el selector de pistas + dificultad del rival y
    // lanza RaceScene en modo VS CPU (una persona, 3 vueltas contra 1 CPU,
    // sin red). El botón entre JUGAR y EN LÍNEA: mismo layout de V1 #9.
    new MenuButton(this, {
      x: centerX,
      y: MENU.trainY,
      width: MENU.trainWidth,
      height: MENU.trainHeight,
      label: 'GRAN PREMIO',
      tint: 0x3c6cd6,
      fontSize: MENU.trainFontSize,
      bus,
      onPress: this.openTrackPicker,
    });

    // Issue #22 — EN LÍNEA: UNA entrada para todo lo online (identidad TU
    // NOMBRE + CREAR SALA/UNIRSE + CHAT, todo en la subpantalla). Hereda el
    // violeta del viejo MULTIJUGADOR.
    // C3 — el label lleva el BADGE de no leídos de la sesión (sala + DMs):
    // la sesión social ya existe desde el Boot (eager, auditoría #2) y su
    // constructor aplicó el ajuste persistido — acá solo se lee el store.
    const social = getSocialChatSession(this.registry);
    this.lastOnlineLabel = onlineMenuButtonLabel(social.store.totalUnread);
    this.onlineButton = new MenuButton(this, {
      x: centerX,
      y: MENU.onlineY,
      width: MENU.onlineWidth,
      height: MENU.onlineHeight,
      label: this.lastOnlineLabel,
      tint: 0xb04ee0,
      fontSize: MENU.onlineFontSize,
      bus,
      onPress: this.openOnlineOverlay,
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
    // C3 + #22 — badge en vivo sobre EN LÍNEA: los DM pueden llegar con el
    // menú abierto (la sala pública sigue viva detrás); el label solo se toca
    // si cambió de verdad.
    const label = onlineMenuButtonLabel(getSocialChatSession(this.registry).store.totalUnread);
    if (label !== this.lastOnlineLabel) {
      this.lastOnlineLabel = label;
      this.onlineButton?.setLabel(label);
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
    // Con una subpantalla abierta (EN LÍNEA o selector de pistas), Enter/
    // Espacio son del input de esa pantalla: no arrancan una carrera sola
    // atravesada.
    if (this.onlineOverlay || this.trackOverlay) {
      return;
    }
    this.scene.start(GameScene.KEY);
  };

  /* ---------------------------------------------------------------- */
  /* Issue #22 — subpantalla EN LÍNEA: nombre + crear/unirse + chat     */
  /* ---------------------------------------------------------------- */

  /**
   * Subpantalla DOM/Phaser sobre el menú (evolución del overlay multijugador
   * de M1): identidad TU NOMBRE compartida (precargada del perfil, una sola
   * vez — la reutilizan la sala y el chat), CREAR SALA / UNIRSE (goLobby de
   * M1 con el feedback "INGRESÁ TU NOMBRE" de #21), CHAT (ChatScene de C2/
   * C3, que ahora guarda el nombre editado antes de lanzarse) y CERRAR. La
   * capa oscura es interactiva y corta la propagación para que los botones
   * de abajo no disparen taps atravesados.
   */
  private readonly openOnlineOverlay = (): void => {
    if (this.onlineOverlay) {
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
    const panel = this.add
      .rectangle(centerX, ONLINE.panelY, ONLINE.panelWidth, ONLINE.panelHeight, 0x14141c)
      .setStrokeStyle(6, 0x3a3a44);
    overlay.add([dim, panel]);

    overlay.add(
      this.add
        .text(centerX, ONLINE.titleY, 'EN LÍNEA', {
          fontFamily: 'monospace',
          fontSize: '56px',
          color: '#f2f2f2',
        })
        .setOrigin(0.5)
        .setStroke('#0c0c14', 8),
    );
    overlay.add(
      this.add
        .text(centerX, ONLINE.nameLabelY, 'TU NOMBRE', {
          fontFamily: 'monospace',
          fontSize: '28px',
          color: '#9aa0a8',
        })
        .setOrigin(0.5),
    );

    this.onlineNameInput = this.add.dom(centerX, ONLINE.inputY, 'input', NAME_INPUT_CSS) as Phaser.GameObjects.DOMElement;
    const inputNode = this.onlineNameInput.node as HTMLInputElement;
    applyMobileInputAttributes(inputNode, 'name');
    inputNode.value = storedName;
    inputNode.placeholder = 'PILOTO';
    this.onlineNameInput.setOrigin(0.5).setDepth(101);

    // Issue #21 — aviso efímero bajo el input (entre el input y CREAR SALA).
    // Texto de la escena, no DOM: el sync del contenedor no lo afecta.
    const nameWarning = this.add
      .text(centerX, ONLINE.warningY, NAME_WARNING_MESSAGE, NAME_WARNING_STYLE)
      .setOrigin(0.5)
      .setVisible(false);
    overlay.add(nameWarning);
    this.onlineNameWarning = nameWarning;

    /** Muestra el aviso opaco y agenda su fade (el destroy del overlay lo corta). */
    const showNameWarning = (): void => {
      this.tweens.killTweensOf(nameWarning);
      nameWarning.setAlpha(1).setVisible(true);
      this.tweens.add({
        targets: nameWarning,
        alpha: 0,
        delay: NAME_WARNING_VISIBLE_MS,
        duration: NAME_WARNING_FADE_MS,
        onComplete: () => nameWarning.setVisible(false),
      });
    };
    /** Apaga el aviso de inmediato (el usuario ya está escribiendo). */
    const hideNameWarning = (): void => {
      this.tweens.killTweensOf(nameWarning);
      nameWarning.setVisible(false);
    };
    // Se escribe → el aviso pierde el sentido: fuera al instante. El listener
    // muere con el nodo (el destroy del DOMElement lo retira del documento).
    inputNode.addEventListener('input', hideNameWarning);

    /** El nombre del input, sanitizado (puede quedar vacío: sin nombre). */
    const readName = (): string => sanitizePlayerName(inputNode.value);

    const goLobby = (mode: 'create' | 'join'): void => {
      const name = readName();
      if (name.length === 0) {
        // Sin nombre no hay lobby: ahora HAY feedback (antes `return` mudo —
        // botones que parecían muertos) y el foco deja el teclado listo.
        showNameWarning();
        inputNode.focus();
        return;
      }
      getPlayerProfileRepository(this.registry).save({ name });
      this.closeOnlineOverlay();
      this.scene.start(LobbyScene.KEY, { mode, name });
    };

    const goChat = (): void => {
      const name = readName();
      if (name.length === 0) {
        // Mismo contrato de identidad que la sala (#22): sin nombre hay
        // feedback y el chat NO se abre.
        showNameWarning();
        inputNode.focus();
        return;
      }
      // Identidad compartida (#22): guardar el nombre editado ANTES de lanzar
      // el chat — la tab PÚBLICO de ChatScene anuncia el nombre del perfil
      // (client.updateSelf) y así sala y chat reflejan el mismo nombre.
      getPlayerProfileRepository(this.registry).save({ name });
      this.closeOnlineOverlay();
      this.openChatOverlay();
    };

    overlay.add(
      new MenuButton(this, {
        x: centerX,
        y: ONLINE.createY,
        width: ONLINE.actionWidth,
        height: ONLINE.actionHeight,
        label: 'CREAR SALA',
        tint: 0x1d8f43,
        fontSize: ONLINE.actionFontSize,
        bus,
        onPress: () => goLobby('create'),
      }).container,
    );
    overlay.add(
      new MenuButton(this, {
        x: centerX,
        y: ONLINE.joinY,
        width: ONLINE.actionWidth,
        height: ONLINE.actionHeight,
        label: 'UNIRSE',
        tint: 0x3c6cd6,
        fontSize: ONLINE.actionFontSize,
        bus,
        onPress: () => goLobby('join'),
      }).container,
    );
    overlay.add(
      new MenuButton(this, {
        x: centerX,
        y: ONLINE.chatY,
        width: ONLINE.actionWidth,
        height: ONLINE.actionHeight,
        label: 'CHAT',
        tint: 0xb04ee0,
        fontSize: ONLINE.actionFontSize,
        bus,
        onPress: goChat,
      }).container,
    );
    overlay.add(
      new MenuButton(this, {
        x: centerX,
        y: ONLINE.closeY,
        width: ONLINE.closeWidth,
        height: ONLINE.closeHeight,
        label: 'CERRAR',
        tint: 0x525868,
        fontSize: ONLINE.closeFontSize,
        bus,
        onPress: this.closeOnlineOverlay,
      }).container,
    );

    this.onlineOverlay = overlay;
  };

  private readonly closeOnlineOverlay = (): void => {
    // El aviso (texto) muere con el contenedor del overlay; acá solo se corta
    // su fade pendiente y se suelta la referencia.
    if (this.onlineNameWarning) {
      this.tweens.killTweensOf(this.onlineNameWarning);
    }
    this.onlineNameWarning = null;
    this.onlineNameInput?.destroy();
    this.onlineNameInput = null;
    this.onlineOverlay?.destroy();
    this.onlineOverlay = null;
  };

  /* ---------------------------------------------------------------- */
  /* V1 (issue #9) — selector de pistas de ENTRENAR                     */
  /* ---------------------------------------------------------------- */

  /**
   * Overlay simple de selección de pista (patrón de la subpantalla EN LÍNEA):
   * las 6 pistas del registro por nombre + hint, el selector de DIFICULTAD
   * del rival (#14: FÁCIL / NORMAL / DIFÍCIL, default NORMAL) y CERRAR. V1
   * NO usa miniaturas (`TrackThumb` llega con el lobby de V2): para entrenar,
   * el nombre de la pista alcanza. La elección lanza RaceScene en modo
   * VS CPU con la dificultad elegida.
   */
  private readonly openTrackPicker = (): void => {
    if (this.trackOverlay || this.onlineOverlay) {
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
        .text(centerX, TRACK_PICKER.titleY, 'GRAN PREMIO', {
          fontFamily: 'monospace',
          fontSize: '56px',
          color: '#f2f2f2',
        })
        .setOrigin(0.5)
        .setStroke('#0c0c14', 8),
    );
    overlay.add(
      this.add
        .text(centerX, TRACK_PICKER.subtitleY, 'ELEGÍ PISTA Y RIVAL — 3 VUELTAS', SUBTITLE_STYLE)
        .setOrigin(0.5),
    );

    // Una fila por pista: nombre grande, circuito que la inspira como hint.
    TRACKS.forEach((track, index) => {
      const y = TRACK_PICKER.rowStartY + index * TRACK_PICKER.rowStep;
      overlay.add(this.trackRow(centerX, y, track.name, track.inspiration, track.id));
    });

    // #14 — selector de dificultad del rival: rótulo + 3 botones pixel; el
    // seleccionado va en verde (el mismo tinte que JUGAR), el resto en gris.
    overlay.add(
      this.add
        .text(centerX, TRACK_PICKER.difficultyLabelY, 'DIFICULTAD DEL RIVAL', {
          fontFamily: 'monospace',
          fontSize: `${TRACK_PICKER.difficultyLabelFontSize}px`,
          color: '#9aa0a8',
        })
        .setOrigin(0.5),
    );
    this.rebuildDifficultyRow(overlay, centerX, bus);

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

  /**
   * (Re)construye la fila de dificultad: al elegir una opción la fila se
   * redibuja para marcar el seleccionado. El orden de dificultad creciente
   * es el del registro de `results.ts`.
   */
  private rebuildDifficultyRow(
    overlay: Phaser.GameObjects.Container,
    centerX: number,
    bus: EventBus<GameEvents>,
  ): void {
    for (const button of this.difficultyButtons) {
      button.destroy();
    }
    this.difficultyButtons = [];
    const order: readonly CpuDifficulty[] = ['easy', 'normal', 'hard'];
    order.forEach((difficulty, index) => {
      const selected = difficulty === this.selectedDifficulty;
      const button = new MenuButton(this, {
        x: centerX + (index - 1) * TRACK_PICKER.difficultyButtonOffsetX,
        y: TRACK_PICKER.difficultyRowY,
        width: TRACK_PICKER.difficultyButtonWidth,
        height: TRACK_PICKER.difficultyButtonHeight,
        label: CPU_DIFFICULTY_LABELS[difficulty],
        tint: selected ? 0x1d8f43 : 0x525868,
        fontSize: TRACK_PICKER.difficultyFontSize,
        bus,
        onPress: () => {
          this.selectedDifficulty = parseCpuDifficulty(difficulty);
          this.rebuildDifficultyRow(overlay, centerX, bus);
        },
      });
      this.difficultyButtons.push(button);
      overlay.add(button.container);
    });
  }

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

  /**
   * Lanza el GRAN PREMIO (issue #14): RaceScene en modo VS CPU con la pista
   * elegida, la dificultad del selector y una seed fresca de parrilla
   * (`Date.now()` — la parrilla de 2 sólo necesita variedad por salida).
   */
  private readonly startPractice = (trackId: TrackId): void => {
    this.closeTrackPicker();
    this.scene.start(RaceScene.KEY, {
      trackId,
      mode: 'vs-cpu',
      difficulty: this.selectedDifficulty,
      seed: Date.now(),
    });
  };

  private readonly closeTrackPicker = (): void => {
    // Los botones de dificultad viven dentro del overlay: el destroy del
    // contenedor los tira; acá sólo se sueltan las referencias.
    this.difficultyButtons = [];
    this.trackOverlay?.destroy();
    this.trackOverlay = null;
  };

  /**
   * C2 (issue #2) — abre el overlay de chat ENCIMA del menú (launch, patrón
   * PauseScene) con la tab PÚBLICO activa por default: en el menú no hay sala
   * de partida y la tab SALA aparece deshabilitada con su aviso. ChatScene se
   * registra on-demand (igual que en el lobby): gameConfig no se toca.
   * Issue #22: ya no es un botón directo del menú — lo llama la subpantalla
   * EN LÍNEA (goChat) DESPUÉS de cerrarse y de guardar el nombre editado en
   * el perfil (la tab PÚBLICO anuncia ese nombre vía client.updateSelf).
   */
  private readonly openChatOverlay = (): void => {
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
