/// <reference types="vite/client" />

/**
 * Tipado de las variables de entorno de Vite que el juego consume
 * (además de las built-in de vite/client). Ver `.env.example`.
 */
interface ImportMetaEnv {
  /**
   * Namespace de matchmaking de Trystero (multijugador P2P). Opcional en
   * tipos, pero OBLIGATORIO en runtime para el multijugador: si falta, el
   * lobby falla rápido con un error visible (resolveAppId).
   */
  readonly VITE_TRYSTERO_APP_ID?: string;
  /**
   * Trackers de señalización BitTorrent custom de Trystero (CSV de
   * `wss://`/`ws://`). OPCIONAL: si falta, la librería usa sus defaults
   * (resolveRelayUrls, issue #8). Misma lista en TODAS las instalaciones:
   * listas distintas fragmentan el matchmaking.
   */
  readonly VITE_TRYSTERO_RELAYS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
