import { describe, expect, it } from 'vitest';
import { CIRCUIT, STATE_HZ } from '../../config/balance';
import {
  PLAUSIBILITY_MAX_CREDIT_PX,
  PLAUSIBILITY_SPEED_FACTOR,
  RacePlausibility,
} from '../../race/racePlausibility';

/**
 * Tests del filtro de plausibilidad del progreso ajeno (issue #9, V3):
 * sin árbitro P2P, lo único validable contra la física local es el AVANCE.
 * El contrato (documentado en race/racePlausibility.ts):
 *
 * - Avance a velocidad física máxima (con jitter) PASA — cero falsos
 *   positivos: el chequeo es contra avances imposibles, no contra jitter.
 * - Avance imposible (más de lo físicamente posible) se IGNORA y la línea
 *   base NO cambia: el próximo rstate legítimo se chequea contra la última
 *   posición creíble.
 * - Ráfagas de red no ayudan a un tramposo: el crédito se acumula en tiempo
 *   real y se banca con techo — la tasa máxima sostenida queda acotada.
 * - Retrocesos se ACEPTAN (no tienen valor de trampa y auto-sanan una línea
 *   base local corrupta sin congelar al peer para siempre).
 */

/** Un intervalo de emisión del stream (ms): el paso natural del stream. */
const STEP_MS = 1000 / STATE_HZ;

/** Avance máximo posible en un intervalo (px): física × holgura. */
const MAX_STEP_PX = (CIRCUIT.maxSpeed * PLAUSIBILITY_SPEED_FACTOR * STEP_MS) / 1000;

describe('racePlausibility — RacePlausibility (filtro del progreso ajeno, V3)', () => {
  it('el primer sample se ancla sin chequeo (no hay contra qué comparar)', () => {
    const filter = new RacePlausibility();
    expect(filter.accept('beto', 1000, 0)).toBe(true);
  });

  it('avance legítimo a velocidad MÁXIMA pasa siempre (cero falsos positivos)', () => {
    const filter = new RacePlausibility();
    expect(filter.accept('beto', 0, 0)).toBe(true);
    // maxSpeed px/s durante un intervalo exacto, 20 intervalos seguidos.
    const stepPx = (CIRCUIT.maxSpeed * STEP_MS) / 1000;
    let progress = 0;
    for (let step = 1; step <= 20; step += 1) {
      progress += stepPx;
      expect(filter.accept('beto', progress, step * STEP_MS)).toBe(true);
    }
  });

  it('avance a velocidad máxima + jitter (por debajo del tope con holgura) pasa', () => {
    const filter = new RacePlausibility();
    expect(filter.accept('beto', 0, 0)).toBe(true);
    // Un pelín por encima de la física pero dentro de la holgura: jitter de
    // reloj/red legítimo — el chequeo NO es contra esto.
    const jitteredStep = MAX_STEP_PX - 1;
    expect(filter.accept('beto', jitteredStep, STEP_MS)).toBe(true);
  });

  it('avance IMPOSIBLE se ignora y la línea base queda en la última posición creíble', () => {
    const filter = new RacePlausibility();
    expect(filter.accept('beto', 0, 0)).toBe(true);

    // Salta más de lo físicamente posible en un intervalo: rechazado.
    const impossible = MAX_STEP_PX + 1;
    expect(filter.accept('beto', impossible, STEP_MS)).toBe(false);

    // La línea base no cambió: el próximo sample legítimo (desde 0) pasa.
    const legit = MAX_STEP_PX - 5;
    expect(filter.accept('beto', legit, 2 * STEP_MS)).toBe(true);
  });

  it('una ráfaga de mensajes NO agranda el techo: el crédito se banca con tope', () => {
    const filter = new RacePlausibility();
    expect(filter.accept('beto', 0, 0)).toBe(true);

    // 10 samples en el MISMO instante reclamando casi el crédito completo:
    // sólo el primero pasa — el crédito bancado es el techo, no 10 techos.
    const claim = PLAUSIBILITY_MAX_CREDIT_PX - 1;
    expect(filter.accept('beto', claim, STEP_MS)).toBe(true);
    for (let burst = 2; burst <= 10; burst += 1) {
      expect(filter.accept('beto', claim * burst, STEP_MS)).toBe(false);
    }

    // Y en el intervalo siguiente el avance sigue acotado al crédito de UN
    // intervalo: la tasa máxima sostenida es maxSpeed × holgura.
    expect(
      filter.accept('beto', claim + MAX_STEP_PX + 1, 2 * STEP_MS),
    ).toBe(false);
  });

  it('un sample batched legítimo (dos rstate llegan juntos) pasa: el crédito banca', () => {
    const filter = new RacePlausibility();
    expect(filter.accept('beto', 0, 0)).toBe(true);
    // El emisor emite a 20 Hz con dt real 0 entre llegadas: cada state trae
    // medio intervalo de avance a velocidad física máxima — ambos pasan.
    const halfStep = (CIRCUIT.maxSpeed * (STEP_MS / 2)) / 1000;
    expect(filter.accept('beto', halfStep, STEP_MS)).toBe(true);
    expect(filter.accept('beto', 2 * halfStep, STEP_MS)).toBe(true);
  });

  it('RETROCESO se acepta (no gana nada) y auto-sana una línea base corrupta', () => {
    const filter = new RacePlausibility();
    expect(filter.accept('beto', 0, 0)).toBe(true);
    // El peer se adelantó un pelín más de la cuenta con un glitch plausible:
    // la línea base quedó adelante de su posición real.
    expect(filter.accept('beto', MAX_STEP_PX - 1, STEP_MS)).toBe(true);

    // Su posición real está muy atrás: el retroceso se acepta (documentado:
    // sin valor de trampa) y re-banca crédito con techo.
    const realPosition = 10;
    expect(filter.accept('beto', realPosition, 2 * STEP_MS)).toBe(true);

    // Desde la posición re-anclada vuelve a avanzar con normalidad.
    const resumed = realPosition + (CIRCUIT.maxSpeed * STEP_MS) / 1000;
    expect(filter.accept('beto', resumed, 3 * STEP_MS)).toBe(true);
  });

  it('sample no finito se rechaza (defensa, no ancla nada)', () => {
    const filter = new RacePlausibility();
    expect(filter.accept('beto', Number.NaN, 0)).toBe(false);
    expect(filter.accept('beto', Number.POSITIVE_INFINITY, 0)).toBe(false);
    expect(filter.accept('beto', 0, Number.NaN)).toBe(false);
    // Y tras el rechazo el peer arranca limpio (el NaN no ancló).
    expect(filter.accept('beto', 0, 0)).toBe(true);
  });

  it('la línea base es POR PEER: un tramposo no contamina a los demás', () => {
    const filter = new RacePlausibility();
    expect(filter.accept('beto', 0, 0)).toBe(true);
    expect(filter.accept('ana', 0, 0)).toBe(true);

    expect(filter.accept('beto', MAX_STEP_PX + 100, STEP_MS)).toBe(false);
    expect(filter.accept('ana', MAX_STEP_PX - 1, STEP_MS)).toBe(true);
  });

  it('forget re-ancla sin chequeo y clear resetea todo (reset de escena)', () => {
    const filter = new RacePlausibility();
    expect(filter.accept('beto', 0, 0)).toBe(true);
    expect(filter.accept('beto', MAX_STEP_PX + 100, STEP_MS)).toBe(false);

    filter.forget('beto');
    expect(filter.accept('beto', MAX_STEP_PX + 100, STEP_MS)).toBe(true);

    filter.clear();
    expect(filter.accept('ana', 5000, 9999)).toBe(true);
  });
});
