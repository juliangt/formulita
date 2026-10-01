import { describe, expect, it } from 'vitest';
import { COIN_SCORE, MAX_SPEED } from '../config/balance';
import { EventBus, type GameEvents } from '../core/EventBus';
import { applyRaceResult, defaultSaveData, parseGameOverData } from '../data/types';
import { ScoreSystem } from '../systems/ScoreSystem';
import { FakeStorage } from './fakeStorage';
import { LocalStorageSaveRepository } from '../data/LocalStorageSaveRepository';

/**
 * Tests del flujo de datos de la Fase 5: lo que GameScene produce al morir
 * (evento `game-over` del bus + init data de GameOverScene) llega intacto a
 * la pantalla, con parseo defensivo de payloads faltantes/corruptos, y el
 * resultado de la carrera se aplica al guardado (récords + monedas).
 * Sin Phaser real: solo el EventBus, el ScoreSystem y la capa de datos.
 */

const DT = 1 / 60;

/** Simula una carrera con la misma composición que hace GameScene. */
function simulateRace(seconds: number, speed: number, coinCount: number) {
  const scoreSystem = new ScoreSystem();
  for (let i = 0; i < Math.round(seconds / DT); i += 1) {
    scoreSystem.update(DT, speed);
  }
  for (let i = 0; i < coinCount; i += 1) {
    scoreSystem.addPoints(COIN_SCORE); // lo que GameScene hace al recolectar
  }
  return { score: scoreSystem.score, distance: scoreSystem.distance, coins: coinCount };
}

describe('flujo Game → GameOver — payloads que viajan', () => {
  it('el evento game-over del bus se convierte en datos de GameOverScene', () => {
    const bus = new EventBus<GameEvents>();
    let received: ReturnType<typeof parseGameOverData> | null = null;

    // La escena consume el payload del bus y lo reenvía como init data.
    bus.once('game-over', (payload) => {
      const isNewBest = payload.score > 5000;
      received = parseGameOverData({ ...payload, isNewBest });
    });

    bus.emit('game-over', { score: 1234, distance: 45678, coins: 7 });

    expect(received).toEqual({ score: 1234, distance: 45678, coins: 7, isNewBest: false });
  });

  it('un puntaje superior al récord viaja marcado como nuevo récord', () => {
    const bus = new EventBus<GameEvents>();
    let received: ReturnType<typeof parseGameOverData> | null = null;

    bus.once('game-over', (payload) => {
      received = parseGameOverData({ ...payload, isNewBest: payload.score > 5000 });
    });

    bus.emit('game-over', { score: 9999, distance: 100000, coins: 0 });

    expect(received).toEqual({ score: 9999, distance: 100000, coins: 0, isNewBest: true });
  });

  it('parseGameOverData acepta un payload válido sin alterarlo', () => {
    expect(
      parseGameOverData({ score: 500, distance: 25000, coins: 4, isNewBest: true }),
    ).toEqual({ score: 500, distance: 25000, coins: 4, isNewBest: true });
  });

  it('parseGameOverData completa defaults con payloads faltantes o basura', () => {
    const empty = { score: 0, distance: 0, coins: 0, isNewBest: false };

    expect(parseGameOverData(undefined)).toEqual(empty);
    expect(parseGameOverData(null)).toEqual(empty);
    expect(parseGameOverData('junk')).toEqual(empty);
    expect(parseGameOverData(42)).toEqual(empty);
  });

  it('parseGameOverData normaliza campos inválidos uno por uno', () => {
    expect(parseGameOverData({ score: -5, distance: 'x', coins: 2.9, isNewBest: 'sí' })).toEqual({
      score: 0,
      distance: 0,
      coins: 2,
      isNewBest: false,
    });
  });
});

describe('flujo de carrera → guardado → pantalla', () => {
  it('una carrera completa marca récord, guarda y sobrevive a una nueva sesión', () => {
    const storage = new FakeStorage();
    const repo = new LocalStorageSaveRepository(storage);

    // Carrera 1: 30 s a punta de velocidad + 5 monedas.
    const raceOne = simulateRace(30, MAX_SPEED, 5);
    expect(raceOne.coins).toBe(5);
    expect(raceOne.score).toBeGreaterThan(0);

    const resultOne = applyRaceResult(repo.load(), raceOne);
    expect(resultOne.isNewBest).toBe(true);
    repo.save(resultOne.save);

    // "Recarga de página": nueva instancia sobre el mismo storage.
    const reloaded = new LocalStorageSaveRepository(storage).load();
    expect(reloaded.bestScore).toBe(raceOne.score);
    // El repositorio persiste conteos enteros (toCount hace floor), así que
    // el contrato exacto es: bestDistance == floor(distancia de la carrera).
    expect(reloaded.bestDistance).toBe(Math.floor(raceOne.distance));
    expect(reloaded.totalCoins).toBe(5);

    // Carrera 2, peor: no rompe récords pero suma monedas.
    const resultTwo = applyRaceResult(reloaded, { score: 100, distance: 500, coins: 3 });
    expect(resultTwo.isNewBest).toBe(false);
    expect(resultTwo.save).toEqual({
      totalCoins: 8,
      bestScore: raceOne.score,
      bestDistance: reloaded.bestDistance,
    });
  });

  it('empatar el récord lo conserva (comparación estricta)', () => {
    const save = { ...defaultSaveData(), bestScore: 500 };

    const tie = applyRaceResult(save, { score: 500, distance: 0, coins: 0 });

    expect(tie.isNewBest).toBe(false);
    expect(tie.save.bestScore).toBe(500);
  });

  it('resultados de carrera con valores basura se normalizan antes de aplicar', () => {
    const save = { ...defaultSaveData(), bestScore: 100, bestDistance: 1000 };

    const result = applyRaceResult(save, {
      score: Number.NaN,
      distance: -50,
      coins: 3.9,
    });

    expect(result.isNewBest).toBe(false);
    expect(result.save).toEqual({ totalCoins: 3, bestScore: 100, bestDistance: 1000 });
  });
});
