import Phaser from 'phaser';
import { PAUSE } from '../config/balance';
import { prefersTouchControls } from '../core/device';
import { getSessionEventBus } from '../core/EventBus';
import { MenuButton } from '../ui/MenuButton';
import { GameScene } from './GameScene';
import { MenuScene } from './MenuScene';

const TITLE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '84px',
  color: '#f2f2f2',
};

const SUBTITLE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: `${PAUSE.subtitleFontSize}px`,
  color: '#9aa0a8',
};

const HINT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '24px',
  color: '#9aa0a8',
};

/**
 * PauseScene — overlay de pausa de la carrera (Fase 7).
 *
 * La pausa es REAL: GameScene se pausa con `scene.pause()`, que congela su
 * update, la física arcade, los tweens, los timers (`time`) y los emisores de
 * partículas — nada avanza un frame mientras el overlay está abierto. Esta
 * escena se LANZA encima (`scene.launch`) precisamente porque una escena
 * pausada tampoco procesa su input: los botones REANUDAR/MENÚ viven acá.
 *
 * Contrato con la escena de juego (patrón init data de Fase 5, no EventBus):
 * se lanza con `{ auto: boolean }` para explicar la PAUSA AUTOMÁTICA por
 * pérdida de foco. V1 (issue #9) — acepta además `target`: la KEY de la
 * escena de juego a reanudar/apagar (RaceScene lanza el overlay apuntándose
 * a sí misma; el default sigue siendo GameScene, regresión cero en el modo
 * BATALLA). Al reanudar hace `resume(target)` — el evento RESUME de la
 * escena de juego es el que re-sincroniza su PauseSystem y re-arma el input
 * táctil —; al ir al MENÚ hace `stop(target)` (dispara el shutdown/limpieza
 * de la carrera) y `start(Menu)`.
 *
 * Teclado (desktop): P o ESC reanudan, M vuelve al menú. Las teclas se
 * registran con `addKey` y se consumen con `JustDown` en `update`: así el
 * auto-repeat del SO (mantener P apretada) no puede alternar pausa/reanudar
 * en bucle.
 */
export class PauseScene extends Phaser.Scene {
  static readonly KEY = 'Pause';

  /** `true` si la pausa vigente fue automática (pérdida de foco). */
  private autoPaused = false;
  /** Escena de juego sobre la que vuela este overlay (default: Game). */
  private targetKey: string = GameScene.KEY;
  private keyP: Phaser.Input.Keyboard.Key | null = null;
  private keyEsc: Phaser.Input.Keyboard.Key | null = null;
  private keyM: Phaser.Input.Keyboard.Key | null = null;

  constructor() {
    super(PauseScene.KEY);
  }

  init(data: unknown): void {
    // Parseo defensivo: si se lanza en caliente sin payload, es pausa manual
    // sobre GameScene (comportamiento de siempre).
    const record = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
    this.autoPaused = record.auto === true;
    this.targetKey = typeof record.target === 'string' ? record.target : GameScene.KEY;
  }

  create(): void {
    const { width, height } = this.scale;
    const centerX = width / 2;
    const bus = getSessionEventBus(this.registry);

    // Velo sobre la carrera congelada (la escena de abajo sigue renderizada).
    this.add.rectangle(centerX, height / 2, width, height, 0x000000, PAUSE.veilAlpha);

    this.add
      .text(centerX, PAUSE.titleY, this.autoPaused ? 'PAUSA AUTOMÁTICA' : 'PAUSA', TITLE_STYLE)
      .setOrigin(0.5)
      .setStroke('#0c0c14', 10);

    this.add
      .text(
        centerX,
        PAUSE.subtitleY,
        this.autoPaused ? 'se perdió el foco de la ventana' : 'la carrera quedó congelada',
        SUBTITLE_STYLE,
      )
      .setOrigin(0.5);

    new MenuButton(this, {
      x: centerX,
      y: PAUSE.resumeY,
      width: PAUSE.buttonWidth,
      height: PAUSE.buttonHeight,
      label: 'REANUDAR',
      tint: 0x1d8f43,
      fontSize: PAUSE.buttonFontSize,
      bus,
      onPress: this.resumeGame,
    });
    new MenuButton(this, {
      x: centerX,
      y: PAUSE.menuY,
      width: PAUSE.buttonWidth,
      height: PAUSE.buttonHeight,
      label: 'MENÚ',
      tint: 0x3c6cd6,
      fontSize: PAUSE.buttonFontSize,
      bus,
      onPress: this.goToMenu,
    });

    // Teclas con JustDown (anti auto-repeat); el plugin de escena libera sus
    // teclas solo en el shutdown, no hace falta off() manual.
    this.keyP = this.input.keyboard?.addKey('P') ?? null;
    this.keyEsc = this.input.keyboard?.addKey('ESC') ?? null;
    this.keyM = this.input.keyboard?.addKey('M') ?? null;

    // Ayuda de teclado solo en desktop (en móvil mandan los botones).
    if (!prefersTouchControls(this.game.device)) {
      this.add
        .text(centerX, PAUSE.hintY, 'P / ESC  REANUDAR   ·   M  MENÚ', HINT_STYLE)
        .setOrigin(0.5);
    }
  }

  override update(): void {
    if (this.justPressed(this.keyP) || this.justPressed(this.keyEsc)) {
      this.resumeGame();
    } else if (this.justPressed(this.keyM)) {
      this.goToMenu();
    }
  }

  /** P o ESC reanudan sin toggle-bucle por auto-repeat. */
  private justPressed(key: Phaser.Input.Keyboard.Key | null): boolean {
    return key !== null && Phaser.Input.Keyboard.JustDown(key);
  }

  /** Reanuda la carrera y se quita de encima (la escena objetivo escucha su RESUME). */
  private readonly resumeGame = (): void => {
    this.scene.resume(this.targetKey);
    this.scene.stop();
  };

  /** Abandona: apaga la carrera (shutdown = limpieza) y vuelve al menú. */
  private readonly goToMenu = (): void => {
    this.scene.stop(this.targetKey);
    this.scene.start(MenuScene.KEY);
  };
}
