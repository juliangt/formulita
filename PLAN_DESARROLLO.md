# Plan de Desarrollo — "Formulita"

Videojuego de carreras de Fórmula 1 en 2D, estilo retro 8-bit (pixel art), mobile-first en orientación vertical, con soporte para escritorio (teclado). MVP funcional armado en capas con principios SOLID.

- **Motor:** Phaser 3 (Arcade Physics) + Vite + TypeScript (strict)
- **Formato:** Portrait, resolución base 720×1280, `Scale.FIT` + `CENTER_BOTH`, `pixelArt: true`
- **Visual:** Pixel art 100% procedural (`Graphics.generateTexture()`), cero assets externos
- **Fecha del plan:** 2026-09-29

---

## Índice

1. [Decisiones confirmadas](#decisiones-confirmadas)
2. [Visión técnica](#visión-técnica)
3. [Estructura de carpetas](#estructura-de-carpetas)
4. [Fases de desarrollo](#fases-de-desarrollo)
   - [Fase 0 — Scaffolding](#fase-0--scaffolding)
   - [Fase 1 — Núcleo visual y jugador](#fase-1--núcleo-visual-y-jugador)
   - [Fase 2 — Controles unificados](#fase-2--controles-unificados-táctil--teclado)
   - [Fase 3 — Velocidad, Turbo y DRS](#fase-3--velocidad-turbo-y-drs)
   - [Fase 4 — Entidades de pista](#fase-4--entidades-de-pista-y-generación-procedural)
   - [Fase 5 — Puntaje, persistencia y pantallas](#fase-5--puntaje-persistencia-y-pantallas)
   - [Fase 6 — Audio sintético](#fase-6--audio-sintético)
   - [Fase 7 — Pulido, QA y entrega](#fase-7--pulido-qa-mobile-y-entrega)
5. [Valores iniciales de balance](#valores-iniciales-de-balance)
6. [Riesgos y mitigaciones](#riesgos-y-mitigaciones)
7. [Definition of Done del MVP](#definition-of-done-del-mvp)
8. [Fases futuras (fuera de alcance)](#fases-futuras-fuera-de-este-plan)

---

## Decisiones confirmadas

| Tema | Decisión |
|---|---|
| Arquitectura | Vite + TypeScript (strict) + Phaser 3 vía npm. Proyecto modular por capas. Se ejecuta local con `npm run dev`; puede probarse desde el celular vía IP local (LAN). |
| Tienda | **Diferida** a fase futura. El MVP solo acumula monedas y las muestra en menú / game over. |
| Audio | **Incluido**: SFX sintéticos con Web Audio API, sin archivos externos. |
| Scoreboard externo | **Fuera de alcance** en este MVP. La capa de persistencia se diseña con interfaz para enchufarlo después sin refactor. |

## Visión técnica

### Resolución y escalado
- Resolución base de diseño: **720×1280 (portrait)**.
- `Phaser.Scale.FIT` + `CENTER_BOTH`: en desktop queda letterbox centrado; en móvil escala completo sin distorsión.
- `pixelArt: true` y `roundPixels` para nitidez del pixel art.

### Capas y responsabilidades

```
scenes   → solo orquestan (no contienen reglas de juego)
systems  → lógica pura y testeable (Speed, Turbo, Drs, Spawn, Difficulty, Score)
entities → sprites con física (PlayerCar, RivalCar, Hazard, Coin, Pickup)
ui       → HUD, barras, botones táctiles
audio    → síntesis Web Audio detrás de interfaz
data     → persistencia detrás de interfaz (localStorage hoy, HTTP mañana)
```

### Principios SOLID aplicados

- **S — Responsabilidad única:** un sistema por responsabilidad; las escenas solo coordinan.
- **O — Abierto/Cerrado:** entidades y patrones de spawn *data-driven* (`entityTypes.ts`): agregar contenido = agregar configuración, no modificar el spawner.
- **L — Sustitución de Liskov:** las fuentes de entrada (teclado / táctil) son intercambiables vía `IInputSource`.
- **I — Segregación de interfaces:** interfaces pequeñas y específicas: `IInputSource`, `ISfxEngine`, `ISaveRepository`.
- **D — Inversión de dependencias:** `GameScene` recibe sistemas y abstracciones por constructor; `localStorage` y Web Audio son detalles reemplazables (futuro `HttpScoreboardRepository`).

### Comunicación interna
- **EventBus tipado** para desacoplar sistemas ↔ HUD ↔ escenas (sin referencias cruzadas hardcodeadas).
- Todos los números de gameplay viven en `config/balance.ts` (ajustables sin tocar lógica).

## Estructura de carpetas

```
formulita/
├── index.html                  # viewport portrait + viewport-fit=cover, touch-action:none
├── package.json / tsconfig.json / vite.config.ts   # server.host para probar desde el celular
└── src/
    ├── main.ts                 # bootstrap Phaser.Game
    ├── config/
    │   ├── gameConfig.ts       # Scale.FIT, pixelArt, Arcade Physics, 720×1280
    │   └── balance.ts          # constantes de gameplay (velocidades, spawn, turbo, DRS)
    ├── core/
    │   └── EventBus.ts         # emitter tipado para desacoplar sistemas ↔ HUD
    ├── scenes/
    │   ├── BootScene.ts
    │   ├── PreloadScene.ts     # generación de texturas procedurales + barra de progreso
    │   ├── MenuScene.ts
    │   ├── GameScene.ts
    │   └── GameOverScene.ts
    ├── systems/
    │   ├── InputSystem.ts      # fusiona fuentes en un único InputState
    │   ├── KeyboardSource.ts   # ←→ / A-D, Espacio, Shift, Z, X
    │   ├── TouchSource.ts      # HUD táctil
    │   ├── TouchButton.ts      # botón con tracking propio de pointerId (multi-touch real)
    │   ├── SpeedSystem.ts
    │   ├── TurboSystem.ts
    │   ├── DrsSystem.ts
    │   ├── SpawnSystem.ts      # oleadas + object pooling
    │   ├── DifficultySystem.ts
    │   └── ScoreSystem.ts
    ├── entities/
    │   ├── PlayerCar.ts
    │   ├── RivalCar.ts
    │   ├── Hazard.ts
    │   ├── Coin.ts
    │   ├── Pickup.ts
    │   └── entityTypes.ts      # definiciones data-driven (OCP)
    ├── ui/
    │   ├── Hud.ts
    │   ├── EnergyBar.ts
    │   ├── DrsIndicator.ts
    │   └── PixelButton.ts
    ├── audio/
    │   ├── ISfxEngine.ts
    │   └── AudioManager.ts
    └── data/
        ├── ISaveRepository.ts
        ├── LocalStorageSaveRepository.ts
        └── types.ts            # SaveData, ScoreEntry (futuro scoreboard)
```

---

## Fases de desarrollo

### Fase 0 — Scaffolding

**Tareas**
- Proyecto Vite (vanilla-ts) + `phaser` + `vitest`; `tsconfig` strict; ESLint básico (opcional).
- `index.html` con meta viewport (`user-scalable=no, viewport-fit=cover`).
- CSS base: fondo negro, `touch-action: none`, `overscroll-behavior: none`, uso de `env(safe-area-inset-*)`.
- `gameConfig.ts` (FIT / pixelArt / physics / 720×1280), `EventBus`, escena placeholder.
- `git init` + commit inicial.

**Criterio de aceptación**
- `npm run dev` muestra el canvas correctamente escalado en desktop y en el celular vía IP local, sin scroll ni zoom del navegador.

### Fase 1 — Núcleo visual y jugador

**Tareas**
- **TextureFactory:** sprites pixel-art procedurales con `Graphics.generateTexture()`: tile de pista con kerb rojo/blanco, auto del jugador, rivales (2-3 colores), moneda, restos, mancha de aceite, pickup turbo (relámpago), pickup DRS (alerón), partículas.
- Flujo `Boot → Preload → Game` con barra de progreso.
- Pista: `TiledSprite` vertical en bucle cuyo scroll = velocidad actual; barreras laterales; bandas de rumble.
- **PlayerCar:** body arcade, movimiento lateral con aceleración/fricción, clamp a los límites de pista, inclinación visual al doblar.

**Criterio de aceptación**
- El auto obedece flechas ←→, la pista scrollea a velocidad base, 60 fps estables.

### Fase 2 — Controles unificados (táctil + teclado)

**Tareas**
- `IInputState` (left / right / throttle / brake / turbo / drs) + `IInputSource` (attach / detach / getState).
- **KeyboardSource:** ←→ o A/D · Espacio acelerar · Shift turbo · Z freno · X DRS.
- **TouchSource + TouchButton:** HUD translúcido — abajo-izquierda: ◀ ▶; abajo-derecha: Acelerador, Freno, Turbo, DRS. **Multi-touch real:** tracking de `pointerId` por botón (no `activePointer` único) para doblar + acelerar simultáneamente; feedback visual de presión.
- `InputSystem` fusiona fuentes en un único `InputState`; los sistemas consumen estado, no eventos sueltos.

**Criterio de aceptación**
- En emulación móvil se dobla y acelera a la vez; teclado funciona en desktop; los botones no roban eventos del juego.

### Fase 3 — Velocidad, Turbo y DRS

**Tareas**
- **SpeedSystem:** velocidad base autónoma; acelerador sube hasta `maxSpeed`, freno baja hasta `minSpeed`; el scroll de pista y el ritmo de spawn dependen de esta velocidad.
- **TurboSystem:** medidor 0–100; drena ~28/s (~3.5 s de uso total); +maxSpeed ×1.6; recarga pasiva lenta + pickup; corte automático al vaciarse; efecto visual (partículas de escape, líneas de velocidad).
- **DrsSystem:** activable solo sobre umbral de velocidad (rectas); ~3 s activos (+punta ×1.25); desactivación automática + cooldown ~8 s; indicador que parpadea al estar listo.
- HUD: barra de turbo, chip DRS (listo / activo / cooldown), velocímetro, monedas, puntaje.

**Criterio de aceptación**
- Cada acción afecta la velocidad de forma perceptible; los medidores cumplen la spec; sin NaN ni aceleraciones infinitas.

### Fase 4 — Entidades de pista y generación procedural

**Tareas**
- `entityTypes.ts` data-driven: textura, hitbox, peso de spawn, velocidad, comportamiento (OCP).
- **SpawnSystem** con **object pooling** (grupos arcade reutilizables) y oleadas fuera de pantalla: líneas de monedas, slalom de rivales, obstáculos dispersos; **garantía de pasabilidad** (siempre un carril libre); densidad según dificultad.
- **RivalCar:** más lento que el jugador, velocidad variable por tipo, cambio de carril ocasional.
- **Hazards:** restos (crash) y mancha de aceite (pérdida de control lateral breve, no destructiva).
- **Pickups:** TurboRefill (+50 medidor) y DRSRefill (resetea cooldown / duración).
- Colisiones (Arcade overlap): pickup / moneda → efecto + evento; rival / resto → explosión, shake y Game Over.
- **DifficultySystem:** rampa por distancia (velocidad rival, densidad, variedad).
- Tests con vitest de lógica pura (scheduler de spawn, drain de turbo, cooldown de DRS).

**Criterio de aceptación**
- Carrera infinita esquivable y recolectable; pooling sin fugas tras sesiones largas.

### Fase 5 — Puntaje, persistencia y pantallas

**Tareas**
- **ScoreSystem:** puntaje por distancia + bonus por velocidad sostenida (near-miss opcional); monedas separadas.
- **ISaveRepository → LocalStorageSaveRepository:** `{ totalCoins, bestScore, bestDistance }`, clave versionada, try/catch con fallback en memoria (modo privado). Punto de extensión para el scoreboard HTTP futuro.
- **MenuScene:** título pixel-art, JUGAR, récord, total de monedas, ayuda de controles según dispositivo.
- **GameOverScene:** puntaje, distancia, monedas ganadas, récord; REINTENTAR / MENÚ.
- Guardado al morir y en `visibilitychange` / blur.

**Criterio de aceptación**
- La persistencia sobrevive recarga de página; flujo menú ↔ juego ↔ game over completo sin errores.

### Fase 6 — Audio sintético

**Tareas**
- **AudioManager (ISfxEngine)** con Web Audio puro: click UI, moneda (blip de dos tonos), pickup, turbo (whoosh), DRS (hiss), crash (ruido + caída de tono).
- **Motor:** oscilador sawtooth+sine con frecuencia mapeada a la velocidad (sube con turbo), ganancia baja.
- Desbloqueo de `AudioContext` en el primer gesto (política de autoplay móvil); toggle de mute persistido.

**Criterio de aceptación**
- Suena en desktop y móvil tras el primer toque; el motor responde a la velocidad; el mute persiste entre sesiones.

### Fase 7 — Pulido, QA mobile y entrega

**Tareas**
- Game feel: countdown 3-2-1, screen shake, flash de crash, destello de moneda, vignette de velocidad con turbo, pausa (botón + tecla P) con overlay.
- Robustez móvil: pausa automática al perder foco, safe-areas (notch), bloqueo de gestos (double-tap zoom, contextmenu), fullscreen opcional en desktop.
- Rendimiento: límites de partículas, auditoría de pooling, `roundPixels`.
- README (cómo correr, controles, probar desde el celular en LAN, roadmap scoreboard) + QA checklist.

**Criterio de aceptación**
- Sesión de 10 min estable sin errores de consola; `npm run build` de producción funciona.

---

## Valores iniciales de balance

Todos en `config/balance.ts`, ajustables sin tocar lógica:

| Parámetro | Valor inicial |
|---|---|
| Velocidad máxima base | ≈ 420 px/s |
| Multiplicador turbo | ×1.6 |
| Multiplicador DRS | ×1.25 |
| Velocidad mínima (frenando) | ≈ 160 px/s |
| Drenaje de turbo | 28/s (≈ 3.5 s de uso total) |
| Recarga pasiva de turbo | 4/s |
| Pickup de turbo | +50 medidor |
| DRS activo / cooldown | 3 s / 8 s |
| Umbral DRS | > 75% de velocidad |
| Moneda | +1 moneda, +50 pts |
| Puntaje por distancia | ≈ 10 pts/s a velocidad base |

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Multi-touch simultáneo (doblar + acelerar) | Phaser soporta varios punteros; los botones trackean su propio `pointerId` y no dependen del puntero primario. |
| Autoplay de audio en móvil | `AudioContext.resume()` en el primer gesto; el juego nunca depende del sonido. |
| Escalado / notch | `Scale.FIT` + `viewport-fit=cover` + safe-area insets; fondo letterbox negro. |
| Rendimiento en gama baja | Pooling estricto, límite de partículas, sin `Graphics` dinámicos en `update`. |
| localStorage en modo privado | Envuelto en try/catch con repositorio en memoria como fallback. |

## Definition of Done del MVP

- [ ] Jugable en vertical en el celular (botones táctiles) y en PC (teclado).
- [ ] Turbo con medidor de uso limitado y recarga; DRS con temporizador y cooldown, según spec.
- [ ] Rivales, obstáculos, monedas y los 2 pickups aparecen proceduralmente y colisionan correctamente.
- [ ] Puntaje y monedas persisten en `localStorage`; menú y game over completos.
- [ ] SFX sintéticos con toggle de mute.
- [ ] Sin errores de consola; `npm run build` de producción funciona.

## Fases futuras (fuera de este plan)

- **Tienda básica:** skins de color para el auto y mejoras menores (capacidad de turbo, duración de DRS) compradas con monedas, persistidas en `localStorage`.
- **Scoreboard en servidor externo:** implementando la interfaz de persistencia ya prevista (`ISaveRepository` / cliente HTTP), sin refactor del juego.
