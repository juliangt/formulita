import Phaser from 'phaser';
import type { EntityDefinition, EntityFamily, EntityKind } from './entityTypes';

/**
 * TrackEntity — base de las entidades de pista poolables (Fase 4).
 *
 * Todas las entidades nacen fuera de pantalla (arriba), viajan hacia el
 * jugador y se reciclan al pool cuando salen por abajo. El ciclo de vida es
 * SIEMPRE `spawn()` → (activa) → `recycle()`: nunca `destroy()`. Eso hace
 * que el pool recicle instancias y que sesiones largas no creen objetos por
 * frame (Pooling estricto, PLAN_DESARROLLO.md §Riesgos).
 *
 * El movimiento vertical lo setea SpawnSystem (velocidad de cierre según
 * familia/dificultad); las subclases solo suman comportamiento propio en su
 * `preUpdate` (cambio de carril, pulso de pickup…).
 *
 * La definición (`EntityDefinition`) es data-driven: textura, hitbox y
 * recompensas se aplican desde `entityTypes.ts` en cada spawn, así un mismo
 * pool sirve para todos los kinds de su familia.
 */
export abstract class TrackEntity extends Phaser.Physics.Arcade.Sprite {
  /** Familia (determina pool y grupo arcade); la fija cada subclase. */
  abstract readonly family: EntityFamily;

  private currentDef: EntityDefinition | null = null;

  protected constructor(scene: Phaser.Scene, x: number, y: number, texture: string) {
    super(scene, x, y, texture);

    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.physicsBody.setAllowGravity(false);
  }

  protected get physicsBody(): Phaser.Physics.Arcade.Body {
    return this.body as Phaser.Physics.Arcade.Body;
  }

  /** Definición aplicada en el último spawn (data-driven). */
  get def(): EntityDefinition {
    if (!this.currentDef) {
      throw new Error('Entidad de pista usada antes de spawn()');
    }
    return this.currentDef;
  }

  /** `true` si la entidad fue spawnearse alguna vez (defensa en overlaps). */
  get isSpawned(): boolean {
    return this.currentDef !== null;
  }

  get kind(): EntityKind {
    return this.def.kind;
  }

  /**
   * Entra en juego: aplica textura/hitbox de la definición, se posiciona y
   * reactiva body y sprite. Reutilizable en cada reciclaje del pool.
   */
  spawn(x: number, y: number, def: EntityDefinition): void {
    this.currentDef = def;
    this.setTexture(def.textureKey);
    this.setPosition(x, y);

    const body = this.physicsBody;
    body.enable = true;
    body.setSize(def.hitbox.width, def.hitbox.height, true);
    body.reset(x, y);

    this.setActive(true).setVisible(true);
    this.clearTint();
    this.setScale(1);
    this.setAlpha(1);
    this.onSpawn();
  }

  /** Vuelve al pool: body deshabilitado y sprite fuera de escena. */
  recycle(): void {
    const body = this.physicsBody;
    body.stop();
    body.enable = false;
    this.setActive(false).setVisible(false);
    this.onRecycle();
  }

  /** Comportamiento propio al entrar en juego (opcional). */
  protected onSpawn(): void {}

  /** Limpieza propia al reciclar (opcional). */
  protected onRecycle(): void {}
}
