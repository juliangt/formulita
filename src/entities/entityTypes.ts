/**
 * entityTypes — definiciones data-driven de las entidades de pista (Fase 4).
 *
 * Principio Abierto/Cerrado del plan: agregar contenido (un rival nuevo, otro
 * pickup) = agregar UNA entrada a `ENTITY_DEFINITIONS` y a su familia en
 * `ENTITY_KINDS_BY_FAMILY`. El SpawnScheduler, los pools y las colisiones NO
 * se modifican: todo se lee de esta configuración declarativa.
 *
 * Lógica 100% pura (sin Phaser): los tests consumen los helpers directamente
 * y Phaser solo instancia los sprites (textura + hitbox salen de acá).
 */

import {
  BASE_SPEED,
  COIN_SCORE,
  COIN_VALUE,
  SPAWN,
} from '../config/balance';
import { TEXTURE_KEYS, type TextureKey } from '../systems/TextureFactory';

/* ------------------------------------------------------------------ */
/* Tipos                                                               */
/* ------------------------------------------------------------------ */

/**
 * Familia de una entidad: define el pool que la contiene, el grupo arcade
 * para overlaps y cómo se mueve (los rivales avanzan, el resto scrollea).
 */
export type EntityFamily = 'rival' | 'coin' | 'hazard' | 'pickup';

/** Identidad de cada entidad spawnable. */
export type EntityKind =
  | 'rivalBlue'
  | 'rivalGreen'
  | 'rivalYellow'
  | 'coin'
  | 'debris'
  | 'oil'
  | 'turbo'
  | 'drs';

/**
 * Efecto del contacto con el jugador. GameScene lo interpreta (Arcade
 * overlap) y dispara la reacción correspondiente; acá solo se declara.
 */
export type CollisionEffect =
  /** Choque destructivo: explosión + shake + game-over. */
  | 'crash'
  /** No destructivo: pérdida de control lateral breve (aceite). */
  | 'slip'
  /** Recolección: +moneda +puntos. */
  | 'collect-coin'
  /** Recolección: recarga el medidor de turbo. */
  | 'collect-turbo'
  /** Recolección: resetea el cooldown del DRS. */
  | 'collect-drs';

/** Hitbox arcade (px), algo menor que el sprite (perdón visual). */
export interface EntityHitbox {
  readonly width: number;
  readonly height: number;
}

/** Definición declarativa de una entidad de pista. */
export interface EntityDefinition {
  readonly kind: EntityKind;
  readonly family: EntityFamily;
  /** Clave de la textura procedural (TextureFactory). */
  readonly textureKey: TextureKey;
  readonly hitbox: EntityHitbox;
  /** Peso relativo de spawn DENTRO de su familia (≥ 1). */
  readonly spawnWeight: number;
  /**
   * Velocidad propia de avance (px/s). 0 = entidad estática sobre el asfalto
   * (scrollea con la pista); los rivales avanzan y por eso cierran más lento
   * que el jugador. Se expresa como fracción de `BASE_SPEED`.
   */
  readonly forwardSpeed: number;
  readonly effect: CollisionEffect;
  /** Monedas otorgadas al contacto. */
  readonly coins: number;
  /** Puntos otorgados al contacto. */
  readonly points: number;
  /** ¿Puede cambiar de carril? (solo tiene sentido en rivales). */
  readonly laneChanges: boolean;
}

/* ------------------------------------------------------------------ */
/* Definiciones (configurar acá = agregar contenido)                   */
/* ------------------------------------------------------------------ */

export const ENTITY_DEFINITIONS = {
  rivalBlue: {
    kind: 'rivalBlue',
    family: 'rival',
    textureKey: TEXTURE_KEYS.rivalCarBlue,
    hitbox: { width: 44, height: 70 },
    spawnWeight: 4,
    forwardSpeed: BASE_SPEED * 0.62,
    effect: 'crash',
    coins: 0,
    points: 0,
    laneChanges: true,
  },
  rivalGreen: {
    kind: 'rivalGreen',
    family: 'rival',
    textureKey: TEXTURE_KEYS.rivalCarGreen,
    hitbox: { width: 44, height: 70 },
    spawnWeight: 3,
    forwardSpeed: BASE_SPEED * 0.72,
    effect: 'crash',
    coins: 0,
    points: 0,
    laneChanges: true,
  },
  rivalYellow: {
    kind: 'rivalYellow',
    family: 'rival',
    textureKey: TEXTURE_KEYS.rivalCarYellow,
    hitbox: { width: 44, height: 70 },
    spawnWeight: 2,
    forwardSpeed: BASE_SPEED * 0.82,
    effect: 'crash',
    coins: 0,
    points: 0,
    // El más rápido va siempre derecho: no invade el carril del jugador.
    laneChanges: false,
  },
  coin: {
    kind: 'coin',
    family: 'coin',
    textureKey: TEXTURE_KEYS.coin,
    hitbox: { width: 20, height: 20 },
    spawnWeight: 1,
    forwardSpeed: 0,
    effect: 'collect-coin',
    coins: COIN_VALUE,
    points: COIN_SCORE,
    laneChanges: false,
  },
  debris: {
    kind: 'debris',
    family: 'hazard',
    textureKey: TEXTURE_KEYS.debris,
    hitbox: { width: 26, height: 18 },
    spawnWeight: 6,
    forwardSpeed: 0,
    effect: 'crash',
    coins: 0,
    points: 0,
    laneChanges: false,
  },
  oil: {
    kind: 'oil',
    family: 'hazard',
    textureKey: TEXTURE_KEYS.oilStain,
    hitbox: { width: 42, height: 22 },
    spawnWeight: 4,
    forwardSpeed: 0,
    effect: 'slip',
    coins: 0,
    points: 0,
    laneChanges: false,
  },
  turbo: {
    kind: 'turbo',
    family: 'pickup',
    textureKey: TEXTURE_KEYS.pickupTurbo,
    hitbox: { width: 40, height: 40 },
    spawnWeight: 5,
    forwardSpeed: 0,
    effect: 'collect-turbo',
    coins: 0,
    points: 0,
    laneChanges: false,
  },
  drs: {
    kind: 'drs',
    family: 'pickup',
    textureKey: TEXTURE_KEYS.pickupDrs,
    hitbox: { width: 40, height: 40 },
    spawnWeight: 4,
    forwardSpeed: 0,
    effect: 'collect-drs',
    coins: 0,
    points: 0,
    laneChanges: false,
  },
} as const satisfies Readonly<Record<EntityKind, EntityDefinition>>;

/** Kinds que componen cada familia (el orden define el desempate por peso). */
export const ENTITY_KINDS_BY_FAMILY: Readonly<Record<EntityFamily, readonly EntityKind[]>> = {
  rival: ['rivalBlue', 'rivalGreen', 'rivalYellow'],
  coin: ['coin'],
  hazard: ['debris', 'oil'],
  pickup: ['turbo', 'drs'],
};

/* ------------------------------------------------------------------ */
/* Helpers puros                                                       */
/* ------------------------------------------------------------------ */

/** Kinds de una familia (data-driven, sin switch). */
export function entityKindsByFamily(family: EntityFamily): readonly EntityKind[] {
  return ENTITY_KINDS_BY_FAMILY[family];
}

/** Definición por kind (atajo tipado). */
export function entityDefinition(kind: EntityKind): EntityDefinition {
  return ENTITY_DEFINITIONS[kind];
}

/** Suma de pesos de spawn de una familia (> 0 si la familia tiene contenido). */
export function totalFamilyWeight(family: EntityFamily): number {
  return entityKindsByFamily(family).reduce(
    (sum, kind) => sum + ENTITY_DEFINITIONS[kind].spawnWeight,
    0,
  );
}

/**
 * Elige un kind de la familia por peso relativo (ruleta). `rng` devuelve un
 * número en [0, 1); inyectable para tests determinísticos.
 */
export function pickWeightedKind(family: EntityFamily, rng: () => number): EntityKind {
  const kinds = entityKindsByFamily(family);
  if (kinds.length === 0) {
    throw new Error(`Familia sin entidades definidas: ${family}`);
  }
  let roll = rng() * totalFamilyWeight(family);
  for (const kind of kinds) {
    roll -= ENTITY_DEFINITIONS[kind].spawnWeight;
    if (roll < 0) {
      return kind;
    }
  }
  return kinds[kinds.length - 1];
}

/**
 * Velocidad de cierre (px/s) de una entidad hacia el jugador, dada la
 * velocidad actual de la carrera: las entidades estáticas viajan con la
 * pista (cierran a la velocidad del jugador) y los rivales restan su avance
 * propio (escalado por el factor de dificultad), con un cierre mínimo para
 * que nunca "escapen hacia arriba" aunque el jugador frene a fondo.
 */
export function closingSpeed(kind: EntityKind, playerSpeed: number, rivalSpeedFactor = 1): number {
  const speed = Number.isFinite(playerSpeed) ? Math.max(0, playerSpeed) : 0;
  const def = ENTITY_DEFINITIONS[kind];
  if (def.family !== 'rival' || def.forwardSpeed <= 0) {
    return speed;
  }
  const factor = Number.isFinite(rivalSpeedFactor) && rivalSpeedFactor > 0 ? rivalSpeedFactor : 1;
  return Math.max(speed - def.forwardSpeed * factor, SPAWN.rivalMinClosing);
}
