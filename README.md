# Formulita

Videojuego de carreras de Fórmula 1 en 2D, estilo retro 8-bit (pixel art 100% procedural, cero assets externos), **mobile-first** en orientación vertical (720×1280). **Phaser 4 + Vite + TypeScript strict.**

**👉 Jugá la versión publicada: <https://juliangt.github.io/formulita/>**

---

## Modos de juego

| Modo | Botón del menú | Jugadores | ¿Necesita red? | En una línea |
| --- | --- | --- | --- | --- |
| **Infinito** | JUGAR | 1 | No | Carrera infinita esquivable: turbo, DRS, monedas, pickups, rivales, restos y aceite; la dificultad sube con la distancia. |
| **Gran Premio** | GRAN PREMIO | 1 vs 7 CPU | No (100% offline) | 3 vueltas (~2 min) por 6 pistas de F1 contra rivales con IA de línea de carrera; 3 dificultades y récords por pista × dificultad. |
| **Batalla** | EN LÍNEA | 2–10 | Sí (P2P, sin servidor) | Todos corren la MISMA pista (definida por la palabra de sala); gana el que más monedas juntó. Eliminado = espectador. |
| **Carrera** | EN LÍNEA | 2–10 | Sí (P2P, sin servidor) | Vueltas por circuito cerrado con ranking en vivo y podio final; la pista y la parrilla son idénticas en todos los dispositivos. |
| **Chat social** | EN LÍNEA → CHAT | — | Sí (P2P) | Chat de sala, presencia pública **opt-in** con mensajes directos e invitaciones a partida; nadie aparece en ninguna lista hasta habilitarlo. |

---

## Empezar

Requisitos: Node 20+ (probado en Node 22) y npm 10+.

```bash
npm install
npm run dev        # dev server en http://localhost:5173 (expuesto en la LAN)
npm run build      # chequeo de tipos (tsc) + build de producción en dist/
npm run preview    # sirve dist/ en http://localhost:4173 (sin caché para iOS, expuesto en la LAN)
npm test           # suite de tests (Vitest)
```

> El warning `chunk larger than 500 kB` en `npm run build` es esperado: Phaser es grande y en un juego de un solo canvas no conviene code-splitting.

### Probar desde el celular (LAN)

1. Conectá el celular a la **misma red Wi-Fi** que tu computadora.
2. Corré `npm run dev` — Vite imprime las URLs de red (`Network: http://192.168.x.x:5173`).
3. Abrí esa URL en el navegador del celular (`server.host: true` ya está configurado en `vite.config.ts`).
4. Si no conecta: revisá que el firewall de tu máquina permita conexiones entrantes al puerto 5173.

También funciona con `npm run preview` (puerto 4173) para probar el build desde el celular.

### Instalarla como "app" (opcional)

En iOS/Android: compartí → *Agregar a pantalla de inicio*. El `viewport-fit=cover` + safe-area insets ya están contemplados para pantallas con notch.

---

## Controles

### Modo Infinito (JUGAR)

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

### Modos de circuito (GRAN PREMIO y CARRERA)

El acelerador es **manual** (issue #20): hay que pisar GAS; sin gas el auto desacelera sola (coast) y frenar y doblar siguen siendo acciones explícitas.

| Acción | Teclado | Táctil (HUD) |
| --- | --- | --- |
| Doblar | ← → o A / D | ◀ ▶ (abajo-izquierda) |
| Gas | W o ↑ | GAS (abajo-derecha, verde) |
| Freno | ↓ / S / Espacio | FRENO (abajo-derecha) |

Común a todos los modos:

- Los botones táctiles soportan **multi-touch real** (tracking de `pointerId` por botón): doblar y acelerar a la vez.
- La carrera arranca con un **countdown 3-2-1-GO!**: el mundo está congelado hasta el final de la cuenta.
- La **pausa es real**: botón en pantalla, tecla P, o **automática** al cambiar de pestaña / perder el foco. Física, scroll, spawn y puntaje quedan congelados de verdad hasta reanudar.

---

## Modo Infinito

La base avanza sola; el acelerador sube hasta la punta (504 px/s) y el freno baja al mínimo.

- **Turbo** (medidor 0–100): drena ~28/s (≈3,5 s de uso), ×1.6 de punta, recarga pasiva lenta + pickup de relámpago (+50).
- **DRS**: activable solo por encima del 75% de la velocidad máxima, dura 3 s (×1.25), cooldown de 8 s; el pickup de alerón lo resetea. El chip del HUD muestra listo / activo / cooldown.
- **Entidades de pista**: líneas y zigzags de monedas, rivales con cambio de carril, restos (crash) y aceite (derrape no destructivo), pickups. Generación procedural con **garantía de pasabilidad** (siempre queda un carril libre).
- **Puntaje**: distancia (escalada por velocidad real) + bonus por velocidad sostenida + 50 pts por moneda. Las monedas son economía aparte.
- **Dificultad**: rampa por distancia (rivales más rápidos, oleadas más densas, más variedad de patrones).
- **Persistencia**: puntaje y monedas se guardan en `localStorage` (con fallback en memoria para modo privado). Los récords de este modo no se mezclan con los de otros modos.

### Salud del vehículo (barra CHASIS)

El auto tiene **100 HP de chasis**, visibles en la barra CHASIS del HUD (verde → amarillo → rojo). Al llegar a 0 viene el crash: explosión + shake + Game Over con resumen/récord en solo, o eliminación + modo espectador en multi.

| Fuente de daño / reparación | Efecto |
| --- | --- |
| Choque contra un rival | −35 HP (y penalización de velocidad) |
| Impacto contra una piedra | −20 HP |
| Rozar la pared | −15 HP por segundo (daño continuo, sin i-frames) |
| Botiquín (pickup de cruz) | +35 HP, con tope en 100 |
| I-frames tras un impacto aplicado | 0,6 s de invulnerabilidad (el golpe repetido se ignora) |

- **Estado crítico (≤ 25% de vida)**: la barra CHASIS parpadea y el auto echa **humo gris** continuo — la señal de buscar botiquín o manejar limpio.
- **Feedback del daño**: flash + shake en cada golpe, **parpadeo** rítmico del auto durante los i-frames y **chispas** en el borde del auto mientras roza la pared.

---

## Gran Premio (contra la CPU)

**Una carrera de F1 de verdad contra 7 rivales con IA, 100% local y offline.** Elegís pista y dificultad, arrancás desde una parrilla de 8 autos y corré **3 vueltas (~2 min)** por cualquiera de las **6 pistas** (MÓNACO, MONZA, SILVERSTONE, SPA, SUZUKA, GÁLVEZ). No necesita red — ni matchmaking ni sincronización: los rivales se simulan en tu dispositivo, con la MISMA física del circuito que el resto de los modos (el auto de cada rival decide su manejo, no hace trampas de velocidad).

### Cómo se juega

1. Menú → **GRAN PREMIO** → elegí pista, **dificultad del rival** (FÁCIL / NORMAL / DIFÍCIL) y el toggle **DESGASTE: SÍ/NO**.
2. Countdown 3-2-1-GO! y largada hacia **arriba** de la pantalla: **mismos controles que la carrera en circuito** (gas manual — ver [Controles](#controles)).
3. HUD en vivo: posición **Pn/8**, **gap** en segundos con el rival de adelante y de atrás, vuelta/tiempos, chip **GRAN PREMIO · PISTA · DIFICULTAD**, minimapa con **tu punto destacado** y — con desgaste activo — el indicador **NEUMÁTICOS n%** (rojo cuando la goma está crítica). Cambiar de posición suena (igual al ganar que al perder el lugar).
4. Al cruzar TU meta: **podio con el top 3** (ganador en oro) y, si quedaste fuera, **tu fila destacada debajo**; **¡NUEVO RÉCORD!** parpadea si superaste tu mejor posición o mejor vuelta para esa pista × dificultad. **REINTENTAR** repite la misma pista, dificultad y desgaste con parrilla nueva.

### Rivales con criterio (no autos sobre rieles)

- **Línea de carrera real**: cada rival sigue la trazada ideal de la pista (con apex) y frena por la curvatura venidera con un punto de mira propio.
- **Personalidad**: los 7 rivales (ALONSITO, MAXVELOZ, SCHUMIKA, LECLERVO, NORRITO, PIASTRINO, SARGUINI) tienen velocidad, trazada y agresividad propias, **deterministas por seed**: la misma carrera es reproducible de punta a punta.
- **Errores humanos**: de vez en cuando frenan tarde o se desvían de su trazada — más seguido en FÁCIL que en DIFÍCIL — y el fallo dura un instante, no los saca de carrera.
- **Adelantamientos**: ven a los autos alrededor, cierran el hueco y desvían SU línea para intentar la maniobra; la agresividad de cada uno decide cuánto se arriesga.

### Contactos entre autos (se puede empujar y bloquear)

Los 8 autos comparten el mundo y **ya no se atraviesan** (issue #39): tocarse tiene física real, simétrica para jugador y rivales y **determinista por seed**.

- **Toque de cola**: el de adelante recibe un **empujón para adelante** (leve) y **el que golpea se frena un poco** — golpear nunca es rentable.
- **El ángulo manda**: un roce de lado **desvía los headings** en sentidos opuestos (más ángulo de contacto, más desvío); un toque limpio de cola es empujón puro, sin desvío.
- **Bloquear es real**: la separación posicional es siempre mutua — sostener tu línea empuja al otro fuera del hueco.
- Cada golpe fuerte **suena** (thump seco) y sacude la cámara; los roces continuos no ametrallan SFX (hay enfriamiento).

### Desgaste de neumáticos (opcional)

El toggle **DESGASTE** del picker (default **NO**, persistido en `localStorage`; REINTENTAR lo respeta) decide si la goma se degrada:

| Toggle | Comportamiento |
| --- | --- |
| **NO** (default) | Carrera arcade pura: rodar y chocar no cambia el rendimiento de ningún auto. |
| **SÍ** | La goma (100% → 0%) se gasta **por kilometraje** (una carrera de 3 vueltas gasta ~40% solo rodando) y **cada golpe acelera el desgaste** (un impacto a fondo cuesta ~4%). La goma gastada **recorta la velocidad punta** hasta −18% al final. El HUD lo muestra en **NEUMÁTICOS n%** (rojo bajo el 25%). El desgaste es simétrico: los rivales lo sufren igual. |

En multijugador y en la práctica libre no hay contactos ni desgaste: los rivales del multi son interpolaciones de red, no simulaciones locales.
- **Goma declarada y acotada**: si un rival queda muy lejos del jugador, su ritmo se ajusta una fracción MUY chica para que la pelea no se rompa — tope pequeño por dificultad (el mayor en FÁCIL, casi rígido en DIFÍCIL) y NUNCA por encima del techo físico del auto.
- **Dificultad**: los presets ajustan ritmo en recta, calidad de trazada, frecuencia de errores, agresividad y goma; el orden fácil < normal < difícil está garantizado por tests.

### Récords

- Por **cada pista × dificultad** el juego recuerda tu **mejor posición** y tu **mejor vuelta** en `localStorage` (clave versionada `formulita.gp.v1`, con fallback en memoria para modo privado).
- Superar cualquiera de las dos dispara **¡NUEVO RÉCORD!** en los resultados; repetir el mejor puesto o girar más lento no toca nada. Las marcas de un modo no se mezclan con las de otro.

> El antiguo **practice** (circuito en solitario) vive como rama interna del modo carrera: el botón del menú ahora lanza el GRAN PREMIO, y REINTENTAR desde resultados corre en solitario contra el cronómetro.

---

## Multijugador (P2P, sin servidor)

Ambos modos multijugador corren sobre **Trystero sobre WebRTC** (señalización BitTorrent — `@trystero-p2p/torrent`): no hay servidor propio. La **palabra de sala** (5–9 letras, pronunciable por teléfono) es la clave que define la pista: todos los clientes de una sala generan exactamente el mismo contenido sin negociar nada por la red. Los trackers de señalización son los defaults de la librería salvo que definas `VITE_TRYSTERO_RELAYS` (opcional — ver [Configuración](#configuración-y-publicación)).

**Cómo entrar**: Menú → **EN LÍNEA** → poné tu nombre → crear sala (el juego te da la palabra) o unirse con la palabra del anfitrión. Poné tu nombre (máx. 12 caracteres); el color del auto se asigna en función del roster (determinista e idéntico para todos). Con 2 o más en sala, el **anfitrión** elige modo (**BATALLA** o **CARRERA**) y, en carrera, la pista (con miniatura); aprieta **INICIAR** y el countdown arranca sincronizado en todos.

### Batalla (battle royale por monedas)

Todos corren la MISMA pista infinita y gana el que **más monedas juntó** al cierre: sobrevivir solo da más tiempo para juntar, no la corona (desempate por kilómetros y luego por puntaje).

- Si tu chasis llega a 0 quedás **eliminado como espectador**: seguís viendo la carrera de los demás (con botón CHAT) hasta que queda un solo vivo.
- Leaderboard final: **monedas DESC → km DESC → puntaje DESC**, idéntico en todos los dispositivos (mismo orden y mismo ganador).

### Carrera (circuito, 2–10 jugadores)

Vueltas por un circuito cerrado, como la F1 de verdad: parrilla de salida detrás de la meta, **3 vueltas (~2 min)** y cronometraje completo (tiempo total, vuelta en curso y **mejor vuelta**).

- Ranking en vivo (**P3/8** en el HUD) y al terminar cada uno difunde su tiempo exacto.
- **Fin de carrera**: el primero en completar las 3 vueltas gana; la partida cierra cuando terminan todos o a los 30 s del primer finish (los que no llegaron clasifican por su último progreso). Podio final con nombres, colores y tiempos, **VUELTA RÁPIDA** destacada en oro y **confeti** al cruzar tu meta.
- **Anti-corte**: cortar por el pasto salta sectores de la vuelta y **la vuelta no cuenta** (checkpoints).
- Quien termina pasa a **espectador** siguiendo al líder (con botón CHAT).

### Cómo funciona por dentro

Pista **determinista por seed de sala + reloj virtual** de generación (misma distancia ⇒ mismas oleadas en todos), rivales como **autos fantasma interpolados** (estado propio a 10 Hz, render a t−100 ms, semitransparentes y atravesables) y **stats congeladas** al crash/fin, de modo que cada cliente computa el MISMO leaderboard/podio sin negociar nada por la red. En carrera, cada cliente aplica además un **filtro de plausibilidad local** (un avance físicamente imposible se ignora) — no hay servidor árbitro.

**Compatibilidad de pistas entre versiones**: el `start` del anfitrión viaja con el `trackId` como string. Un cliente que recibe el id de una pista que su versión no conoce (p. ej. `galvez` hacia un cliente anterior al issue #26) la degrada **en silencio** a la primera del registro (**MÓNACO**): la carrera arranca igual, pero ese cliente corre otra pista. Detectar el desfasaje en el lobby antes de INICIAR es un follow-up no bloqueante.

### Límites de la v1

- **Sin reconexión**: te caés, recargás o cerrás = eliminado/ABANDONÓ, con las stats hasta ese momento.
- **Autos fantasma sin colisión entre sí** (y atravesables respecto del propio): solo tu pista local te elimina.
- **Sin árbitro ni anti-cheat**: cada cliente reporta sus propias stats (confianza P2P + filtro de plausibilidad).
- **Background del navegador elimina** por staleness (>20 s sin difundir estado).
- **Monedas por instancia local**: dos jugadores pueden tomar la misma moneda (cada uno la ve en su propia pista).
- **NAT/4G restrictivos pueden fallar**: WebRTC directo sin TURN propio; si el handshake no cruza, la sala no conecta (error visible en el lobby).
- **Los récords de un modo no se mezclan** con los de otro.

### Probarlo local

1. `npm run dev` y abrí **dos pestañas** de la misma URL (o dos dispositivos de la red por la IP LAN — ver [Empezar](#empezar)).
2. Pestaña 1: EN LÍNEA → crear sala, anotá la palabra.
3. Pestaña 2 (o el celular): EN LÍNEA → unirse con esa palabra.
4. **INICIAR** desde la pestaña del anfitrión.

---

## Chat social (sala + directos, opt-in)

Tres piezas, todo P2P sobre la misma red de Trystero: **(1)** chat de **SALA** de partida (en el lobby y, si te eliminan, en modo espectador — el que sigue corriendo no tiene chat: conducir sin distracciones); **(2)** sala pública de presencia **opt-in** con **mensajes directos (DM)**; **(3)** **invitaciones a partida** por DM.

**Privacy by default**: NADIE aparece en la lista pública hasta habilitar **MOSTRARME DISPONIBLE** (default **NO**, persistido). Deshabilitarlo es una **desconexión real** (leave de la sala pública, sin tráfico residual). Mientras estás disponible tu IP es visible a los peers de esa sala (WebRTC directo) — por eso el default es escondido.

### Cómo se usa

1. Menú → **EN LÍNEA** → botón **CHAT** (el botón del menú acumula el badge de no leídos: `EN LÍNEA · N`); también está en el lobby. Abre el overlay con dos tabs.
2. Tab **SALA**: el hilo de la partida actual (solo existe dentro de una partida; desde el menú aparece deshabilitado con aviso).
3. Tab **PÚBLICO**: toggle **MOSTRARME DISPONIBLE** (SÍ/NO) + lista en vivo de quienes se mostraron. Tocar una fila abre el **hilo de DM** (VOLVER · BLOQUEAR/DESBLOQUEAR · INVITAR).
4. **INVITAR A PARTIDA** (solo si estás en un lobby): manda tu palabra de sala por DM; el otro ve el banner «N TE INVITÓ A "PALABRA"» con **UNIRSE** (pre-carga la palabra) / **IGNORAR**.

### Reglas

- Mensajes de **máx. 200 caracteres** (sanitizados igual en emisor y receptor: trim, espacios colapsados, recorte).
- **1 mensaje cada 1,5 s POR HILO**: la sala y cada DM enfrían por separado.
- **Efímero**: NADA persiste al cerrar la pestaña (ni mensajes, ni hilos, ni bloqueos; solo el toggle de disponibilidad queda en `localStorage`).
- **Bloqueo por sesión** (BLOQUEAR): corta la conversación en AMBOS sentidos y no se persiste (los peerId cambian en cada conexión).
- **DM requiere ambos disponibles**: si el otro se esconde (o cae por staleness, >20 s sin heartbeat de 5 s), su hilo pasa a **DESCONECTADO** con el input bloqueado; el historial queda.
- Sin identidad persistente: los nombres NO son únicos (dos "PILOTO" pueden coexistir).

**Límites de la v1**: sin historial ni offline ni notificaciones (nada llega con la pestaña cerrada), sin moderación central (la defensa es client-side: sanitize + throttle + bloqueo), malla pública cómoda hasta ~30–50 presentes por sala.

**Probarlo**: igual que el multijugador — 2–3 pestañas/dispositivos, EN LÍNEA → CHAT → tab PÚBLICO → MOSTRARME DISPONIBLE. Requiere `VITE_TRYSTERO_APP_ID` (ver [Configuración](#configuración-y-publicación)).

---

## Configuración y publicación

### `VITE_TRYSTERO_APP_ID`

| Dónde | Cómo |
| --- | --- |
| Desarrollo local | `cp .env.example .env.local` y ajustá el valor (`.env.local` está gitignored) |
| Producción (Pages) | Variable de repo `VITE_TRYSTERO_APP_ID` en **Settings → Secrets and variables → Actions → Variables** (la lee el workflow de deploy al buildear) |

- **Qué es**: el namespace de matchmaking de Trystero — un string público que agrupa las salas de ESTA aplicación dentro de los trackers de señalización. **NO es un secreto ni una API key**: queda visible en el bundle, y dos navegadores solo se encuentran si usan el mismo appId + la misma palabra de sala.
- **Si falta**: el build funciona igual (el requisito es de RUNTIME, no de build); al abrir el multijugador o el chat el lobby **falla rápido** con el error visible "falta VITE_TRYSTERO_APP_ID" en vez de conectar en silencio.

### `VITE_TRYSTERO_RELAYS` (opcional)

- **Qué es**: la lista de **trackers de señalización BitTorrent** que usa Trystero para el encuentro inicial entre jugadores (CSV de `wss://`/`ws://`). El tracker es solo el casamentero: una vez establecida la conexión, el tráfico del juego es **P2P directo** entre navegadores y nunca pasa por él.
- **Si falta o queda vacía**: la librería usa sus trackers default — comportamiento actual; no hace falta definirla.
- **Cuándo cambiarlo**: solo si querés depender de trackers propios (autoalojados) o si un default dejara de funcionar.
- **Riesgo de fragmentación**: la sala existe DENTRO de los trackers usados — dos jugadores con listas **disjuntas** (sin ningún tracker en común) nunca se encuentran, aunque compartan appId y palabra de sala; con al menos un tracker compartido sí conectan. Cualquier lista custom tiene que ser **igual en todas las instalaciones** (coordiná el cambio con todos los jugadores).
- Formato y validación: `wss://a, wss://b` — se ignoran entradas vacías o sin `wss://`/`ws://`; si la variable tiene contenido pero ninguna URL válida, el multijugador **falla rápido** con error visible (no degrada en silencio a los defaults, que fragmentaría el matchmaking). Con lista custom se usan TODAS las URLs (la redundancia de la librería solo aplica a sus defaults).
- **Producción (Pages)**: para que llegue al deploy hay que agregarla al paso de build de `.github/workflows/deploy.yml` junto a `VITE_TRYSTERO_APP_ID` (`VITE_TRYSTERO_RELAYS: ${{ vars.VITE_TRYSTERO_RELAYS }}`); en dev alcanza con `.env.local`.

### Analítica (PostHog Cloud EU, issue #27)

La analítica está **APAGADA por default** y es opt-in del administrador del deploy (no del jugador): hay que crear el proyecto y pegar el token, como se describe abajo. Mientras no haya token, no se pide ni un byte del SDK.

**Qué se mide** (y nada más — `autocapture: false`, sólo eventos explícitos):

| Evento | Properties | Cuándo |
| --- | --- | --- |
| Pageview | — (el default del snippet) | al cargar la página |
| `partida_iniciada` | `modo` (`entrenar` \| `gran_premio` \| `multijugador`), `pista` (sólo gran premio y carrera multi), `dificultad` (sólo gran premio: `easy`/`normal`/`hard`), `desgaste` (sólo gran premio, #39: booleano del toggle DESGASTE) | al arrancar una partida desde el menú o desde el lobby |
| `vuelta_completada` | `pista`, `duracion_ms` | cada vuelta válida del jugador local en RaceScene (gran premio y carrera multi; nunca por rival) |

**Qué NO se mide — cero PII**: nombres de jugador, contenido de chat, peer IDs ni datos de presencia jamás viajan en las properties (el código fuente es el contrato: [`src/telemetry/analytics.ts`](./src/telemetry/analytics.ts) es el único punto de contacto, y los ganchos viven en `MenuScene`, `LobbyScene` y `RaceScene`).

**Sin cookies ni storage ⇒ sin banner de consentimiento**: el proyecto se usa en modo **cookieless `always`** — PostHog no le pega un ID anónimo al visitante; cada evento se identifica server-side con un hash IRREVERSIBLE del request con **sal diaria**, así que no hay retención de identidad entre sesiones. El juego no escribe cookies ni `localStorage`/`sessionStorage` por telemetría, y por eso no necesita banner. Todo el flujo va por **PostHog Cloud EU** (API y assets en la UE).

**Activación (paso manual, una sola vez)**:

1. Crear el proyecto en **<https://eu.posthog.com>** con el modo **"Cookieless server hash mode"** habilitado (y, si querés máxima sobriedad, GeoIP deshabilitado en la configuración del proyecto).
2. Pegar el **Project API token** en [`index.html`](./index.html), en la constante `POSTHOG_TOKEN` del snippet de telemetría. El token es público por diseño (viaja en el HTML estático). **Vacío = analítica apagada** (ni siquiera se carga el SDK).
3. En desarrollo local (`npm run dev`) no hace falta nada: el snippet además está gateado por hostname y en `localhost`/`file://` no carga nada.

La telemetría es **fire-and-forget**: `trackEvent` nunca lanza ni bloquea el juego — con el SDK bloqueado (uBlock), sin red o a medio cargar, el juego corre idéntico.

### Publicación (GitHub Pages)

Los workflows corren **solo manualmente** — pestaña **Actions** → elegir workflow → **Run workflow** — sin disparadores automáticos por push ni PR:

- **Deploy a GitHub Pages** ([`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml)): corre la suite completa, buildea con `--base=/formulita/` (Pages sirve los sitios de proyecto bajo subpath) y publica en **<https://juliangt.github.io/formulita/>**.
- **CI** ([`.github/workflows/ci.yml`](./.github/workflows/ci.yml)): tests + build, sin deploy.

Requisitos (una sola vez, quien administra el repo):

1. **Settings → Secrets and variables → Actions → Variables** (no Secrets): `VITE_TRYSTERO_APP_ID` (p. ej. `formulita`).

> El sitio de Pages no requiere configuración manual: `deploy.yml` usa `actions/configure-pages` con `enablement: true`, así que habilita el sitio (source "GitHub Actions") en el propio run si aún no existe. Sin la variable, en cambio, el sitio se publica igual (el appId es runtime, no build-time), pero el multijugador mostrará el error de configuración faltante al entrar al lobby.

---

## Arquitectura (por capas)

Principios SOLID: escenas que solo orquestan, lógica pura testeable, input/audio/persistencia detrás de interfaces.

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
└── data/                 # ISaveRepository → LocalStorageSaveRepository (fallback en
                          memoria); punto de extensión para scoreboard HTTP
```

Decisiones clave:

- **EventBus tipado de sesión**: las escenas emiten eventos (`speed`, `coins`, `game-over`, `game-paused`…) y el HUD/audio reaccionan sin acoplarse. Los widgets se desuscriben en su `destroy()`.
- **Object pooling con límite duro** por familia de entidad: ninguna sesión larga crea objetos sin tope; las partículas también tienen `maxParticles`.
- **Pausa real por `scene.pause()`**: la escena de juego congela update, física, tweens, timers y partículas; el overlay vive en una escena aparte (`PauseScene`) porque una escena pausada tampoco procesa su input.
- **Texturas 100% procedurales** (`Graphics.generateTexture()` una vez en Preload; la viñeta de turbo es un gradiente de canvas horneado una vez). Sin `Graphics` dinámicos en `update`.
- **Persistencia con interfaz** (`ISaveRepository`): swap a un repositorio HTTP futuro sin refactor del juego.

---

## Tests

- 108 archivos / 1546 tests en `src/__tests__/`, corridos con `npm test` (Vitest, entorno `happy-dom` + stub de contexto 2D en `src/__tests__/setup.ts`).
- **Modo solo**: lógica pura de todos los sistemas (velocidad, turbo, DRS, spawn con pasabilidad + pool, dificultad, puntaje, countdown, pausa, input con multi-touch, derrape, persistencia, audio con fakes de Web Audio) + tests de integración sin runtime de Phaser (input → steering, SpawnScheduler × Difficulty, colisiones → economía, carrera → guardado → recarga).
- **Multijugador**: lobby y carrera compartida contra un hub en memoria (`fakes/FakeNetClient.ts`) — roster/colores/anfitrión, pista determinista por seed, stream a 10 Hz con fantasmas interpolados, eliminaciones/stale/desconexiones, y el flujo COMPLETO de una partida de 3 clientes que exige el MISMO ranking en los tres.
- **Chat social**: ChatStore (sanitize/throttle por hilo/no leídos/bloqueo), TrysteroChatClient contra hub fake (presencia opt-in, heartbeat, stale, DM/invite) y flujo COMPLETO de 3 clientes (`socialFullFlow.test.ts`), 100% determinista con reloj/timers inyectados.
- **Carrera en circuito**: pistas validadas (curvatura/banda de duración de vuelta), física y anti-corte (LapTracker por sectores), parrilla determinista, ranking/clasificación, plausibilidad y staleness, protocolo `rstate`/`rfin`/`race-over` y flujos completos practice/multi.
- **Gran Premio**: roster de 7 rivales determinista por seed, presets de dificultad en orden estricto (fácil < normal < difícil, probados sobre simulación headless a 60 Hz), línea de carrera, payload de resultados con parseo defensivo y récords por pista × dificultad (round-trip, JSON corrupto, storage roto → memoria, claves aisladas).
- **Telemetría (#27)**: wrapper no-op seguro de [`src/telemetry/analytics.ts`](./src/telemetry/analytics.ts), snippet gateado de `index.html` y ganchos de juego (`partida_iniciada` en menú y lobby, `vuelta_completada` en RaceScene con un LapTracker real de por medio) asertados contra un `window.posthog.capture` espiado, con igualdad EXACTA de properties (sin PII).

---

## QA manual

Los checklists de verificación manual (desktop, mobile, multijugador, carrera, gran premio y chat con dispositivos reales) viven en [`docs/QA.md`](./docs/QA.md) — es el QA que la suite no puede cubrir: teclado virtual, foco, overlays del SO y sesiones largas multi-dispositivo.

---

## Roadmap (fuera del MVP)

- **Tienda básica**: skins de color del auto y mejoras menores (capacidad de turbo, duración de DRS) compradas con las monedas acumuladas.
- **Scoreboard en servidor externo**: implementando la interfaz de persistencia ya prevista (`ISaveRepository` / cliente HTTP) sin refactor del juego.

---

## Notas

- Todos los números de balance (velocidades, turbo, DRS, spawns, layout de HUD, daño) viven en `src/config/balance.ts` con comentarios de intención: ajustables sin tocar lógica.
