# QA manual de Formulita

Checklists de verificación manual que la suite de tests (`npm test`) no cubre: lo físico (teclado virtual, foco, overlays del SO), lo multi-dispositivo y las sesiones largas.

Criterio de aceptación global: **sesión de 10 minutos sin errores de consola** y `npm run build` exitoso.

---

## Desktop (teclado)

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
- [ ] Salud del vehículo: un choque NO mata al instante — la barra CHASIS baja, hay flash/shake más chicos que el de muerte y el auto parpadea ~0,6 s (i-frames, el golpe repetido inmediato no vuelve a doler).
- [ ] Roce con pared: chispas en el borde del auto, la CHASIS drena continuamente (la pared no respeta i-frames) y sostener el roce llega a muerte.
- [ ] Estado crítico (≤ 25%): el auto echa humo gris continuo y la barra CHASIS parpadea; el botiquín (+35) la recompone y humo/parpadeo de barra se apagan.
- [ ] Aceite: derrape breve con control invertido, sin muerte; el auto no pierde vida por eso.
- [ ] Récord y monedas persisten tras recargar la página (F5); el mute también persiste.
- [ ] Botón PANTALLA COMPLETA (y tecla F) del menú: entra/sale y la etiqueta cambia a VENTANA; el canvas sigue nítido (pixel art sin blur).
- [ ] Click derecho sobre el canvas no abre menú contextual; doble click no hace zoom.
- [ ] 10 minutos de carrera seguida: sin errores/warnings de consola, sin degradación de FPS perceptible.

## Mobile (táctil, vía LAN)

- [ ] La URL de red abre el juego en vertical sin scroll, sin zoom y sin tap-highlight.
- [ ] Con notch: la UI no queda tapada por la muesca (safe-area insets) y el canvas escala completo sin distorsión.
- [ ] Multi-touch real: doblar con ◀ ▶ mientras se mantiene GAS; soltar un dedo no suelta el otro botón.
- [ ] Los 6 botones del HUD (◀ ▶ GAS BRK TURBO DRS) presionan y sueltan limpio, con feedback visual de presión; ninguno "queda pegado" tras una pausa.
- [ ] Botón II pausa; REANUDAR/MENÚ responden al primer toque.
- [ ] Cambiar de app / bloquear la pantalla: al volver hay overlay de PAUSA AUTOMÁTICA y el progreso (monedas bancadas) quedó guardado.
- [ ] El audio suena desde el primer toque (desbloqueo de autoplay) y el mute persiste entre sesiones; el motor sube de tono con la velocidad y se calla en pausa.
- [ ] Long-press sobre la pantalla no abre menú contextual ni selecciona texto; double-tap no hace zoom.
- [ ] Sesión de 10 minutos: sin errores de consola, sin fugas evidentes (el pool recicla: la densidad de entidades no crece con el tiempo).

## Multijugador (multi-dispositivo: Wi-Fi + 4G mezclados)

Criterio de aceptación (M3): partida de ~10 minutos con dispositivos REALES en redes mezcladas (uno en Wi-Fi, otro en 4G) sin errores de consola, mismo trazado en todos y leaderboard idéntico. Se prueba contra la versión publicada (<https://juliangt.github.io/formulita/>) o con `npm run dev` / `npm run preview` en la LAN.

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

## Carrera en circuito (multi + GRAN PREMIO)

- [ ] Carrera local (GRAN PREMIO, y practice como rama interna): countdown, 3 vueltas, cartel pop **¡VUELTA 2/3!** al completar cada vuelta que no sea la final, cartel ¡BANDERA A CUADROS! + **confeti** en la última, resultados con tiempo total y mejor vuelta.
- [ ] El dron del motor sube de tono al acelerar y baja al frenar; se calla en pausa, al cruzar la meta y al salir por MENÚ (sin sonido colgado).
- [ ] CARRERA (multi): parrilla idéntica en todos los dispositivos, badge Pn/N en vivo, `rfin` propio → espectador con cartel + botón CHAT, cierre de la carrera (todos terminan o gracia de 30 s) y **podio final idéntico** con la línea **VUELTA RÁPIDA: NOMBRE (M:SS.mmm)** en oro.
- [ ] Un peer en background >20 s desaparece del mundo/minimapa y figura como ABANDONÓ en el podio; la carrera concluye igual.
- [ ] Escalado móvil 720×1280 (Scale.FIT): HUD (vueltas/tiempos/Pn-N), minimapa, botón de mute y botones táctiles ◀ ▶ GAS FRENO se ven y alcanzan bien en un teléfono chico — todo el HUD se dibuja en coordenadas del lienzo base y el canvas escala completo sin distorsión.
- [ ] Largada hacia **arriba** de la pantalla en las 5 pistas (auto y parrilla), y **gas manual**: sin tocar GAS el auto desacelera sola (coast); con GAS llega al techo de velocidad (issue #20).
- [ ] Subpantalla EN LÍNEA del menú (issue #22: reemplaza a MULTIJUGADOR y CHAT) en viewport con letterbox (≠ 9:16): el input TU NOMBRE se ve DENTRO del panel y acepta texto; tocar CREAR/UNIRSE/CHAT sin nombre muestra "INGRESÁ TU NOMBRE" (issue #21) y CHAT no abre el chat. Ídem input de palabra de sala en UNIRSE y los inputs de chat en DM.
- [ ] El pasto corta: cortar por afuera salta sectores de la vuelta y **la vuelta no cuenta** (anti-corte por checkpoints).
- [ ] Regresión: el modo solo (JUGAR) y la BATALLA multi (leaderboard, espectador, chat) funcionan exactamente igual que antes.

## Gran Premio (vs CPU)

- [ ] Flujo completo: menú → GRAN PREMIO → pista + dificultad → carrera de 8 autos → podio → récord → REINTENTAR conserva pista y dificultad; MENÚ vuelve limpio.
- [ ] Las 3 dificultades se notan: FÁCIL perdona (errores rivales visibles), DIFÍCIL exige; el chip del HUD y el subtítulo de resultados muestran siempre la elegida.
- [ ] HUD vivo: badge Pn/8, gap +/- en segundos con los vecinos, minimapa con tu punto, cartel ¡VUELTA n/3!, SFX de largada y de adelantamiento (suena al ganar Y al perder posiciones, con enfriamiento).
- [ ] Podio correcto: top 3 con nombres y ganador en oro; terminar 4º o peor muestra tu fila destacada debajo; ¡NUEVO RÉCORD! parpadea solo cuando superaste una marca (posición o vuelta).
- [ ] Récords por pista × dificultad aislados: una marca en MÓNACO FÁCIL no aparece ni en MONZA ni en DIFÍCIL, y persiste tras recargar la página (F5).
- [ ] Sin red: en modo avión / offline el GRAN PREMIO arranca y corre completo (el modo nunca toca la red).
- [ ] Regresión: CARRERA multi, la BATALLA y el modo solo funcionan exactamente igual que antes.

## Chat social (multi-dispositivo: iOS + Android mezclados)

Criterio de aceptación (C4): el flujo social completo con 3 dispositivos REALES sin errores de consola.

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
- [ ] El badge del botón EN LÍNEA del menú (issue #22: heredado del viejo botón CHAT) cuenta los no leídos de sala + DMs y se limpia al abrir cada hilo; el nombre editado en TU NOMBRE es el mismo en la sala y en el chat.
- [ ] Sesión de ~10 minutos de chat (sala + DMs + bloqueos) sin errores ni warnings de consola en ningún dispositivo.
- [ ] Cerrar la pestaña y volver: no queda rastro de mensajes ni hilos (efímero); solo el toggle de disponibilidad se recuerda.
