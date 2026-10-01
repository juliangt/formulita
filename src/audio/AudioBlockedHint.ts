/**
 * Overlay DOM del hint "audio bloqueado" (issue #4, Fase 2 — Ring/Silent).
 *
 * Es la mitad PRESENTACIONAL del aviso: el AudioManager decide CUÁNDO (una
 * vez por sesión, solo si el contexto no quedó `running` tras el gesto — ver
 * `shouldShowAudioBlockedHint`) y acá vive solo el CÓMO: un div fixed discreto
 * con fade in/out, `pointer-events: none` (no bloquea input del juego) y
 * auto-remoción a los ~4 s. Estilo consistente con los otros overlays DOM del
 * juego (eco de toques y build tag en `src/main.ts`): monospace, esquina
 * inferior, respetando el safe area del notch. Nunca lanza: si el DOM no
 * existe (SSR) o algo falla, el juego sigue.
 */

const HINT_TEXT = 'Revisá el volumen y el silencio del teléfono';
const HINT_VISIBLE_MS = 4000;
const HINT_FADE_MS = 300;

/** Nodo visible hoy (dedupe de llamadas repetidas de distintas instancias). */
let hintNode: HTMLElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | undefined;

/** Muestra el hint con fade in y programa su auto-remoción. Idempotente. */
export function showAudioBlockedHint(): void {
  try {
    if (typeof document === 'undefined') {
      return;
    }
    if (hintNode) {
      clearTimeout(hideTimer);
      scheduleHide();
      return;
    }
    const node = document.createElement('div');
    node.textContent = HINT_TEXT;
    node.setAttribute('role', 'status');
    node.style.cssText = [
      'position:fixed',
      'left:50%',
      'bottom:calc(env(safe-area-inset-bottom, 0px) + 56px)',
      'transform:translateX(-50%)',
      'max-width:80vw',
      'padding:8px 14px',
      'background:rgba(0,0,0,0.65)',
      'border:1px solid rgba(255,255,255,0.25)',
      'border-radius:6px',
      'font:12px monospace',
      'color:rgba(255,255,255,0.85)',
      'letter-spacing:0.5px',
      'text-align:center',
      'pointer-events:none',
      'z-index:40',
      'opacity:0',
      `transition:opacity ${HINT_FADE_MS}ms ease-out`,
    ].join(';');
    document.body.appendChild(node);
    hintNode = node;
    // Fade-in: el navegador pinta primero el opacity 0 y recién entonces
    // transiciona a 1 (un cambio en el mismo frame no anima).
    requestAnimationFrame(() => {
      node.style.opacity = '1';
    });
    scheduleHide();
  } catch {
    // El hint es cosmético: su fallo no toca el juego.
  }
}

/** Auto-remoción: fade out a los ~4 s y quita el nodo tras la transición. */
function scheduleHide(): void {
  hideTimer = setTimeout(() => {
    const node = hintNode;
    hintNode = null;
    if (!node) {
      return;
    }
    node.style.opacity = '0';
    setTimeout(() => {
      try {
        node.remove();
      } catch {
        // Ya removido por otra vía: nada que hacer.
      }
    }, HINT_FADE_MS + 50);
  }, HINT_VISIBLE_MS);
}
