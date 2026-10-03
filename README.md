# Formulita

Videojuego de carreras de Fórmula 1 en 2D, estilo retro 8-bit (pixel art 100% procedural, cero assets externos), **mobile-first** en orientación vertical (720×1280). **Phaser 4 + Vite + TypeScript strict.**

**👉 Jugá la versión publicada: <https://juliangt.github.io/formulita/>**

---

## Arquitectura en simple

Todo pasa dentro de **un solo canvas** de Phaser, organizado en **escenas que solo orquestan** (boot, menú, carrera, game over y overlays de pausa/lobby/chat). La lógica del juego vive en **sistemas puros** — velocidad, turbo, DRS, spawns, dificultad, física de circuito — sin conocer Phaser: son funciones testeables de punta a punta. Las piezas se hablan a través de un **EventBus tipado** (la escena emite eventos y el HUD/audio reaccionan sin acoplarse), los gráficos son **pixel art 100% procedural** (texturas generadas una vez al precargar, cero assets externos) y la persistencia de récords y monedas pasa por una **interfaz de repositorio** con implementación en `localStorage`.

```
input (teclado/táctil) ─┐
                        ▼
        sistemas puros (lógica de juego)
                        │ eventos
                        ▼
   EventBus tipado ──► escenas (render) ──► HUD y audio
                        │
                        ▼
        persistencia (ISaveRepository → localStorage)
```

El árbol completo de `src/`, las decisiones de diseño y el detalle de la suite de tests: [`docs/ARQUITECTURA.md`](./docs/ARQUITECTURA.md).

---

## Modos de juego

| Modo | Botón del menú | Jugadores | ¿Necesita red? | En una línea |
| --- | --- | --- | --- | --- |
| **Infinito** | JUGAR | 1 | No | Carrera infinita esquivable: turbo, DRS, monedas, pickups, rivales, restos y aceite; la dificultad sube con la distancia. |
| **Gran Premio** | GRAN PREMIO | 1 vs 7 CPU | No (100% offline) | 3 vueltas (~2 min) por 6 pistas de F1 contra rivales con IA de línea de carrera; 3 dificultades y récords por pista × dificultad. |
| **Batalla** | EN LÍNEA | 2–10 | Sí (P2P, sin servidor) | Todos corren la MISMA pista (definida por la palabra de sala); gana el que más monedas juntó. Eliminado = espectador. |
| **Carrera** | EN LÍNEA | 2–10 | Sí (P2P, sin servidor) | Vueltas por circuito cerrado con ranking en vivo y podio final; la pista y la parrilla son idénticas en todos los dispositivos. |
| **Chat social** | EN LÍNEA → CHAT | — | Sí (P2P) | Chat de sala, presencia pública **opt-in** con mensajes directos e invitaciones a partida; nadie aparece en ninguna lista hasta habilitarlo. |

Controles, reglas y detalles de cada modo en solitario ([`docs/MODOS.md`](./docs/MODOS.md)) y de los modos en línea ([`docs/MULTIJUGADOR.md`](./docs/MULTIJUGADOR.md)).

---

## Multijugador P2P: Trystero + torrent

El multijugador y el chat social corren **sin servidor propio**: conexión **WebRTC directa entre navegadores**, coordinada por la librería **[Trystero](https://github.com/dmotz/trystero)** con su estrategia **torrent** (`@trystero-p2p/torrent`).

Cómo funciona, en cuatro ideas:

1. **Trystero** convierte una "sala" en un grupo de navegadores conectados entre sí: `joinRoom(appId, palabra)`.
2. **La palabra de sala** (5–9 letras, pronunciable por teléfono) es la clave de todo: los que entran con la misma palabra forman la misma sala y, como la pista se genera **determinísticamente a partir de esa palabra** (más un reloj virtual), todos corren exactamente el mismo contenido sin negociar nada por la red.
3. **Torrent = la señalización inicial**. Para que dos navegadores que no se conocen logren el primer contacto (intercambiar las ofertas WebRTC), la estrategia torrent usa **trackers BitTorrent** — los mismos servidores de la red de torrents, pero haciendo solo de **casamentero**: una vez establecida la conexión, el tráfico del juego va **directo entre peers** y nunca vuelve a pasar por el tracker.
4. **El `appId`** (`VITE_TRYSTERO_APP_ID`) es el namespace que separa las salas de esta aplicación de otras que usen los mismos trackers. No es secreto (viaja en el bundle): dos navegadores se encuentran solo con el mismo appId **y** la misma palabra. Con `VITE_TRYSTERO_RELAYS` podés usar trackers propios en vez de los defaults de la librería.

**Cómo entrar**: Menú → **EN LÍNEA** → tu nombre → crear sala (el juego te da la palabra) o unirse con la del anfitrión. Con 2 o más en sala, el anfitrión elige modo (BATALLA o CARRERA), pista y **INICIAR** arranca el countdown sincronizado en todos. La misma red da el **chat social** (chat de partida + presencia opt-in con DMs e invitaciones).

Cómo funciona por dentro (fantasmas interpolados, leaderboards idénticos, filtro de plausibilidad), los límites de la v1 y cómo probarlo local: [`docs/MULTIJUGADOR.md`](./docs/MULTIJUGADOR.md).

---

## Empezar

Requisitos: Node 20+ (probado en Node 22) y npm 10+.

```bash
npm install
npm run dev        # dev server en http://localhost:5173 (expuesto en la LAN)
npm run build      # chequeo de tipos (tsc) + build de producción en dist/
npm run preview    # sirve dist/ en http://localhost:4173
npm test           # suite de tests (Vitest)
```

Para probar **desde el celular**: conectalo a la misma red Wi-Fi y abrí la URL `Network:` que imprime Vite (el `server.host: true` ya está configurado en `vite.config.ts`).

**Instalable como app (PWA, issue #43)**: manifest + service worker propios (cero dependencias nuevas), con registro **solo en producción** — en `npm run dev` el juego corre sin caché de por medio mientras iterás; en `npm run preview` y en el deploy de Pages:

- **Android (Chrome)**: ofrece *Instalar app* (prompt del navegador o menú ⋮). Queda en el launcher con icono y nombre "Formulita", fullscreen y sin barra del navegador.
- **iOS (Safari)**: *Compartir → Agregar a pantalla de inicio*. Se abre standalone con icono propio, respetando el notch.
- **Offline**: tras la primera visita, el modo un jugador es 100% jugable sin red (el juego baja cero assets externos). El multijugador sigue necesitando conexión por diseño (P2P).
- **Actualizaciones**: al recargar con red entra la versión nueva (navegaciones network-first) y la caché vieja se limpia sola.

Detalles del service worker, del registro y del prompt de instalación: [`src/pwa/`](./src/pwa/) y [`docs/ARQUITECTURA.md`](./docs/ARQUITECTURA.md).

El multijugador necesita `VITE_TRYSTERO_APP_ID` (copiá `.env.example` a `.env.local`); los trackers custom y la analítica son opcionales y quedan apagados sin configuración. Toda la configuración — variables, PostHog y deploy a GitHub Pages — en [`docs/CONFIGURACION.md`](./docs/CONFIGURACION.md).

> El warning `chunk larger than 500 kB` en `npm run build` es esperado: Phaser es grande y en un juego de un solo canvas no conviene code-splitting.

---

## Tests y QA

- **130 archivos / 1787 tests** en `src/__tests__/` (`npm test`, Vitest): lógica pura de todos los sistemas, integración sin runtime de Phaser, multijugador contra un hub en memoria y flujos completos de 3 clientes con ranking idéntico. Detalle por área: [`docs/ARQUITECTURA.md`](./docs/ARQUITECTURA.md).
- **QA manual** (teclado virtual, foco, overlays del SO, sesiones largas multi-dispositivo): [`docs/QA.md`](./docs/QA.md).

---

## Roadmap (fuera del MVP)

- **Tienda básica**: skins de color del auto y mejoras menores (capacidad de turbo, duración de DRS) compradas con las monedas acumuladas.
- **Scoreboard en servidor externo**: implementando la interfaz de persistencia ya prevista (`ISaveRepository` / cliente HTTP) sin refactor del juego.

---

## Notas

- Todos los números de balance (velocidades, turbo, DRS, spawns, layout de HUD, daño) viven en `src/config/balance.ts` con comentarios de intención: ajustables sin tocar lógica.
