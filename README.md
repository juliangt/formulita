# Formulita

Videojuego de carreras de Fórmula 1 en 2D, estilo retro 8-bit (pixel art 100% procedural, cero assets externos), **mobile-first** en orientación vertical (resolución base 720×1280). **Phaser 4 + Vite + TypeScript strict.**

Carrera infinita esquivable: acelerá, frená, activá **Turbo** y **DRS**, recolectá monedas y pickups, y sobreviví a rivales, restos y manchas de aceite mientras la dificultad sube con la distancia. El puntaje y las monedas persisten en `localStorage` (con fallback en memoria para modo privado).

> Plan completo por fases: [`PLAN_DESARROLLO.md`](./PLAN_DESARROLLO.md). Estado: **MVP completo (Fases 0–7).**

---

## Cómo correr

Requisitos: Node 20+ (probado en Node 22) y npm 10+.

```bash
npm install
npm run dev        # dev server en http://localhost:5173 (expuesto en la LAN)
npm run build      # chequeo de tipos (tsc) + build de producción en dist/
npm run preview    # sirve el build de producción (http://localhost:4173)
npm test           # suite de tests (Vitest)
```

> El warning `chunk larger than 500 kB` en `npm run build` es esperado: Phaser es grande y en un juego de un solo canvas no conviene code-splitting.

### Probar desde el celular (LAN)

1. Conectá el celular a la **misma red Wi-Fi** que tu computadora.
2. Corré `npm run dev` — Vite imprime las URLs de red (`Network: http://192.168.x.x:5173`).
3. Abrí esa URL en el navegador del celular (`server.host: true` ya está configurado en `vite.config.ts`).
4. Si no conecta: revisá que el firewall de tu máquina permita conexiones entrantes al puerto 5173.

También funciona con `npm run preview` (puerto 4173) para probar el build de producción desde el celular.

### Instalarla como "app" (opcional)

En iOS/Android: compartí → *Agregar a pantalla de inicio*. El `viewport-fit=cover` + safe-area insets ya están contemplados para pantallas con notch.

---

## Controles

| Acción | Teclado | Táctil (HUD) |
| --- | --- | --- |
| Doblar | ← → o A / D | ◀ ▶ (abajo-izquierda) |
| Acelerar | Espacio | GAS (abajo-derecha) |
| Freno | Z | BRK |
| Turbo | Shift | TURBO |
| DRS | X | DRS |
| Pausa | P | Botón II (arriba a la izquierda) |
| Reanudar (en pausa) | P o ESC | REANUDAR |
| Menú (en pausa / game over) | M | MENÚ |
| Pantalla completa (solo desktop, menú) | F | — |
| Jugar / Reintentar (menús) | Enter o Espacio | Botones |

- Los botones táctiles soportan **multi-touch real** (tracking de `pointerId` por botón): doblar y acelerar a la vez.
- La carrera arranca con un **countdown 3-2-1-GO!**: el mundo (pista, rivales, puntaje) está congelado hasta el final de la cuenta.
- La **pausa es real**: botón en pantalla, tecla P, o **automática** al cambiar de pestaña / perder el foco de la ventana. Física, scroll, spawn y puntaje quedan congelados de verdad hasta reanudar.

---

## Cómo se juega

- **Velocidad autónoma**: la base avanza sola; el acelerador sube hasta la punta (420 px/s) y el freno baja al mínimo.
- **Turbo** (medidor 0–100): drena ~28/s (≈3,5 s de uso), ×1.6 de punta, recarga pasiva lenta + pickup de relámpago (+50).
- **DRS**: activable solo sobre el 75% de la velocidad máxima, dura 3 s (×1.25), cooldown de 8 s; el pickup de alerón lo resetea. El chip del HUD muestra listo / activo / cooldown.
- **Entidades de pista**: líneas y zigzags de monedas, rivales con cambio de carril, restos (crash) y aceite (derrape no destructivo), pickups. Generación procedural con **garantía de pasabilidad** (siempre queda un carril libre).
- **Puntaje**: distancia (escalada por velocidad real) + bonus por velocidad sostenida + 50 pts por moneda. Las monedas son economía aparte.
- **Dificultad**: rampa por distancia (rivales más rápidos, oleadas más densas, más variedad de patrones).
- Muerte por choque (rival/resto): explosión, flash, shake y pantalla de Game Over con resumen y récord.

---

## Arquitectura (por capas)

Principios SOLID: escenas que solo orquestan, lógica pura testeable, input/audio/persistencia detrás de interfaces.

```
src/
├── main.ts               # bootstrap + guards de gestos móviles (Fase 7)
├── config/
│   ├── gameConfig.ts     # Scale.FIT, pixelArt, Arcade Physics, 720×1280, escenas
│   └── balance.ts        # TODOS los números de gameplay (ajustables sin tocar lógica)
├── core/EventBus.ts      # emitter tipado que desacopla sistemas ↔ HUD ↔ audio
├── scenes/               # Boot → Preload → Menu → Game → GameOver (+ Pause overlay)
├── systems/              # lógica pura: Speed, Turbo, Drs, Countdown, Pause,
│                         #   Spawn (scheduler + ObjectPool), Difficulty, Score,
│                         #   Input (Keyboard/Touch), TextureFactory (pixel art)
├── entities/             # PlayerCar, RivalCar, Hazard, Coin, Pickup (+ defs data-driven)
├── ui/                   # HUD: Speedometer, EnergyBar, DrsIndicator, ScoreHud,
│                         #   botones (MenuButton, PixelButton, MuteButton)
├── audio/                # AudioManager (ISfxEngine): SFX sintéticos Web Audio + dron
│                         #   del motor; mute persistido, desbloqueo por primer gesto
└── data/                 # ISaveRepository → LocalStorageSaveRepository (fallback en
                          #   memoria); punto de extensión para scoreboard HTTP
```

Decisiones clave:

- **EventBus tipado de sesión**: las escenas emiten eventos (`speed`, `coins`, `game-over`, `game-paused`…) y el HUD/audio reaccionan sin acoplarse. Los widgets se desuscriben en su `destroy()`.
- **Object pooling con límite duro** por familia de entidad: ninguna sesión larga crea objetos sin tope; las partículas también tienen `maxParticles`.
- **Pausa real por `scene.pause()`**: la escena de juego congela update, física, tweens, timers y partículas; el overlay vive en una escena aparte (`PauseScene`) porque una escena pausada tampoco procesa su input.
- **Texturas 100% procedurales** (`Graphics.generateTexture()` una vez en Preload; la viñeta de turbo es un gradiente de canvas horneado una vez). Sin `Graphics` dinámicos en `update`.
- **Persistencia con interfaz** (`ISaveRepository`): swap a un repositorio HTTP futuro sin refactor del juego.

---

## Tests

- 28 archivos / 392 tests en `src/__tests__/`, corridos con `npm test` (Vitest, entorno `happy-dom` + stub de contexto 2D en `src/__tests__/setup.ts`).
- Cubren la lógica pura de todos los sistemas: velocidad, turbo (drenaje/latch/recarga), DRS (umbral/duración/cooldown), spawn (scheduler con pasabilidad + pool), dificultad, puntaje, countdown, pausa, input (fusión de fuentes, multi-touch), steering del derrape (`slipSteer`), persistencia (parseo defensivo, mute persistido), audio (síntesis con fakes de Web Audio), flujo Game → GameOver y config.
- Tests de integración sin runtime de Phaser: input → steering (fusión consumida por el auto, con derrape), SpawnScheduler × DifficultySystem (ritmo, patrones y cierre conjuntos), colisiones → economía (monedas/pickups → Score/Turbo/DRS/bus) y carrera → guardado → recarga.

---

## QA checklist (verificación manual)

Criterio de aceptación global: **sesión de 10 minutos sin errores de consola** y `npm run build` exitoso.

### Desktop (teclado)

- [ ] `npm run dev` abre el juego con letterbox negro centrado, sin scroll ni zoom.
- [ ] El flujo Boot (barra de progreso de texturas) → Menú → carrera → Game Over funciona completo y en loop (REINTENTAR / MENÚ).
- [ ] El auto obedece ← → / A·D con aceleración lateral suave y clamp en los kerbs.
- [ ] Espacio/Z acelera y frena de forma perceptible; sin soltar nada, la velocidad vuelve sola a la base.
- [ ] Shift activa turbo solo con medidor: llamas de escape, líneas de velocidad, viñeta en los bordes y whoosh; se corta solo al vaciarse y no reactiva hasta soltar (latch).
- [ ] X activa DRS solo por encima del 75% de velocidad; dura 3 s; el chip pasa a cooldown con cuenta regresiva; a los 8 s vuelve a "LISTO" parpadeante.
- [ ] Countdown 3-2-1-GO! visible al arrancar cada carrera; la pista no scrollea ni aparecen rivales hasta el GO!.
- [ ] Tecla P (o botón II) pausa: overlay con REANUDAR/MENÚ, y al reanudar no quedó ninguna tecla "pegada".
- [ ] Perder el foco de la ventana (click afuera, cambiar de pestaña) pausa solo con overlay de PAUSA AUTOMÁTICA; al volver, la carrera sigue exactamente donde estaba.
- [ ] MENÚ desde la pausa corta el motor y vuelve al menú sin errores ni sonido colgado.
- [ ] Choque: explosión, flash rojo, screen shake y Game Over con puntaje/distancia/monedas; ¡NUEVO RÉCORD! parpadea si corresponde.
- [ ] Aceite: derrape breve con control invertido, sin muerte; el auto no pierde vida por eso.
- [ ] Récord y monedas persisten tras recargar la página (F5); el mute también persiste.
- [ ] Botón PANTALLA COMPLETA (y tecla F) del menú: entra/sale y la etiqueta cambia a VENTANA; el canvas sigue nítido (pixel art sin blur).
- [ ] Click derecho sobre el canvas no abre menú contextual; doble click no hace zoom.
- [ ] 10 minutos de carrera seguida: sin errores/warnings de consola, sin degradación de FPS perceptible.

### Mobile (táctil, vía LAN)

- [ ] La URL de red abre el juego en vertical sin scroll, sin zoom y sin tap-highlight.
- [ ] Con notch: la UI no queda tapada por la muesca (safe-area insets) y el canvas escala completo sin distorsión.
- [ ] Multi-touch real: doblar con ◀ ▶ mientras se mantiene GAS; soltar un dedo no suelta el otro botón.
- [ ] Los 6 botones del HUD (◀ ▶ GAS BRK TURBO DRS) presionan y sueltan limpio, con feedback visual de presión; ninguno "queda pegado" tras una pausa.
- [ ] Botón II pausa; REANUDAR/MENÚ responden al primer toque.
- [ ] Cambiar de app / bloquear la pantalla: al volver hay overlay de PAUSA AUTOMÁTICA y el progreso (monedas bancadas) quedó guardado.
- [ ] El audio suena desde el primer toque (desbloqueo de autoplay) y el mute persiste entre sesiones; el motor sube de tono con la velocidad y se calla en pausa.
- [ ] Long-press sobre la pantalla no abre menú contextual ni selecciona texto; double-tap no hace zoom.
- [ ] Sesión de 10 minutos: sin errores de consola, sin fugas evidentes (el pool recicla: la densidad de entidades no crece con el tiempo).

---

## Roadmap (fuera de este MVP)

- **Tienda básica**: skins de color del auto y mejoras menores (capacidad de turbo, duración de DRS) compradas con las monedas acumuladas.
- **Scoreboard en servidor externo**: implementando la interfaz de persistencia ya prevista (`ISaveRepository` / cliente HTTP) sin refactor del juego.

---

## Notas

- Todos los números de balance (velocidades, turbo, DRS, spawns, layout de HUD) viven en `src/config/balance.ts` con comentarios de intención: ajustables sin tocar lógica.
