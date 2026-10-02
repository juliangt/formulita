/**
 * EventBus — emitter tipado sin dependencia de Phaser.
 *
 * Desacopla sistemas ↔ HUD ↔ escenas según el plan (principio D): los
 * productores emiten eventos y los consumidores se suscriben, sin referencias
 * cruzadas hardcodeadas.
 */

/** Tipo de handler para un evento con payload `P`. */
export type EventHandler<P> = (payload: P) => void;

/** Estado del DRS que consume el chip del HUD (Fase 3). */
export type DrsStatus = 'off' | 'ready' | 'active' | 'cooldown';

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
  /** Velocidad de avance efectiva en px/s (para el velocímetro del HUD). */
  speed: number;
  /** Turbo: nivel del medidor (0–100) y si está activo en este instante. */
  turbo: { level: number; active: boolean };
  /**
   * DRS: estado del chip + progreso de cooldown (`cooldownRatio` 1 → recién
   * entra en cooldown, 0 → termina; 0 siempre fuera de cooldown) y segundos
   * restantes de cooldown (`cooldownSeconds`).
   */
  drs: { state: DrsStatus; cooldownRatio: number; cooldownSeconds: number };
  /**
   * Salud del vehículo (issue #10, H2): HP actual (entero, 0 = muerto) y
   * fracción de vida (0–1) para la barra del HUD. Se emite con el estado
   * inicial en create() y tras cada cambio de HP (impactos y roce continuo).
   */
  health: { hp: number; ratio: number };
  /**
   * Impacto puntual APLICADO (no i-frames): dispara el SFX de golpe. Es un
   * evento aparte de `health` porque el roce con pared drena HP por frame y
   * emitiría el sonido en cada tick; acá solo viajan los golpes secos.
   */
  damage: undefined;
  /** Toggle de mute del audio. */
  mute: boolean;
  /** Click de UI (botones de menú/game over/mute): dispara el SFX de click. */
  'ui-click': undefined;
  /**
   * Pickup recolectado (`'turbo' | 'drs' | 'repair'` según el tipo): dispara
   * el SFX de pickup. Los eventos `turbo`/`drs` de estado no sirven para esto
   * (se emiten por frame), por eso el contacto con el pickup emite el suyo.
   */
  pickup: 'turbo' | 'drs' | 'repair';
  /** Fin de la carrera (colisión con rival o resto). */
  'game-over': { score: number; distance: number; coins: number };
  /** Inicio de una carrera nueva. */
  'game-start': undefined;
  /**
   * La carrera entró en pausa (botón, tecla P o pérdida de foco — Fase 7).
   * El AudioManager apaga el dron del motor; el overlay de pausa no necesita
   * payload (el flag `auto` viaja como init data de la escena de pausa).
   */
  'game-paused': undefined;
  /** La carrera salió de la pausa (REANUDAR / P / ESC): vuelve el dron. */
  'game-resumed': undefined;
  /**
   * La carrera se abandonó sin crash (MENÚ desde la pausa — Fase 7): corta el
   * dron del motor sin sonar el SFX de crash (a diferencia de `game-over`).
   */
  'game-aborted': undefined;
  /**
   * GO! del countdown del GRAN PREMIO (issue #14, V3): dispara el SFX de
   * largada. Sólo lo emite la rama vs CPU (`RaceScene.finishCountdown` hace
   * el gate) — la práctica y el multi no cambian su comportamiento. Distinto
   * de `game-start` (que arranca el dron en TODOS los modos y no suena).
   */
  'race-go': undefined;
  /**
   * La posición propia del ranking vivo del GRAN PREMIO (#14, V3) cambió
   * (adelantó o lo adelantaron): dispara el SFX de adelantamiento. El
   * enfriamiento (~2 s, máx. 1 sonido por cambio) lo decide el detector puro
   * (`race/racePositionSwap`) ANTES de emitir — el bus nunca recibe rafagas.
   */
  'race-overtake': undefined;
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

/**
 * Bus de SESIÓN (Fase 6): una única instancia de `EventBus<GameEvents>`
 * compartida por toda la partida, resuelta del registry de Phaser igual que
 * el repositorio de guardado. Lo consumen las escenas (para emitir y para
 * conectar el HUD) y el AudioManager (para sonar), de modo que los eventos
 * de gameplay (`coins`, `speed`, `game-over`…) y los de UI (`mute`,
 * `ui-click`) tengan UN solo canal en toda la app.
 *
 * Ojo: por ser compartido, NADIE debe llamar `clear()` sobre él; los
 * consumidores por-escena (widgets del HUD) se desuscriben en su
 * `destroy()`, y los de larga vida (audio) viven mientras vive la página.
 */
export const EVENT_BUS_REGISTRY_KEY = 'eventBus';

/** Porción del registry de Phaser que la resolución consume. */
interface RegistrySlice {
  get(key: string): unknown;
  set(key: string, value: unknown): unknown;
}

/**
 * Resuelve el bus de sesión (registry de Phaser): si otro módulo ya puso
 * uno, se respeta esa decisión; si no, crea el default y lo cachea para que
 * toda la sesión comparta la misma instancia.
 */
export function getSessionEventBus(registry: RegistrySlice): EventBus<GameEvents> {
  const existing = registry.get(EVENT_BUS_REGISTRY_KEY);
  if (existing instanceof EventBus) {
    return existing;
  }
  const created = new EventBus<GameEvents>();
  registry.set(EVENT_BUS_REGISTRY_KEY, created);
  return created;
}
