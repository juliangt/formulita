# Arquitectura y tests

Principios SOLID: escenas que solo orquestan, lógica pura testeable, input/audio/persistencia detrás de interfaces.

## Árbol de `src/`

```
src/
├── main.ts               # bootstrap + guards de gestos móviles
├── config/
│   ├── gameConfig.ts     # Scale.FIT, pixelArt, Arcade Physics, 720×1280, escenas
│   └── balance.ts        # TODOS los números de gameplay (ajustables sin tocar lógica)
├── core/EventBus.ts      # emitter tipado que desacopla sistemas ↔ HUD ↔ audio
├── scenes/               # Boot → Preload → Menu → Game → GameOver, Race (circuito),
│                         #   Lobby (multi), Chat (overlay) y Pause (overlay)
├── systems/              # lógica pura: Speed, Turbo, Drs, Countdown, Pause,
│                         #   Spawn (scheduler + ObjectPool), Difficulty, Score,
│                         #   Input (Keyboard/Touch), TextureFactory (pixel art),
│                         #   VirtualClock (pista determinista), MatchTracker (multi)
├── entities/             # PlayerCar, RivalCar, Hazard, Coin, Pickup, GhostCar (+ defs)
├── net/                  # multijugador P2P: NetClient + TrysteroNetClient, protocolo,
│                         #   lobby (roster/colores/anfitrión), roomRng (seed por sala),
│                         #   interpolación de fantasmas, handoff lobby → carrera,
│                         #   ChatClient + TrysteroChatClient (sala pública social)
├── race/                 # carrera en circuito: núcleo puro — TrackPath,
│                         #   CircuitPhysics, LapTracker (vueltas/sectores), parrilla,
│                         #   ranking/clasificación, plausibilidad, staleness,
│                         #   interpolación de rivales, controles y 6 pistas validadas;
│                         #   GRAN PREMIO: rivales IA (racing line con apex,
│                         #   errores humanos, goma) y récords por pista × dificultad
├── chat/                 # chat social: ChatStore puro (sanitize 200 /
│                         #   throttle 1,5 s por hilo / no leídos / bloqueo sesión),
│                         #   adaptadores roomChat/dmChat, sesión social
│                         #   (socialChatSession), vistas puras presenceView/dmView
├── ui/                   # HUD: Speedometer, EnergyBar, DrsIndicator, ScoreHud,
│                         #   botones (MenuButton, PixelButton, MuteButton) y
│                         #   ChatPanel (lista + input DOM + ENVIAR del chat)
├── audio/                # AudioManager (ISfxEngine): SFX sintéticos Web Audio + dron
│                         #   del motor; mute persistido, desbloqueo por primer gesto
├── pwa/                  # PWA instalable (#43): registro del service worker (solo
│                         #   producción, nunca lanza) + manager del prompt de
│                         #   instalación con telemetría anónima; el SW vive en public/
└── data/                 # ISaveRepository → LocalStorageSaveRepository (fallback en
                          memoria); punto de extensión para scoreboard HTTP
```

## Decisiones clave

- **EventBus tipado de sesión**: las escenas emiten eventos (`speed`, `coins`, `game-over`, `game-paused`…) y el HUD/audio reaccionan sin acoplarse. Los widgets se desuscriben en su `destroy()`.
- **Object pooling con límite duro** por familia de entidad: ninguna sesión larga crea objetos sin tope; las partículas también tienen `maxParticles`.
- **Pausa real por `scene.pause()`**: la escena de juego congela update, física, tweens, timers y partículas; el overlay vive en una escena aparte (`PauseScene`) porque una escena pausada tampoco procesa su input.
- **Texturas 100% procedurales** (`Graphics.generateTexture()` una vez en Preload; la viñeta de turbo es un gradiente de canvas horneado una vez). Sin `Graphics` dinámicos en `update`.
- **Persistencia con interfaz** (`ISaveRepository`): swap a un repositorio HTTP futuro sin refactor del juego.
- **PWA instalable (#43)**: manifest + service worker **vanilla** en `public/` (copiado tal cual por Vite: el scope cae en la raíz del juego y las URLs relativas sobreviven al subpath `/formulita/` de Pages). Shell offline (el juego baja cero assets externos) con navegaciones **network-first** — las actualizaciones entran al recargar — y assets **stale-while-revalidate**; caché versionada (`formulita-v1`) con limpieza en `activate`. Cross-origin (CDN de PostHog, trackers de Trystero) y no-GET quedan afuera. El registro (`src/pwa/serviceWorkerRegistration.ts`) corre solo en `import.meta.env.PROD` con URL relativa y es **no-op seguro** (nunca lanza — mismo contrato que la telemetría); el manager del prompt (`src/pwa/installPrompt.ts`) observa `beforeinstallprompt`/`appinstalled` **sin `preventDefault`** (el banner nativo de Android queda intacto) y alimenta la telemetría anónima `pwa_installed`.

## Tests

- 130 archivos / 1787 tests en `src/__tests__/`, corridos con `npm test` (Vitest, entorno `happy-dom` + stub de contexto 2D en `src/__tests__/setup.ts`).
- **Modo solo**: lógica pura de todos los sistemas (velocidad, turbo, DRS, spawn con pasabilidad + pool, dificultad, puntaje, countdown, pausa, input con multi-touch, derrape, persistencia, audio con fakes de Web Audio) + tests de integración sin runtime de Phaser (input → steering, SpawnScheduler × Difficulty, colisiones → economía, carrera → guardado → recarga).
- **Multijugador**: lobby y carrera compartida contra un hub en memoria (`fakes/FakeNetClient.ts`) — roster/colores/anfitrión, pista determinista por seed, stream a 10 Hz con fantasmas interpolados, eliminaciones/stale/desconexiones, y el flujo COMPLETO de una partida de 3 clientes que exige el MISMO ranking en los tres.
- **Chat social**: ChatStore (sanitize/throttle por hilo/no leídos/bloqueo), TrysteroChatClient contra hub fake (presencia opt-in, heartbeat, stale, DM/invite) y flujo COMPLETO de 3 clientes (`socialFullFlow.test.ts`), 100% determinista con reloj/timers inyectados.
- **Carrera en circuito**: pistas validadas (curvatura/banda de duración de vuelta), física y anti-corte (LapTracker por sectores), parrilla determinista, ranking/clasificación, plausibilidad y staleness, protocolo `rstate`/`rfin`/`race-over` y flujos completos practice/multi.
- **Gran Premio**: roster de 7 rivales determinista por seed, presets de dificultad en orden estricto (fácil < normal < difícil, probados sobre simulación headless a 60 Hz), línea de carrera, payload de resultados con parseo defensivo y récords por pista × dificultad (round-trip, JSON corrupto, storage roto → memoria, claves aisladas).
- **Telemetría (#27, loader desde #41)**: wrapper no-op seguro de [`src/telemetry/analytics.ts`](../src/telemetry/analytics.ts), loader gateado de [`src/telemetry/posthogLoader.ts`](../src/telemetry/posthogLoader.ts) (fuera del HTML: token por `VITE_POSTHOG_TOKEN`) y ganchos de juego (`partida_iniciada` en menú y lobby, `vuelta_completada` en RaceScene con un LapTracker real de por medio) asertados contra un `window.posthog.capture` espiado, con igualdad EXACTA de properties (sin PII).
- **PWA (#43)**: registro con gates inyectados (PROD/dev, sin soporte, error sincrónico y rechazo de `register` → `false`, jamás lanza), manager del prompt contra un target falso (captura **sin** `preventDefault`, evento de un solo uso, dismissed/reject reportados, `dispose` que suelta listeners) y el contrato de los estáticos en `pwaAssets.test.ts`: manifest válido con `start_url` relativo, iconos PNG con dimensiones reales (parseo del IHDR), metas de iOS en el shell y handlers/estrategia del `public/sw.js` (que es vanilla y no pasa por tsc).

## QA manual

Los checklists de verificación manual (desktop, mobile, multijugador, carrera, gran premio y chat con dispositivos reales) viven en [`docs/QA.md`](./QA.md) — es el QA que la suite no puede cubrir: teclado virtual, foco, overlays del SO y sesiones largas multi-dispositivo.
