import { describe, expect, it } from 'vitest';
import {
  AUDIO,
  BASE_SPEED,
  COIN_SCORE,
  COIN_VALUE,
  DRS_COOLDOWN_SECONDS,
  DRS_DURATION_SECONDS,
  DRS_MULTIPLIER,
  DRS_SPEED_THRESHOLD,
  MAX_SPEED,
  MIN_SPEED,
  PLAYER_LATERAL_ACCELERATION,
  PLAYER_LATERAL_DRAG,
  PLAYER_MAX_LATERAL_SPEED,
  PLAYER_START_Y,
  PLAYER_TILT_MAX_DEGREES,
  SCORE_PER_SECOND_AT_BASE_SPEED,
  TRACK,
  TURBO_DRAIN_PER_SECOND,
  TURBO_MAX,
  TURBO_MULTIPLIER,
  TURBO_PICKUP_REFILL,
  TURBO_REGEN_PER_SECOND,
} from '../config/balance';
import { GAME_HEIGHT, GAME_WIDTH } from '../config/gameConfig';

/**
 * Tests de sanidad de balance: los valores deben existir y ser coherentes
 * entre sí (el plan los define en §Valores iniciales de balance). Si alguien
 * ajusta un número y rompe una invariante, esto avisa.
 */
describe('balance', () => {
  it('velocidades de avance: max > base > min, todas positivas', () => {
    expect(MIN_SPEED).toBeGreaterThan(0);
    expect(MAX_SPEED).toBeGreaterThan(MIN_SPEED);
    expect(BASE_SPEED).toBeGreaterThan(MIN_SPEED);
    expect(BASE_SPEED).toBeLessThan(MAX_SPEED);
  });

  it('turbo: multiplicador > 1 y drenaje/recarga sanas', () => {
    expect(TURBO_MULTIPLIER).toBeGreaterThan(1);
    expect(TURBO_MAX).toBeGreaterThan(0);
    expect(TURBO_DRAIN_PER_SECOND).toBeGreaterThan(0);
    expect(TURBO_REGEN_PER_SECOND).toBeGreaterThan(0);
    // La recarga pasiva es más lenta que el drenaje (si no, turbo infinito).
    expect(TURBO_REGEN_PER_SECOND).toBeLessThan(TURBO_DRAIN_PER_SECOND);
    expect(TURBO_PICKUP_REFILL).toBeGreaterThan(0);
    expect(TURBO_PICKUP_REFILL).toBeLessThanOrEqual(TURBO_MAX);
  });

  it('turbo: duración total ≈ 3.5 s según el plan', () => {
    const duration = TURBO_MAX / TURBO_DRAIN_PER_SECOND;
    expect(duration).toBeGreaterThan(3);
    expect(duration).toBeLessThan(4);
  });

  it('DRS: duración y cooldown positivas, cooldown > duración', () => {
    expect(DRS_MULTIPLIER).toBeGreaterThan(1);
    expect(DRS_DURATION_SECONDS).toBeGreaterThan(0);
    expect(DRS_COOLDOWN_SECONDS).toBeGreaterThan(DRS_DURATION_SECONDS);
  });

  it('DRS: umbral de velocidad es una fracción (0, 1) exclusiva', () => {
    expect(DRS_SPEED_THRESHOLD).toBeGreaterThan(0);
    expect(DRS_SPEED_THRESHOLD).toBeLessThan(1);
  });

  it('monedas y puntaje: valores positivos', () => {
    expect(COIN_VALUE).toBeGreaterThanOrEqual(1);
    expect(COIN_SCORE).toBeGreaterThan(0);
    expect(SCORE_PER_SECOND_AT_BASE_SPEED).toBeGreaterThan(0);
  });

  it('jugador: parámetros laterales positivos e inclinación acotada', () => {
    expect(PLAYER_LATERAL_ACCELERATION).toBeGreaterThan(0);
    expect(PLAYER_LATERAL_DRAG).toBeGreaterThan(0);
    expect(PLAYER_MAX_LATERAL_SPEED).toBeGreaterThan(0);
    expect(PLAYER_TILT_MAX_DEGREES).toBeGreaterThan(0);
    expect(PLAYER_TILT_MAX_DEGREES).toBeLessThanOrEqual(15);
  });

  it('jugador: posición inicial dentro de la pantalla', () => {
    expect(PLAYER_START_Y).toBeGreaterThan(0);
    expect(PLAYER_START_Y).toBeLessThan(GAME_HEIGHT);
  });

  it('pista: layout simétrico y coherente con la resolución', () => {
    expect(TRACK.width).toBe(GAME_WIDTH);
    expect(TRACK.barrierWidth).toBeGreaterThan(0);
    expect(TRACK.kerbWidth).toBeGreaterThan(0);
    // roadLeft = barrera + kerb; roadRight simétrico.
    expect(TRACK.roadLeft).toBe(TRACK.barrierWidth + TRACK.kerbWidth);
    expect(TRACK.roadRight).toBe(TRACK.width - TRACK.roadLeft);
    expect(TRACK.roadLeft).toBeLessThan(TRACK.roadRight);
  });

  it('pista: el alto del tile divide exactamente a la pantalla (tiling limpio)', () => {
    expect(TRACK.tileHeight).toBeGreaterThan(0);
    expect(TRACK.tileHeight).toBeLessThan(GAME_HEIGHT);
    expect(GAME_HEIGHT % TRACK.tileHeight).toBe(0);
  });

  it('pista: hay asfalto jugable suficiente para el auto', () => {
    const roadWidth = TRACK.roadRight - TRACK.roadLeft;
    // El auto mide 48 px (12 px × escala 4); el asfalto debe sobrepasarlo.
    expect(roadWidth).toBeGreaterThan(48);
  });

  it('audio: el dron del motor tiene parámetros positivos y turbo ≥ 1', () => {
    expect(AUDIO.engineVolume).toBeGreaterThan(0);
    expect(AUDIO.engineVolume).toBeLessThan(1);
    expect(AUDIO.engineFreqMin).toBeGreaterThan(0);
    expect(AUDIO.engineFreqMax).toBeGreaterThan(AUDIO.engineFreqMin);
    expect(AUDIO.engineTurboBoost).toBeGreaterThanOrEqual(1);
    // El lowpass deja pasar al menos la fundamental de punta.
    expect(AUDIO.engineFilterHz).toBeGreaterThan(AUDIO.engineFreqMax);
    expect(AUDIO.engineFilterTurboHz).toBeGreaterThan(AUDIO.engineFilterHz);
  });

  it('audio: el perfil móvil del dron es el desktop una octava arriba (issue #4)', () => {
    // Los parlantes de un celular apenas reproducen < ~400 Hz: la banda
    // desktop (55–235 Hz) puede ser físicamente inaudible ahí. El perfil
    // móvil sube UNA octava exacta para entrar en banda reproducible.
    expect(AUDIO.engineFreqMinMobile).toBe(AUDIO.engineFreqMin * 2);
    expect(AUDIO.engineFreqMaxMobile).toBe(AUDIO.engineFreqMax * 2);
    // La fundamental de punta móvil entra de lleno en la banda reproducible.
    expect(AUDIO.engineFreqMinMobile).toBeGreaterThan(100);
    expect(AUDIO.engineFreqMaxMobile).toBeGreaterThan(400);
    // El parlante chico rinde menos: la ganancia móvil compensa (≥ desktop).
    expect(AUDIO.engineVolumeMobile).toBeGreaterThanOrEqual(AUDIO.engineVolume);
    expect(AUDIO.engineVolumeMobile).toBeLessThan(1);
    // El lowpass móvil deja pasar los armónicos de la banda nueva.
    expect(AUDIO.engineFilterHzMobile).toBeGreaterThan(AUDIO.engineFreqMaxMobile);
    expect(AUDIO.engineFilterTurboHzMobile).toBeGreaterThan(AUDIO.engineFilterHzMobile);
  });
});
