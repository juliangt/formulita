/**
 * carContacts — contactos entre autos del GRAN PREMIO (issue #39).
 *
 * Los 8 autos compiten EN el mismo mundo y ya no se atraviesan. La
 * resolución es PURA y determinista (misma entrada → misma salida: la
 * reproducibilidad por seed de la carrera queda intacta) y opera sobre los
 * `CarState` de la física del circuito — velocidad ESCALAR a lo largo del
 * heading, sin velocidad lateral — así que el impulso se descompone en el
 * frame de cada auto:
 *
 * 1. SEPARACIÓN posicional (siempre que se solapan): cada auto cede la
 *    mitad del solape a lo largo de la normal del contacto. Es lo que
 *    impide atravesar y lo que hace real el "bloquear": sostener la línea
 *    empuja al otro fuera del hueco.
 * 2. IMPULSO (sólo si se ACERCAN: `dot(vRel, normal) > 0` y UNA vez por
 *    par), acotado por `RACE_CONTACT.maxImpactPx`:
 *    - **Empujón**: la víctima (auto de adelante) gana velocidad a lo largo
 *      de SU heading, proporcional a la componente alineada del impacto —
 *      "lo empujás para adelante levemente".
 *    - **Desvío**: el heading de cada auto se corre proporcional a la
 *      componente LATERAL de la normal — el ángulo del contacto decide:
 *      toque de atrás ≈ empujón puro, roce de lado ≈ desvío puro.
 *    - **Frenada del agresor**: el auto cuyo frente impacta pierde
 *      velocidad ("el que choca se frena un poco") — más de la que le
 *      regala al empujado: golpear nunca es rentable.
 *
 * Los pares se barren en VARIAS pasadas (hasta `MAX_SWEEPS`): resolver un
 * par puede pisar a un tercero (paquetes de primera curva) y una sola
 * pasada dejaría solapamientos vivos. El impulso NO se repite por pasada —
 * un roce continuo no ametralla — y cada par reporta su golpe UNA vez (el
 * de mayor impacto).
 *
 * Puro: sin Phaser ni escenas, muta los `CarState` que recibe (mismo estilo
 * que `CircuitPhysics.step`) y devuelve los golpes que hubo, para que la
 * escena decida SFX/shake y desgaste.
 */

import { RACE_CONTACT } from '../config/balance';
import type { CarState } from './circuitPhysics';

/** Un golpe entre dos autos (índices en el arreglo pasado a resolver). */
export interface CarContact {
  /** Índice del primer auto del par (el de "atrás" en un toque de cola). */
  readonly a: number;
  /** Índice del segundo auto del par. */
  readonly b: number;
  /**
   * Impacto del contacto (px/s de acercamiento a lo largo de la normal,
   * ya clampeado a `RACE_CONTACT.maxImpactPx`).
   */
  readonly impact: number;
}

/**
 * Pasadas máximas de separación. Resolver un par puede volver a pisar a un
 * tercero (paquetes de primera curva), así que se barra hasta que el paquete
 * quede limpio o se agote el tope: la cota garantiza separación COMPLETA
 * incluso en densidades imposibles en carrera (grilla de 50 px con autos de
 * 60 px de diámetro) a un costo despreciable (n = 8: ≤ 700 chequeos).
 */
const MAX_SWEEPS = 24;

/**
 * Componente lateral con signo de un vector respecto de un heading (sistema
 * con y hacia abajo, heading creciendo girando a la derecha en pantalla):
 * cross(heading, v). Con heading 0 (mirando a +x), un vector hacia +y — la
 * DERECHA del auto — da +1; apuntando a −y (su izquierda), −1.
 */
function lateralOf(dx: number, dy: number, heading: number): number {
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  // Vector heading (cos, sin); lateral = cross(heading, v) = hx·vy − hy·vx.
  return cos * dy - sin * dx;
}

/**
 * Resuelve TODOS los contactos del paquete de autos (jugador + rivales del
 * GP, O(n²) con n = 8: despreciable). Mutación in-place de los estados y
 * lista de golpes (uno por par que aplicó impulso, en orden de primera
 * aparición — determinista).
 *
 * Defensivo: estados con NaN en posición se tratan como en el origen del
 * par (la separación los empuja afuera); dos autos EN el mismo punto no
 * producen impulso (normal indefinida) pero sí se separan por su heading.
 */
export function resolveCarContacts(cars: CarState[]): CarContact[] {
  const contacts = new Map<string, CarContact>();
  const minDist = RACE_CONTACT.radiusPx * 2;

  for (let sweep = 0; sweep < MAX_SWEEPS; sweep += 1) {
    let separated = false;

    for (let i = 0; i < cars.length; i += 1) {
      for (let j = i + 1; j < cars.length; j += 1) {
        const a = cars[i];
        const b = cars[j];
        const ax = Number.isFinite(a.x) ? a.x : 0;
        const ay = Number.isFinite(a.y) ? a.y : 0;
        const bx = Number.isFinite(b.x) ? b.x : 0;
        const by = Number.isFinite(b.y) ? b.y : 0;
        let nx = bx - ax;
        let ny = by - ay;
        const distSq = nx * nx + ny * ny;
        if (distSq >= minDist * minDist) {
          continue; // Ni cerca: el par más común de todo el paquete.
        }

        // 1) Separación posicional: la mitad del solape para cada uno.
        const dist = Math.sqrt(distSq);
        if (dist > 1e-6) {
          nx /= dist;
          ny /= dist;
          const push = (minDist - dist) / 2;
          a.x = ax - nx * push;
          a.y = ay - ny * push;
          b.x = bx + nx * push;
          b.y = by + ny * push;
          separated = true;
        } else {
          // Mismo punto (corrupción): separación por el heading de b,
          // dirección estable, sin impulso (la normal no está definida).
          const hx = Math.cos(b.heading);
          const hy = Math.sin(b.heading);
          const len = Math.hypot(hx, hy);
          nx = len > 1e-6 ? hx / len : 1;
          ny = len > 1e-6 ? hy / len : 0;
          a.x = ax - nx * minDist;
          a.y = ay - ny * minDist;
          b.x = bx;
          b.y = by;
          separated = true;
          continue;
        }

        // 2) Impulso UNA vez por par (el mapa deduplica entre pasadas) y
        //    sólo si se acercan a lo largo de la normal.
        const key = `${i}:${j}`;
        if (contacts.has(key)) {
          continue;
        }
        const vaAlong = Math.cos(a.heading) * a.speed;
        const vaPerp = Math.sin(a.heading) * a.speed;
        const vbAlong = Math.cos(b.heading) * b.speed;
        const vbPerp = Math.sin(b.heading) * b.speed;
        const approach = (vaAlong - vbAlong) * nx + (vaPerp - vbPerp) * ny;
        if (approach <= 0) {
          continue; // Se separan o van en paralelo: la separación basta.
        }
        const impact = Math.min(approach, RACE_CONTACT.maxImpactPx);

        // La normal de cada impulso apunta DESDE el otro auto HACIA el que
        // lo recibe: `n` va de a→b, así que a recibe −n y b recibe +n.
        applyContactImpulse(a, -nx, -ny, impact);
        applyContactImpulse(b, nx, ny, impact);
        contacts.set(key, { a: i, b: j, impact });
      }
    }

    if (!separated) {
      break; // Paquete limpio: no hace falta otra pasada.
    }
  }
  return [...contacts.values()];
}

/**
 * Aplica a UN auto su parte del impulso de un contacto cuya normal (desde
 * el OTRO auto hacia éste) es `(nx, ny)`, con el `impact` ya clampeado.
 *
 * - Componente de la normal ALINEADA con SU heading (cos > 0: el otro auto
 *   quedó detrás) → empujón hacia adelante. Si el otro quedó adelante
 *   (cos < 0: SU frente chocó contra él) → frenada de agresor.
 * - Componente LATERAL → desvío del heading, alejándolo del contacto.
 */
function applyContactImpulse(car: CarState, nx: number, ny: number, impact: number): void {
  const cos = Math.cos(car.heading);
  const sin = Math.sin(car.heading);
  const aligned = nx * cos + ny * sin; // +1: el otro detrás; −1: el otro adelante.
  const lateral = lateralOf(nx, ny, car.heading);

  if (aligned > 0) {
    // Empujado desde atrás: gana el empujón a lo largo de SU dirección.
    car.speed += RACE_CONTACT.pushFactor * impact * aligned;
  } else {
    // Golpeó con su frente: se frena (frenada simétrica al impacto, sin
    // atenuar por el ángulo: de frente o de costado, chocar frena).
    car.speed -= RACE_CONTACT.ramSlowFactor * impact;
  }

  // Desvío: girar ALEJÁNDOSE del contacto. `lateral` es cross(heading, n)
  // con `n` apuntando desde el otro hacia acá: lateral > 0 significa contacto
  // a la IZQUIERDA del auto (en pantalla y-hacia-abajo, girar a la izquierda
  // es RESTAR heading), así que el giro de alejamiento sigue ese signo.
  const strength = Math.abs(lateral);
  if (strength > 1e-3) {
    car.heading +=
      Math.sign(lateral) *
      RACE_CONTACT.deflectRadPerImpact *
      (impact / RACE_CONTACT.maxImpactPx) *
      strength;
  }
}
