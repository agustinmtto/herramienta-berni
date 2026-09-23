# docs/ — Índice de la documentación viva

Esta carpeta es la **fuente de verdad del proyecto**: la metodología es spec-driven — los cambios de requisitos entran primero acá, luego se implementan. Todo lo jubilado está en `../docs-obsoletos/` (con su propio README explicando por qué).

## Orden de lectura

| Archivo | Qué es | Cuándo leerlo |
|---|---|---|
| [`00-OVERVIEW.md`](00-OVERVIEW.md) | Objetivo del proyecto, flujo de negocio, decisiones cerradas, stack, estado actual | **Siempre, primero** |
| [`04-design-system.md`](04-design-system.md) | Colores, tipografía y componentes — fuente de verdad visual | Antes de tocar UI |
| [`06-pendientes-y-preguntas.md`](06-pendientes-y-preguntas.md) | Tracker vivo: pendientes, bloqueantes y preguntas al negocio | Al planear cualquier trabajo |
| [`07-scm-gestion-configuracion.md`](07-scm-gestion-configuracion.md) | Nombrado de archivos, estructura del repo, branches, commits | Antes de cualquier commit/PR |
| [`08-roadmap.md`](08-roadmap.md) | Modelo de trabajo (Supabase local + Docker, migraciones, PRs) y fases con estado real | Al planear/implementar |
| [`09-security.md`](09-security.md) | Checklist de seguridad pre-producción: qué está cerrado y qué no | Al tocar `/api/lead`, headers, rate limiting, o antes de un deploy |
| [`10-levantar-metacrypto-os-local.md`](10-levantar-metacrypto-os-local.md) | Guía paso a paso para levantar el OS + Supabase local (Docker) | Antes de trabajar en `metacrypto-os-app/` o con la integración |
| [`11-migracion-modulo-leads.md`](11-migracion-modulo-leads.md) | **Spec funcional autoritativa** del módulo de leads: contrato, identidad, vinculaciones, reglas fijas | Antes de tocar migraciones 0068-0071, RPCs o el endpoint de leads |
| [`12-spec-sdd-fases-migracion-leads.md`](12-spec-sdd-fases-migracion-leads.md) | Spec SDD: fases con criterios verificables y estado actual de cada una | Al ejecutar cualquier fase |
| [`13-entrega-y-preguntas-milo.md`](13-entrega-y-preguntas-milo.md) | Entrega del módulo: qué quedó corregido, qué falta y qué pedirle al negocio | Al preparar el PR/deploy |
| [`14-estado-actual-produccion.md`](14-estado-actual-produccion.md) | Auditoría de readiness (GO/NO GO): checklist de producción contrastado contra el código real | Antes de mandar tráfico real o hacer el primer deploy |
| [`15-transferencia-funnel-al-repo-del-os.md`](15-transferencia-funnel-al-repo-del-os.md) | Cómo llevar el funnel al repo del OS (Miled) con el patch listo en `release/` | Al migrar el funnel al repo del negocio |

## Qué NO está acá (y por qué)

- **Documentación jubilada** (reunión de integración, requisitos del audio, especificación del MVP standalone, descripción del prototipo): `../docs-obsoletos/` — se conserva por trazabilidad, no como referencia.
- **Fuentes primarias crudas** (transcripciones de la reunión y del audio): `../docs-obsoletos/fuentes-primarias/`.
- La especificación del **sistema del negocio** (MetaCrypto OS) vive en su propia copia: `metacrypto-os-app/CLAUDE.md` y `metacrypto-os-app/docs/`.

## Nota sobre la numeración

Los números de archivo (`00`…`13`) marcan el orden de lectura histórico. Hay saltos (`01/02/03/05` faltan) porque esos documentos se jubilaron a `docs-obsoletos/` el 22-sep-2026 — los números vivos se conservan tal cual porque todo el código y los PRs los referencian por ruta estable (`docs/11 §…`).
