import Phaser from 'phaser';
import { SPAWN, TOUCH_HUD, TRACK } from '../config/balance';

/**
 * TextureFactory — generación 100% procedural de las texturas pixel-art del
 * juego (Fase 1). Cero assets externos: cada sprite se dibuja con `Graphics`
 * y se hornea con `Graphics.generateTexture()`.
 *
 * Los sprites chicos se definen como mapas de píxeles (strings) con paletas
 * intercambiables — estética 8-bit auténtica y palette-swap barato (los
 * rivales reutilizan el mapa del auto con otros colores).
 *
 * La generación es one-shot (PreloadScene): nada de `Graphics` dinámicos en
 * `update` (riesgo de rendimiento, PLAN_DESARROLLO.md §Riesgos).
 */

/** Claves de todas las texturas generadas proceduralmente. */
export const TEXTURE_KEYS = {
  /** Tile de pista: asfalto + línea central discontinua + kerbs + barreras. */
  roadTile: 'road-tile',
  /** Auto del jugador (F1 roja, vista superior). */
  playerCar: 'player-car',
  /** Rivales: mismo mapa, paleta intercambiada (se usan en la Fase 4). */
  rivalCarBlue: 'rival-car-blue',
  rivalCarGreen: 'rival-car-green',
  rivalCarYellow: 'rival-car-yellow',
  /** Moneda. */
  coin: 'coin',
  /** Restos / escombros (hazard). */
  debris: 'debris',
  /** Mancha de aceite (hazard no destructivo). */
  oilStain: 'oil-stain',
  /** Pickup de turbo: relámpago sobre insignia azul. */
  pickupTurbo: 'pickup-turbo',
  /** Pickup de DRS: alerón sobre insignia verde. */
  pickupDrs: 'pickup-drs',
  /** Pickup de botiquín: cruz roja sobre caja blanca. */
  pickupRepair: 'pickup-repair',
  /** Partícula blanca 4×4 (tintable). */
  particle: 'particle',
  /* --- HUD táctil (Fase 2) --- */
  /** Panel de botón táctil, blanco tintable con borde horneado. */
  hudPanel: 'hud-panel',
  /** Glifo pixel ◀ del botón de doblar a la izquierda. */
  hudArrowLeft: 'hud-arrow-left',
  /** Glifo pixel ▶ del botón de doblar a la derecha. */
  hudArrowRight: 'hud-arrow-right',
  /* --- Botón de mute (Fase 6) --- */
  /** Glifo pixel de altavoz con ondas (audio activado). */
  hudAudioOn: 'hud-audio-on',
  /** Glifo pixel de altavoz con X (audio silenciado). */
  hudAudioOff: 'hud-audio-off',
} as const;

export type TextureKey = (typeof TEXTURE_KEYS)[keyof typeof TEXTURE_KEYS];

/** Todas las claves, en el orden en que se generan (progreso real). */
export const ALL_TEXTURE_KEYS: readonly TextureKey[] = Object.values(TEXTURE_KEYS);

/** Cantidad total de texturas generadas (para la barra de progreso). */
export const TOTAL_TEXTURE_COUNT = ALL_TEXTURE_KEYS.length;

/** Callback de progreso: `completed` de `total` texturas ya horneadas. */
export type TextureProgressCallback = (completed: number, total: number) => void;

/**
 * Definición data de un sprite pixel-art: cada caracter de cada fila es un
 * píxel de tamaño `scale`. '.' = transparente.
 */
export interface PixelSprite {
  readonly rows: readonly string[];
  /** Paleta: caracter → color hex '#rrggbb'. */
  readonly palette: Readonly<Record<string, string>>;
  /** Alfa global opcional (0–1). */
  readonly alpha?: number;
}

/* ------------------------------------------------------------------ */
/* Mapas de píxeles                                                    */
/* ------------------------------------------------------------------ */

/**
 * Mapa del F1 vista superior (12×19 píxeles), nariz hacia arriba:
 * alerón delantero ancho con endplates, ruedas delanteras, pontones con
 * brillo lateral, cabina con casco, ruedas traseras anchas y alerón trasero
 * de dos tramos. Compartido por jugador y rivales (palette swap).
 */
export const CAR_SPRITE_ROWS: readonly string[] = [
  '.wwwwwwwwww.', // alerón delantero (plano ancho)
  '.w.rrrrrr.w.', // endplates + unión con la nariz
  '.....rr.....', // nariz
  '....rrrr....', // nariz ensanchando
  '.tt.rrrr.tt.', // ruedas delanteras
  '.tthrrrrhtt.', // pontones: brillo en los bordes
  '.thrrrrrrht.',
  '.thrrrrrrht.',
  '..thrrrrht..', // se estrecha hacia la cabina
  '..rrksskrr..', // cabina + casco
  '..rrkkkkrr..', // cuello del cockpit
  '..trrrrrrt..',
  '.ttrrrrrrtt.', // ruedas traseras
  '.ttrrrrrrtt.',
  '.ttrrrrrrtt.',
  '.tt.rrrr.tt.',
  'gg..rrrr..gg', // soportes del alerón trasero
  'gggggggggggg', // alerón trasero (plano)
  'gddddddddddg', // cara inferior en sombra
];

/** Escala en px de cada "píxel" del mapa del auto. */
const CAR_SCALE = 4;

/**
 * Crea el sprite de un auto con la paleta indicada (palette swap).
 * @param bodyColor   color principal de la carrocería.
 * @param shadowColor color de sombra (tapa de motor / zonas oscuras).
 * El brillo (`h`) se deriva del color de carrocería para que el palette
 * swap mantenga el modelado de luz de cada auto.
 */
export function makeCarSprite(bodyColor: string, shadowColor: string): PixelSprite {
  return {
    rows: CAR_SPRITE_ROWS,
    palette: {
      w: '#e8e8e8', // alerón delantero
      t: '#14141a', // neumáticos
      r: bodyColor, // carrocería
      d: shadowColor, // sombras
      h: shadeHex(bodyColor, 1.5), // brillo lateral de la carrocería
      k: '#0e0e12', // cockpit
      s: '#cdd3dd', // casco
      g: '#1a1a20', // alerón trasero (endplates + plano)
    },
  };
}

/** Aclara (`factor` > 1) u oscurece (`factor` < 1) un color '#rrggbb'. */
function shadeHex(hex: string, factor: number): string {
  const value = parseInt(hex.slice(1), 16);
  const channel = (shift: number): string =>
    Math.min(255, Math.round(((value >> shift) & 0xff) * factor))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

/** Moneda 8×8 (24×24 con escala 3). */
export const COIN_SPRITE: PixelSprite = {
  rows: [
    '..oooo..',
    '.oyyyyo.',
    'oyWyyyyo',
    'oyWyyyyo',
    'oyyyyyyo',
    'oyyyynno',
    '.oyynno.',
    '..oooo..',
  ],
  palette: {
    o: '#8a5a00', // contorno
    y: '#f7c531', // oro
    W: '#fff3b0', // brillo
    n: '#c78a1e', // sombra del oro
  },
};

/** Restos / escombros 8×6 (32×24 con escala 4). */
export const DEBRIS_SPRITE: PixelSprite = {
  rows: [
    '..kkk...',
    '.kllkk..',
    'kllkkkk.',
    'kkkkkkk.',
    '.kkkkk..',
    '..kk.k..',
  ],
  palette: {
    k: '#4a4a52', // metal
    l: '#9aa0a8', // brillo del metal
  },
};

/** Mancha de aceite 10×6 (50×30 con escala 5), semitransparente. */
export const OIL_STAIN_SPRITE: PixelSprite = {
  rows: [
    '...kkk....',
    '..kdddk...',
    '.kdddddk..',
    'kdddddddk.',
    '.kdddddk..',
    '..kkkk....',
  ],
  palette: {
    k: '#23232e', // borde de la mancha
    d: '#101018', // núcleo
  },
  alpha: 0.9,
};

/** Pickup de turbo: relámpago sobre insignia azul 12×12 (48×48). */
export const TURBO_PICKUP_SPRITE: PixelSprite = {
  rows: [
    '..BBBBBBBB..',
    '.BbbbbbbbbB.',
    'BbbbbbyybbbB',
    'BbbbbyybbbbB',
    'BbbbyybbbbbB',
    'BbbyyyyybbbB',
    'BbbbbbyybbbB',
    'BbbbbyybbbbB',
    'BbbbyybbbbbB',
    'BbbyybbbbbbB',
    '.BbbbbbbbbB.',
    '..BBBBBBBB..',
  ],
  palette: {
    B: '#dbe4f0', // borde de la insignia
    b: '#1d3f8f', // fondo azul
    y: '#ffd23c', // relámpago
  },
};

/** Pickup de DRS: alerón sobre insignia verde 12×12 (48×48). */
export const DRS_PICKUP_SPRITE: PixelSprite = {
  rows: [
    '..BBBBBBBB..',
    '.BbbbbbbbbB.',
    'BbbwwwwwwbbB', // plano del alerón
    'BbbwwwwwwbbB',
    'BbbbbwbbwbbB', // soportes
    'BbbbbwbbwbbB',
    'BbbbbwbbwbbB',
    'BbbwwwwwwbbB', // base
    'BbbbbbbbbbbB',
    'BbbbbbbbbbbB',
    '.BbbbbbbbbB.',
    '..BBBBBBBB..',
  ],
  palette: {
    B: '#d9f2df', // borde de la insignia
    b: '#14532d', // fondo verde
    w: '#f2f2f2', // alerón
  },
};

/** Pickup de botiquín: cruz roja sobre caja blanca 10×10 (40×40, escala 4). */
export const REPAIR_PICKUP_SPRITE: PixelSprite = {
  rows: [
    'BBBBBBBBBB',
    'BwwwwwwwwB',
    'BwwwrrwwwB',
    'BwwwrrwwwB',
    'BwwrrrrwwB',
    'BwwrrrrwwB',
    'BwwwrrwwwB',
    'BwwwrrwwwB',
    'BwwwwwwwwB',
    'BBBBBBBBBB',
  ],
  palette: {
    B: '#e0e0e6', // borde de la caja
    w: '#f2f2f2', // caja blanca
    r: '#d63c3c', // cruz roja (rojo F1 del jugador)
  },
};

/* ------------------------------------------------------------------ */
/* Glifos del HUD táctil (Fase 2)                                      */
/* ------------------------------------------------------------------ */

/** Escala en px de los glifos de flecha del HUD (7×8 → 42×48). */
const HUD_ARROW_SCALE = 6;

/** Flecha pixel ◀ (7×8), blanca tintable: punta hacia la IZQUIERDA. */
export const HUD_ARROW_LEFT_SPRITE: PixelSprite = {
  rows: [
    '.....ww',
    '...wwww',
    '.wwwwww',
    'wwwwwww',
    'wwwwwww',
    '.wwwwww',
    '...wwww',
    '.....ww',
  ],
  palette: { w: '#f2f2f2' },
};

/** Flecha pixel ▶ (7×8), blanca tintable: punta hacia la DERECHA. */
export const HUD_ARROW_RIGHT_SPRITE: PixelSprite = {
  rows: [
    'ww.....',
    'wwww...',
    'wwwwww.',
    'wwwwwww',
    'wwwwwww',
    'wwwwww.',
    'wwww...',
    'ww.....',
  ],
  palette: { w: '#f2f2f2' },
};

/* ------------------------------------------------------------------ */
/* Glifos del botón de mute (Fase 6)                                   */
/* ------------------------------------------------------------------ */

/** Escala en px de los glifos de audio (12×10 → 48×40). */
const HUD_AUDIO_SCALE = 4;

/**
 * Altavoz con ondas (12×10), blanco tintable: cono apuntando a la derecha y
 * dos arcos de sonido.
 */
export const HUD_AUDIO_ON_SPRITE: PixelSprite = {
  rows: [
    '............',
    '.........w..',
    '.ww.......w.',
    '.www..w....w',
    '.wwww..w...w',
    '.wwww..w...w',
    '.www..w....w',
    '.ww.......w.',
    '.........w..',
    '............',
  ],
  palette: { w: '#f2f2f2' },
};

/**
 * Altavoz silenciado (12×10), blanco tintable: mismo cono y una X en lugar
 * de las ondas.
 */
export const HUD_AUDIO_OFF_SPRITE: PixelSprite = {
  rows: [
    '............',
    '............',
    '.ww....w...w',
    '.www....w.w.',
    '.wwww....w..',
    '.wwww....w..',
    '.www....w.w.',
    '.ww....w...w',
    '............',
    '............',
  ],
  palette: { w: '#f2f2f2' },
};

/* ------------------------------------------------------------------ */
/* Helpers de dibujo (puros salvo el `Graphics` receptor)               */
/* ------------------------------------------------------------------ */

/** Tamaño final de un pixel sprite al escalarlo (en px). */
export function pixelSpriteSize(
  sprite: PixelSprite,
  scale: number,
): { width: number; height: number } {
  const cols = sprite.rows.reduce((max, row) => Math.max(max, row.length), 0);
  return { width: cols * scale, height: sprite.rows.length * scale };
}

/**
 * Dibuja un pixel sprite sobre un `Graphics`, píxel por píxel.
 * @throws si un caracter no está en la paleta.
 */
export function drawPixelSprite(
  g: Phaser.GameObjects.Graphics,
  sprite: PixelSprite,
  scale: number,
  offsetX = 0,
  offsetY = 0,
): void {
  const colorCache = new Map<string, number>();
  const alpha = sprite.alpha ?? 1;

  for (let row = 0; row < sprite.rows.length; row += 1) {
    const line = sprite.rows[row];
    for (let col = 0; col < line.length; col += 1) {
      const char = line[col];
      if (char === '.') {
        continue;
      }
      let color = colorCache.get(char);
      if (color === undefined) {
        const hex = sprite.palette[char];
        if (!hex) {
          throw new Error(`Caracter '${char}' sin color en la paleta del sprite`);
        }
        color = Phaser.Display.Color.HexStringToColor(hex).color;
        colorCache.set(char, color);
      }
      g.fillStyle(color, alpha);
      g.fillRect(offsetX + col * scale, offsetY + row * scale, scale, scale);
    }
  }
}

/* ------------------------------------------------------------------ */
/* TextureFactory                                                      */
/* ------------------------------------------------------------------ */

/** Colores de carrocería/sombra de cada auto. */
const CAR_COLORS = {
  player: { body: '#d63c3c', shadow: '#8f1f1f' },
  rivalBlue: { body: '#3c6cd6', shadow: '#24509a' },
  rivalGreen: { body: '#3c9e52', shadow: '#226434' },
  rivalYellow: { body: '#d8a72c', shadow: '#96701a' },
} as const;

/**
 * Fábrica de texturas procedurales. `generate()` hornea una textura por
 * clave; PreloadScene la invoca una vez por frame para reportar progreso
 * real por textura generada.
 */
export class TextureFactory {
  /**
   * Genera todas las texturas de una vez (bloqueante).
   * @param onProgress callback con progreso real por textura generada.
   */
  static generateAll(scene: Phaser.Scene, onProgress?: TextureProgressCallback): void {
    ALL_TEXTURE_KEYS.forEach((key, index) => {
      TextureFactory.generate(scene, key);
      onProgress?.(index + 1, TOTAL_TEXTURE_COUNT);
    });
  }

  /** Genera y hornea UNA textura por su clave. */
  static generate(scene: Phaser.Scene, key: TextureKey): void {
    switch (key) {
      case TEXTURE_KEYS.roadTile:
        TextureFactory.drawRoadTile(scene);
        break;
      case TEXTURE_KEYS.playerCar:
        TextureFactory.bakeCar(scene, key, CAR_COLORS.player);
        break;
      case TEXTURE_KEYS.rivalCarBlue:
        TextureFactory.bakeCar(scene, key, CAR_COLORS.rivalBlue);
        break;
      case TEXTURE_KEYS.rivalCarGreen:
        TextureFactory.bakeCar(scene, key, CAR_COLORS.rivalGreen);
        break;
      case TEXTURE_KEYS.rivalCarYellow:
        TextureFactory.bakeCar(scene, key, CAR_COLORS.rivalYellow);
        break;
      case TEXTURE_KEYS.coin:
        TextureFactory.bakePixelSprite(scene, key, COIN_SPRITE, 3);
        break;
      case TEXTURE_KEYS.debris:
        TextureFactory.bakePixelSprite(scene, key, DEBRIS_SPRITE, 4);
        break;
      case TEXTURE_KEYS.oilStain:
        TextureFactory.bakePixelSprite(scene, key, OIL_STAIN_SPRITE, 5);
        break;
      case TEXTURE_KEYS.pickupTurbo:
        TextureFactory.bakePixelSprite(scene, key, TURBO_PICKUP_SPRITE, 4);
        break;
      case TEXTURE_KEYS.pickupDrs:
        TextureFactory.bakePixelSprite(scene, key, DRS_PICKUP_SPRITE, 4);
        break;
      case TEXTURE_KEYS.pickupRepair:
        TextureFactory.bakePixelSprite(scene, key, REPAIR_PICKUP_SPRITE, 4);
        break;
      case TEXTURE_KEYS.particle:
        TextureFactory.drawParticle(scene);
        break;
      case TEXTURE_KEYS.hudPanel:
        TextureFactory.drawHudPanel(scene);
        break;
      case TEXTURE_KEYS.hudArrowLeft:
        TextureFactory.bakePixelSprite(scene, key, HUD_ARROW_LEFT_SPRITE, HUD_ARROW_SCALE);
        break;
      case TEXTURE_KEYS.hudArrowRight:
        TextureFactory.bakePixelSprite(scene, key, HUD_ARROW_RIGHT_SPRITE, HUD_ARROW_SCALE);
        break;
      case TEXTURE_KEYS.hudAudioOn:
        TextureFactory.bakePixelSprite(scene, key, HUD_AUDIO_ON_SPRITE, HUD_AUDIO_SCALE);
        break;
      case TEXTURE_KEYS.hudAudioOff:
        TextureFactory.bakePixelSprite(scene, key, HUD_AUDIO_OFF_SPRITE, HUD_AUDIO_SCALE);
        break;
      default:
        throw new Error(`Textura desconocida: ${String(key)}`);
    }
  }

  /* ------------------------- Pista ------------------------- */

  /**
   * Tile de pista 720×256 (el alto divide a 1280 → tiling limpio).
   * De afuera hacia adentro: barrera gris con juntas y brillo metálico
   * (scrollean y venden velocidad), kerb rojo/blanco en bloques de 32px con
   * línea de sombreado, líneas blancas del borde, línea central discontinua
   * con período 64 (continua entre tiles), bandas de desgaste de neumáticos
   * por carril y grano de asfalto determinístico (hash de posición: mismo
   * tile en cada corrida, sin Math.random).
   */
  private static drawRoadTile(scene: Phaser.Scene): void {
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    const width = TRACK.width;
    const height = TRACK.tileHeight;
    const barrier = TRACK.barrierWidth;
    const kerb = TRACK.kerbWidth;

    // Asfalto base + parches sutiles determinísticos (varían dentro del tile).
    g.fillStyle(0x3e4046, 1);
    g.fillRect(0, 0, width, height);
    g.fillStyle(0x393b41, 1);
    g.fillRect(120, 24, 96, 28);
    g.fillRect(430, 140, 120, 36);
    g.fillRect(220, 216, 80, 24);
    g.fillStyle(0x44464c, 1);
    g.fillRect(300, 64, 90, 20);
    g.fillRect(520, 208, 70, 30);

    // Grano de asfalto: motas claras/oscuras fijas por coordenada (hash
    // entero). Pocos puntos por tile: textura sin costo por frame.
    for (let y = 0; y < height; y += 4) {
      for (let x = TRACK.roadLeft; x < TRACK.roadRight; x += 4) {
        const hash = (((x * 73856093) ^ (y * 19349663)) >>> 0) % 97;
        if (hash < 6) {
          g.fillStyle(hash < 3 ? 0x45474d : 0x36383e, 1);
          g.fillRect(x + (hash % 3), y + ((hash >> 2) % 3), 2, 2);
        }
      }
    }

    // Bandas de desgaste de neumáticos: el ruedo de cada carril, un paso más
    // oscuro y con el centro apenas más claro (doble marca de goma).
    const laneWidth = (TRACK.roadRight - TRACK.roadLeft) / SPAWN.laneCount;
    for (let lane = 0; lane < SPAWN.laneCount; lane += 1) {
      const centerX = TRACK.roadLeft + laneWidth * (lane + 0.5);
      g.fillStyle(0x37393f, 1);
      g.fillRect(centerX - 26, 0, 52, height);
      g.fillStyle(0x424449, 1);
      g.fillRect(centerX - 30, 0, 4, height);
      g.fillRect(centerX + 26, 0, 4, height);
    }

    // Barreras laterales.
    g.fillStyle(0x23242c, 1);
    g.fillRect(0, 0, barrier, height);
    g.fillRect(width - barrier, 0, barrier, height);
    // Cara interna iluminada + brillo metálico.
    g.fillStyle(0x3a3c48, 1);
    g.fillRect(barrier - 4, 0, 4, height);
    g.fillRect(width - barrier, 0, 4, height);
    g.fillStyle(0x4c4e5c, 1);
    g.fillRect(barrier - 12, 0, 2, height);
    g.fillRect(width - barrier + 10, 0, 2, height);
    // Juntas horizontales (scrollean con la pista → sensación de velocidad).
    g.fillStyle(0x16171d, 1);
    for (let y = 0; y < height; y += 64) {
      g.fillRect(0, y, barrier, 4);
      g.fillRect(width - barrier, y, barrier, 4);
    }

    // Bandas de rumble (kerb) rojo/blanco en bloques de 32px, con una línea
    // de sombra en la base de cada bloque (relieve).
    for (let y = 0; y < height; y += 32) {
      const isRed = (y / 32) % 2 === 0;
      g.fillStyle(isRed ? 0xd23c3c : 0xf2f2f2, 1);
      g.fillRect(TRACK.roadLeft - kerb, y, kerb, 32);
      g.fillRect(TRACK.roadRight, y, kerb, 32);
      g.fillStyle(isRed ? 0x8f1f1f : 0xb9bcc2, 1);
      g.fillRect(TRACK.roadLeft - kerb, y + 28, kerb, 4);
      g.fillRect(TRACK.roadRight, y + 28, kerb, 4);
    }

    // Líneas blancas continuas del borde del asfalto.
    g.fillStyle(0xdedede, 1);
    g.fillRect(TRACK.roadLeft, 0, 4, height);
    g.fillRect(TRACK.roadRight - 4, 0, 4, height);

    // Línea central discontinua (período 64 → continua entre tiles).
    g.fillStyle(0xf2f2f2, 1);
    for (let y = 0; y < height; y += 64) {
      g.fillRect(width / 2 - 4, y, 8, 36);
    }

    TextureFactory.bake(g, scene, TEXTURE_KEYS.roadTile, width, height);
  }

  /* ------------------------- Partícula ------------------------- */

  /** Partícula blanca 4×4, tintable desde los sistemas de partículas. */
  private static drawParticle(scene: Phaser.Scene): void {
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff, 1);
    g.fillRect(0, 0, 4, 4);
    TextureFactory.bake(g, scene, TEXTURE_KEYS.particle, 4, 4);
  }

  /* ------------------------- HUD táctil ------------------------- */

  /**
   * Panel de botón táctil (TOUCH_HUD.buttonSize × buttonSize): borde oscuro
   * horneado + relleno casi blanco para que cada botón lo tinte a su color.
   * Compartido por los 6 botones del TouchSource.
   */
  private static drawHudPanel(scene: Phaser.Scene): void {
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    const size = TOUCH_HUD.buttonSize;
    const border = 4;

    g.fillStyle(0x1c1c24, 1);
    g.fillRect(0, 0, size, size);
    g.fillStyle(0xf2f2f2, 1);
    g.fillRect(border, border, size - border * 2, size - border * 2);

    TextureFactory.bake(g, scene, TEXTURE_KEYS.hudPanel, size, size);
  }

  /* ------------------------- Horneado ------------------------- */

  private static bakeCar(
    scene: Phaser.Scene,
    key: TextureKey,
    colors: { body: string; shadow: string },
  ): void {
    TextureFactory.bakePixelSprite(scene, key, makeCarSprite(colors.body, colors.shadow), CAR_SCALE);
  }

  private static bakePixelSprite(
    scene: Phaser.Scene,
    key: string,
    sprite: PixelSprite,
    scale: number,
  ): void {
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    drawPixelSprite(g, sprite, scale);
    const { width, height } = pixelSpriteSize(sprite, scale);
    TextureFactory.bake(g, scene, key, width, height);
  }

  /** Hornea el contenido del `Graphics` en una textura y lo destruye. */
  private static bake(
    g: Phaser.GameObjects.Graphics,
    scene: Phaser.Scene,
    key: string,
    width: number,
    height: number,
  ): void {
    // Idempotente: si la textura ya existe (reinicio de escena), se reemplaza.
    if (scene.textures.exists(key)) {
      scene.textures.remove(key);
    }
    g.generateTexture(key, width, height);
    g.destroy();
  }
}
