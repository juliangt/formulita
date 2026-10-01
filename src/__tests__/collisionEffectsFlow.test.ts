import { describe, expect, it } from 'vitest';
import {
  BASE_SPEED,
  COIN_SCORE,
  COIN_VALUE,
  DRS_MULTIPLIER,
  HEALTH,
  MAX_SPEED,
  TURBO_MAX,
  TURBO_MULTIPLIER,
  TURBO_PICKUP_REFILL,
} from '../config/balance';
import { EventBus, type GameEvents } from '../core/EventBus';
import { applyRaceResult } from '../data/types';
import { ENTITY_DEFINITIONS, type EntityKind } from '../entities/entityTypes';
import { DrsSystem } from '../systems/DrsSystem';
import { HealthSystem } from '../systems/HealthSystem';
import { ScoreSystem } from '../systems/ScoreSystem';
import { SpeedSystem } from '../systems/SpeedSystem';
import { TurboSystem } from '../systems/TurboSystem';

/**
 * Integración Fases 4/5 + issue #10 (H2) — el flujo de puntos y de daño de
 * las colisiones SIN Phaser.
 *
 * Es la composición que GameScene ejecuta en `handleTrackContact`: el efecto
 * declarado en `entityTypes` (data-driven, `CollisionEffect`) se despacha
 * sobre los sistemas puros — ScoreSystem (puntos de monedas), TurboSystem
 * (recarga), DrsSystem (reset de cooldown), HealthSystem + SpeedSystem
 * (daño gradual por choques y roce) — y se anuncia por el bus (`coins`,
 * `pickup`, `health`, `damage`, `game-over`). El despacho de acá es un espejo
 * fiel del switch de GameScene (`applyImpact` incluido); lo que se verifica
 * es el CONTRATO entre definiciones, sistemas y bus (las partículas, el
 * shake y los sprites son QA manual del README).
 */

const DT = 1 / 60;

/** Umbral de DRS sobre el que el proveedor de velocidad reporta siempre. */
const ALWAYS_ABOVE_DRS = MAX_SPEED * 2 * TURBO_MULTIPLIER * DRS_MULTIPLIER;

/** Registro de lo emitido por el bus durante la carrera. */
type Emission =
  | { event: 'coins'; coins: number }
  | { event: 'pickup'; kind: 'turbo' | 'drs' | 'repair' }
  | { event: 'health'; hp: number; ratio: number }
  | { event: 'damage' }
  | { event: 'game-over'; summary: GameEvents['game-over'] };

/**
 * Estado de carrera mínimo + el despacho de efectos de GameScene. La lógica
 * de contacto es una réplica exacta de `GameScene.handleTrackContact` y de
 * su `applyImpact` (issue #10, H2).
 */
class RaceCollisions {
  readonly bus = new EventBus<GameEvents>();
  readonly score = new ScoreSystem();
  readonly turbo = new TurboSystem();
  readonly drs = new DrsSystem(() => ALWAYS_ABOVE_DRS);
  readonly health = new HealthSystem();
  readonly speed = new SpeedSystem();

  coins = 0;
  gameOver = false;
  /** Piedras recicladas al pool (`spawnSystem.release` en GameScene). */
  debrisReleased = 0;
  /** Pickups reciclados al pool (`spawnSystem.release` en GameScene). */
  pickupsReleased = 0;
  readonly emissions: Emission[] = [];

  /** Espejo del guard `lastEmittedHp` de `GameScene.emitHealth`. */
  private lastEmittedHp: number = HEALTH.max;

  constructor() {
    this.bus.on('coins', (coins) => this.emissions.push({ event: 'coins', coins }));
    this.bus.on('pickup', (kind) => this.emissions.push({ event: 'pickup', kind }));
    this.bus.on('health', (payload) => this.emissions.push({ event: 'health', ...payload }));
    this.bus.on('damage', () => this.emissions.push({ event: 'damage' }));
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
        this.pickupsReleased += 1;
        this.bus.emit('pickup', 'turbo');
        break;
      case 'collect-drs':
        this.drs.resetCooldown();
        this.pickupsReleased += 1;
        this.bus.emit('pickup', 'drs');
        break;
      case 'collect-repair':
        this.health.heal(HEALTH.repairAmount);
        this.pickupsReleased += 1;
        this.bus.emit('pickup', 'repair');
        this.emitHealth();
        break;
      case 'slip':
        // playerCar.slip(OIL_SLIP_SECONDS): el derrape no toca el puntaje.
        break;
      case 'crash':
        this.applyImpact(def.kind);
        break;
    }
  }

  /**
   * `GameScene.applyImpact` (issue #10, H2): daño por familia contra el
   * HealthSystem; la piedra se libera SIEMPRE, el rival nunca.
   */
  private applyImpact(kind: EntityKind): void {
    const def = ENTITY_DEFINITIONS[kind];
    if (def.family === 'hazard') {
      this.debrisReleased += 1;
    }
    const amount =
      def.family === 'rival' ? HEALTH.impactDamage.rival : HEALTH.impactDamage.debris;
    const result = this.health.damage(amount);
    if (result === 'ignored') {
      return;
    }
    if (result === 'dead') {
      this.emitHealth();
      this.gameOver = true;
      this.bus.emit('game-over', {
        score: this.score.score,
        distance: this.score.distance,
        coins: this.coins,
      });
      return;
    }
    this.speed.penalize(HEALTH.impactSpeedLoss);
    this.bus.emit('damage', undefined);
    this.emitHealth();
  }

  /** `GameScene.emitHealth`: emite el estado de salud cuando el HP cambia. */
  private emitHealth(): void {
    if (this.health.hp === this.lastEmittedHp) {
      return; // mismo guard que GameScene: a vida llena el botiquín no emite
    }
    this.lastEmittedHp = this.health.hp;
    this.bus.emit('health', { hp: this.health.hp, ratio: this.health.ratio });
  }

  /**
   * Hace tictac la salud sin contacto (expiran i-frames), igual que
   * `healthSystem.update(dt)` en el gate de física de GameScene.
   */
  tick(seconds: number): void {
    for (let i = 0; i < Math.round(seconds / DT); i += 1) {
      this.health.update(DT);
    }
  }

  /**
   * `GameScene.update` con `playerCar.scrapingWall` en true: tictac de
   * i-frames + drenaje continuo de `scrape(dt)`; HP 0 → crash.
   */
  scrapeAgainstWall(seconds: number): void {
    for (let i = 0; i < Math.round(seconds / DT); i += 1) {
      if (this.gameOver) {
        return;
      }
      this.health.update(DT);
      const hpBefore = this.health.hp;
      if (this.health.scrape(DT) === 'dead') {
        this.emitHealth();
        this.gameOver = true;
        this.bus.emit('game-over', {
          score: this.score.score,
          distance: this.score.distance,
          coins: this.coins,
        });
        return;
      }
      if (this.health.hp !== hpBefore) {
        this.emitHealth();
      }
    }
  }

  /** Avanza el puntaje por distancia (scroll de la carrera) a la velocidad dada. */
  race(seconds: number, speed: number): void {
    for (let i = 0; i < Math.round(seconds / DT); i += 1) {
      this.score.update(DT, speed);
      this.health.update(DT);
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
  it('el HP 0 dispara el flujo de crash y emite el resumen completo por el bus', () => {
    const race = new RaceCollisions();
    race.race(10, 420); // 10 s a punta
    race.contact('coin');
    race.contact('coin');
    // 5 piedras (20 de daño cada una, con i-frames entre impactos) = 100 HP.
    for (let i = 0; i < 5; i += 1) {
      race.contact('debris');
      race.tick(HEALTH.invulnerabilitySeconds + DT);
    }

    expect(race.gameOver).toBe(true);
    expect(race.health.hp).toBe(0);
    const gameOverEvent = race.emissions.find((e) => e.event === 'game-over');
    expect(gameOverEvent).toBeDefined();
    if (!gameOverEvent || gameOverEvent.event !== 'game-over') {
      throw new Error('informativo para el tipado');
    }
    expect(gameOverEvent.summary.coins).toBe(2 * COIN_VALUE);
    expect(gameOverEvent.summary.score).toBe(race.score.score);
    expect(gameOverEvent.summary.distance).toBe(race.score.distance);
    expect(gameOverEvent.summary.score).toBeGreaterThan(0);
  });

  it('tras el crash los contactos siguientes se ignoran (guard de GameScene)', () => {
    const race = new RaceCollisions();
    race.race(3, 300);
    // 3 rivales (35 de daño cada uno) con i-frames entre impactos = muerte.
    for (let i = 0; i < 3; i += 1) {
      race.contact('rivalBlue');
      race.tick(HEALTH.invulnerabilitySeconds + DT);
    }
    expect(race.gameOver).toBe(true);

    const emissionsAfterCrash = race.emissions.length;
    race.contact('coin');
    race.contact('coin');
    race.contact('oil');
    race.contact('debris');

    expect(race.coins).toBe(0);
    expect(race.emissions.length).toBe(emissionsAfterCrash);
  });

  it('cadena completa: carrera con monedas → crash (HP 0) → resumen → guardado → recarga', () => {
    const race = new RaceCollisions();

    race.race(20, 380);
    race.contact('coin');
    race.contact('coin');
    race.contact('coin');
    race.contact('coin');
    // 3 rivales con i-frames entre impactos: 3 × 35 = 105 ≥ 100 HP.
    for (let i = 0; i < 3; i += 1) {
      race.contact('rivalYellow');
      race.tick(HEALTH.invulnerabilitySeconds + DT);
    }

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

describe('integración colisiones → salud gradual (issue #10, H2)', () => {
  it('un impacto no letal acumula HP perdido, penaliza la velocidad y anuncia por el bus', () => {
    const race = new RaceCollisions();
    race.race(2, 400); // el ScoreSystem corre

    race.contact('rivalBlue');

    expect(race.health.hp).toBe(HEALTH.max - HEALTH.impactDamage.rival);
    expect(race.speed.speed).toBe(BASE_SPEED - HEALTH.impactSpeedLoss); // penalize
    expect(race.gameOver).toBe(false);
    expect(race.emissions).toEqual([
      { event: 'damage' },
      { event: 'health', hp: HEALTH.max - HEALTH.impactDamage.rival, ratio: 0.65 },
    ]);
  });

  it('la piedra hace MENOS daño que el rival (20 vs 35) y se recicla al impacto', () => {
    const race = new RaceCollisions();

    race.contact('debris');

    expect(race.health.hp).toBe(HEALTH.max - HEALTH.impactDamage.debris);
    expect(race.debrisReleased).toBe(1);
    expect(race.gameOver).toBe(false);
  });

  it('los i-frames ignoran el segundo golpe inmediato (y la piedra igual se rompe)', () => {
    const race = new RaceCollisions();

    race.contact('rivalBlue'); // golpe aplicado: arma i-frames
    const emissionsAfterFirst = race.emissions.length;
    race.contact('rivalBlue'); // dentro de i-frames: ignorado

    expect(race.health.hp).toBe(HEALTH.max - HEALTH.impactDamage.rival);
    expect(race.emissions.length).toBe(emissionsAfterFirst);

    race.contact('debris'); // piedra en i-frames: sin daño, pero SE ROMPE
    expect(race.health.hp).toBe(HEALTH.max - HEALTH.impactDamage.rival);
    expect(race.debrisReleased).toBe(1);

    race.tick(HEALTH.invulnerabilitySeconds + DT); // expiran los i-frames
    race.contact('rivalBlue'); // vuelve a doler: castigo estándar

    expect(race.health.hp).toBe(HEALTH.max - 2 * HEALTH.impactDamage.rival);
  });

  it('el aceite (slip) NO hace daño al chasis', () => {
    const race = new RaceCollisions();

    race.contact('oil');

    expect(race.health.hp).toBe(HEALTH.max);
    expect(race.gameOver).toBe(false);
    expect(race.emissions).toEqual([]);
  });

  it('3 choques de rival (o 5 piedras) alcanzan para matar — el DoD del issue', () => {
    const porRivales = new RaceCollisions();
    for (let i = 0; i < 3; i += 1) {
      porRivales.contact('rivalGreen');
      porRivales.tick(HEALTH.invulnerabilitySeconds + DT);
    }
    expect(porRivales.gameOver).toBe(true);
    expect(porRivales.health.hp).toBe(0);

    const porPiedras = new RaceCollisions();
    for (let i = 0; i < 5; i += 1) {
      porPiedras.contact('debris');
      porPiedras.tick(HEALTH.invulnerabilitySeconds + DT);
    }
    expect(porPiedras.gameOver).toBe(true);
    expect(porPiedras.health.hp).toBe(0);
  });
});

describe('integración colisiones → roce con pared (issue #10, H2)', () => {
  it('el roce drena HEALTH.scrapePerSecond HP/s (sin i-frames, daño continuo)', () => {
    const race = new RaceCollisions();

    race.scrapeAgainstWall(1);

    expect(race.health.hp).toBe(HEALTH.max - HEALTH.scrapePerSecond);
    expect(race.gameOver).toBe(false);
    // El drenaje continuo NO suena el SFX de golpe (solo impactos puntuales).
    expect(race.emissions.some((e) => e.event === 'damage')).toBe(false);
  });

  it('el roce con i-frames activos igual drena (la pared no respeta i-frames)', () => {
    const race = new RaceCollisions();
    race.contact('rivalBlue'); // arma i-frames

    race.scrapeAgainstWall(0.5);

    // El HP vive en enteros: 7.5 HP pendientes → se aplican 7 (residuo 0.5).
    expect(race.health.hp).toBe(
      HEALTH.max - HEALTH.impactDamage.rival - Math.floor(HEALTH.scrapePerSecond * 0.5),
    );
  });

  it('mantener el roce ~7 s llega a HP 0 y dispara el flujo de crash', () => {
    const race = new RaceCollisions();

    race.scrapeAgainstWall(7); // 100 HP / 15 HP/s ≈ 6.67 s

    expect(race.gameOver).toBe(true);
    expect(race.health.hp).toBe(0);
    const gameOverEvent = race.emissions.find((e) => e.event === 'game-over');
    expect(gameOverEvent).toBeDefined();
    // La barra recibió el estado final en 0 antes del game-over.
    const lastHealth = [...race.emissions]
      .reverse()
      .find((e) => e.event === 'health');
    expect(lastHealth).toEqual({ event: 'health', hp: 0, ratio: 0 });
  });
});

describe('integración colisiones → botiquín (issue #10, H3)', () => {
  it('el botiquín cura +35 con anuncio por el bus y el pickup se libera', () => {
    const race = new RaceCollisions();
    race.contact('rivalBlue'); // 100 → 65
    race.tick(HEALTH.invulnerabilitySeconds + DT);
    race.contact('debris'); // 65 → 45
    race.emissions.length = 0;

    race.contact('repair');

    expect(race.health.hp).toBe(45 + HEALTH.repairAmount);
    expect(race.pickupsReleased).toBe(1);
    expect(race.emissions).toEqual([
      { event: 'pickup', kind: 'repair' },
      { event: 'health', hp: 45 + HEALTH.repairAmount, ratio: 0.8 },
    ]);
  });

  it('dos botiquines segundan curan parcial y luego al tope: 45 → 80 → 100 (clamp)', () => {
    const race = new RaceCollisions();
    race.contact('rivalBlue'); // 100 → 65
    race.tick(HEALTH.invulnerabilitySeconds + DT);
    race.contact('debris'); // 65 → 45
    race.tick(HEALTH.invulnerabilitySeconds + DT);
    race.emissions.length = 0;

    race.contact('repair');
    expect(race.health.hp).toBe(45 + HEALTH.repairAmount); // 80

    race.contact('repair');
    expect(race.health.hp).toBe(HEALTH.max); // 80 + 35 = 115 → clamp al tope
    expect(race.pickupsReleased).toBe(2);
    const healthEvents = race.emissions.filter((e) => e.event === 'health');
    expect(healthEvents).toEqual([
      { event: 'health', hp: 45 + HEALTH.repairAmount, ratio: 0.8 },
      { event: 'health', hp: HEALTH.max, ratio: 1 },
    ]);
  });

  it('a vida llena es un no-op de curación (cura 0) pero se consume y anuncia pickup', () => {
    const race = new RaceCollisions();

    race.contact('repair');

    expect(race.health.hp).toBe(HEALTH.max);
    expect(race.pickupsReleased).toBe(1); // el pickup igual se consume
    // SFX (por `pickup`) y burst ocurren en GameScene; el bus NO emite
    // `health` (guard de emitHealth: el HP mostrado no cambió).
    expect(race.emissions).toEqual([{ event: 'pickup', kind: 'repair' }]);
  });
});
