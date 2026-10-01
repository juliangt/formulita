# Formulita

Videojuego de carreras de Fórmula 1 en 2D, estilo retro 8-bit (pixel art 100% procedural, cero assets externos), **mobile-first** en orientación vertical (resolución base 720×1280). **Phaser 4 + Vite + TypeScript strict.**

Carrera infinita esquivable: acelerá, frená, activá **Turbo** y **DRS**, recolectá monedas y pickups, y sobreviví a rivales, restos y manchas de aceite mientras la dificultad sube con la distancia. El puntaje y las monedas persisten en `localStorage` (con fallback en memoria para modo privado). Además hay modo **multijugador online P2P** (battle royale por monedas, 2–10 jugadores, sin servidor) y **chat social opt-in** (chat de sala, mensajes directos e invitaciones a partida — nadie aparece en ninguna lista hasta habilitarlo).

> Plan completo por fases: [`PLAN_DESARROLLO.md`](./PLAN_DESARROLLO.md). Estado: **MVP completo (Fases 0–7) + multijugador battle royale (issue #1) + chat social (issue #2).**

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

## Multijugador (battle royale por monedas)

**Battle royale de 2 a 10 jugadores por monedas, P2P sin servidor.** Todos corren la MISMA pista — la **palabra de sala** es la clave que la define — y gana el que **más monedas juntó** al cierre: sobrevivir solo da más tiempo para juntar, no la corona (desempate por kilómetros y luego por puntaje). Si chocás quedás **eliminado como espectador**: seguís viendo la carrera de los demás hasta que queda un solo vivo, y entonces todos ven el **leaderboard final** — idéntico en todos los dispositivos, mismo orden y mismo ganador.

### Cómo se juega

1. Menú → **MULTIJUGADOR** → crear sala (el juego te da una **palabra de sala** de 5–9 letras, pronunciable por teléfono) o **unirse** con la palabra que te pasó el anfitrión.
2. Poné tu nombre (máx. 12 caracteres); el color del auto se asigna solo en función del roster (determinista e idéntico para todos).
3. Con 2 o más en sala, el **anfitrión** aprieta **INICIAR**: se difunde la semilla de la pista y el countdown 3-2-1-GO! arranca en todos.
4. Corré, esquivá y juntá monedas. Cada choque te elimina (pasás a espectador); la partida termina al quedar 1 vivo.
5. Leaderboard final: **monedas DESC → km DESC → puntaje DESC**. ¡GANASTE! si tu fila es la 1.

### Arquitectura (una línea)

**P2P sin servidor** (Trystero sobre WebRTC, señalización BitTorrent — `@trystero-p2p/torrent`): pista **determinista por seed de sala + reloj virtual** de generación (misma distancia ⇒ mismas oleadas en todos), rivales como **autos fantasma interpolados** (estado propio a 10 Hz, render a t−100 ms, semitransparentes y atravesables) y **stats congeladas** al crash/fin, de modo que cada cliente computa el MISMO leaderboard sin negociar nada por la red.

### Configuración — `VITE_TRYSTERO_APP_ID`

| Dónde | Cómo |
| --- | --- |
| Desarrollo local | `cp .env.example .env.local` y ajustá el valor (`.env.local` está gitignored) |
| Producción (Pages) | Variable de repo `VITE_TRYSTERO_APP_ID` en **Settings → Secrets and variables → Actions → Variables** (la lee el workflow de deploy al buildtear) |

- **Qué es**: el namespace de matchmaking de Trystero — un string público que agrupa las salas de ESTA aplicación dentro de los trackers de señalización. **NO es un secreto ni una API key**: queda visible en el bundle, y dos navegadores solo se encuentran si usan el mismo appId + la misma palabra de sala.
- **Si falta**: el build funciona igual (el requisito es de RUNTIME, no de build); al abrir el multijugador el lobby **falla rápido** con el error visible "falta VITE_TRYSTERO_APP_ID" en vez de conectar en silencio.

### Probar el multijugador local

1. `npm run dev` y abrí **dos pestañas** de la misma URL (o dos dispositivos de la red por la IP LAN — ver [Probar desde el celular](#probar-desde-el-celular-lan)).
2. Pestaña 1: MULTIJUGADOR → crear sala, anotá la palabra.
3. Pestaña 2 (o el celular): MULTIJUGADOR → unirse con esa palabra.
4. **INICIAR** desde la pestaña del anfitrión.

### Publicación (GitHub Pages)

Al pushear a `main`, el workflow [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml) corre la suite completa, buildtea con `--base=/formulita/` (Pages sirve los sitios de proyecto bajo subpath) y publica en:

**<https://juliangt.github.io/formulita/>**

Los PRs a `main` corren CI (tests + build, sin deploy) en [`.github/workflows/ci.yml`](./.github/workflows/ci.yml).

Requisitos (una sola vez, quien administra el repo):

1. **Settings → Pages → Source: "GitHub Actions"**.
2. **Settings → Secrets and variables → Actions → Variables** (no Secrets): `VITE_TRYSTERO_APP_ID` (p. ej. `formulita`).

> Sin la variable el sitio se publica igual (el appId es runtime, no build-time), pero el multijugador mostrará el error de configuración faltante al entrar al lobby.

### Límites de la v1 multijugador

- **Sin reconexión**: te caés, recargás o cerrás = eliminado, con las stats hasta ese momento.
- **Autos fantasma sin colisión entre sí** (y atravesables respecto del propio): solo tu pista local te elimina.
- **Sin anti-cheat**: cada cliente reporta sus propias stats (confianza P2P).
- **Background del navegador te elimina** por staleness (>20 s sin difundir estado).
- **Monedas por instancia local**: dos jugadores pueden tomar la misma moneda (cada uno la ve en su propia pista).
- **NAT/4G restrictivos pueden fallar**: WebRTC directo sin TURN propio; si el handshake no cruza, la sala no conecta (error visible en el lobby).
- **Los récords del modo solo NO se mezclan** con las partidas multi.

---

## Chat social (sala + directos, opt-in)

**Chat de tres piezas: (1) chat de SALA de partida** — en el lobby y, si te eliminan, en modo espectador; el que sigue corriendo no tiene chat (decisión cerrada del issue: conducir sin distracciones) —; **(2) sala pública de presencia OPT-IN con mensajes directos (DM)**; **(3) invitaciones a partida** por DM. Todo P2P sobre la misma red de Trystero, sin servidor.

**Presencia opt-in privacy-by-default**: NADIE aparece en la lista pública hasta habilitar **MOSTRARME DISPONIBLE** (default **NO**, persistido por pestaña). Deshabilitarlo es una **desconexión real** (leave de la sala pública, sin tráfico residual). Mientras estás disponible tu IP es visible a los peers de esa sala (WebRTC directo, como en cualquier partida) — por eso el default es escondido.

### Cómo se usa

1. Botón **CHAT**: en el menú (con badge de no leídos `CHAT · N`) y en el lobby. Abre el overlay con dos tabs.
2. Tab **SALA**: el hilo de la partida actual (solo existe dentro de una partida; desde el menú aparece deshabilitada con aviso).
3. Tab **PÚBLICO**: toggle grande **MOSTRARME DISPONIBLE** (SÍ/NO) + lista en vivo de quienes se mostraron. Tocar una fila abre el **hilo de DM** con ese jugador (VOLVER · BLOQUEAR/DESBLOQUEAR · INVITAR).
4. **INVITAR A PARTIDA** (solo si estás en un lobby): manda tu palabra de sala por DM; el otro ve el banner «N TE INVITÓ A "PALABRA"» con **UNIRSE** (pre-carga la palabra en el flujo de unirse) / **IGNORAR**.
5. El eliminado de una partida multi tiene botón **CHAT** en su overlay de espectador (escribe en el hilo de sala); el vivo no lo ve nunca.

### Reglas

- Mensajes de **máx. 200 caracteres** (sanitizados igual en emisor y receptor: trim, espacios colapsados, recorte — un cliente "rogue" no elude el límite).
- **1 mensaje cada 1,5 s POR HILO**: la sala y cada DM enfrían por separado; los intentos rechazados no re-armar el reloj.
- **Efímero**: NADA persiste al cerrar la pestaña (ni mensajes, ni hilos, ni bloqueos; solo el toggle de disponibilidad queda guardado en `localStorage`).
- **Bloqueo por sesión** (BLOQUEAR): corta la conversación en AMBOS sentidos — sus mensajes no entran, los míos no salen — y no se persiste (los peerId cambian en cada conexión).
- **DM requiere ambos disponibles**: si el otro se esconde (o cae por staleness, >20 s sin heartbeat de 5 s), su hilo pasa a **DESCONECTADO** con el input bloqueado; el historial queda.
- Sin identidad persistente: los nombres NO son únicos (dos "PILOTO" pueden coexistir).

### Límites de la v1 del chat (issue #2 §9)

- **Sin identidad persistente**: nombres no únicos, bloqueo solo por sesión (al reconectar, peerId nuevo).
- **Sin historial ni offline ni notificaciones**: no hay mensajes pendientes esperándote; nada llega con la pestaña cerrada.
- **Sin moderación central**: la defensa es distributed-by-client — sanitize (200) + throttle (1,5 s/hilo) + bloqueo por sesión.
- **Malla pública cómoda hasta ~30–50 presentes** por sala `appId-social`; más que eso exigiría sharding de vestíbulos (futuro).
- **Privacidad WebRTC**: mientras estás disponible, tu IP es visible a los peers de la sala pública (conexión directa, sin relay) — el default escondido minimiza la exposición.

### Probarlo

Igual que el multijugador: 2–3 pestañas/dispositivos (`npm run dev` por LAN). En cada una: CHAT → tab PÚBLICO → MOSTRARME DISPONIBLE. La lista se llena sola al momento del descubrimiento de malla (~1,5 s), y los hilos de DM abren tocando las filas. Requiere `VITE_TRYSTERO_APP_ID` (misma configuración que el multijugador).

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
│                         #   Input (Keyboard/Touch), TextureFactory (pixel art),
│                         #   VirtualClock (pista determinista), MatchTracker (multi)
├── entities/             # PlayerCar, RivalCar, Hazard, Coin, Pickup, GhostCar (+ defs)
├── net/                  # multijugador P2P: NetClient + TrysteroNetClient, protocolo,
│                         #   lobby (roster/colores/anfitrión), roomRng (seed por sala),
│                         #   interpolación de fantasmas, handoff lobby → carrera,
│                         #   ChatClient + TrysteroChatClient (sala pública social)
├── chat/                 # chat social (issue #2): ChatStore puro (sanitize 200 /
│                         #   throttle 1,5 s por hilo / no leídos / bloqueo sesión),
│                         #   adaptadores roomChat/dmChat, sesión social
│                         #   (socialChatSession), vistas puras presenceView/dmView
├── ui/                   # HUD: Speedometer, EnergyBar, DrsIndicator, ScoreHud,
│                         #   botones (MenuButton, PixelButton, MuteButton) y
│                         #   ChatPanel (lista + input DOM + ENVIAR del chat)
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

- 64 archivos / 850 tests en `src/__tests__/`, corridos con `npm test` (Vitest, entorno `happy-dom` + stub de contexto 2D en `src/__tests__/setup.ts`).
- Cubren la lógica pura de todos los sistemas: velocidad, turbo (drenaje/latch/recarga), DRS (umbral/duración/cooldown), spawn (scheduler con pasabilidad + pool), dificultad, puntaje, countdown, pausa, input (fusión de fuentes, multi-touch), steering del derrape (`slipSteer`), persistencia (parseo defensivo, mute persistido), audio (síntesis con fakes de Web Audio), flujo Game → GameOver y config.
- Tests de integración sin runtime de Phaser: input → steering (fusión consumida por el auto, con derrape), SpawnScheduler × DifficultySystem (ritmo, patrones y cierre conjuntos), colisiones → economía (monedas/pickups → Score/Turbo/DRS/bus) y carrera → guardado → recarga.
- Multijugador: lobby y carrera compartida contra un hub en memoria (`fakes/FakeNetClient.ts`, misma semántica que Trystero) — roster/colores/anfitrión, pista determinista por seed con perfiles de velocidad distintos, stream a 10 Hz con fantasmas interpolados, eliminaciones/stale/desconexiones, y el flujo COMPLETO de una partida de 3 clientes (lobby → start → carrera con perfiles distintos → 2 choques → match-over) que exige el MISMO ranking en los tres, con el de más monedas de ganador aunque otro haya sobrevivido más.
- Chat social: ChatStore (sanitize/throttle por hilo/no leídos/bloqueo entrada+salida), TrysteroChatClient contra rooms/hub fake (presencia opt-in, heartbeat, stale, DM/invite dirigidos), sesión social (DM con el overlay cerrado) — y el flujo COMPLETO de 3 clientes (`socialFullFlow.test.ts`: chat de sala + presencia opt-in con privacy-by-default verificada + 2 DM simultáneos con throttles independientes + escondite→DESCONECTADO + invitación con UNIRSE + badges por cliente), 100% determinista con reloj/timers inyectados.

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

### Multijugador (multi-dispositivo: Wi-Fi + 4G mezclados)

Criterio de aceptación del issue #1 (M3): partida de ~10 minutos con dispositivos REALES en redes mezcladas (uno en Wi-Fi, otro en 4G) sin errores de consola, mismo trazado en todos y leaderboard idéntico. Se prueba contra la versión publicada (<https://juliangt.github.io/formulita/>) o con `npm run dev`/`npm run serve` en la LAN.

- [ ] Dos o más dispositivos crean/unen por palabra y ven el MISMO roster (nombres, colores, contador n/10) en todas las pantallas.
- [ ] INICIAR (anfitrión) arranca el countdown en todos casi a la vez; nadie ve la pista moverse antes del GO!.
- [ ] **Mismo trazado en todos**: a la misma distancia, las mismas oleadas/monedas/rivales en cada dispositivo (pista determinista por seed de sala).
- [ ] El auto fantasma de cada rival se mueve suave (interpolado, sin teletransportes), es semitransparente y NO colisiona con el propio.
- [ ] Choque en un dispositivo: ese jugador pasa a espectador (cartel ELIMINADO — PUESTO N) y los demás ven VIVOS bajar de inmediato.
- [ ] **Eliminaciones en orden correcto**: el PUESTO N de cada cartel coincide con el orden real de los choques.
- [ ] Al quedar 1 vivo: **leaderboard final en TODOS los dispositivos — idéntico** (mismo orden, mismas stats fila por fila, mismo ganador marcado).
- [ ] El ganador es el de **más monedas**, aunque otro jugador haya sobrevivido más tiempo (y kilómetros).
- [ ] Redes mezcladas (Wi-Fi + 4G): la partida se completa; si un jugador pierde conexión, los demás lo ven eliminado (desconexión inmediata o stale a los ~20 s) y la partida concluye bien.
- [ ] Mandar un dispositivo al background/bloquear pantalla: ese jugador queda eliminado por stale (>20 s sin estado) y el resto sigue sin errores.
- [ ] Partida de ~10 min con 2–10 jugadores sin errores de consola ni degradación de FPS en ningún dispositivo.
- [ ] **Reconexión NO soportada (límite v1)**: recargar (F5) a mitad de partida elimina al que recargó (puede crear/unirse a otra sala); los demás concluyen la partida en curso sin romperse.
- [ ] Los récords/monedas del modo solo no cambian por jugar partidas multi.

### Chat social (multi-dispositivo: iOS + Android mezclados)

Criterio de aceptación del issue #2 (C4): el flujo social completo con 3 dispositivos REALES sin errores de consola. La parte física (teclado virtual en pantalla, foco real, overlays del SO) no es automatizable — esta checklist es el QA manual que la suite no cubre.

Teclado virtual y foco (en CADA dispositivo móvil):

- [ ] Tocar el input de chat lo enfoca y el **teclado NO tapa el input**: en Android la ventana se redimensiona y todo el lienzo (input + ENVIAR) queda visible sobre el teclado; en iOS Safari verificar que el input enfocado queda alcanzable (el layout ancla el input abajo, con ENVIAR/CERRAR debajo).
- [ ] La tecla Enter del teclado virtual se etiqueta **"enviar"** (`enterkeyhint`) y envía el mensaje; en el input de palabra de sala se etiqueta "ir" y en el de nombre "listo".
- [ ] Enfocar el input **NO hace zoom** la página en iOS (la fuente efectiva queda ≥16 px CSS).
- [ ] El teclado NO sugiere autocorrección ni autocompletado en ningún input del juego (y la palabra de sala fuerza MAYÚSCULAS).
- [ ] Escribir **"P" en el input de chat NO pausa nada** (ni ESPACIO acelera, ni las flechas mueven): el input está aislado del teclado del juego; al cerrar el chat, P vuelve a pausar.
- [ ] El tope de 200 caracteres se corta al tipear (el input no admite más).

Lista de mensajes:

- [ ] La lista muestra siempre los **últimos** mensajes (anclada abajo) y los propios alineados a la derecha en amarillo "VOS" (decisión v1: sin scroll táctil — sobran los últimos N visibles).
- [ ] Con el panel lleno, los mensajes más viejos salen por arriba sin deformar el layout.

Flujo social con 3 dispositivos (uno iOS, uno Android, uno desktop):

- [ ] Sala compartida: A crea, B y C se unen; el chat de SALA muestra nombre y color del remitente en todos, con el throttle de 1,5 s visible ("ESPERÁ…").
- [ ] **Privacy by default**: nadie aparece en la tab PÚBLICO hasta tocar MOSTRARME DISPONIBLE; quien no lo tocó no figura en la lista de nadie.
- [ ] **2 DM simultáneos** al chat de sala (p. ej. A↔C mientras B escribe en sala): los mensajes no se cruzan de hilo y el throttle de cada hilo es independiente.
- [ ] Tocar MOSTRARME DISPONIBLE: NO → SÍ aparece en las listas de los demás en ~1,5 s; SÍ → NO desaparece y su hilo de DM pasa a DESCONECTADO con el input bloqueado.
- [ ] **INVITAR A PARTIDA** (desde un lobby): el invitado ve el banner «N TE INVITÓ A "PALABRA"», UNIRSE lo lleva al lobby con la palabra pre-cargada y IGNORAR lo descarta.
- [ ] El badge del botón CHAT del menú cuenta los no leídos de sala + DMs y se limpia al abrir cada hilo.
- [ ] Sesión de ~10 minutos de chat (sala + DMs + bloqueos) sin errores ni warnings de consola en ningún dispositivo.
- [ ] Cerrar la pestaña y volver: no queda rastro de mensajes ni hilos (efímero); solo el toggle de disponibilidad se recuerda.

---

## Roadmap (fuera de este MVP)

- **Tienda básica**: skins de color del auto y mejoras menores (capacidad de turbo, duración de DRS) compradas con las monedas acumuladas.
- **Scoreboard en servidor externo**: implementando la interfaz de persistencia ya prevista (`ISaveRepository` / cliente HTTP) sin refactor del juego.

---

## Notas

- Todos los números de balance (velocidades, turbo, DRS, spawns, layout de HUD) viven en `src/config/balance.ts` con comentarios de intención: ajustables sin tocar lógica.
