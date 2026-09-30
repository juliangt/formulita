/**
 * EventBus — emitter tipado sin dependencia de Phaser.
 *
 * Desacopla sistemas ↔ HUD ↔ escenas según el plan (principio D): los
 * productores emiten eventos y los consumidores se suscriben, sin referencias
 * cruzadas hardcodeadas.
 */

/** Tipo de handler para un evento con payload `P`. */
export type EventHandler<P> = (payload: P) => void;

/**
 * Mapa de eventos del juego. Cada clave es un nombre de evento y su tipo es
 * el payload que transporta. Se irá extendiendo en fases posteriores
 * (ver PLAN_DESARROLLO.md).
 */
export type GameEvents = {
  /** Puntaje actual del jugador. */
  score: number;
  /** Cantidad de monedas recolectadas en la carrera actual. */
  coins: number;
  /** Velocidad actual en px/s (para el velocímetro del HUD). */
  speed: number;
  /** Nivel del medidor de turbo (0–100). */
  turbo: number;
  /** Estado del DRS. */
  drs: 'off' | 'ready' | 'active' | 'cooldown';
  /** Toggle de mute del audio. */
  mute: boolean;
  /** Fin de la carrera (colisión con rival o resto). */
  'game-over': { score: number; distance: number; coins: number };
  /** Inicio de una carrera nueva. */
  'game-start': undefined;
};

export class EventBus<TEvents extends object> {
  private readonly handlers = new Map<keyof TEvents, Set<EventHandler<never>>>();

  /**
   * Suscribe un handler a un evento.
   * @returns Función de desuscripción.
   */
  on<K extends keyof TEvents>(event: K, handler: EventHandler<TEvents[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as EventHandler<never>);
    return () => {
      this.off(event, handler);
    };
  }

  /** Desuscribe un handler de un evento. */
  off<K extends keyof TEvents>(event: K, handler: EventHandler<TEvents[K]>): void {
    this.handlers.get(event)?.delete(handler as EventHandler<never>);
  }

  /**
   * Suscribe un handler que se ejecuta una sola vez y se desuscribe solo.
   * @returns Función de desuscripción (si se llama antes del emit, el handler nunca se ejecuta).
   */
  once<K extends keyof TEvents>(event: K, handler: EventHandler<TEvents[K]>): () => void {
    const wrapped: EventHandler<TEvents[K]> = (payload) => {
      this.off(event, wrapped);
      handler(payload);
    };
    return this.on(event, wrapped);
  }

  /** Emite un evento con su payload. No lanza error si no hay listeners. */
  emit<K extends keyof TEvents>(event: K, payload: TEvents[K]): void {
    const set = this.handlers.get(event);
    if (!set || set.size === 0) {
      return;
    }
    // Se itera sobre una copia para permitir que un handler se desuscriba
    // (off/once) durante el emit sin romper la iteración.
    for (const handler of [...set]) {
      handler(payload as never);
    }
  }

  /** Cantidad de handlers activos para un evento (útil para tests/debug). */
  listenerCount<K extends keyof TEvents>(event: K): number {
    return this.handlers.get(event)?.size ?? 0;
  }

  /** Limpia todos los handlers de todos los eventos. */
  clear(): void {
    this.handlers.clear();
  }
}
