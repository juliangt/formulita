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
import { getSessionEventBus } from '../core/EventBus';
import { getPlayerProfileRepository } from '../data/PlayerProfileRepository';
import {
  isValidRoomWord,
  sanitizePlayerName,
  sanitizeRoomWord,
  type PlayerInfo,
  type StartPayload,
} from '../net/protocol';
import type { NetClient } from '../net/NetClient';
import { handoffNetClient } from '../net/netClientSession';
import { randomRoomSeed } from '../net/roomRng';
import { resolveAppId, TrysteroNetClient } from '../net/TrysteroNetClient';
import { TEXTURE_KEYS } from '../systems/TextureFactory';
import { GameScene } from './GameScene';
import { MenuScene } from './MenuScene';
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
}

/** Parseo defensivo del init data (Phaser lo propaga como unknown). */
function parseLobbyData(raw: unknown): LobbySceneData {
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const mode = record.mode === 'join' ? 'join' : 'create';
  const name = typeof record.name === 'string' ? record.name : undefined;
  return { mode, name };
}

export class LobbyScene extends Phaser.Scene {
  static readonly KEY = 'Lobby';

  private lobbyData: LobbySceneData = { mode: 'create' };
  private client: NetClient | null = null;
  private appId = '';
  private playerName = '';
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

  constructor() {
    super(LobbyScene.KEY);
  }

  init(data: unknown): void {
    this.lobbyData = parseLobbyData(data);
    this.playerName = sanitizePlayerName(this.lobbyData.name ?? '');
    this.joined = false;
    this.handedOff = false;
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
      this.showWordInput();
      this.setStatus(`SALA LLENA (${MULTIPLAYER.maxPlayers}/${MULTIPLAYER.maxPlayers})`, '#d63c3c');
    });
    this.client.onRosterChange((roster) => this.renderRoster(roster));
    this.client.onHostChange(() => this.syncStartButton());
    this.client.onStart((payload) => this.startRace(payload));

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
      if (this.handedOff) {
        this.client = null;
        return;
      }
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
    node.maxLength = MULTIPLAYER.roomWordMaxLength;
    node.autocapitalize = 'characters';
    node.placeholder = 'PALABRA';
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
    node.maxLength = MULTIPLAYER.maxPlayerNameLength;
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
  }

  /** INICIAR: el anfitrión difunde start y arranca SU carrera local. */
  private tryStart(): void {
    const client = this.requireClient();
    const roster = client.getRoster();
    if (!client.isHost() || roster.length < MULTIPLAYER.minPlayersToStart) {
      this.setStatus(`SE NECESITAN ${MULTIPLAYER.minPlayersToStart}+ JUGADORES`, '#d63c3c');
      return;
    }
    const payload: StartPayload = {
      seed: randomRoomSeed(),
      players: roster,
      startAt: Date.now(),
    };
    client.start(payload);
    this.startRace(payload);
  }

  /** `start` recibido (o propio): arranca la carrera multi determinista. */
  private startRace(payload: StartPayload): void {
    // M2 — handoff del NetClient: la carrera es la nueva dueña del transporte
    // (difunde state/eliminated/match-over). Este SHUTDOWN ya no lo destruye.
    if (this.client) {
      handoffNetClient(this.registry, this.client);
      this.handedOff = true;
    }
    this.scene.start(GameScene.KEY, {
      mode: 'multi',
      seed: payload.seed,
      players: payload.players,
      myPeerId: this.client?.selfPeerId ?? '',
      roomWord: this.client?.roomWord ?? '',
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
