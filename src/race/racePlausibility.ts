/**
 * racePlausibility — filtro de plausibilidad del progreso ajeno (issue #9, V3).
 *
 * La carrera multi NO tiene árbitro: cada cliente difunde su propio `rstate`
 * y los demás le creen. Con confianza limitada, lo único que se puede validar
 * contra la física LOCAL es el AVANCE: un auto no puede recorrer más px que
 * `CIRCUIT.maxSpeed` × tiempo real transcurrido (el pasto es más lento —
 * `grassMaxSpeedFactor` — y la `v` del payload es la palabra del emisor, no
 * una prueba).
 *
 * Reglas (decisión documentada de V3):
 * - AVANCE imposible (más de lo físicamente posible): el sample se IGNORA
 *   (se espera el próximo `rstate`) y la línea base NO cambia — el próximo
 *   sample se chequea contra la última posición creíble. El chequeo es contra
 *   avances imposibles SOSTENIDOS, no contra jitter: el crédito se acumula en
 *   tiempo real y se banca hasta un intervalo de emisión, así la holgura de
 *   `PLAUSIBILITY_SPEED_FACTOR` tolera ráfagas y retrasos de red sin falsos
 *   positivos a velocidad física máxima.
 * - RETROCESO (progreso menor al aceptado): se ACEPTA. El progreso
 *   desenrollado de un auto legítimo es monótono (no hay reversa), así que un
 *   retroceso no puede GANAR nada — no tiene valor de trampa — y aceptarlo
 *   auto-sana una línea base local corrupta sin congelar al peer para
 *   siempre. Costo aceptado: un glitch raro puede mostrar un salto hacia
 *   atrás del rival (y un descuento en el ranking propio del tramposo).
 * - Primer sample de un peer (o `forget`): se ancla sin chequeo.
 *
 * El crédito se acumula con el reloj de RECEPCIÓN local: un tramposo no lo
 * agranda saturando mensajes — cada sample gasta crédito y el saldo máximo
 * está acotado (`PLAUSIBILITY_MAX_CREDIT_PX`), así la tasa de avance máxima
 * sostenida queda en `maxSpeed × PLAUSIBILITY_SPEED_FACTOR` pase lo que pase.
 *
 * Puro: reloj inyectado por llamada (`nowMs`), cero Phaser, cero red.
 */

import { CIRCUIT, STATE_HZ } from '../config/balance';

/**
 * Holgura del tope físico (factor sobre `CIRCUIT.maxSpeed`): cubre el
 * redondeo entero del wire (`s`/`lap` van redondeados), la cuantización del
 * reloj local y la deriva entre el ritmo de emisión y el de llegada. Con
 * 1.35 un tramposo gana a lo sumo ~35% sobre la física antes de ser ignorado
 * — y un corredor legítimo a velocidad máxima jamás lo dispara.
 */
export const PLAUSIBILITY_SPEED_FACTOR = 1.35;

/**
 * Intervalo de emisión del stream (`1/STATE_HZ`, ms): define cuánto crédito
 * puede BANCARSE entre samples — un `rstate` atrasado por una ráfaga de red
 * trae a lo sumo el avance de un intervalo a velocidad física máxima.
 */
export const PLAUSIBILITY_EMIT_INTERVAL_MS = 1000 / STATE_HZ;

/**
 * Techo de crédito bancado (px): lo que avanza un auto a velocidad física
 * máxima (con la holgura) durante UN intervalo de emisión. Un sample suelto
 * puede gastar hasta esto aunque llegue justo después de otro — el resto del
 * avance imposible se ignora.
 */
export const PLAUSIBILITY_MAX_CREDIT_PX =
  (CIRCUIT.maxSpeed * PLAUSIBILITY_SPEED_FACTOR * PLAUSIBILITY_EMIT_INTERVAL_MS) / 1000;

/** Línea base aceptada de un peer: último progreso creíble y su instante. */
interface PlausibilityBaseline {
  progress: number;
  atMs: number;
  /** Crédito de avance disponible (px) al instante `atMs`. */
  creditPx: number;
}

export class RacePlausibility {
  private baselines = new Map<string, PlausibilityBaseline>();

  /**
   * Consulta si el progreso de un `rstate` es plausible para `peerId` y, si
   * lo es, lo ancla como nueva línea base (consumiendo el crédito gastado).
   * false ⇒ el sample se ignora: ni buffer ni ranking lo ven y la línea base
   * queda en la última posición creíble.
   */
  accept(peerId: string, progress: number, nowMs: number): boolean {
    if (!Number.isFinite(progress) || !Number.isFinite(nowMs)) {
      return false; // Defensa: un sample corrupto no ancla nada.
    }
    const baseline = this.baselines.get(peerId);
    if (!baseline) {
      // Primer sample del peer: crédito completo (pudo moverse un intervalo).
      this.baselines.set(peerId, {
        progress,
        atMs: nowMs,
        creditPx: PLAUSIBILITY_MAX_CREDIT_PX,
      });
      return true;
    }

    // Crédito acumulado en tiempo REAL de recepción, bancado con techo.
    const elapsedMs = Math.max(0, nowMs - baseline.atMs);
    const creditPx = Math.min(
      baseline.creditPx +
        (CIRCUIT.maxSpeed * PLAUSIBILITY_SPEED_FACTOR * elapsedMs) / 1000,
      PLAUSIBILITY_MAX_CREDIT_PX,
    );

    const advance = progress - baseline.progress;
    if (advance > creditPx) {
      return false; // Avance imposible: se ignora, la línea base queda.
    }

    // Avance posible (gasta crédito) o retroceso (lo re-banca, con techo):
    // se ancla en el instante REAL de llegada.
    this.baselines.set(peerId, {
      progress,
      atMs: nowMs,
      creditPx: Math.min(creditPx - advance, PLAUSIBILITY_MAX_CREDIT_PX),
    });
    return true;
  }

  /** Olvida la línea base de un peer (sala que se disuelve, reset de escena). */
  forget(peerId: string): void {
    this.baselines.delete(peerId);
  }

  /** Reinicia todo el estado (SHUTDOWN de la escena). */
  clear(): void {
    this.baselines.clear();
  }
}
