/**
 * tracks — las 6 pistas del registro (issues #9 y #26: data pura + registro).
 *
 * Cada `TrackDefinition` describe un circuito cerrado inspirado en un GP
 * real: waypoints de control (26–32) sobre un mundo de 7000×7000 px que
 * `TrackPath` CIERRA EXPLÍCITAMENTE (las listas NO repiten el primer punto)
 * y suaviza con Catmull-Rom centrípeto. Issue #18: el mundo y los anchos se
 * escalan ×2.5 respecto de la V0 (2800 px / Mónaco 116) para que el asfalto
 * llene la pantalla al conducir (≥ 80% del ancho con `RACE.cameraZoom`); las
 * velocidades escalan igual y los turn rates no cambian, así el gameplay
 * relativo es idéntico a escala.
 *
 * Diseño validado (tests de `tracks.test.ts`) contra la física de
 * `circuitPhysics`:
 * - Duración de vuelta dentro de la banda [36, 44] s a
 *   `CIRCUIT.referenceSpeed` (objetivo 40 s ⇒ ~18000 px de perímetro).
 * - Radio de curvatura mínimo: en CADA punto de la polilínea densa el radio
 *   debe ser ≥ referenceSpeed / turnRateAtSpeed(referenceSpeed) ≈ 216 px —
 *   o sea, un auto a velocidad de referencia puede sostener cualquier curva
 *   sin levantar. Mínimos reales por pista: 236 (Mónaco) a 350 (Spa); la
 *   horquilla de GÁLVEZ se diseñó "abierta" (~300 px, como La Source).
 * - Sin auto-intersección (barrido de segmentos de la polilínea densa,
 *   excluyendo adyacentes): SUZUKA modela los esses SIN el cruce en 8 real.
 *
 * Issue #20 — SENTIDO DE RECORRIDO: los waypoints listan la vuelta en ORDEN
 * DE CARRERA (el primer punto queda en la zona de meta). La tangente del eje
 * en s=0 — la que fija el heading de la parrilla (`gridOrder`) — debe apuntar
 * hacia ARRIBA de la pantalla (Δy < 0 y más vertical que horizontal) para que
 * la largada sea "hacia arriba" en móvil. La geometría no cambia con el orden:
 * mismos radios de curvatura, mismo perímetro, misma banda de vuelta.
 *
 * `palette` define la forma que V1 consume para renderizar (pasto, asfalto,
 * kerbs y línea de meta, colores 0xrrggbb).
 */

import { CIRCUIT } from '../config/balance';
import { TrackPath } from './trackPath';
import type { Point, SectorFraction } from './trackPath';

/** Identificador de pista. */
export type TrackId = 'monaco' | 'monza' | 'silverstone' | 'spa' | 'suzuka' | 'galvez';

/**
 * Paleta de render (V1): colores 0xrrggbb de cada capa del circuito.
 * `kerb`/`kerbAlt` alternan en las bandas de rumble y `startLine` pinta la
 * meta; `grassAlt`/`asphaltAlt` dan el texturizado alternado por tile.
 */
export interface TrackPalette {
  grass: number;
  grassAlt: number;
  asphalt: number;
  asphaltAlt: number;
  kerb: number;
  kerbAlt: number;
  startLine: number;
}

/** Definición serializable de una pista (data: sin TrackPath construido). */
export interface TrackDefinition {
  id: TrackId;
  name: string;
  /** Circuito real que inspira la traza. */
  inspiration: string;
  /**
   * Puntos de control (26–32) EN ORDEN DE CARRERA (issue #20: la tangente en
   * s=0 apunta hacia arriba); la implementación cierra la curva.
   */
  waypoints: readonly Point[];
  /** Ancho jugable del asfalto (px); el pasto empieza en widthPx / 2. */
  widthPx: number;
  worldSize: { width: number; height: number };
  palette: TrackPalette;
  /** Duración objetivo de vuelta (ms): referencia de ritmo esperado. */
  lapTargetMs: number;
  /** Ventanas de sector como fracciones del largo total (8 por pista). */
  sectors: readonly SectorFraction[];
}

/** Fracciones de los 8 sectores iguales (compartidas por las 6 pistas). */
const EIGHT_SECTORS: readonly SectorFraction[] = Array.from(
  { length: CIRCUIT.sectorCount },
  (_, i) => ({ start: i / CIRCUIT.sectorCount, end: (i + 1) / CIRCUIT.sectorCount }),
);

/** Mundo común de las 6 pistas (px). */
const WORLD = { width: 7000, height: 7000 };

/* ------------------------------------------------------------------ */
/* MONACO — lenta y estrecha: sin rectas largas, cambio de ritmo       */
/* ------------------------------------------------------------------ */

const MONACO: TrackDefinition = {
  id: 'monaco',
  name: 'MÓNACO',
  inspiration: 'Circuito de Mónaco (Monte Carlo)',
  widthPx: 290,
  worldSize: WORLD,
  lapTargetMs: 40000,
  sectors: EIGHT_SECTORS,
  palette: {
    grass: 0x2e6b48,
    grassAlt: 0x27593d,
    asphalt: 0x4a4a55,
    asphaltAlt: 0x42424c,
    kerb: 0xd63c3c,
    kerbAlt: 0xe8e6e0,
    startLine: 0xf7c531,
  },
  waypoints: [
    { x: 6080, y: 3048 },
    { x: 5560, y: 2623 },
    { x: 4885, y: 2465 },
    { x: 4550, y: 2213 },
    { x: 4498, y: 1500 },
    { x: 4115, y: 1010 },
    { x: 3555, y: 825 },
    { x: 2948, y: 675 },
    { x: 2385, y: 955 },
    { x: 1945, y: 1370 },
    { x: 1495, y: 1685 },
    { x: 1048, y: 2040 },
    { x: 723, y: 2518 },
    { x: 905, y: 3145 },
    { x: 1080, y: 3645 },
    { x: 785, y: 4173 },
    { x: 778, y: 4750 },
    { x: 1025, y: 5270 },
    { x: 1338, y: 5780 },
    { x: 1928, y: 5953 },
    { x: 2533, y: 5883 },
    { x: 3030, y: 5815 },
    { x: 3508, y: 6000 },
    { x: 4130, y: 6325 },
    { x: 4653, y: 6063 },
    { x: 5013, y: 5593 },
    { x: 5538, y: 5303 },
    { x: 5883, y: 4813 },
    { x: 6090, y: 4248 },
    { x: 6278, y: 3645 },
  ],
};

/* ------------------------------------------------------------------ */
/* MONZA — rectas largas y chicanes rápidas                            */
/* ------------------------------------------------------------------ */

const MONZA: TrackDefinition = {
  id: 'monza',
  name: 'MONZA',
  inspiration: 'Autodromo Nazionale Monza (Templo de la velocidad)',
  widthPx: 375,
  worldSize: WORLD,
  lapTargetMs: 40000,
  sectors: EIGHT_SECTORS,
  palette: {
    grass: 0x3a7d3a,
    grassAlt: 0x316a31,
    asphalt: 0x50505a,
    asphaltAlt: 0x484852,
    kerb: 0xd63c3c,
    kerbAlt: 0xe8e6e0,
    startLine: 0xf7c531,
  },
  waypoints: [
    { x: 6340, y: 2988 },
    { x: 5793, y: 2485 },
    { x: 5230, y: 2158 },
    { x: 4858, y: 1725 },
    { x: 4450, y: 1198 },
    { x: 3840, y: 938 },
    { x: 3183, y: 1018 },
    { x: 2545, y: 1150 },
    { x: 1873, y: 1320 },
    { x: 1340, y: 1768 },
    { x: 1283, y: 2518 },
    { x: 900, y: 3043 },
    { x: 555, y: 3685 },
    { x: 458, y: 4438 },
    { x: 848, y: 5080 },
    { x: 1478, y: 5480 },
    { x: 2045, y: 5800 },
    { x: 2605, y: 6060 },
    { x: 3218, y: 6063 },
    { x: 3778, y: 5918 },
    { x: 4303, y: 5788 },
    { x: 5063, y: 5943 },
    { x: 5908, y: 5813 },
    { x: 6333, y: 5168 },
    { x: 6488, y: 4420 },
    { x: 6543, y: 3685 },
  ],
};

/* ------------------------------------------------------------------ */
/* SILVERSTONE — curvas rápidas fluidas                                */
/* ------------------------------------------------------------------ */

const SILVERSTONE: TrackDefinition = {
  id: 'silverstone',
  name: 'SILVERSTONE',
  inspiration: 'Silverstone Circuit (Northamptonshire)',
  widthPx: 363,
  worldSize: WORLD,
  lapTargetMs: 40000,
  sectors: EIGHT_SECTORS,
  palette: {
    grass: 0x4a8a44,
    grassAlt: 0x3f763a,
    asphalt: 0x54545e,
    asphaltAlt: 0x4c4c56,
    kerb: 0x2c6cd6,
    kerbAlt: 0xe8e6e0,
    startLine: 0xf7c531,
  },
  waypoints: [
    { x: 6288, y: 2673 },
    { x: 6065, y: 2073 },
    { x: 5563, y: 1658 },
    { x: 5033, y: 1378 },
    { x: 4610, y: 985 },
    { x: 4100, y: 640 },
    { x: 3490, y: 698 },
    { x: 2955, y: 960 },
    { x: 2398, y: 1043 },
    { x: 1733, y: 1108 },
    { x: 1190, y: 1475 },
    { x: 863, y: 2045 },
    { x: 643, y: 2660 },
    { x: 695, y: 3310 },
    { x: 1163, y: 3843 },
    { x: 1628, y: 4208 },
    { x: 1723, y: 4720 },
    { x: 1770, y: 5468 },
    { x: 2163, y: 6068 },
    { x: 2803, y: 6328 },
    { x: 3490, y: 6360 },
    { x: 4123, y: 6088 },
    { x: 4533, y: 5478 },
    { x: 4795, y: 4950 },
    { x: 5280, y: 4738 },
    { x: 5945, y: 4493 },
    { x: 6330, y: 3960 },
    { x: 6358, y: 3310 },
  ],
};

/* ------------------------------------------------------------------ */
/* SPA — mixta: curvones, quebradas y horquilla La Source              */
/* ------------------------------------------------------------------ */

const SPA: TrackDefinition = {
  id: 'spa',
  name: 'SPA',
  inspiration: 'Circuit de Spa-Francorchamps (Las Ardenas)',
  widthPx: 355,
  worldSize: WORLD,
  lapTargetMs: 40000,
  sectors: EIGHT_SECTORS,
  palette: {
    grass: 0x2f6e3c,
    grassAlt: 0x285c33,
    asphalt: 0x4c4c56,
    asphaltAlt: 0x44444e,
    kerb: 0xd63c3c,
    kerbAlt: 0xe8e6e0,
    startLine: 0xf7c531,
  },
  waypoints: [
    { x: 6298, y: 2820 },
    { x: 5810, y: 2378 },
    { x: 5265, y: 2113 },
    { x: 5023, y: 1688 },
    { x: 4750, y: 1188 },
    { x: 4273, y: 920 },
    { x: 3743, y: 740 },
    { x: 3173, y: 693 },
    { x: 2643, y: 910 },
    { x: 2085, y: 1043 },
    { x: 1358, y: 1088 },
    { x: 813, y: 1500 },
    { x: 653, y: 2175 },
    { x: 615, y: 2820 },
    { x: 738, y: 3425 },
    { x: 995, y: 3948 },
    { x: 1070, y: 4488 },
    { x: 1218, y: 5053 },
    { x: 1743, y: 5333 },
    { x: 2298, y: 5438 },
    { x: 2725, y: 5688 },
    { x: 3198, y: 5915 },
    { x: 3743, y: 6103 },
    { x: 4398, y: 6308 },
    { x: 4993, y: 6078 },
    { x: 5225, y: 5385 },
    { x: 5418, y: 4845 },
    { x: 5880, y: 4503 },
    { x: 6250, y: 4018 },
    { x: 6385, y: 3425 },
  ],
};

/* ------------------------------------------------------------------ */
/* SUZUKA — esses en S (SIN el cruce en 8 del trazado real)            */
/* ------------------------------------------------------------------ */

const SUZUKA: TrackDefinition = {
  id: 'suzuka',
  name: 'SUZUKA',
  inspiration: 'Suzuka International Racing Course (esses en S, sin cruce)',
  widthPx: 345,
  worldSize: WORLD,
  lapTargetMs: 40000,
  sectors: EIGHT_SECTORS,
  palette: {
    grass: 0x35793f,
    grassAlt: 0x2d6736,
    asphalt: 0x52525c,
    asphaltAlt: 0x4a4a54,
    kerb: 0xf07f2c,
    kerbAlt: 0xe8e6e0,
    startLine: 0xf7c531,
  },
  waypoints: [
    { x: 6170, y: 2865 },
    { x: 5633, y: 2498 },
    { x: 5508, y: 2020 },
    { x: 5345, y: 1490 },
    { x: 4830, y: 1308 },
    { x: 4388, y: 1083 },
    { x: 3970, y: 658 },
    { x: 3423, y: 590 },
    { x: 2910, y: 840 },
    { x: 2493, y: 1165 },
    { x: 2203, y: 1588 },
    { x: 1798, y: 1788 },
    { x: 1125, y: 1878 },
    { x: 805, y: 2330 },
    { x: 848, y: 2900 },
    { x: 628, y: 3413 },
    { x: 533, y: 3988 },
    { x: 928, y: 4448 },
    { x: 1358, y: 4793 },
    { x: 1725, y: 5110 },
    { x: 2070, y: 5438 },
    { x: 2348, y: 6008 },
    { x: 2828, y: 6410 },
    { x: 3423, y: 6165 },
    { x: 3925, y: 5943 },
    { x: 4485, y: 5975 },
    { x: 4903, y: 5630 },
    { x: 5110, y: 5100 },
    { x: 5473, y: 4783 },
    { x: 5895, y: 4438 },
    { x: 6238, y: 3973 },
    { x: 6468, y: 3413 },
  ],
};

/* ------------------------------------------------------------------ */
/* GÁLVEZ — curvón, enlace en S y horquilla abierta (Buenos Aires)     */
/* ------------------------------------------------------------------ */

/**
 * Issue #26 — inspirado en el trazado n°6 del GP de Argentina: recta
 * principal hacia arriba, Curvón amplio (R≈500) en la parte superior, enlace
 * en S bajando por un carril interior, giro por el sector bajo y HORQUILLA
 * ABIERTA (R≈300, mismo criterio que La Source: la cerrazón real no es
 * sostenible a referenceSpeed) que devuelve por la recta opuesta a meta.
 * Kerbs celeste/blanco: identidad argentina del autódromo.
 */
const GALVEZ: TrackDefinition = {
  id: 'galvez',
  name: 'GÁLVEZ',
  inspiration: 'Autódromo Juan y Oscar Gálvez (Buenos Aires) — Circuito n°6',
  widthPx: 355,
  worldSize: WORLD,
  lapTargetMs: 40000,
  sectors: EIGHT_SECTORS,
  palette: {
    grass: 0x3d7a3c,
    grassAlt: 0x336833,
    asphalt: 0x4e4e58,
    asphaltAlt: 0x464650,
    kerb: 0x74acdf,
    kerbAlt: 0xe8e6e0,
    startLine: 0xf7c531,
  },
  waypoints: [
    { x: 900, y: 5450 },
    { x: 917, y: 3950 },
    { x: 933, y: 2450 },
    { x: 950, y: 950 },
    { x: 1096, y: 596 },
    { x: 1450, y: 450 },
    { x: 1804, y: 596 },
    { x: 1950, y: 950 },
    { x: 2100, y: 1350 },
    { x: 2200, y: 1800 },
    { x: 2100, y: 2250 },
    { x: 1800, y: 2700 },
    { x: 1700, y: 3150 },
    { x: 1800, y: 3600 },
    { x: 1950, y: 4050 },
    { x: 1950, y: 5080 },
    { x: 2067, y: 5363 },
    { x: 2350, y: 5480 },
    { x: 3400, y: 5480 },
    { x: 4459, y: 5480 },
    { x: 4614, y: 5522 },
    { x: 4727, y: 5635 },
    { x: 4769, y: 5790 },
    { x: 4727, y: 5945 },
    { x: 4614, y: 6058 },
    { x: 4459, y: 6100 },
    { x: 3400, y: 6100 },
    { x: 2400, y: 6100 },
    { x: 1300, y: 6100 },
    { x: 1017, y: 5983 },
    { x: 900, y: 5700 },
  ],
};

/** Registro de pistas (orden de exhibición en el menú; #26 suma GÁLVEZ). */
export const TRACKS: readonly TrackDefinition[] = [
  MONACO,
  MONZA,
  SILVERSTONE,
  SPA,
  SUZUKA,
  GALVEZ,
];

/** Pista por id (undefined si no existe). */
export function getTrackById(id: string): TrackDefinition | undefined {
  return TRACKS.find((track) => track.id === id);
}

/**
 * Construye el `TrackPath` de una definición (con sus sectores). Los
 * consumidores (V1 render, V2 sync) lo construyen una vez por carrera.
 */
export function buildTrackPath(def: TrackDefinition): TrackPath {
  return new TrackPath(def.waypoints, { sectorFractions: def.sectors });
}
