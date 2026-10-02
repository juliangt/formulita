/**
 * tracks — las 5 pistas del issue #9 (V0: data pura + registro).
 *
 * Cada `TrackDefinition` describe un circuito cerrado inspirado en un GP
 * real: waypoints de control (26–32) sobre un mundo de 2800×2800 px que
 * `TrackPath` CIERRA EXPLÍCITAMENTE (las listas NO repiten el primer punto)
 * y suaviza con Catmull-Rom centrípeto.
 *
 * Diseño validado (tests de `tracks.test.ts`) contra la física de
 * `circuitPhysics`:
 * - Duración de vuelta dentro de la banda [36, 44] s a
 *   `CIRCUIT.referenceSpeed` (objetivo 40 s ⇒ ~7200 px de perímetro).
 * - Radio de curvatura mínimo: en CADA punto de la polilínea densa el radio
 *   debe ser ≥ referenceSpeed / turnRateAtSpeed(referenceSpeed) ≈ 87 px —
 *   o sea, un auto a velocidad de referencia puede sostener cualquier curva
 *   sin levantar. Mínimos reales por pista: 94 (Mónaco) a 141 (Spa).
 * - Sin auto-intersección (barrido de segmentos de la polilínea densa,
 *   excluyendo adyacentes): SUZUKA modela los esses SIN el cruce en 8 real.
 *
 * `palette` define la forma que V1 consume para renderizar (pasto, asfalto,
 * kerbs y línea de meta, colores 0xrrggbb).
 */

import { CIRCUIT } from '../config/balance';
import { TrackPath } from './trackPath';
import type { Point, SectorFraction } from './trackPath';

/** Identificador de pista. */
export type TrackId = 'monaco' | 'monza' | 'silverstone' | 'spa' | 'suzuka';

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
  /** Puntos de control (26–32); la implementación cierra la curva. */
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

/** Fracciones de los 8 sectores iguales (compartidas por las 5 pistas). */
const EIGHT_SECTORS: readonly SectorFraction[] = Array.from(
  { length: CIRCUIT.sectorCount },
  (_, i) => ({ start: i / CIRCUIT.sectorCount, end: (i + 1) / CIRCUIT.sectorCount }),
);

/** Mundo común de las 5 pistas (px). */
const WORLD = { width: 2800, height: 2800 };

/* ------------------------------------------------------------------ */
/* MONACO — lenta y estrecha: sin rectas largas, cambio de ritmo       */
/* ------------------------------------------------------------------ */

const MONACO: TrackDefinition = {
  id: 'monaco',
  name: 'MÓNACO',
  inspiration: 'Circuito de Mónaco (Monte Carlo)',
  widthPx: 116,
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
    { x: 2511, y: 1458 },
    { x: 2436, y: 1699 },
    { x: 2353, y: 1925 },
    { x: 2215, y: 2121 },
    { x: 2005, y: 2237 },
    { x: 1861, y: 2425 },
    { x: 1652, y: 2530 },
    { x: 1403, y: 2400 },
    { x: 1212, y: 2326 },
    { x: 1013, y: 2353 },
    { x: 771, y: 2381 },
    { x: 535, y: 2312 },
    { x: 410, y: 2108 },
    { x: 311, y: 1900 },
    { x: 314, y: 1669 },
    { x: 432, y: 1458 },
    { x: 362, y: 1258 },
    { x: 289, y: 1007 },
    { x: 419, y: 816 },
    { x: 598, y: 674 },
    { x: 778, y: 548 },
    { x: 954, y: 382 },
    { x: 1179, y: 270 },
    { x: 1422, y: 330 },
    { x: 1646, y: 404 },
    { x: 1799, y: 600 },
    { x: 1820, y: 885 },
    { x: 1954, y: 986 },
    { x: 2224, y: 1049 },
    { x: 2432, y: 1219 },
  ],
};

/* ------------------------------------------------------------------ */
/* MONZA — rectas largas y chicanes rápidas                            */
/* ------------------------------------------------------------------ */

const MONZA: TrackDefinition = {
  id: 'monza',
  name: 'MONZA',
  inspiration: 'Autodromo Nazionale Monza (Templo de la velocidad)',
  widthPx: 150,
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
    { x: 2617, y: 1474 },
    { x: 2595, y: 1768 },
    { x: 2533, y: 2067 },
    { x: 2363, y: 2325 },
    { x: 2025, y: 2377 },
    { x: 1721, y: 2315 },
    { x: 1511, y: 2367 },
    { x: 1287, y: 2425 },
    { x: 1042, y: 2424 },
    { x: 818, y: 2320 },
    { x: 591, y: 2192 },
    { x: 339, y: 2032 },
    { x: 183, y: 1775 },
    { x: 222, y: 1474 },
    { x: 360, y: 1217 },
    { x: 513, y: 1007 },
    { x: 536, y: 707 },
    { x: 749, y: 528 },
    { x: 1018, y: 460 },
    { x: 1273, y: 407 },
    { x: 1536, y: 375 },
    { x: 1780, y: 479 },
    { x: 1943, y: 690 },
    { x: 2092, y: 863 },
    { x: 2317, y: 994 },
    { x: 2536, y: 1195 },
  ],
};

/* ------------------------------------------------------------------ */
/* SILVERSTONE — curvas rápidas fluidas                                */
/* ------------------------------------------------------------------ */

const SILVERSTONE: TrackDefinition = {
  id: 'silverstone',
  name: 'SILVERSTONE',
  inspiration: 'Silverstone Circuit (Northamptonshire)',
  widthPx: 145,
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
    { x: 2543, y: 1324 },
    { x: 2532, y: 1584 },
    { x: 2378, y: 1797 },
    { x: 2112, y: 1895 },
    { x: 1918, y: 1980 },
    { x: 1813, y: 2191 },
    { x: 1649, y: 2435 },
    { x: 1396, y: 2544 },
    { x: 1121, y: 2531 },
    { x: 865, y: 2427 },
    { x: 708, y: 2187 },
    { x: 689, y: 1888 },
    { x: 651, y: 1683 },
    { x: 465, y: 1537 },
    { x: 278, y: 1324 },
    { x: 257, y: 1064 },
    { x: 345, y: 818 },
    { x: 476, y: 590 },
    { x: 693, y: 443 },
    { x: 959, y: 417 },
    { x: 1182, y: 384 },
    { x: 1396, y: 279 },
    { x: 1640, y: 256 },
    { x: 1844, y: 394 },
    { x: 2013, y: 551 },
    { x: 2225, y: 663 },
    { x: 2426, y: 829 },
    { x: 2515, y: 1069 },
  ],
};

/* ------------------------------------------------------------------ */
/* SPA — mixta: curvones, quebradas y horquilla La Source              */
/* ------------------------------------------------------------------ */

const SPA: TrackDefinition = {
  id: 'spa',
  name: 'SPA',
  inspiration: 'Circuit de Spa-Francorchamps (Las Ardenas)',
  widthPx: 142,
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
    { x: 2554, y: 1370 },
    { x: 2500, y: 1607 },
    { x: 2352, y: 1801 },
    { x: 2167, y: 1938 },
    { x: 2090, y: 2154 },
    { x: 1997, y: 2431 },
    { x: 1759, y: 2523 },
    { x: 1497, y: 2441 },
    { x: 1279, y: 2366 },
    { x: 1090, y: 2275 },
    { x: 919, y: 2175 },
    { x: 697, y: 2133 },
    { x: 487, y: 2021 },
    { x: 428, y: 1795 },
    { x: 398, y: 1579 },
    { x: 295, y: 1370 },
    { x: 246, y: 1128 },
    { x: 261, y: 870 },
    { x: 325, y: 600 },
    { x: 543, y: 435 },
    { x: 834, y: 417 },
    { x: 1057, y: 364 },
    { x: 1269, y: 277 },
    { x: 1497, y: 296 },
    { x: 1709, y: 368 },
    { x: 1900, y: 475 },
    { x: 2009, y: 675 },
    { x: 2106, y: 845 },
    { x: 2324, y: 951 },
    { x: 2519, y: 1128 },
  ],
};

/* ------------------------------------------------------------------ */
/* SUZUKA — esses en S (SIN el cruce en 8 del trazado real)            */
/* ------------------------------------------------------------------ */

const SUZUKA: TrackDefinition = {
  id: 'suzuka',
  name: 'SUZUKA',
  inspiration: 'Suzuka International Racing Course (esses en S, sin cruce)',
  widthPx: 138,
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
    { x: 2587, y: 1365 },
    { x: 2495, y: 1589 },
    { x: 2358, y: 1775 },
    { x: 2189, y: 1913 },
    { x: 2044, y: 2040 },
    { x: 1961, y: 2252 },
    { x: 1794, y: 2390 },
    { x: 1570, y: 2377 },
    { x: 1369, y: 2466 },
    { x: 1131, y: 2564 },
    { x: 939, y: 2403 },
    { x: 828, y: 2175 },
    { x: 690, y: 2044 },
    { x: 543, y: 1917 },
    { x: 371, y: 1779 },
    { x: 213, y: 1595 },
    { x: 251, y: 1365 },
    { x: 339, y: 1160 },
    { x: 322, y: 932 },
    { x: 450, y: 751 },
    { x: 719, y: 715 },
    { x: 881, y: 635 },
    { x: 997, y: 466 },
    { x: 1164, y: 336 },
    { x: 1369, y: 236 },
    { x: 1588, y: 263 },
    { x: 1755, y: 433 },
    { x: 1932, y: 523 },
    { x: 2138, y: 596 },
    { x: 2203, y: 808 },
    { x: 2253, y: 999 },
    { x: 2468, y: 1146 },
  ],
};

/** Registro de pistas (orden de exhibición en el menú). */
export const TRACKS: readonly TrackDefinition[] = [
  MONACO,
  MONZA,
  SILVERSTONE,
  SPA,
  SUZUKA,
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
