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
  LOBBY,
  MAX_SPEED,
  MIN_SPEED,
  PLAYER_LATERAL_ACCELERATION,
  PLAYER_LATERAL_DRAG,
  PLAYER_MAX_LATERAL_SPEED,
  PLAYER_START_Y,
  PLAYER_TILT_MAX_DEGREES,
  SCORE_PER_SECOND_AT_BASE_SPEED,
  TRACK,
  TRACK_PICKER,
  TURBO_DRAIN_PER_SECOND,
  TURBO_MAX,
  TURBO_MULTIPLIER,
  TURBO_PICKUP_REFILL,
  TURBO_REGEN_PER_SECOND,
} from '../config/balance';
import { GAME_HEIGHT, GAME_WIDTH } from '../config/gameConfig';
import { TRACKS } from '../race/tracks';

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

/* ------------------------------------------------------------------ */
/* Selectores de pista con 6 filas: sin solapamientos (issue #26)      */
/* ------------------------------------------------------------------ */

/**
 * El registro tiene 6 pistas (GÁLVEZ entró con #26) y ambos pickers dibujan
 * UNA fila por pista con layouts pensados para 5: la 6ª fila pisaba otros
 * elementos. Estos tests fijan el criterio del issue — "sin solapamientos y
 * dentro del panel" — sobre las constantes de layout (aritmética pura, el
 * mismo modelo que usan MenuScene y LobbyScene al pintar):
 *
 * - Fila del menú (TRACK_PICKER): botón de `rowHeight` centrado en la fila,
 *   hint debajo con `hintGap` de aire y `hintFontSize` de alto (origin 0.5,0:
 *   el y del hint es su borde superior).
 * - Fila del lobby (LOBBY.track*): miniatura de `trackThumbSize` (88, lo más
 *   alto de la fila) y botón de `trackRowButtonHeight` (84) comparten centro.
 *
 * El aire mínimo de 16 px contra DIFICULTAD / CERRAR es la condición dura del
 * issue. Si mañana se suma una 7ª pista sin recompactar, estos tests fallan
 * antes de que el overlay quede roto en pantalla.
 */
describe('TRACK_PICKER — GRAN PREMIO: 6 filas sin solapamientos (issue #26)', () => {
  /** Borde superior/inferior del panel (el centro va en `panelY`). */
  const panelTop = TRACK_PICKER.panelY - TRACK_PICKER.panelHeight / 2;
  const panelBottom = TRACK_PICKER.panelY + TRACK_PICKER.panelHeight / 2;
  /** Centro Y de cada fila de pista, una por entrada del registro. */
  const rows = TRACKS.map((_, index) => TRACK_PICKER.rowStartY + index * TRACK_PICKER.rowStep);
  const buttonTop = (y: number): number => y - TRACK_PICKER.rowHeight / 2;
  /** Borde inferior de la fila completa: el hint cuelga bajo el botón. */
  const rowBottom = (y: number): number =>
    y + TRACK_PICKER.rowHeight / 2 + TRACK_PICKER.hintGap + TRACK_PICKER.hintFontSize;
  const labelTop = TRACK_PICKER.difficultyLabelY - TRACK_PICKER.difficultyLabelFontSize / 2;
  const labelBottom = TRACK_PICKER.difficultyLabelY + TRACK_PICKER.difficultyLabelFontSize / 2;

  it('las filas del registro quedan dentro del panel y sin tocarse entre sí', () => {
    expect(buttonTop(rows[0])).toBeGreaterThanOrEqual(panelTop);
    for (let i = 1; i < rows.length; i += 1) {
      expect(buttonTop(rows[i]), `la fila ${i} pisa el hint de la fila ${i - 1}`).toBeGreaterThanOrEqual(
        rowBottom(rows[i - 1]),
      );
    }
    expect(rowBottom(rows[rows.length - 1])).toBeLessThanOrEqual(panelBottom);
  });

  it('la última fila queda ≥ 16 px por encima del rótulo DIFICULTAD DEL RIVAL', () => {
    expect(rowBottom(rows[rows.length - 1]) + 16, 'el hint de la última fila pisa el rótulo').toBeLessThanOrEqual(
      labelTop,
    );
  });

  it('el rótulo de dificultad no pisa sus botones ni el toggle DESGASTE (#39)', () => {
    const difficultyTop = TRACK_PICKER.difficultyRowY - TRACK_PICKER.difficultyButtonHeight / 2;
    const difficultyBottom = TRACK_PICKER.difficultyRowY + TRACK_PICKER.difficultyButtonHeight / 2;
    expect(difficultyTop).toBeGreaterThanOrEqual(labelBottom);
    const wearTop = TRACK_PICKER.wearRowY - TRACK_PICKER.wearButtonHeight / 2;
    expect(wearTop, 'la fila de dificultad pisa el toggle DESGASTE').toBeGreaterThanOrEqual(
      difficultyBottom + 16,
    );
  });

  it('el toggle DESGASTE (#39) no pisa CERRAR y CERRAR queda dentro del panel', () => {
    const wearBottom = TRACK_PICKER.wearRowY + TRACK_PICKER.wearButtonHeight / 2;
    expect(
      TRACK_PICKER.closeY - TRACK_PICKER.closeHeight / 2,
      'el toggle DESGASTE pisa CERRAR',
    ).toBeGreaterThanOrEqual(wearBottom + 16);
  });

  it('CERRAR queda completo dentro del panel, debajo de todo el contenido', () => {
    // El subtítulo mide 30 px de fuente; la primera fila arranca debajo.
    expect(buttonTop(rows[0])).toBeGreaterThanOrEqual(TRACK_PICKER.subtitleY + 15);
    expect(TRACK_PICKER.closeY + TRACK_PICKER.closeHeight / 2).toBeLessThanOrEqual(panelBottom);
    // El panel crecido (#39) no puede salirse del lienzo 720×1280.
    expect(panelBottom).toBeLessThanOrEqual(1280);
  });
});

describe('LOBBY — picker de pistas: 6 filas sin solapamientos (issue #26)', () => {
  const panelTop = LOBBY.trackPanelY - LOBBY.trackPanelHeight / 2;
  const panelBottom = LOBBY.trackPanelY + LOBBY.trackPanelHeight / 2;
  /** Centro Y de cada fila (miniatura + botón comparten centro). */
  const rows = TRACKS.map((_, index) => LOBBY.trackRowStartY + index * LOBBY.trackRowStep);
  /** La miniatura (88) es lo más alto de la fila; el botón mide 84. */
  const rowHalf = LOBBY.trackThumbSize / 2;

  it('las 6 filas quedan dentro del panel y sin tocarse entre sí', () => {
    expect(rows[0] - rowHalf).toBeGreaterThanOrEqual(panelTop);
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i] - rowHalf, `la fila ${i} pisa la fila ${i - 1}`).toBeGreaterThanOrEqual(
        rows[i - 1] + rowHalf,
      );
    }
    expect(rows[rows.length - 1] + rowHalf).toBeLessThanOrEqual(panelBottom);
  });

  it('la última fila queda ≥ 16 px por encima de CERRAR', () => {
    const closeTop = LOBBY.trackCloseY - LOBBY.trackCloseHeight / 2;
    expect(rows[rows.length - 1] + rowHalf + 16, 'la última fila pisa CERRAR').toBeLessThanOrEqual(closeTop);
  });

  it('CERRAR queda completo dentro del panel, debajo del título y de las filas', () => {
    expect(LOBBY.trackTitleY).toBeLessThanOrEqual(rows[0] - rowHalf);
    expect(LOBBY.trackCloseY + LOBBY.trackCloseHeight / 2).toBeLessThanOrEqual(panelBottom);
  });
});
