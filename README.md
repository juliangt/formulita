# Formulita

Juego de carreras de Fórmula 1 en 2D, estilo retro 8-bit (pixel art 100% procedural, sin assets externos), mobile-first en vertical (720×1280). **Phaser 3 + Vite + TypeScript (strict).**

> Roadmap completo por fases: [`PLAN_DESARROLLO.md`](./PLAN_DESARROLLO.md).

## Cómo correr

Requisitos: Node 20+ y npm 10+.

```bash
npm install
npm run dev        # http://localhost:5173
```

Para jugar desde el celular: misma red Wi-Fi y abrir `http://<IP-de-tu-máquina>:5173` (Vite la imprime al arrancar).

## Controles

| Acción | Teclado | Táctil (HUD) |
| --- | --- | --- |
| Doblar | ← → o A / D | ◀ ▶ (abajo-izquierda) |
| Acelerar | Espacio | Acelerador |
| Freno | Z | Freno |
| Turbo | Shift | Turbo |
| DRS | X | DRS |

Los botones táctiles soportan multi-touch real (doblar y acelerar a la vez).

## Scripts

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Dev server expuesto en la red local. |
| `npm run build` | Chequeo de tipos + build de producción. |
| `npm run preview` | Sirve el build de producción. |
| `npm test` | Tests con Vitest. |

## Convención de tests

- Los tests viven en `src/__tests__/` y usan el sufijo `.test.ts` (ej.: `src/__tests__/EventBus.test.ts`).
- Se corren con `npm test` (Vitest, entorno `happy-dom` para poder importar Phaser).
- `src/__tests__/setup.ts` provee un stub de contexto 2D de canvas: happy-dom no lo implementa y Phaser lo consulta al importarse.
- La lógica pura de gameplay (sistemas de velocidad, turbo, DRS, spawn, etc.) se irá testeando junto a su implementación en fases siguientes.

## Notas

- `phaser3spectorjs` está como devDependency porque Phaser 3.90.0 la importa sin declararla en sus propias dependencias (bug de packaging conocido).
- El warning de "chunk larger than 500 kB" en `npm run build` es esperado: Phaser es grande y en un juego de un solo canvas no conviene code-splitting.

## Estado

- [x] Fase 0 — Scaffolding
- [ ] Fase 1 — Núcleo visual y jugador (próxima)
