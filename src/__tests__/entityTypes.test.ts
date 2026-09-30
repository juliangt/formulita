import { describe, expect, it } from 'vitest';
import {
  BASE_SPEED,
  COIN_SCORE,
  COIN_VALUE,
  SPAWN,
  TRACK,
  laneCenterX,
  laneIndexAtX,
} from '../config/balance';
import { TEXTURE_KEYS } from '../systems/TextureFactory';
import {
  ENTITY_DEFINITIONS,
  ENTITY_KINDS_BY_FAMILY,
  closingSpeed,
  entityDefinition,
  entityKindsByFamily,
  pickWeightedKind,
  totalFamilyWeight,
  type EntityFamily,
  type EntityKind,
} from '../entities/entityTypes';

/**
 * Tests de lógica de entityTypes (Fase 4): definiciones data-driven sanas
 * (hitboxes, pesos, texturas), ruleta de pesos y velocidades de cierre.
 * Todo puro, sin Phaser (el import de TextureFactory solo trae las claves).
 */

const ALL_KINDS = Object.keys(ENTITY_DEFINITIONS) as EntityKind[];

/** Generador determinístico (mulberry32) para tests reproducibles. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('ENTITY_DEFINITIONS — sanidad data-driven (OCP)', () => {
  it('define los 8 kinds requeridos por la Fase 4', () => {
    expect(ALL_KINDS.sort()).toEqual(
      ['coin', 'debris', 'drs', 'oil', 'rivalBlue', 'rivalGreen', 'rivalYellow', 'turbo'].sort(),
    );
  });

  it('cada kind tiene textura procedural existente e hitbox positiva', () => {
    const textureKeys = Object.values(TEXTURE_KEYS);
    for (const kind of ALL_KINDS) {
      const def = entityDefinition(kind);
      expect(textureKeys, `${kind}: textura registrada`).toContain(def.textureKey);
      expect(def.hitbox.width, `${kind}: hitbox ancho`).toBeGreaterThan(0);
      expect(def.hitbox.height, `${kind}: hitbox alto`).toBeGreaterThan(0);
      expect(def.hitbox.width).toBeLessThanOrEqual(48);
      expect(def.spawnWeight, `${kind}: peso de spawn`).toBeGreaterThanOrEqual(1);
      expect(def.points, `${kind}: puntos`).toBeGreaterThanOrEqual(0);
      expect(def.coins, `${kind}: monedas`).toBeGreaterThanOrEqual(0);
    }
  });

  it('las familias agrupan exactamente los kinds declarados', () => {
    for (const family of Object.keys(ENTITY_KINDS_BY_FAMILY) as EntityFamily[]) {
      for (const kind of entityKindsByFamily(family)) {
        expect(entityDefinition(kind).family, `${kind} pertenece a ${family}`).toBe(family);
      }
    }
    // Cobertura: cada kind aparece exactamente una vez en alguna familia.
    const grouped = (Object.keys(ENTITY_KINDS_BY_FAMILY) as EntityFamily[]).flatMap((family) =>
      entityKindsByFamily(family),
    );
    expect([...grouped].sort()).toEqual([...ALL_KINDS].sort());
  });

  it('coin paga según balance (COIN_VALUE / COIN_SCORE) y effect de recolección', () => {
    const coin = ENTITY_DEFINITIONS.coin;
    expect(coin.coins).toBe(COIN_VALUE);
    expect(coin.points).toBe(COIN_SCORE);
    expect(coin.effect).toBe('collect-coin');
    expect(coin.family).toBe('coin');
  });

  it('rivales: destructivos, más lentos que la base y velocidades distintas por tipo', () => {
    const rivals = entityKindsByFamily('rival');
    const speeds = rivals.map((kind) => entityDefinition(kind).forwardSpeed);

    for (const kind of rivals) {
      expect(entityDefinition(kind).effect).toBe('crash');
    }
    expect(speeds.every((speed) => speed > 0 && speed < BASE_SPEED)).toBe(true);
    expect(new Set(speeds).size).toBe(speeds.length); // variable por tipo
    // El orden declarado es de más lento a más rápido.
    expect([...speeds].sort((a, b) => a - b)).toEqual(speeds);
  });

  it('hazards: debris destructivo y aceite no destructivo (slip)', () => {
    expect(ENTITY_DEFINITIONS.debris.effect).toBe('crash');
    expect(ENTITY_DEFINITIONS.oil.effect).toBe('slip');
  });

  it('pickups: turbo recarga medidor y drs resetea cooldown', () => {
    expect(ENTITY_DEFINITIONS.turbo.effect).toBe('collect-turbo');
    expect(ENTITY_DEFINITIONS.drs.effect).toBe('collect-drs');
  });
});

describe('pesos de spawn', () => {
  it('cada familia suma un peso positivo', () => {
    for (const family of Object.keys(ENTITY_KINDS_BY_FAMILY) as EntityFamily[]) {
      expect(totalFamilyWeight(family)).toBeGreaterThan(0);
    }
  });

  it('pickWeightedKind respeta los límites de la ruleta (extremos determinísticos)', () => {
    // hazard: debris (6) + oil (4) = 10 → rng 0 cae en debris, rng ~1 en oil.
    expect(pickWeightedKind('hazard', () => 0)).toBe('debris');
    expect(pickWeightedKind('hazard', () => 0.59)).toBe('debris');
    expect(pickWeightedKind('hazard', () => 0.6)).toBe('oil');
    expect(pickWeightedKind('hazard', () => 0.999)).toBe('oil');
  });

  it('pickWeightedKind aproxima la proporción de los pesos (rng semillado)', () => {
    const rng = mulberry32(20260929);
    const draws = 30000;
    const counts = new Map<EntityKind, number>();

    for (let i = 0; i < draws; i += 1) {
      const kind = pickWeightedKind('rival', rng);
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }

    const total = totalFamilyWeight('rival');
    for (const kind of entityKindsByFamily('rival')) {
      const expected = entityDefinition(kind).spawnWeight / total;
      const observed = (counts.get(kind) ?? 0) / draws;
      expect(Math.abs(observed - expected), `${kind}: peso ${expected}`).toBeLessThan(0.02);
    }
  });
});

describe('closingSpeed — cierre de entidades hacia el jugador', () => {
  it('las entidades estáticas cierran a la velocidad del jugador', () => {
    for (const kind of ['coin', 'debris', 'oil', 'turbo', 'drs'] as EntityKind[]) {
      expect(closingSpeed(kind, 300)).toBe(300);
    }
  });

  it('los rivales cierran a velocidad del jugador menos su avance propio', () => {
    const blue = ENTITY_DEFINITIONS.rivalBlue;
    expect(closingSpeed('rivalBlue', 300)).toBeCloseTo(300 - blue.forwardSpeed);
  });

  it('el factor de dificultad acelera el avance propio del rival', () => {
    const green = ENTITY_DEFINITIONS.rivalGreen;
    expect(closingSpeed('rivalGreen', 420, 1.35)).toBeCloseTo(420 - green.forwardSpeed * 1.35);
  });

  it('nunca es negativo: el cierre mínimo evita rivales que escapan hacia arriba', () => {
    expect(closingSpeed('rivalYellow', 0)).toBe(SPAWN.rivalMinClosing);
    expect(closingSpeed('rivalBlue', 100)).toBe(SPAWN.rivalMinClosing);
  });

  it('es defensivo con velocidades no finitas', () => {
    expect(closingSpeed('coin', Number.NaN)).toBe(0);
    expect(closingSpeed('rivalBlue', Number.NaN)).toBe(SPAWN.rivalMinClosing);
  });
});

describe('carriles del asfalto', () => {
  it('laneCenterX cae dentro del asfalto y es equiespaciado y simétrico', () => {
    const lanes = [0, 1, 2, 3].map((index) => laneCenterX(index));

    for (const x of lanes) {
      expect(x).toBeGreaterThanOrEqual(TRACK.roadLeft);
      expect(x).toBeLessThanOrEqual(TRACK.roadRight);
    }
    const gaps = lanes.slice(1).map((x, i) => x - lanes[i]);
    for (const gap of gaps) {
      expect(gap).toBeCloseTo((TRACK.roadRight - TRACK.roadLeft) / SPAWN.laneCount);
    }
    // Simétrico respecto del centro de la pista.
    const center = TRACK.width / 2;
    expect(lanes[0] + lanes[lanes.length - 1]).toBeCloseTo(center * 2);
  });

  it('laneIndexAtX mapea x → carril con clamp a los bordes', () => {
    expect(laneIndexAtX(laneCenterX(0))).toBe(0);
    expect(laneIndexAtX(laneCenterX(3))).toBe(3);
    expect(laneIndexAtX(0)).toBe(0);
    expect(laneIndexAtX(TRACK.width)).toBe(SPAWN.laneCount - 1);
    // Cada centro cae en su propio carril (bicectivo con laneCenterX).
    for (let index = 0; index < SPAWN.laneCount; index += 1) {
      expect(laneIndexAtX(laneCenterX(index))).toBe(index);
    }
  });
});
