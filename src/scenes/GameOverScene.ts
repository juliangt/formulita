import Phaser from 'phaser';
import { CIRCUIT, GAME_OVER, LEADERBOARD, RACE_FAST_LAP } from '../config/balance';
import { prefersTouchControls } from '../core/device';
import { getSessionEventBus } from '../core/EventBus';
import { getSaveRepository } from '../data/LocalStorageSaveRepository';
import { getPlayerProfileRepository } from '../data/PlayerProfileRepository';
import { parseGameOverData, type GameOverData } from '../data/types';
import { parseMultiGameOverData, type MultiGameOverData } from '../net/protocol';
import {
  CPU_DIFFICULTY_LABELS,
  parseRaceMultiResults,
  parseRacePracticeResults,
  parseRaceVsCpuResults,
  type RaceMultiResultsData,
  type RacePracticeResultsData,
  type RaceVsCpuResultsData,
} from '../race/results';
import { GameScene } from './GameScene';
import { LobbyScene } from './LobbyScene';
import { MenuScene } from './MenuScene';
import { RaceScene } from './RaceScene';
import { formatDistance, formatLapMs, formatScore } from '../ui/format';
import { Leaderboard, personalResultMessage } from '../ui/Leaderboard';
import { MenuButton } from '../ui/MenuButton';

const TITLE_COLOR = '#d63c3c';
const GOLD_COLOR = '#f7c531';
const DIM_COLOR = '#c8ccd4';

const TITLE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '84px',
  color: TITLE_COLOR,
};

const MULTI_TITLE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '72px',
  color: '#f2f2f2',
};

const RECORD_BANNER_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '44px',
  color: GOLD_COLOR,
};

const HINT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '24px',
  color: DIM_COLOR,
};

/* #14 — rama VS CPU de resultados: dos líneas bajo el título (mensaje
 * personal + subtítulo pista/dificultad) alrededor del Y del cartel de la
 * rama práctica (GAME_OVER.newRecordY), misma rejilla de botones. */
const VS_CPU_MESSAGE_OFFSET_Y = -40;
const VS_CPU_SUBTITLE_OFFSET_Y = 40;
const VS_CPU_MESSAGE_FONT_SIZE = 48;
const VS_CPU_SUBTITLE_FONT_SIZE = 32;

/**
 * GameOverScene — resultados de la carrera (Fase 5).
 *
 * Muestra puntaje final, distancia, monedas ganadas y el récord histórico,
 * con cartel parpadeante de ¡NUEVO RÉCORD! cuando corresponde. Botones
 * REINTENTAR y MENÚ (táctiles + teclado: Enter/Espacio reintenta, M vuelve
 * al menú).
 *
 * Cómo recibe los datos de la carrera (decisión documentada): GameScene los
 * pasa como INIT DATA DE ESCENA (`scene.start(GameOverScene.KEY, payload)`)
 * y esta escena los parsea de forma defensiva en `init()`. Se eligió sobre
 * el EventBus (pensado para consumidores desacoplados del HUD, no para
 * transporte entre escenas) y sobre el registry de Phaser (estado global que
 * habría que invalidar en cada carrera): el init data es síncrono, tipado y
 * por-transición. El contrato es `GameOverData` (`data/types.ts`).
 *
 * M2 — multijugador: el payload `MultiGameOverData` (`{mode:'multi',
 * standings, myPeerId}`, parseado defensivo en net/protocol.ts) cambia la
 * pantalla a RESULTADOS con la tabla del leaderboard y el mensaje personal;
 * los botones pasan a ser MENÚ + CREAR PARTIDA (una carrera multi nueva
 * empieza por el lobby). Sin payload multi, la pantalla solo es IDÉNTICA a
 * la de siempre (regresión cero).
 */
export class GameOverScene extends Phaser.Scene {
  static readonly KEY = 'GameOver';

  private raceData: GameOverData = parseGameOverData(undefined);
  /** M2 — payload multi (null = pantalla clásica de modo solo). */
  private multiData: MultiGameOverData | null = null;
  /** V1 (issue #9) — resultados de la carrera de práctica (null = otra rama). */
  private practiceData: RacePracticeResultsData | null = null;
  /** #14 — resultados del GRAN PREMIO vs CPU (null = otra rama). */
  private vsCpuData: RaceVsCpuResultsData | null = null;
  /** V2 (issue #9) — clasificación final de la carrera multi (null = otra). */
  private raceMultiData: RaceMultiResultsData | null = null;

  constructor() {
    super(GameOverScene.KEY);
  }

  init(data: unknown): void {
    this.raceData = parseGameOverData(data);
    this.multiData = parseMultiGameOverData(data);
    this.practiceData = parseRacePracticeResults(data);
    this.vsCpuData = parseRaceVsCpuResults(data);
    this.raceMultiData = parseRaceMultiResults(data);
  }

  create(): void {
    const centerX = this.scale.width / 2;
    this.cameras.main.setBackgroundColor('#000000');

    // M2 — la partida multijugador tiene su propia pantalla: RESULTADOS +
    // tabla del leaderboard + mensaje personal (¡GANASTE! / TERMINASTE N°X)
    // y botones MENÚ / CREAR PARTIDA (una carrera multi nueva pasa por el
    // lobby: el transporte de la anterior ya se destruyó al salir de Game).
    if (this.multiData) {
      this.createMultiResults(centerX);
      return;
    }

    // V2 (issue #9) — la carrera en circuito MULTIJUGADOR tiene su propia
    // rama: clasificación final (podio con nombres y tiempos de los
    // terminados). Va ANTES de la práctica: son modos distintos de la misma
    // escena y el payload nunca es ambiguo (mode 'race-multi' vs 'practice').
    if (this.raceMultiData) {
      this.createRaceMultiResults(centerX);
      return;
    }

    // V1 (issue #9) — la carrera de práctica (ENTRENAR) también tiene su
    // propia rama: resumen de la carrera (tiempo total, mejor vuelta,
    // vueltas) y botones REINTENTAR (misma pista) / MENÚ.
    if (this.practiceData) {
      this.createRaceResults(centerX);
      return;
    }

    // #14 — GRAN PREMIO VS CPU: misma rejilla de la rama práctica, con la
    // posición final (1º/2º en V0), la dificultad del rival y REINTENTAR
    // con la MISMA pista + dificultad.
    if (this.vsCpuData) {
      this.createRaceVsCpuResults(centerX);
      return;
    }

    this.add
      .text(centerX, GAME_OVER.titleY, 'GAME OVER', TITLE_STYLE)
      .setOrigin(0.5)
      .setStroke('#0c0c14', 10);

    // Cartel parpadeante solo cuando la carrera superó el récord previo.
    if (this.raceData.isNewBest) {
      const banner = this.add
        .text(centerX, GAME_OVER.newRecordY, '¡NUEVO RÉCORD!', RECORD_BANNER_STYLE)
        .setOrigin(0.5)
        .setStroke('#0c0c14', 8);
      this.tweens.add({
        targets: banner,
        alpha: 0.25,
        duration: 300,
        yoyo: true,
        repeat: -1,
      });
    }

    const statStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: 'monospace',
      fontSize: `${GAME_OVER.statFontSize}px`,
      color: '#f2f2f2',
    };

    this.add
      .text(centerX, GAME_OVER.scoreY, `PUNTOS ${formatScore(this.raceData.score)}`, statStyle)
      .setOrigin(0.5);
    this.add
      .text(centerX, GAME_OVER.distanceY, `DISTANCIA ${formatDistance(this.raceData.distance)}`, statStyle)
      .setOrigin(0.5);
    this.add
      .text(centerX, GAME_OVER.coinsY, `MONEDAS +${this.raceData.coins}`, statStyle)
      .setOrigin(0.5)
      .setColor(GOLD_COLOR);

    // Récord histórico: ya fue actualizado por GameScene al morir (guardado
    // inmediato), así que con carrera nueva récord == puntaje de esta carrera.
    const record = Math.max(
      this.raceData.score,
      getSaveRepository(this.registry).load().bestScore,
    );
    this.add
      .text(centerX, GAME_OVER.recordY, `RÉCORD ${formatScore(record)}`, {
        fontFamily: 'monospace',
        fontSize: '28px',
        color: DIM_COLOR,
      })
      .setOrigin(0.5);

    // Botones con el bus de sesión inyectado: cada activación emite
    // `ui-click` (SFX de click, Fase 6) antes de la acción.
    const bus = getSessionEventBus(this.registry);
    new MenuButton(this, {
      x: centerX,
      y: GAME_OVER.retryY,
      width: GAME_OVER.buttonWidth,
      height: GAME_OVER.buttonHeight,
      label: 'REINTENTAR',
      tint: 0x1d8f43,
      fontSize: GAME_OVER.buttonFontSize,
      bus,
      onPress: this.retry,
    });
    new MenuButton(this, {
      x: centerX,
      y: GAME_OVER.menuY,
      width: GAME_OVER.buttonWidth,
      height: GAME_OVER.buttonHeight,
      label: 'MENÚ',
      tint: 0x3c6cd6,
      fontSize: GAME_OVER.buttonFontSize,
      bus,
      onPress: this.goToMenu,
    });

    // Teclado: Enter/Espacio reintenta, M vuelve al menú.
    this.input.keyboard?.on('keydown-ENTER', this.retry);
    this.input.keyboard?.on('keydown-SPACE', this.retry);
    this.input.keyboard?.on('keydown-M', this.goToMenu);

    // Ayuda de teclado solo en desktop (en móvil mandan los botones).
    if (!prefersTouchControls(this.game.device)) {
      this.add
        .text(centerX, GAME_OVER.hintY, 'ENTER / ESPACIO  REINTENTAR   ·   M  MENÚ', HINT_STYLE)
        .setOrigin(0.5);
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.off('keydown-ENTER', this.retry);
      this.input.keyboard?.off('keydown-SPACE', this.retry);
      this.input.keyboard?.off('keydown-M', this.goToMenu);
    });
  }

  /**
   * M2 — RESULTADOS multijugador: título, mensaje personal según el puesto,
   * tabla del leaderboard (puesto, nombre+color, monedas, puntaje, km) y
   * botones MENÚ / CREAR PARTIDA. Ganar = tener más monedas, no sobrevivir:
   * el ganador se destaca en la tabla y el mensaje lo dice explícito.
   */
  private createMultiResults(centerX: number): void {
    const data = this.multiData;
    if (!data) {
      return;
    }
    const bus = getSessionEventBus(this.registry);

    this.add
      .text(centerX, LEADERBOARD.titleY, 'RESULTADOS', MULTI_TITLE_STYLE)
      .setOrigin(0.5)
      .setStroke('#0c0c14', 10);

    const mine = data.standings.find((standing) => standing.peerId === data.myPeerId);
    const place = mine?.place ?? data.standings.length;
    const isWinner = place === 1;
    this.add
      .text(centerX, LEADERBOARD.messageY, personalResultMessage(place), {
        fontFamily: 'monospace',
        fontSize: `${LEADERBOARD.messageFontSize}px`,
        color: isWinner ? GOLD_COLOR : '#f2f2f2',
      })
      .setOrigin(0.5)
      .setStroke('#0c0c14', 8);

    new Leaderboard(this, { highlightPeerId: data.myPeerId }).render(data.standings);

    // Botones: MENÚ y CREAR PARTIDA (abre el lobby en modo crear con el
    // nombre ya persistido — flujo limpio, sin reusar el transporte muerto).
    new MenuButton(this, {
      x: centerX,
      y: LEADERBOARD.menuY,
      width: LEADERBOARD.buttonWidth,
      height: LEADERBOARD.buttonHeight,
      label: 'MENÚ',
      tint: 0x3c6cd6,
      fontSize: LEADERBOARD.buttonFontSize,
      bus,
      onPress: this.goToMenu,
    });
    new MenuButton(this, {
      x: centerX,
      y: LEADERBOARD.playY,
      width: LEADERBOARD.buttonWidth,
      height: LEADERBOARD.buttonHeight,
      label: 'CREAR PARTIDA',
      tint: 0x1d8f43,
      fontSize: LEADERBOARD.buttonFontSize - 6,
      bus,
      onPress: this.createMultiRace,
    });

    // Teclado multi: M menú, Enter/Espacio/C crean una partida nueva.
    this.input.keyboard?.on('keydown-ENTER', this.createMultiRace);
    this.input.keyboard?.on('keydown-SPACE', this.createMultiRace);
    this.input.keyboard?.on('keydown-C', this.createMultiRace);
    this.input.keyboard?.on('keydown-M', this.goToMenu);

    if (!prefersTouchControls(this.game.device)) {
      this.add
        .text(centerX, LEADERBOARD.hintY, 'ENTER / C  CREAR PARTIDA   ·   M  MENÚ', HINT_STYLE)
        .setOrigin(0.5);
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.off('keydown-ENTER', this.createMultiRace);
      this.input.keyboard?.off('keydown-SPACE', this.createMultiRace);
      this.input.keyboard?.off('keydown-C', this.createMultiRace);
      this.input.keyboard?.off('keydown-M', this.goToMenu);
    });
  }

  /** CREAR PARTIDA (multi): lobby en modo crear con el nombre persistido. */
  private readonly createMultiRace = (): void => {
    const name = getPlayerProfileRepository(this.registry).load().name;
    this.scene.start(LobbyScene.KEY, { mode: 'create', name });
  };

  /**
   * V2 (issue #9) — RESULTADOS de la carrera en circuito multijugador:
   * podio P1..Pn con nombre+color (del roster congelado) y, para los que
   * terminaron, su tiempo total (`rfin`); los que no llegaron muestran la
   * vuelta en la que estaban y los caídos, ABANDONÓ. El ganador va en oro y
   * la propia fila queda resaltada. V4: bajo el subtítulo va la línea
   * "VUELTA RÁPIDA: NOMBRE (M:SS.mmm)" con el mejor `bestLapMs` de la
   * carrera. Los botones son los de la BATALLA (MENÚ / CREAR PARTIDA: una
   * carrera nueva empieza por el lobby).
   */
  private createRaceMultiResults(centerX: number): void {
    const data = this.raceMultiData;
    if (!data) {
      return;
    }
    const bus = getSessionEventBus(this.registry);
    const nameOf = (peerId: string): string =>
      data.players.find((player) => player.peerId === peerId)?.name ?? 'PILOTO';
    const colorOf = (peerId: string): number =>
      data.players.find((player) => player.peerId === peerId)?.color ?? 0xffffff;

    this.add
      .text(centerX, LEADERBOARD.titleY, 'RESULTADOS', MULTI_TITLE_STYLE)
      .setOrigin(0.5)
      .setStroke('#0c0c14', 10);

    const mine = data.standings.find((standing) => standing.peerId === data.myPeerId);
    const place = mine?.position ?? data.standings.length;
    this.add
      .text(centerX, LEADERBOARD.messageY, personalResultMessage(place), {
        fontFamily: 'monospace',
        fontSize: `${LEADERBOARD.messageFontSize}px`,
        color: place === 1 ? GOLD_COLOR : '#f2f2f2',
      })
      .setOrigin(0.5)
      .setStroke('#0c0c14', 8);

    // Subtítulo: la pista corrida y el formato de la carrera.
    this.add
      .text(centerX, LEADERBOARD.headerY, `${data.trackName} · ${CIRCUIT.totalLaps} VUELTAS`, {
        fontFamily: 'monospace',
        fontSize: `${LEADERBOARD.headerFontSize + 8}px`,
        color: DIM_COLOR,
      })
      .setOrigin(0.5);

    // V4 (issue #9) — vuelta rápida de la carrera: el mejor `bestLapMs` de
    // los `rfin` (viaja en el payload de resultados; null si nadie terminó).
    // Etiqueta en oro, el mismo tono que el ganador del podio.
    if (data.fastLap) {
      this.add
        .text(
          centerX,
          RACE_FAST_LAP.y,
          `VUELTA RÁPIDA: ${nameOf(data.fastLap.peerId)} (${formatLapMs(data.fastLap.bestLapMs)})`,
          {
            fontFamily: 'monospace',
            fontSize: `${RACE_FAST_LAP.fontSize}px`,
            color: GOLD_COLOR,
          },
        )
        .setOrigin(0.5)
        .setStroke('#0c0c14', 6);
    }

    const rowStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: 'monospace',
      fontSize: `${LEADERBOARD.rowFontSize + 6}px`,
      color: '#f2f2f2',
    };
    data.standings.forEach((standing, index) => {
      const y = LEADERBOARD.rowStartY + index * LEADERBOARD.rowHeight;
      const isSelf = standing.peerId === data.myPeerId;
      const rowColor = standing.position === 1 ? GOLD_COLOR : isSelf ? '#8fce3c' : '#f2f2f2';
      const rightText =
        standing.status === 'finished' && standing.totalMs !== null
          ? formatLapMs(standing.totalMs)
          : standing.status === 'running'
            ? `VUELTA ${Math.min(standing.lap + 1, CIRCUIT.totalLaps)}`
            : 'ABANDONÓ';
      this.add
        .rectangle(
          LEADERBOARD.nameX - LEADERBOARD.swatchSize,
          y,
          LEADERBOARD.swatchSize,
          LEADERBOARD.swatchSize,
          colorOf(standing.peerId),
        )
        .setStrokeStyle(2, 0x0c0c14);
      this.add
        .text(LEADERBOARD.placeX, y, `P${standing.position}`, rowStyle)
        .setOrigin(0, 0.5)
        .setColor(rowColor);
      this.add
        .text(LEADERBOARD.nameX, y, nameOf(standing.peerId), rowStyle)
        .setOrigin(0, 0.5)
        .setColor(rowColor);
      this.add
        .text(LEADERBOARD.kmX, y, rightText, rowStyle)
        .setOrigin(1, 0.5)
        .setColor(rowColor);
    });

    new MenuButton(this, {
      x: centerX,
      y: LEADERBOARD.menuY,
      width: LEADERBOARD.buttonWidth,
      height: LEADERBOARD.buttonHeight,
      label: 'MENÚ',
      tint: 0x3c6cd6,
      fontSize: LEADERBOARD.buttonFontSize,
      bus,
      onPress: this.goToMenu,
    });
    new MenuButton(this, {
      x: centerX,
      y: LEADERBOARD.playY,
      width: LEADERBOARD.buttonWidth,
      height: LEADERBOARD.buttonHeight,
      label: 'CREAR PARTIDA',
      tint: 0x1d8f43,
      fontSize: LEADERBOARD.buttonFontSize - 6,
      bus,
      onPress: this.createMultiRace,
    });

    this.input.keyboard?.on('keydown-ENTER', this.createMultiRace);
    this.input.keyboard?.on('keydown-SPACE', this.createMultiRace);
    this.input.keyboard?.on('keydown-C', this.createMultiRace);
    this.input.keyboard?.on('keydown-M', this.goToMenu);

    if (!prefersTouchControls(this.game.device)) {
      this.add
        .text(centerX, LEADERBOARD.hintY, 'ENTER / C  CREAR PARTIDA   ·   M  MENÚ', HINT_STYLE)
        .setOrigin(0.5);
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.off('keydown-ENTER', this.createMultiRace);
      this.input.keyboard?.off('keydown-SPACE', this.createMultiRace);
      this.input.keyboard?.off('keydown-C', this.createMultiRace);
      this.input.keyboard?.off('keydown-M', this.goToMenu);
    });
  }

  /**
   * V1 (issue #9) — RESULTADOS de la carrera de práctica (ENTRENAR): misma
   * rejilla de la pantalla clásica (posiciones de GAME_OVER), distinto
   * contenido: pista + vueltas como subtítulo, tiempo total, mejor vuelta y
   * vueltas completadas. Botones REINTENTAR (misma pista) y MENÚ.
   */
  private createRaceResults(centerX: number): void {
    const data = this.practiceData;
    if (!data) {
      return;
    }
    const bus = getSessionEventBus(this.registry);

    this.add
      .text(centerX, GAME_OVER.titleY, 'RESULTADOS', TITLE_STYLE)
      .setOrigin(0.5)
      .setStroke('#0c0c14', 10);

    // Subtítulo: la pista corrida y el formato de la carrera.
    this.add
      .text(centerX, GAME_OVER.newRecordY, `${data.trackName} · ${CIRCUIT.totalLaps} VUELTAS`, {
        fontFamily: 'monospace',
        fontSize: '40px',
        color: DIM_COLOR,
      })
      .setOrigin(0.5)
      .setStroke('#0c0c14', 6);

    const statStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: 'monospace',
      fontSize: `${GAME_OVER.statFontSize}px`,
      color: '#f2f2f2',
    };

    this.add
      .text(centerX, GAME_OVER.scoreY, `TIEMPO TOTAL ${formatLapMs(data.totalMs)}`, statStyle)
      .setOrigin(0.5);
    this.add
      .text(centerX, GAME_OVER.distanceY, `MEJOR VUELTA ${formatLapMs(data.bestLapMs)}`, statStyle)
      .setOrigin(0.5)
      .setColor(GOLD_COLOR);
    this.add
      .text(centerX, GAME_OVER.coinsY, `VUELTAS ${data.laps}/${CIRCUIT.totalLaps}`, statStyle)
      .setOrigin(0.5);

    new MenuButton(this, {
      x: centerX,
      y: GAME_OVER.retryY,
      width: GAME_OVER.buttonWidth,
      height: GAME_OVER.buttonHeight,
      label: 'REINTENTAR',
      tint: 0x1d8f43,
      fontSize: GAME_OVER.buttonFontSize,
      bus,
      onPress: this.retryRace,
    });
    new MenuButton(this, {
      x: centerX,
      y: GAME_OVER.menuY,
      width: GAME_OVER.buttonWidth,
      height: GAME_OVER.buttonHeight,
      label: 'MENÚ',
      tint: 0x3c6cd6,
      fontSize: GAME_OVER.buttonFontSize,
      bus,
      onPress: this.goToMenu,
    });

    // Teclado: Enter/Espacio reintenta, M vuelve al menú.
    this.input.keyboard?.on('keydown-ENTER', this.retryRace);
    this.input.keyboard?.on('keydown-SPACE', this.retryRace);
    this.input.keyboard?.on('keydown-M', this.goToMenu);

    if (!prefersTouchControls(this.game.device)) {
      this.add
        .text(centerX, GAME_OVER.hintY, 'ENTER / ESPACIO  REINTENTAR   ·   M  MENÚ', HINT_STYLE)
        .setOrigin(0.5);
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.off('keydown-ENTER', this.retryRace);
      this.input.keyboard?.off('keydown-SPACE', this.retryRace);
      this.input.keyboard?.off('keydown-M', this.goToMenu);
    });
  }

  /** REINTENTAR (practice): RaceScene otra vez con la MISMA pista. */
  private readonly retryRace = (): void => {
    const data = this.practiceData;
    this.scene.start(RaceScene.KEY, {
      trackId: data?.trackId,
      mode: 'practice',
    });
  };

  /**
   * #14 — RESULTADOS del GRAN PREMIO VS CPU: mismo layout de la rama
   * práctica (rejilla GAME_OVER), distinto contenido: pista + vueltas +
   * dificultad del rival como subtítulo, mensaje personal por posición
   * (1º/2º en V0), tiempo total, mejor vuelta y vueltas completadas.
   * Botones REINTENTAR (misma pista + dificultad, seed fresca) y MENÚ.
   */
  private createRaceVsCpuResults(centerX: number): void {
    const data = this.vsCpuData;
    if (!data) {
      return;
    }
    const bus = getSessionEventBus(this.registry);

    this.add
      .text(centerX, GAME_OVER.titleY, 'RESULTADOS', TITLE_STYLE)
      .setOrigin(0.5)
      .setStroke('#0c0c14', 10);

    // Mensaje personal por posición (1 = ¡GANASTE!, oro; 2º en blanco).
    const isWinner = data.position === 1;
    this.add
      .text(centerX, GAME_OVER.newRecordY + VS_CPU_MESSAGE_OFFSET_Y, personalResultMessage(data.position), {
        fontFamily: 'monospace',
        fontSize: `${VS_CPU_MESSAGE_FONT_SIZE}px`,
        color: isWinner ? GOLD_COLOR : '#f2f2f2',
      })
      .setOrigin(0.5)
      .setStroke('#0c0c14', 8);

    // Subtítulo: pista, formato de la carrera y dificultad del rival.
    this.add
      .text(
        centerX,
        GAME_OVER.newRecordY + VS_CPU_SUBTITLE_OFFSET_Y,
        `${data.trackName} · ${CIRCUIT.totalLaps} VUELTAS · RIVAL ${CPU_DIFFICULTY_LABELS[data.difficulty]}`,
        {
          fontFamily: 'monospace',
          fontSize: `${VS_CPU_SUBTITLE_FONT_SIZE}px`,
          color: DIM_COLOR,
        },
      )
      .setOrigin(0.5)
      .setStroke('#0c0c14', 6);

    const statStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: 'monospace',
      fontSize: `${GAME_OVER.statFontSize}px`,
      color: '#f2f2f2',
    };

    this.add
      .text(centerX, GAME_OVER.scoreY, `POSICIÓN P${data.position}/${data.totalCars}`, statStyle)
      .setOrigin(0.5)
      .setColor(isWinner ? GOLD_COLOR : '#f2f2f2');
    this.add
      .text(centerX, GAME_OVER.distanceY, `TIEMPO TOTAL ${formatLapMs(data.totalMs)}`, statStyle)
      .setOrigin(0.5);
    this.add
      .text(centerX, GAME_OVER.coinsY, `MEJOR VUELTA ${formatLapMs(data.bestLapMs)}`, statStyle)
      .setOrigin(0.5);

    new MenuButton(this, {
      x: centerX,
      y: GAME_OVER.retryY,
      width: GAME_OVER.buttonWidth,
      height: GAME_OVER.buttonHeight,
      label: 'REINTENTAR',
      tint: 0x1d8f43,
      fontSize: GAME_OVER.buttonFontSize,
      bus,
      onPress: this.retryRaceVsCpu,
    });
    new MenuButton(this, {
      x: centerX,
      y: GAME_OVER.menuY,
      width: GAME_OVER.buttonWidth,
      height: GAME_OVER.buttonHeight,
      label: 'MENÚ',
      tint: 0x3c6cd6,
      fontSize: GAME_OVER.buttonFontSize,
      bus,
      onPress: this.goToMenu,
    });

    // Teclado: Enter/Espacio reintenta, M vuelve al menú.
    this.input.keyboard?.on('keydown-ENTER', this.retryRaceVsCpu);
    this.input.keyboard?.on('keydown-SPACE', this.retryRaceVsCpu);
    this.input.keyboard?.on('keydown-M', this.goToMenu);

    if (!prefersTouchControls(this.game.device)) {
      this.add
        .text(centerX, GAME_OVER.hintY, 'ENTER / ESPACIO  REINTENTAR   ·   M  MENÚ', HINT_STYLE)
        .setOrigin(0.5);
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.off('keydown-ENTER', this.retryRaceVsCpu);
      this.input.keyboard?.off('keydown-SPACE', this.retryRaceVsCpu);
      this.input.keyboard?.off('keydown-M', this.goToMenu);
    });
  }

  /**
   * REINTENTAR (vs CPU): RaceScene con la MISMA pista + dificultad y una
   * seed fresca de parrilla (misma política que la salida desde el menú).
   */
  private readonly retryRaceVsCpu = (): void => {
    const data = this.vsCpuData;
    this.scene.start(RaceScene.KEY, {
      trackId: data?.trackId,
      mode: 'vs-cpu',
      difficulty: data?.difficulty,
      seed: Date.now(),
    });
  };

  private readonly retry = (): void => {
    this.scene.start(GameScene.KEY);
  };

  private readonly goToMenu = (): void => {
    this.scene.start(MenuScene.KEY);
  };
}
