# Design System — Metacrypto Club

Fuente de verdad visual: las landings del negocio en `referencia/landings/` (`bitcoin_rompio_el_guion.html`, `el_error_despues_de_perderte_bitcoin.html`) + el prototipo `index.html`. **No inventar colores nuevos.**

## Paleta

Base: **negro con acento dorado**, texto crema. Es verde/rojo solo semánticos.

| Token | Valor | Uso |
|---|---|---|
| `--gold` | `#E1CA71` | Acento principal, CTAs, textos destacados, oro |
| `--gold-soft` | `#c9b35e` | Gradientes del oro |
| `--gold-dim` | `rgba(225,202,113,.16)` | Fondos suaves dorados |
| `--gold-line` | `rgba(225,202,113,.28)` | Bordes dorados |
| Oro gradiente (títulos) | `linear-gradient(180deg,#f6ecbf, #E1CA71 45%, #a8893b)` en `-webkit-background-clip:text` | Palabra clave del `h1` (`<em>`) |
| `--ink` | `#000` | Fondo principal |
| `--ink-2` / `--panel` | `#0a0a0a` / `#0d0d0d` | Paneles/tarjetas (gradiente hacia `#070707`) |
| `--text` | `#f3f0e6` | Texto principal (crema) |
| `--text-dim` | `#9b988f` | Texto secundario |
| `--text-faint` | `#65635c` | Texto terciario/mono decorativo |
| `--red` | `#FF4D4D` (protoripo) / `#FF5656` (landing) | Errores, warnings |
| `--green` | `#52d273` (prototipo) / `#55d681` (landing) | Estado OK/done |
| Otros de la landing | `#0b0b0b`, `#0f0f0f`, `#111`, `#68a7ff` (link azul), `#9c7c2a` (dorado oscuro), `#d8d4ca`/`#e6e0d4` (cremas) | Variedad según contexto |

## Tipografía

| Fuente | Familia | Uso |
|---|---|---|
| **Oswald** | display/sans condensada | Títulos, eyebrows, botones — SIEMPRE `text-transform: uppercase`, weights 500–700 |
| **Sora** | body | Párrafos, opciones, inputs |
| **JetBrains Mono** | mono | Metadatos: índices de pregunta, hints pequeños, tags en `UPPERCASE`, `letter-spacing` amplio |

Cíclo de jerarquía característico: `eyebrow` (mono/Oswald, `letter-spacing:.42em`, dorado) → `h1` Oswald con `<em>` dorado → subtítulo Sora.

## Componentes clave (es-boilerplate del prototipo)

- **Eyebrow**: uppercase, tracking .42em, dorado.
- **Título hero**: `h1` Oswald 700, `clamp(2.6rem,7.5vw,5.4rem)`, em dorado con gradiente.
- **Botón dorado** `.btn-gold`: gradiente oro (arriba `#f6ecbf` → `#E1CA71` 45% → `#a8893b`), texto negro, uppercase, `letter-spacing:.14em`, borde-radius 10px, hover lift + glow.
- **Chips / píldoras**: borde `--gold-line`, pill radius, mono uppercase.
- **Opción del wizard** `.opt`: panel oscuro con gradiente, borde casi negro → hover borde dorado, punto radial se ilumina na` al seleccionar.
- **Tabla portfolio**: filas con label Oswald + input mono dorado alineado a la derecha; fila de total con borde dorado.
- **Callouts**: `callout` (dorado), `warning` (rojo, border-left 3px), `highlight` (verde) — fondo con gradiente del color al 7–10% opacity.
- **Plan de acción**: lista numerada, número Oswald dorado.
- **Video box**: borde dorado, placeholder 16:9 con play circular, caption mono.
- **CTA final**: tarjeta panel con glow radial dorado arriba.

## Animación

- Entrada de hero: `rise` traslación 22px + opacity, `.9s cubic-bezier(.2,.7,.2,1)` escalonada (0, .12s, .26s…).
- Barra de progreso: `.5s` mismo easing.
- **Pantalla "analizando"**: steps secuenciales (EN COLA → PROCESANDO con "…" animado → ✓ LISTO) con 700–1200ms por paso — sensación de trabajo real de IA.
- Respeto: `prefers-reduced-motion` desactiva todo.

## Reglas

- Uppercase + tracking generoso en títulos y metadatos (estética "premium fintech nocturna").
- Dorado = valor/dinero/CTA; rojo solo para riesgos/errores; verde para "listo".
- Textos de UI en español; código en inglés.
