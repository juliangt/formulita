import { describe, expect, it } from 'vitest';
import {
  BASE_SPEED,
  COIN_SCORE,
  DRS_MULTIPLIER,
  DISTANCE_METERS_PER_PIXEL,
  GAMEOVER_TRANSITION_MS,
  MAX_SPEED,
  MIN_SPEED,
  SCORE_BONUS_PER_SECOND,
  SCORE_BONUS_SPEED_FRACTION,
  SCORE_BONUS_WARMUP_SECONDS,
  SCORE_PER_SECOND_AT_BASE_SPEED,
  TURBO_MULTIPLIER,
} from '../config/balance';
import { GAME_HEIGHT, GAME_WIDTH } from '../config/gameConfig';
import { GAME_OVER, MENU, RACE_HUD } from '../config/balance';
import { ScoreSystem } from '../systems/ScoreSystem';

/**
 * Tests del ScoreSystem (Fase 5): puntaje por distancia escalado con la
 * velocidad real, bonus por velocidad sostenida (con warmup y racha),
 * puntos planos de las monedas (separados de la distancia) y defensas de
 * dt/velocidad. Lógica pura: dt inyectado, sin Phaser.
 */

const DT = 1 / 60;

/** Simula `seconds` de ticks con dt fijo a la velocidad dada. */
function tick(score: ScoreSystem, seconds: number, speed: number): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i += 1) {
    score.update(DT, speed);
  }
}

describe('ScoreSystem — puntaje por distancia', () => {
  it('a velocidad base rinde exactamente SCORE_PER_SECOND_AT_BASE_SPEED por segundo', () => {
    const score = new ScoreSystem();
    // 1 s en 4 pasos de 0.25 s: un update individual se acota a 0.25 s
    // (anti-espiral de la muerte, igual que SpeedSystem/DifficultySystem).
    for (let i = 0; i < 4; i += 1) {
      score.update(0.25, BASE_SPEED);
    }

    expect(score.score).toBe(SCORE_PER_SECOND_AT_BASE_SPEED); // 10
  });

  it('escala linealmente con la velocidad real (a MAX_SPEED rinde tasa × MAX/BASE)', () => {
    const score = new ScoreSystem();
    tick(score, 1, MAX_SPEED);

    expect(score.score).toBeCloseTo(SCORE_PER_SECOND_AT_BASE_SPEED * (MAX_SPEED / BASE_SPEED));
  });

  it('la punta compuesta (turbo × DRS) rinde proporcionalmente más', () => {
    const plain = new ScoreSystem();
    tick(plain, 1, MAX_SPEED);
    const boosted = new ScoreSystem();
    tick(boosted, 1, MAX_SPEED * TURBO_MULTIPLIER * DRS_MULTIPLIER);

    expect(boosted.score / plain.score).toBeCloseTo(TURBO_MULTIPLIER * DRS_MULTIPLIER);
  });

  it('a MIN_SPEED rinde la proporción MIN_SPEED / BASE_SPEED de la tasa base', () => {
    const score = new ScoreSystem();
    tick(score, 1, MIN_SPEED);

    const expected = SCORE_PER_SECOND_AT_BASE_SPEED * (MIN_SPEED / BASE_SPEED);
    // El puntaje mostrado es el entero (piso) de la tasa continua 5.33/s.
    expect(score.score).toBe(Math.floor(expected));
    expect(expected).toBeLessThan(SCORE_PER_SECOND_AT_BASE_SPEED);
    expect(expected).toBeGreaterThan(SCORE_PER_SECOND_AT_BASE_SPEED / 2);
  });

  it('acumula igual por frames de 1/60 que por pasos de 0.25 s (mismo tiempo)', () => {
    const frames = new ScoreSystem();
    tick(frames, 1, BASE_SPEED);
    const chunks = new ScoreSystem();
    for (let i = 0; i < 4; i += 1) {
      chunks.update(0.25, BASE_SPEED);
    }

    expect(frames.score).toBeCloseTo(chunks.score);
  });

  it('acumula a lo largo de varios updates', () => {
    const score = new ScoreSystem();
    tick(score, 2.5, BASE_SPEED);

    expect(score.score).toBeCloseTo(SCORE_PER_SECOND_AT_BASE_SPEED * 2.5);
  });

  it('cuenta la distancia recorrida (px)', () => {
    const score = new ScoreSystem();
    tick(score, 2, BASE_SPEED);

    expect(score.distance).toBeCloseTo(BASE_SPEED * 2);
  });

  it('el puntaje es siempre un entero (piso del acumulador fraccional)', () => {
    const score = new ScoreSystem();
    score.update(0.05, MIN_SPEED); // 10 × (MIN/BASE) × 0.05

    expect(Number.isInteger(score.score)).toBe(true);
    expect(score.score).toBe(0); // aún no cruza el primer punto
  });
});

describe('ScoreSystem — bonus por velocidad sostenida', () => {
  /** Umbral efectivo sobre MAX_SPEED (378 px/s con los valores de balance). */
  const THRESHOLD = SCORE_BONUS_SPEED_FRACTION * MAX_SPEED;

  it('bajo el umbral no hay bonus ni racha', () => {
    const score = new ScoreSystem();
    tick(score, 3, THRESHOLD - 1);

    expect(score.speedBonusScore).toBe(0);
    expect(score.sustainedSeconds).toBe(0);
  });

  it('durante el warmup sostiene la racha pero no paga', () => {
    const score = new ScoreSystem();
    // 4 pasos exactos de 0.25 s (exáctos en float): 1 s de racha.
    for (let i = 0; i < 4; i += 1) {
      score.update(0.25, MAX_SPEED);
    }

    expect(score.sustainedSeconds).toBeCloseTo(SCORE_BONUS_WARMUP_SECONDS);
    expect(score.speedBonusScore).toBe(0);
  });

  it('vencido el warmup paga SCORE_BONUS_PER_SECOND por segundo', () => {
    const score = new ScoreSystem();
    // 1 s de warmup + 1 s de bonus facturado.
    for (let i = 0; i < 8; i += 1) {
      score.update(0.25, MAX_SPEED);
    }

    expect(score.speedBonusScore).toBe(SCORE_BONUS_PER_SECOND);
    expect(score.sustainedSeconds).toBeCloseTo(SCORE_BONUS_WARMUP_SECONDS + 1);
  });

  it('el tick que cruza el warmup factura solo su porción (sin regalo)', () => {
    const score = new ScoreSystem();
    for (let i = 0; i < 5; i += 1) {
      score.update(0.25, MAX_SPEED); // 0.75, 1.0 (cruce), 1.25 → 0.25 s facturados
    }

    expect(score.speedBonusScore).toBe(SCORE_BONUS_PER_SECOND * 0.25);
  });

  it('bajar del umbral corta la racha: hay que volver a sostener la velocidad', () => {
    const score = new ScoreSystem();
    tick(score, 3, MAX_SPEED); // racha larga, ya pagando
    const bonusBefore = score.speedBonusScore;
    expect(bonusBefore).toBeGreaterThan(0);

    score.update(0.2, BASE_SPEED); // cae bajo el umbral
    expect(score.sustainedSeconds).toBe(0);

    tick(score, 0.9, MAX_SPEED); // warmup incompleto otra vez: no paga
    expect(score.speedBonusScore).toBeCloseTo(bonusBefore);
  });

  it('el bonus suma al puntaje total junto con la distancia', () => {
    const score = new ScoreSystem();
    const seconds = SCORE_BONUS_WARMUP_SECONDS + 1;
    tick(score, seconds, MAX_SPEED);

    const distancePoints = SCORE_PER_SECOND_AT_BASE_SPEED * (MAX_SPEED / BASE_SPEED) * seconds;
    expect(score.score).toBeCloseTo(distancePoints + SCORE_BONUS_PER_SECOND);
  });
});

describe('ScoreSystem — puntos de monedas (separados de la distancia)', () => {
  it('addPoints suma directo al puntaje sin tocar distancia ni bonus', () => {
    const score = new ScoreSystem();
    score.addPoints(COIN_SCORE);

    expect(score.score).toBe(COIN_SCORE);
    expect(score.distance).toBe(0);
    expect(score.speedBonusScore).toBe(0);
    expect(score.distanceScore).toBe(0);
  });

  it('las monedas se acumulan con el puntaje por distancia', () => {
    const score = new ScoreSystem();
    tick(score, 1, BASE_SPEED);
    score.addPoints(COIN_SCORE);

    expect(score.score).toBe(SCORE_PER_SECOND_AT_BASE_SPEED + COIN_SCORE);
  });

  it('valores inválidos (NaN, 0, negativos, infinito) son no-op', () => {
    const score = new ScoreSystem();
    score.addPoints(Number.NaN);
    score.addPoints(0);
    score.addPoints(-COIN_SCORE);
    score.addPoints(Number.POSITIVE_INFINITY);

    expect(score.score).toBe(0);
  });
});

describe('ScoreSystem — defensas y reset', () => {
  it('dt NaN, negativo o infinito es un no-op', () => {
    const score = new ScoreSystem();
    score.update(Number.NaN, BASE_SPEED);
    score.update(-1, BASE_SPEED);
    score.update(Number.POSITIVE_INFINITY, BASE_SPEED);

    expect(score.score).toBe(0);
    expect(score.distance).toBe(0);
  });

  it('un dt gigante se acota: un tick suma como mucho 0.25 s', () => {
    const score = new ScoreSystem();
    score.update(10, BASE_SPEED);

    expect(score.distance).toBeCloseTo(BASE_SPEED * 0.25);
    // 2.5 pts acumulados → el puntaje mostrado es el piso: 2.
    expect(score.score).toBe(Math.floor(SCORE_PER_SECOND_AT_BASE_SPEED * 0.25));
  });

  it('velocidad inválida (NaN o negativa) no suma puntos ni distancia', () => {
    const score = new ScoreSystem();
    score.update(1, Number.NaN);
    score.update(1, -100);

    expect(score.score).toBe(0);
    expect(score.distance).toBe(0);
  });

  it('reset vuelve al estado inicial', () => {
    const score = new ScoreSystem();
    tick(score, 3, MAX_SPEED);
    score.addPoints(COIN_SCORE);

    score.reset();

    expect(score.score).toBe(0);
    expect(score.distanceScore).toBe(0);
    expect(score.speedBonusScore).toBe(0);
    expect(score.distance).toBe(0);
    expect(score.sustainedSeconds).toBe(0);
  });
});

describe('balance de Fase 5 — sanidad', () => {
  it('el umbral del bonus es una fracción (0,1) y warmup/bonus positivos', () => {
    expect(SCORE_BONUS_SPEED_FRACTION).toBeGreaterThan(0);
    expect(SCORE_BONUS_SPEED_FRACTION).toBeLessThan(1);
    expect(SCORE_BONUS_WARMUP_SECONDS).toBeGreaterThan(0);
    expect(SCORE_BONUS_PER_SECOND).toBeGreaterThan(0);
  });

  it('la conversión de distancia a metros es positiva', () => {
    expect(DISTANCE_METERS_PER_PIXEL).toBeGreaterThan(0);
  });

  it('la transición al Game Over deja ver el crash (≥ 300 ms)', () => {
    expect(GAMEOVER_TRANSITION_MS).toBeGreaterThanOrEqual(300);
  });

  it('los layouts de menú y game over entran en la pantalla 720×1280', () => {
    for (const y of [
      MENU.titleY,
      MENU.subtitleY,
      MENU.carY,
      MENU.recordY,
      MENU.coinsY,
      MENU.playY,
      MENU.helpY,
    ]) {
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(GAME_HEIGHT);
    }
    for (const y of [
      GAME_OVER.titleY,
      GAME_OVER.newRecordY,
      GAME_OVER.scoreY,
      GAME_OVER.distanceY,
      GAME_OVER.coinsY,
      GAME_OVER.recordY,
      GAME_OVER.retryY,
      GAME_OVER.menuY,
      GAME_OVER.hintY,
    ]) {
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(GAME_HEIGHT);
    }
    for (const x of [RACE_HUD.scoreX, RACE_HUD.coinsX, MENU.playWidth, GAME_OVER.buttonWidth]) {
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThanOrEqual(GAME_WIDTH);
    }
    expect(MENU.playY + MENU.playHeight / 2).toBeLessThan(MENU.helpY);
    expect(GAME_OVER.retryY + GAME_OVER.buttonHeight / 2).toBeLessThan(GAME_OVER.menuY);
  });
});
