# Modos de juego en solitario y controles

Detalle de los modos sin red. Los modos en línea (batalla, carrera y chat social) están en [`MULTIJUGADOR.md`](./MULTIJUGADOR.md).

## Controles

### Modo Infinito (JUGAR)

| Acción | Teclado | Táctil (HUD) |
| --- | --- | --- |
| Doblar | ← → o A / D | **Joystick deslizable** (abajo-izquierda, issue #37) |
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
| Doblar | ← → o A / D | **Joystick deslizable** (abajo-izquierda, issue #37) |
| Gas | W o ↑ | GAS (abajo-derecha, verde) |
| Freno | ↓ / S / Espacio | FRENO (abajo-derecha) |

Común a todos los modos:

- **Doblado analógico (issue #37)**: en táctil, el giro es un joystick horizontal — apoyá el dedo en la zona inferior-izquierda y deslizalo: cuanto más lejos del centro, más giro (con zona muerta en el medio). Al soltar —aunque el dedo salga del canvas— el volante vuelve al centro. El teclado sigue binario (← → / A D).
- Los controles táctiles soportan **multi-touch real** (tracking de `pointerId` por control): doblar deslizando y acelerar a la vez.
- La carrera arranca con un **countdown 3-2-1-GO!**: el mundo está congelado hasta el final de la cuenta.
- La **pausa es real**: botón en pantalla, tecla P, o **automática** al cambiar de pestaña / perder el foco. Física, scroll, spawn y puntaje quedan congelados de verdad hasta reanudar.

---

## Modo Infinito (JUGAR)

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
- **Goma declarada y acotada**: si un rival queda muy lejos del jugador, su ritmo se ajusta una fracción MUY chica para que la pelea no se rompa — tope pequeño por dificultad (el mayor en FÁCIL, casi rígido en DIFÍCIL) y NUNCA por encima del techo físico del auto.
- **Dificultad**: los presets ajustan ritmo en recta, calidad de trazada, frecuencia de errores, agresividad y goma; el orden fácil < normal < difícil está garantizado por tests.

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

### Récords

- Por **cada pista × dificultad** el juego recuerda tu **mejor posición** y tu **mejor vuelta** en `localStorage` (clave versionada `formulita.gp.v1`, con fallback en memoria para modo privado).
- Superar cualquiera de las dos dispara **¡NUEVO RÉCORD!** en los resultados; repetir el mejor puesto o girar más lento no toca nada. Las marcas de un modo no se mezclan con las de otro.

> El antiguo **practice** (circuito en solitario) vive como rama interna del modo carrera: el botón del menú ahora lanza el GRAN PREMIO, y REINTENTAR desde resultados corre en solitario contra el cronómetro.
