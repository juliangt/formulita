/*
 * Service worker de Formulita (issue #43 — PWA instalable).
 *
 * Vanilla a propósito, SIN bundling: vive en public/ y Vite lo copia tal
 * cual a dist/, así que el scope del worker queda en la raíz del juego
 * (/formulita/ en Pages) y todas las URLs de abajo son RELATIVAS al propio
 * worker — sobreviven al subpath de GitHub Pages sin configuración.
 *
 * Estrategia (el juego es un SPA de un solo canvas con assets 100%
 * procedurales: el "app shell" acá es TODO lo que hay que cachear):
 * - Navegaciones: NETWORK-FIRST con fallback a la caché. Así una versión
 *   nueva entra apenas hay red (al abrir o recargar), y sin red el juego
 *   igual arranca con la última que se conoció.
 * - Resto same-origin (bundles hashados, manifest, iconos): STALE-WHILE-
 *   REVALIDATE — respuesta al toque desde caché y refresco en segundo
 *   plano para la próxima vez.
 * - Fuera del worker: todo request cross-origin (CDN EU de PostHog,
 *   trackers de señalización de Trystero) y todo no-GET — el multijugador
 *   P2P y la telemetría no pasan por acá ni deben tocar la caché.
 *
 * El nombre de la caché está VERSIONADO: al activarse una versión nueva se
 * borran las viejas (no hay crecimiento infinito ni mezcla de versiones).
 * skipWaiting + clients.claim: el worker nuevo toma el control sin esperar
 * un segundo reload; combinado con network-first, una recarga alcanza para
 * actualizarse.
 */

const CACHE_NAME = 'formulita-v1';

/** App shell: lo mínimo para que el juego arranque sin red. */
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') {
    return;
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }
  // Sin rangos: cache.put de respuestas 206 rompe la caché (y no hay media
  // externa que streamear — el audio es sintético Web Audio).
  if (request.headers.has('range')) {
    return;
  }
  event.respondWith(staleWhileRevalidate(request, event));
});

/**
 * Navegaciones (el HTML del juego): primero la red; si falla, la última
 * versión cacheada del shell. Se cachea bajo la URL canónica './index.html'
 * y bajo la URL pedida ('/formulita/' y '/formulita/index.html' son dos
 * llaves distintas para la caché, aunque sirvan el mismo HTML).
 */
async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) {
      const canonical = new URL('./index.html', self.location.href).href;
      await cache.put('./index.html', fresh.clone());
      if (new URL(request.url).href !== canonical) {
        await cache.put(request, fresh.clone());
      }
    }
    return fresh;
  } catch {
    const cached =
      (await cache.match('./index.html')) ||
      (await cache.match('./')) ||
      (await cache.match(request));
    if (cached) {
      return cached;
    }
    return new Response('Formulita offline: falta la primera visita con red.', {
      status: 503,
      statusText: 'Offline',
    });
  }
}

/**
 * Assets same-origin: respondé rápido desde caché y actualizala en segundo
 * plano (atado a waitUntil para no matar el worker a mitad del refresco).
 * Sin caché previa y sin red: 503 — no hay nada mejor que hacer.
 */
async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(CACHE_NAME);
  const refresh = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        return cache.put(request, response.clone()).then(() => response);
      }
      return response;
    })
    .catch(() => undefined);
  if (event && typeof event.waitUntil === 'function') {
    event.waitUntil(refresh);
  }
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }
  const fresh = await refresh;
  return fresh || new Response('', { status: 503, statusText: 'Offline' });
}
