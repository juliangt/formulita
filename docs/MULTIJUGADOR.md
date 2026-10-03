# Multijugador y chat social (P2P, sin servidor)

Todo lo que necesita red corre sobre **Trystero** con su estrategia **torrent** (`@trystero-p2p/torrent`): no hay servidor propio, solo WebRTC directo entre navegadores. Las bases (qué es Trystero, qué hace el tracker de torrent, el appId y la palabra de sala) están explicadas en el [README](../README.md#multijugador-p2p-trystero--torrent); acá está el resto: los modos en línea, cómo funciona por dentro, los límites y cómo probarlo.

## Cómo entrar

Menú → **EN LÍNEA** → poné tu nombre → crear sala (el juego te da la palabra) o unirse con la palabra del anfitrión (máx. 12 caracteres para el nombre). El color del auto se asigna en función del roster (determinista e idéntico para todos). Con 2 o más en sala, el **anfitrión** elige modo (**BATALLA** o **CARRERA**) y, en carrera, la pista (con miniatura); aprieta **INICIAR** y el countdown arranca sincronizado en todos.

## Batalla (battle royale por monedas)

Todos corren la MISMA pista infinita y gana el que **más monedas juntó** al cierre: sobrevivir solo da más tiempo para juntar, no la corona (desempate por kilómetros y luego por puntaje).

- Si tu chasis llega a 0 quedás **eliminado como espectador**: seguís viendo la carrera de los demás (con botón CHAT) hasta que queda un solo vivo.
- Leaderboard final: **monedas DESC → km DESC → puntaje DESC**, idéntico en todos los dispositivos (mismo orden y mismo ganador).

## Carrera (circuito, 2–10 jugadores)

Vueltas por un circuito cerrado, como la F1 de verdad: parrilla de salida detrás de la meta, **3 vueltas (~2 min)** y cronometraje completo (tiempo total, vuelta en curso y **mejor vuelta**).

- Ranking en vivo (**P3/8** en el HUD) y al terminar cada uno difunde su tiempo exacto.
- **Fin de carrera**: el primero en completar las 3 vueltas gana; la partida cierra cuando terminan todos o a los 30 s del primer finish (los que no llegaron clasifican por su último progreso). Podio final con nombres, colores y tiempos, **VUELTA RÁPIDA** destacada en oro y **confeti** al cruzar tu meta.
- **Anti-corte**: cortar por el pasto salta sectores de la vuelta y **la vuelta no cuenta** (checkpoints).
- Quien termina pasa a **espectador** siguiendo al líder (con botón CHAT).

## Cómo funciona por dentro

Pista **determinista por seed de sala + reloj virtual** de generación (misma distancia ⇒ mismas oleadas en todos), rivales como **autos fantasma interpolados** (estado propio a 10 Hz, render a t−100 ms, semitransparentes y atravesables) y **stats congeladas** al crash/fin, de modo que cada cliente computa el MISMO leaderboard/podio sin negociar nada por la red. En carrera, cada cliente aplica además un **filtro de plausibilidad local** (un avance físicamente imposible se ignora) — no hay servidor árbitro.

**Compatibilidad de pistas entre versiones**: el `start` del anfitrión viaja con el `trackId` como string. Un cliente que recibe el id de una pista que su versión no conoce (p. ej. `galvez` hacia un cliente anterior al issue #26) la degrada **en silencio** a la primera del registro (**MÓNACO**): la carrera arranca igual, pero ese cliente corre otra pista. Detectar el desfasaje en el lobby antes de INICIAR es un follow-up no bloqueante.

## Límites de la v1

- **Sin reconexión**: te caés, recargás o cerrás = eliminado/ABANDONÓ, con las stats hasta ese momento.
- **Autos fantasma sin colisión entre sí** (y atravesables respecto del propio): solo tu pista local te elimina.
- **Sin árbitro ni anti-cheat**: cada cliente reporta sus propias stats (confianza P2P + filtro de plausibilidad).
- **Background del navegador elimina** por staleness (>20 s sin difundir estado).
- **Monedas por instancia local**: dos jugadores pueden tomar la misma moneda (cada uno la ve en su propia pista).
- **NAT/4G restrictivos pueden fallar**: WebRTC directo sin TURN propio; si el handshake no cruza, la sala no conecta (error visible en el lobby).
- **Los récords de un modo no se mezclan** con los de otro.

## Probarlo local

1. `npm run dev` y abrí **dos pestañas** de la misma URL (o dos dispositivos de la red por la IP LAN — ver [Empezar](../README.md#empezar)).
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

**Probarlo**: igual que el multijugador — 2–3 pestañas/dispositivos, EN LÍNEA → CHAT → tab PÚBLICO → MOSTRARME DISPONIBLE. Requiere `VITE_TRYSTERO_APP_ID` (ver [`CONFIGURACION.md`](./CONFIGURACION.md)).
