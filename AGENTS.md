# AGENTS.md — Contexto del proyecto

Herramienta de captación (lead magnet) para el negocio de Berni (Metacrypto Club, cripto): landing con wizard de preguntas → **diagnóstico de portfolio determinístico** (algoritmo, sin IA) → captura de lead → integración con el sistema del negocio (Supabase/Next.js) para llamadas en caliente a leads con capital (≥ 10.000 USD, desde 10.000 inclusive).

**Metodología: spec-driven.** La documentación en `docs/` es la fuente de verdad: los cambios de requisitos se editan primero en `docs/`, luego se implementan. Empieza por `docs/README.md` (índice con orden de lectura).

## Documentación (leer en este orden)

| Archivo | Qué es | Cuándo leerlo |
|---|---|---|
| `docs/00-OVERVIEW.md` | Objetivo, flujo de negocio, decisiones tomadas, stack, estado | Siempre, primero |
| `docs/04-design-system.md` | Colores, tipografía, componentes — fuente de verdad visual | Antes de tocar UI |
| `docs/06-pendientes-y-preguntas.md` | Tracker vivo: pendientes, bloqueantes y preguntas al negocio | Al planear sprints |
| `docs/07-scm-gestion-configuracion.md` | Nombrado de archivos, estructura del repo, branches, formato de commits, prácticas | Antes de cualquier commit/PR |
| `docs/08-roadmap.md` | Modelo de trabajo (Supabase local + Docker, migrations, feature branches, PRs) y fases de implementación (con estado real de cada fase) | Al planear/implementar cualquier fase |
| `docs/09-security.md` | Checklist de seguridad pre-producción: qué está implementado, qué no aplica aún, aclaraciones acordadas | Al tocar `/api/lead`, headers, rate limiting o antes de un deploy |
| `docs/10-levantar-metacrypto-os-local.md` | Guía paso a paso para levantar MetaCrypto OS + Supabase local (Docker) desde cero y en el día a día | Antes de trabajar en `metacrypto-os-app/` o con la integración quiz↔OS |
| `docs/11-migracion-modulo-leads.md` | **Spec funcional autoritativa** del módulo de leads: contrato, identidad, vinculaciones, regla de lead caliente, reglas fijas | Antes de tocar las migraciones 0068–0071, los RPC o el endpoint de leads |
| `docs/12-spec-sdd-fases-migracion-leads.md` | Spec SDD: fases 0–D con criterios verificables, comandos de validación por compuerta y estado actual | Al ejecutar cualquier fase |
| `docs/13-entrega-y-preguntas-milo.md` | Entrega del módulo: qué quedó corregido, qué falta por dueño y qué pedirle al negocio | Al preparar el PR/deploy y para responder con Milo/Miled |

> **Documentación jubilada:** `docs-obsoletos/` (reunión de integración, requisitos del audio de Berni, especificación del MVP standalone, descripción del prototipo y fuentes primarias crudas). Se conserva por trazabilidad — **no usar como spec ni referencia técnica**. El detalle de cada jubilación está en su `README.md`.

## Decisiones firmes (no re-abrir)

- **Integración por código** con el stack del negocio (Supabase + Next.js, branch + PR). Go High Level fue evaluado y descartado; queda solo como CRM/agendas del negocio.
- **Sin IA**: clasificación de leads y diagnóstico **determinísticos** por algoritmo (las respuestas son todas de opción múltiple).
- **El funnel vive dentro del OS del negocio** como ruta pública `/quiz` (no es un deploy aparte — decisión D1 de `docs/11`).
- Tracking mínimo: la métrica clave es **hasta qué pregunta llega el lead** (si termina el cuestionario o no).
- **Final del flujo (decidido): pantalla final única** — diagnóstico + sección "recursos" con 3 videos (2 genéricos + 1 destacado según la pregunta 2). Sin pantalla separada de resultado ni de video. Sin contador de preguntas ni índices en el wizard: solo barra de progreso psicológica (avance rápido al inicio y más lento después).
- **Contacto y CTA**: nombre + email + teléfono al final; CTA a WhatsApp `+54 9 3585 401429` con las respuestas precargadas.
- **PDF**: el documento HTML y el generador transitorio se conservan como base técnica, pero no hay descarga visible; la entrega completa vía Resend queda para después.
- **Camino comercial del lead (docs/11 §9)**: post-venta el triaje **vincula** el lead temporal al cliente definitivo (con validación de teléfono y rollback exacto auditado) o lo **descarta** si no hubo venta (`estado='descartado'`).
- Lead caliente = capital **≥ 10.000 USD** (desde 10.000 inclusive — docs/11 §8) → llamada de triaje.

## Estado actual (23-sep-2026)

- Implementación de la integración **completa y validada en local**, incluidas las correcciones de la **auditoría v4** (2 críticos + 11 importantes + 3 medias del módulo cerrados — detalle en `docs/16`).
- Migraciones del módulo: `0068` (esquema + RPC), `0069` (teléfono/auditoría/rollback), `0070` (descarte), `0071` (reconciliación), `0072` (reconciliación v2 — inmutabilidad, consentimiento, concurrencia, tracking). **Números confirmados por Miled.**
- Suite del OS: **1.343 tests en verde (0 omitidos)** · `tsc` limpio · `eslint` 0 errores · `next build` OK.
- Patch de transferencia **regenerado** (`release/funnel-leads.patch`, 36 archivos incl. `package.json`/lockfile/`eslint.config.mjs`) y verificado con `git apply --check` sobre un clone fresco del repo de Miled.
- **Pendiente para el GO**: videos de Berni (URL definitiva) y verificación final del engine determinístico con decisiones. Operativo de Miled: aplicar `0068–0072` en producción, env, backup, rate limit distribuido (WAF/Upstash) y smoke test. Tickets preexistentes del OS en `docs/13` §4.

## Estructura del repo

```
app/                    # App Next.js del MVP standalone (App Router) — histórico, referencia
components/flow.jsx     # Máquina de estados del flujo completo del prototipo
components/diagnosis-document.jsx # Documento HTML fijo usado para generar el PDF
lib/                    # Del standalone: question-config.js, engine.js, pdf.js, whatsapp.js
test/                   # Suite node:test del standalone (unit + integración + seguridad)
prototipos/
  index.html            # Prototipo original (referencia histórica; desechable como código)
  referencia/landings/  # Landings existentes del negocio = design system a replicar (docs/04)
  frames/               # Capturas del prototipo
docs/                   # Documentación VIVA del proyecto (índice: docs/README.md)
docs-obsoletos/         # Documentación jubilada + fuentes primarias (no usar como spec)
metacrypto-os-app/      # Sistema interno del negocio + Supabase; **acá vive la implementación vigente** (/quiz + /leads). Ver su CLAUDE.md antes de tocarlo
  apps/inbox/           # La app Next.js del OS: funnel (/quiz, /api/lead), módulo /leads, inbox, crons
  supabase/migrations/  # 0001…0071 — se aplican a mano por el operador, en orden (nunca editar aplicadas)
scripts/
  transcribe.py         # Utilidad: transcribe audios con Whisper → transcripciones .md
```

## Convenciones

- Español para textos de UI y documentación; inglés para código y mensajes de commit (Conventional Commits — ver `docs/07`).
- Design system fijo (colores/tipografía): ver `docs/04-design-system.md` — no inventar colores nuevos.
- El prototipo `prototipos/index.html` es desechable; el producto real está definido en `docs/11` y vive en `metacrypto-os-app/`.
- Todo config-driven: las preguntas, los videos y la CTA viven en el question-config del funnel; cambiar contenido no debe requerir tocar código de componentes.
- Tests: `npx vitest run` (OS) y `npm test` (raíz) deben pasar antes de abrir un PR que toque lógica o el endpoint. `npm run lint` es compuerta (0 errores). Los suites gated de integración SOLO corren contra Supabase local (guarda anti-producción).
- Los `.txt` de auditorías externas quedan fuera del repo (trabajo en vuelo, no documentación).
