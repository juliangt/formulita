# Configuración y publicación

Variables de entorno, analítica y deploy. En desarrollo alcanza con `cp .env.example .env.local` (ver también el [README](../README.md#empezar)).

## `VITE_TRYSTERO_APP_ID`

| Dónde | Cómo |
| --- | --- |
| Desarrollo local | `cp .env.example .env.local` y ajustá el valor (`.env.local` está gitignored) |
| Producción (Pages) | Variable de repo `VITE_TRYSTERO_APP_ID` en **Settings → Secrets and variables → Actions → Variables** (la lee el workflow de deploy al buildear) |

- **Qué es**: el namespace de matchmaking de Trystero — un string público que agrupa las salas de ESTA aplicación dentro de los trackers de señalización. **NO es un secreto ni una API key**: queda visible en el bundle, y dos navegadores solo se encuentran si usan el mismo appId + la misma palabra de sala.
- **Si falta**: el build funciona igual (el requisito es de RUNTIME, no de build); al abrir el multijugador o el chat el lobby **falla rápido** con el error visible "falta VITE_TRYSTERO_APP_ID" en vez de conectar en silencio.

## `VITE_TRYSTERO_RELAYS` (opcional)

- **Qué es**: la lista de **trackers de señalización BitTorrent** que usa Trystero para el encuentro inicial entre jugadores (CSV de `wss://`/`ws://`). El tracker es solo el casamentero: una vez establecida la conexión, el tráfico del juego es **P2P directo** entre navegadores y nunca pasa por él.
- **Si falta o queda vacía**: la librería usa sus trackers default — comportamiento actual; no hace falta definirla.
- **Cuándo cambiarlo**: solo si querés depender de trackers propios (autoalojados) o si un default dejara de funcionar.
- **Riesgo de fragmentación**: la sala existe DENTRO de los trackers usados — dos jugadores con listas **disjuntas** (sin ningún tracker en común) nunca se encuentran, aunque compartan appId y palabra de sala; con al menos un tracker compartido sí conectan. Cualquier lista custom tiene que ser **igual en todas las instalaciones** (coordiná el cambio con todos los jugadores).
- Formato y validación: `wss://a, wss://b` — se ignoran entradas vacías o sin `wss://`/`ws://`; si la variable tiene contenido pero ninguna URL válida, el multijugador **falla rápido** con error visible (no degrada en silencio a los defaults, que fragmentaría el matchmaking). Con lista custom se usan TODAS las URLs (la redundancia de la librería solo aplica a sus defaults).
- **Producción (Pages)**: para que llegue al deploy hay que agregarla al paso de build de [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) junto a `VITE_TRYSTERO_APP_ID` (`VITE_TRYSTERO_RELAYS: ${{ vars.VITE_TRYSTERO_RELAYS }}`); en dev alcanza con `.env.local`.

## Analítica (PostHog Cloud EU, issue #27)

La analítica está **APAGADA por default** y es opt-in del administrador del deploy (no del jugador): hay que crear el proyecto y definir el token como variable de entorno, como se describe abajo. Mientras no haya token, no se pide ni un byte del SDK.

**Qué se mide** (y nada más — `autocapture: false`, sólo eventos explícitos):

| Evento | Properties | Cuándo |
| --- | --- | --- |
| Pageview | — (el default del loader) | al cargar la página |
| `partida_iniciada` | `modo` (`entrenar` \| `gran_premio` \| `multijugador`), `pista` (sólo gran premio y carrera multi), `dificultad` (sólo gran premio: `easy`/`normal`/`hard`), `desgaste` (sólo gran premio, #39: booleano del toggle DESGASTE) | al arrancar una partida desde el menú o desde el lobby |
| `vuelta_completada` | `pista`, `duracion_ms` | cada vuelta válida del jugador local en RaceScene (gran premio y carrera multi; nunca por rival) |

**Qué NO se mide — cero PII**: nombres de jugador, contenido de chat, peer IDs ni datos de presencia jamás viajan en las properties (el código fuente es el contrato: [`src/telemetry/analytics.ts`](../src/telemetry/analytics.ts) es el único punto de contacto, y los ganchos viven en `MenuScene`, `LobbyScene` y `RaceScene`).

**Sin cookies ni storage ⇒ sin banner de consentimiento**: el proyecto se usa en modo **cookieless `always`** — PostHog no le pega un ID anónimo al visitante; cada evento se identifica server-side con un hash IRREVERSIBLE del request con **sal diaria**, así que no hay retención de identidad entre sesiones. El juego no escribe cookies ni `localStorage`/`sessionStorage` por telemetría, y por eso no necesita banner. Todo el flujo va por **PostHog Cloud EU** (API y assets en la UE).

**Activación (paso manual, una sola vez)**:

1. Crear el proyecto en **<https://eu.posthog.com>** con el modo **"Cookieless server hash mode"** habilitado (y, si querés máxima sobriedad, GeoIP deshabilitado en la configuración del proyecto).
2. Definir el **Project API token** como variable `VITE_POSTHOG_TOKEN` (issues #27 y #41): en dev, `cp .env.example .env.local` y completarla; en producción, como variable de repo en el paso de build de [`deploy.yml`](../.github/workflows/deploy.yml). El token es público por diseño (viaja al navegador dentro del bundle). **Vacía o ausente = analítica apagada** (ni siquiera se carga el SDK).
3. En desarrollo local (`npm run dev`) no hace falta nada: el loader ([`src/telemetry/posthogLoader.ts`](../src/telemetry/posthogLoader.ts)) además está gateado por hostname y en `localhost`/`file://` no carga nada.

La telemetría es **fire-and-forget**: `trackEvent` nunca lanza ni bloquea el juego — con el SDK bloqueado (uBlock), sin red o a medio cargar, el juego corre idéntico.

## Publicación (GitHub Pages)

Los workflows corren **solo manualmente** — pestaña **Actions** → elegir workflow → **Run workflow** — sin disparadores automáticos por push ni PR:

- **Deploy a GitHub Pages** ([`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)): corre la suite completa, buildea con `--base=/formulita/` (Pages sirve los sitios de proyecto bajo subpath) y publica en **<https://juliangt.github.io/formulita/>**.
- **CI** ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)): tests + build, sin deploy.

Requisitos (una sola vez, quien administra el repo):

1. **Settings → Secrets and variables → Actions → Variables** (no Secrets): `VITE_TRYSTERO_APP_ID` (p. ej. `formulita`). Opcional: `VITE_POSTHOG_TOKEN` (analítica — sin ella queda apagada) y `VITE_TRYSTERO_RELAYS` (trackers custom — sin ella usa los defaults).

> El sitio de Pages no requiere configuración manual: `deploy.yml` usa `actions/configure-pages` con `enablement: true`, así que habilita el sitio (source "GitHub Actions") en el propio run si aún no existe. Sin la variable, en cambio, el sitio se publica igual (el appId es runtime, no build-time), pero el multijugador mostrará el error de configuración faltante al entrar al lobby.
