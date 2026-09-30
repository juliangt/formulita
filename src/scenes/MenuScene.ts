import Phaser from 'phaser';
import { getAudioEngine } from '../audio/AudioManager';
import { MUTE_BUTTON, MENU, TRACK } from '../config/balance';
import { EventBus, getSessionEventBus, type GameEvents } from '../core/EventBus';
import { getSaveRepository } from '../data/LocalStorageSaveRepository';
import { TEXTURE_KEYS } from '../systems/TextureFactory';
import { GameScene } from './GameScene';
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

    // Ayuda de controles y extras según el dispositivo. El fullscreen (Fase
    // 7) es OPCIONAL y solo desktop: en móvil el HUD táctil ya ocupa los
    // pulgares y el navegador maneja la pantalla completa a su manera.
    const device = this.game.device;
    const isTouch = device.input.touch && !device.os.desktop;
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
    this.scene.start(GameScene.KEY);
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
