import { describe, expect, it } from 'vitest';
import {
  COIN_SCORE,
  COIN_VALUE,
  DRS_MULTIPLIER,
  MAX_SPEED,
  TURBO_MAX,
  TURBO_MULTIPLIER,
  TURBO_PICKUP_REFILL,
} from '../config/balance';
import { EventBus, type GameEvents } from '../core/EventBus';
import { applyRaceResult } from '../data/types';
import { ENTITY_DEFINITIONS, type EntityKind } from '../entities/entityTypes';
import { DrsSystem } from '../systems/DrsSystem';
import { ScoreSystem } from '../systems/ScoreSystem';
import { TurboSystem } from '../systems/TurboSystem';

/**
 * Integración Fases 4/5 — el flujo de puntos de las colisiones SIN Phaser.
 *
 * Es la composición que GameScene ejecuta en `handleTrackContact`: el efecto
 * declarado en `entityTypes` (data-driven, `CollisionEffect`) se despacha
 * sobre los sistemas puros — ScoreSystem (puntos de monedas), TurboSystem
 * (recarga), DrsSystem (reset de cooldown) — y se anuncia por el bus (`coins`,
 * `pickup`, `game-over`). El despacho de acá es un espejo fiel del switch de
 * GameScene; lo que se verifica es el CONTRATO entre definiciones, sistemas y
 * bus (las partículas, el shake y los sprites son QA manual del README).
 */

const DT = 1 / 60;

/** Umbral de DRS sobre el que el proveedor de velocidad reporta siempre. */
const ALWAYS_ABOVE_DRS = MAX_SPEED * 2 * TURBO_MULTIPLIER * DRS_MULTIPLIER;

/** Registro de lo emitido por el bus durante la carrera. */
type Emission =
  | { event: 'coins'; coins: number }
  | { event: 'pickup'; kind: 'turbo' | 'drs' }
  | { event: 'game-over'; summary: GameEvents['game-over'] };

/**
 * Estado de carrera mínimo + el despacho de efectos de GameScene. La lógica
 * de contacto es una réplica exacta de `GameScene.handleTrackContact`.
 */
class RaceCollisions {
  readonly bus = new EventBus<GameEvents>();
  readonly score = new ScoreSystem();
  readonly turbo = new TurboSystem();
  readonly drs = new DrsSystem(() => ALWAYS_ABOVE_DRS);

  coins = 0;
  gameOver = false;
  readonly emissions: Emission[] = [];

  constructor() {
    this.bus.on('coins', (coins) => this.emissions.push({ event: 'coins', coins }));
    this.bus.on('pickup', (kind) => this.emissions.push({ event: 'pickup', kind }));
    this.bus.on('game-over', (summary) =>
      this.emissions.push({ event: 'game-over', summary }),
    );
  }

  /** `GameScene.handleTrackContact` para una entidad de pista de este kind. */
  contact(kind: EntityKind): void {
    if (this.gameOver) {
      return; // el guard de GameScene: tras el crash no hay más contactos
    }
    const def = ENTITY_DEFINITIONS[kind];
    switch (def.effect) {
      case 'collect-coin':
        this.coins += def.coins;
        this.score.addPoints(def.points);
        this.bus.emit('coins', this.coins);
        break;
      case 'collect-turbo':
        this.turbo.refill(TURBO_PICKUP_REFILL);
        this.bus.emit('pickup', 'turbo');
        break;
      case 'collect-drs':
        this.drs.resetCooldown();
        this.bus.emit('pickup', 'drs');
        break;
      case 'slip':
        // playerCar.slip(OIL_SLIP_SECONDS): el derrape no toca el puntaje.
        break;
      case 'crash':
        this.gameOver = true;
        this.bus.emit('game-over', {
          score: this.score.score,
          distance: this.score.distance,
          coins: this.coins,
        });
        break;
    }
  }

  /** Avanza el puntaje por distancia (scroll de la carrera) a la velocidad dada. */
  race(seconds: number, speed: number): void {
    for (let i = 0; i < Math.round(seconds / DT); i += 1) {
      this.score.update(DT, speed);
    }
  }
}

describe('integración colisiones → economía — monedas y puntos separados', () => {
  it('la moneda suma en DOS economías: contador de monedas y puntos planos', () => {
    const race = new RaceCollisions();
    race.race(5, 300); // puntaje por distancia ya corriendo

    const scoreBeforeCoins = race.score.score;
    race.contact('coin');
    race.contact('coin');
    race.contact('coin');

    expect(race.coins).toBe(3 * COIN_VALUE);
    expect(race.score.score).toBe(scoreBeforeCoins + 3 * COIN_SCORE);
    // El bus anunció el total acumulado en cada recolección.
    const coinEvents = race.emissions.filter((e) => e.event === 'coins');
    expect(coinEvents.map((e) => (e.event === 'coins' ? e.coins : -1))).toEqual([1, 2, 3]);
  });

  it('el aceite (slip) NO toca el puntaje ni las monedas ni termina la carrera', () => {
    const race = new RaceCollisions();
    race.race(5, 300);
    const score = race.score.score;

    race.contact('oil');

    expect(race.score.score).toBe(score); // sin puntos
    expect(race.coins).toBe(0); // sin monedas
    expect(race.gameOver).toBe(false); // no destructivo
    expect(race.emissions).toEqual([]); // y sin anuncios de economía
  });
});

describe('integración colisiones → sistemas — pickups data-driven', () => {
  it('el pickup de turbo recarga el medidor y desarma el latch de vaciado', () => {
    const race = new RaceCollisions();

    // Drena el turbo a cero manteniendo el botón (queda con latch: exige
    // soltar el botón antes de poder reactivar).
    let guard = 0;
    while (race.turbo.levelValue > 0 && guard < 1000) {
      race.turbo.update(DT, true);
      guard += 1;
    }
    expect(race.turbo.levelValue).toBe(0);
    expect(race.turbo.isEmptyLatch).toBe(true);

    race.contact('turbo');

    expect(race.turbo.levelValue).toBe(TURBO_PICKUP_REFILL);
    expect(race.turbo.isEmptyLatch).toBe(false); // el pickup re-habilita el uso
    expect(race.emissions).toEqual([{ event: 'pickup', kind: 'turbo' }]);
  });

  it('el pickup de turbo respeta el tope del medidor', () => {
    const race = new RaceCollisions();
    // Medidor lleno: la recarga pasiva y el pickup no pueden pasarse del tope.
    race.turbo.update(1, false);

    race.contact('turbo');

    expect(race.turbo.levelValue).toBe(TURBO_MAX);
  });

  it('el pickup de DRS resetea el cooldown al instante', () => {
    const race = new RaceCollisions();

    // Activa el DRS (el proveedor reporta velocidad sobre el umbral) y lo
    // deja agotar para entrar en cooldown.
    race.drs.update(DT, false); // observar una suelta primero (flanco)
    race.drs.update(DT, true);
    expect(race.drs.state).toBe('active');
    for (let i = 0; i < Math.ceil(4 / DT); i += 1) {
      race.drs.update(DT, true);
    }
    expect(race.drs.state).toBe('cooldown');
    expect(race.drs.cooldownSeconds).toBeGreaterThan(0);

    race.contact('drs');

    expect(race.drs.state).not.toBe('cooldown');
    expect(race.drs.cooldownSeconds).toBe(0);
    expect(race.emissions).toEqual([{ event: 'pickup', kind: 'drs' }]);
  });
});

describe('integración colisiones → fin de carrera — el resumen que viaja', () => {
  it('el crash congela la carrera y emite el resumen completo por el bus', () => {
    const race = new RaceCollisions();
    race.race(10, 420); // 10 s a punta
    race.contact('coin');
    race.contact('coin');
    race.contact('debris');

    expect(race.gameOver).toBe(true);
    expect(race.emissions).toHaveLength(3); // 2 monedas + game-over
    const summary = race.emissions[2];
    expect(summary.event).toBe('game-over');
    if (summary.event !== 'game-over') {
      throw new Error('informativo para el tipado');
    }
    expect(summary.summary.coins).toBe(2 * COIN_VALUE);
    expect(summary.summary.score).toBe(race.score.score);
    expect(summary.summary.distance).toBe(race.score.distance);
    expect(summary.summary.score).toBeGreaterThan(0);
  });

  it('tras el crash los contactos siguientes se ignoran (guard de GameScene)', () => {
    const race = new RaceCollisions();
    race.race(3, 300);
    race.contact('rivalBlue');

    const emissionsAfterCrash = race.emissions.length;
    race.contact('coin');
    race.contact('coin');
    race.contact('oil');

    expect(race.coins).toBe(0);
    expect(race.emissions.length).toBe(emissionsAfterCrash);
  });

  it('cadena completa: carrera con monedas → crash → resumen → guardado → recarga', () => {
    const race = new RaceCollisions();

    race.race(20, 380);
    race.contact('coin');
    race.contact('coin');
    race.contact('coin');
    race.contact('coin');
    race.contact('rivalYellow'); // crash

    const gameOverEvent = race.emissions.find((e) => e.event === 'game-over');
    if (!gameOverEvent || gameOverEvent.event !== 'game-over') {
      throw new Error('el crash debió emitir game-over');
    }
    const summary = gameOverEvent.summary;
    expect(summary.coins).toBe(4 * COIN_VALUE);

    // El resumen del bus ES un RaceSummary: aplica directo al guardado.
    const result = applyRaceResult({ totalCoins: 10, bestScore: 0, bestDistance: 0 }, summary);
    expect(result.isNewBest).toBe(true);
    expect(result.save.totalCoins).toBe(10 + 4 * COIN_VALUE);
    expect(result.save.bestScore).toBe(summary.score);
    // La distancia fraccional se trunca a entero al persistir.
    expect(result.save.bestDistance).toBe(Math.floor(summary.distance));
  });
});
