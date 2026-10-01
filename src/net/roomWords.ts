/**
 * roomWords.ts — diccionario de palabras de sala (M1).
 *
 * La palabra clave ES el roomId de Trystero: `joinRoom({appId}, 'PARRILLA')`.
 * Cualquier peer que escriba la misma palabra cae en la misma sala, así que
 * las palabras deben ser fáciles de deletrear por teléfono o chat:
 *
 * - UPPERCASE, SOLO A–Z (sin Ñ ni acentos ni espacios ni dígitos).
 * - 5–9 letras (ni criptográficas ni impronunciables).
 * - Únicas.
 * - Español: jerga de carreras/F1 + cultura general (circuitos, campeones,
 *   escuderías, comida y música del mundo hispano).
 *
 * `roomWords.test.ts` verifica el formato de TODAS contra estas reglas:
 * editar la lista sin cumplirlas rompe el test, no el juego.
 *
 * `pickRoomWord(rng)` elige con el rng INYECTABLE (mulberry32 en el juego,
 * secuencias fijas en tests): crear sala no llama a Math.random.
 */

import type { Rng } from './roomRng';

/**
 * 150 palabras válidas como código de sala, agrupadas por ámbito (pista,
 * boxes/auto, circuitos, pilotos, escuderías, cultura) para que la lista se
 * mantenga legible al editarla.
 */
export const ROOM_WORDS: readonly string[] = [
  // Pista y carrera
  'PARRILLA',
  'CARRERA',
  'PISTA',
  'CIRCUITO',
  'TRAZADA',
  'RECTA',
  'CURVA',
  'HORQUILLA',
  'CHICANE',
  'PERALTE',
  'ASFALTO',
  'GRAVA',
  'DAMERO',
  'AJEDREZ',
  'VUELTA',
  'RITMO',
  'ADELANTAR',
  'FRENADA',
  'DERRAPE',
  'TURBO',
  'SPRINT',
  'CRONO',
  'TIEMPO',
  'RECORD',
  'PODIO',
  'TROFEO',
  'MEDALLA',
  'CAMPEON',
  'ESTRATEGA',
  'PILOTO',
  'COPILOTO',
  'RIVALES',
  'LLEGADA',
  'ARRANQUE',
  'SEMAFORO',
  'BANDERA',
  'COMISARIO',
  'MECANICO',
  'TRIBUNA',
  'AFICION',
  'LEYENDA',
  'VICTORIA',
  'TRIUNFO',
  'PUNTOS',
  'TITULO',
  'CORONA',
  'SANCION',
  'VERDE',
  'AMARILLO',
  // Boxes y auto
  'BOXES',
  'PITLANE',
  'PITSTOP',
  'ESCAPERIA',
  'NEUMATICO',
  'LLANTA',
  'RUEDA',
  'ALERON',
  'MONOPLAZA',
  'CABINA',
  'CASCO',
  'CHASIS',
  'DIFUSOR',
  'MOTOR',
  'EMBRAGUE',
  'MARCHA',
  'CAMBIO',
  'VOLANTE',
  'DIRECCION',
  'VELOCIDAD',
  'ACELERAR',
  'FRENO',
  'ESCAPE',
  'RADIADOR',
  'ACEITE',
  'GASOLINA',
  'PRESION',
  'BATERIA',
  'VEHICULO',
  'AUTOMOVIL',
  'DEPORTIVO',
  'KARTING',
  'ESTELA',
  'SUCCION',
  'VACIO',
  'RUGIDO',
  'ESTAMPIDO',
  'PITIDO',
  // Circuitos
  'MONACO',
  'MONZA',
  'IMOLA',
  'JEREZ',
  'BARCELONA',
  'VALENCIA',
  'ESTORIL',
  'MUGELLO',
  'SUZUKA',
  'AUSTIN',
  'ZANDVOORT',
  'SOCHI',
  'SHANGHAI',
  'SEPANG',
  'KYALAMI',
  // Campeones y pilotos
  'FANGIO',
  'SENNA',
  'PROST',
  'LAUDA',
  'STEWART',
  'ANDRETTI',
  'PIQUET',
  'MANSELL',
  'HAKKINEN',
  'RAIKKONEN',
  'VETTEL',
  'HAMILTON',
  'ALONSO',
  'LECLERC',
  'NORRIS',
  'SAINZ',
  'PEREZ',
  'MASSA',
  // Escuderías y marcas
  'FERRARI',
  'MCLAREN',
  'WILLIAMS',
  'RENAULT',
  'MERCEDES',
  'JAGUAR',
  'JORDAN',
  'MINARDI',
  'SAUBER',
  'LOTUS',
  'REDBULL',
  'ALPINE',
  // Cultura general (comida, música, baile)
  'TANGO',
  'FLAMENCO',
  'PAELLA',
  'TAPAS',
  'JAMON',
  'ASADO',
  'EMPANADA',
  'TORTILLA',
  'SALSA',
  'CUMBIA',
  'BACHATA',
  'MERENGUE',
  'SAMBA',
  'MARIACHI',
  'GUITARRA',
  'ACORDEON',
  'SANGRIA',
  'MALBEC',
];

/**
 * Elige una palabra de sala con el rng inyectado (determinista con
 * mulberry32 sembrado; en creación real se siembra con crypto). El índice es
 * `floor(rng() * length)` clampeado — un rng defectuoso que devuelva
 * exactamente 1 (el contrato es [0, 1)) no puede salirse del array.
 */
export function pickRoomWord(rng: Rng): string {
  const roll = rng();
  const clamped = Number.isFinite(roll) ? Math.min(Math.max(roll, 0), 0.999999) : 0;
  return ROOM_WORDS[Math.floor(clamped * ROOM_WORDS.length)];
}
