/**
 * ISfxEngine — contrato mínimo del audio del juego (Fase 6).
 *
 * Segregación de interfaces (plan §SOLID): los consumidores solo conocen
 * ESTA interfaz pequeña — disparar SFX nombrados y el ciclo de vida
 * (unlock/mute/dispose) — nunca la implementación Web Audio concreta.
 *
 * El control del dron del motor (arrancar/parar/velocidad) NO vive acá:
 * lo maneja `AudioManager` internamente al consumir el EventBus (el bus es
 * el desacoplador elegido: las escenas dicen QUÉ pasó y el audio decide
 * CÓMO sonar — ver documentación de `AudioManager.attachBus`).
 *
 * Implementación: `AudioManager` (Web Audio API pura, cero assets). El
 * juego NUNCA depende del sonido: toda la implementación es defensiva y
 * degrada a no-op si Web Audio no existe o falla.
 */

/** SFX nombrados soportados (síntesis programática, sin archivos). */
export type SfxName =
  /** Blip corto de botón de UI (menú, game over, mute). */
  | 'click'
  /** Moneda recogida (blip de dos tonos). */
  | 'coin'
  /** Pickup de turbo/DRS recogido (barrido ascendente). */
  | 'pickup'
  /** Turbo activado (whoosh de ruido filtrado). */
  | 'turbo'
  /** DRS activado (hiss de ruido agudo). */
  | 'drs'
  /** Golpe no letal (rival/piedra): thump grave y corto (issue #10, H2). */
  | 'damage'
  /** Choque destructivo (ruido + caída de tono). */
  | 'crash'
  /**
   * Largada del GRAN PREMIO (issue #14, V3): arpegio ascendente en el GO! del
   * countdown. Sólo lo pide la rama vs CPU (práctica y multi no cambian).
   */
  | 'go'
  /**
   * Cambio de posición en el ranking vivo del GRAN PREMIO (#14, V3):
   * "zip" corto de adelantamiento — mismo sonido al ganar o perder el lugar
   * (la dirección se lee en el badge Pn/N del HUD).
   */
  | 'overtake';

export interface ISfxEngine {
  /** Estado de silencio actual (persistido entre sesiones). */
  readonly isMuted: boolean;

  /**
   * Dispara un SFX por su nombre. Nunca lanza: si el audio no está
   * disponible (sin Web Audio, contexto fallido) o está muteado, es no-op.
   */
  play(sfx: SfxName): void;

  /**
   * Desbloquea el AudioContext (política de autoplay móvil): crea el
   * contexto si falta y hace `resume()` si está suspendido. Idempotente y
   * pensado para llamarse en el primer gesto (pointerdown/keydown).
   */
  unlock(): void;

  /**
   * Aplica el mute y lo persiste. Nunca lanza (si el storage falla, el
   * mute igualmente rige para la sesión actual).
   */
  setMuted(muted: boolean): void;

  /** Libera recursos (listeners, contexto). No revivir después de llamar. */
  dispose(): void;
}

/**
 * Clave del motor de audio como servicio de larga vida en el registry de
 * Phaser (`game.registry`): se inyecta una vez en Boot y todas las
 * escenas/pantallas lo consumen. Inversión de dependencias: para reemplazar
 * el motor basta `game.registry.set(AUDIO_ENGINE_REGISTRY_KEY, otro)` antes
 * de Boot.
 */
export const AUDIO_ENGINE_REGISTRY_KEY = 'audioEngine';
