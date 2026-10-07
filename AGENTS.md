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
- **Despliegue del funnel (D1 → D2, 06-oct):** originalmente dentro del OS (`/quiz`); hoy es una **app pública aparte** (`apps/funnel/`, su propia instancia/dominio) que escribe por el RPC `registrar_diagnostico` con el rol mínimo `funnel` (migración `0069`). El OS NO expone rutas del funnel — solo el módulo privado `/leads` para el triaje.
- Tracking mínimo: la métrica clave es **hasta qué pregunta llega el lead** (si termina el cuestionario o no).
- **Final del flujo (decidido): pantalla final única** — diagnóstico + sección "recursos" con 3 videos (2 genéricos + 1 destacado según la pregunta 2). Sin pantalla separada de resultado ni de video. Sin contador de preguntas ni índices en el wizard: solo barra de progreso psicológica (avance rápido al inicio y más lento después).
- **Contacto y CTA**: nombre + email + teléfono al final; CTA a WhatsApp `+54 9 3585 401429` con las respuestas precargadas.
- **PDF**: el documento HTML y el generador transitorio se conservan como base técnica, pero no hay descarga visible; la entrega completa vía Resend queda para después.
- **Camino comercial del lead (docs/11 §9)**: post-venta el triaje **vincula** el lead temporal al cliente definitivo (con validación de teléfono y rollback exacto auditado) o lo **descarta** si no hubo venta (`estado='descartado'`).
- Lead caliente = capital **≥ 10.000 USD** (desde 10.000 inclusive — docs/11 §8) → llamada de triaje.

## Estado actual (06-oct-2026, pm)

- Implementación de la integración **completa y validada en local**: correcciones de las auditorías v4/v5 integradas, módulo consolidado tras la revisión anti-sobre-ingeniería **y funnel separado en su propia app pública (D2)**.
- **Dos despliegues, una base** (`docs/00` D2 / `docs/18`): `apps/funnel` (pública: wizard + `/api/lead`, rol mínimo `funnel`) + `apps/inbox` (OS del negocio con módulo `/leads` — sin rutas públicas). El mensaje del funnel entra por el RPC `registrar_diagnostico`; la llave pública no puede leer PII ni ejecutar el triage (aislamiento verificado con 403 reales).
- **Migraciones del módulo**: `0068_quiz_leads.sql` (estado final consolidado del histórico 0068–0073; convergente) + `0069_funnel_db_role.sql` (rol mínimo `funnel` de la app pública) + `0070_auditoria_lead_del_envio.sql` (lookup SQL nativo del QA E2E). La validación de migraciones la hacemos nosotros con la carpeta del OS (docs/18 §1).
- Suite: **funnel 5 archivos / 68 tests (gated con el rol funnel) + inbox 55 archivos (RPC + leads incluidos) — todas en verde, 0 omitidos** · `tsc` limpio · `eslint` 0 errores · `next build` OK en ambas apps.
- Patch de transferencia **regenerado** (`release/funnel-leads.patch`): solo módulo `/leads` + migraciones — la app pública no viaja al repo del OS.
- Limpieza aplicada: workflow raíz de CI duplicado eliminado, **prototipo standalone de la raíz retirado** (queda en git history + `docs-obsoletos/`), código muerto fuera, un solo esquema de advisory lock por contacto canónico. Informe QA completo: `docs/19-qa-funnel.md`.
- **Pendiente para el GO**: videos de Berni (URL definitiva) y url del funnel (dominio). Operativo técnico: `docs/18-guia-deploy-go.md` (backup, migraciones 0068+0069, token del rol funnel, env, rate limit distribuido WAF/Upstash, smoke en ambas instancias). Tickets preexistentes del OS en `docs/13` §4.

## Estructura del repo

```
metacrypto-os-app/      # Sistema interno del negocio + Supabase; **acá vive la implementación vigente**. Ver su CLAUDE.md antes de tocarlo
  apps/funnel/          # App PÚBLICA del funnel (separación D2): wizard /quiz + /api/lead, rol mínimo `funnel` — desplegada en su propia instancia
  apps/inbox/           # La app Next.js del OS: módulo /leads, inbox, crons — SIN rutas públicas del funnel
  supabase/migrations/  # 0001…0069 — la 0068 es el módulo de leads (consolidada) y la 0069 el rol mínimo del funnel; se aplican a mano por el operador, en orden (nunca editar aplicadas)
prototipos/
  referencia/landings/  # Landings existentes del negocio = design system a replicar (docs/04)
  frames/               # Capturas del prototipo
  index.html            # Prototipo original (referencia histórica; desechable como código)
docs/                   # Documentación VIVA del proyecto (índice: docs/README.md)
docs-obsoletos/         # Documentación jubilada + fuentes primarias (no usar como spec)
release/
  funnel-leads.patch    # Diff del MÓDULO /leads para aplicar sobre el repo del OS (docs/15, docs/18 §7)
scripts/
  transcribe.py         # Utilidad: transcribe audios con Whisper → transcripciones .md
```

> Retirado (06-oct-2026): el prototipo standalone de la raíz (`app/`, `components/`, `lib/`, `test/`, `package.json`/lockfile, `next.config.mjs`, `middleware.js`) y su workflow de CI. El mapa completo de archivos vivos con su rol está en `docs/19-qa-funnel.md`.

## Convenciones

- Español para textos de UI y documentación; inglés para código y mensajes de commit (Conventional Commits — ver `docs/07`).
- Design system fijo (colores/tipografía): ver `docs/04-design-system.md` — no inventar colores nuevos.
- El prototipo `prototipos/index.html` es desechable; el producto real está definido en `docs/11` y vive en `metacrypto-os-app/`.
- Todo config-driven: las preguntas, los videos y la CTA viven en el question-config del funnel; cambiar contenido no debe requerir tocar código de componentes.
- Tests: `npx vitest run` en `metacrypto-os-app/apps/inbox` (y el workflow de CI del módulo) deben pasar antes de abrir un PR que toque lógica o el endpoint; los suites gated de integración SOLO corren contra Supabase local (guarda anti-producción). `npm run lint` es compuerta (0 errores). El `npm test` raíz es historia del prototipo retirado.
- Los `.txt` de auditorías externas quedan fuera del repo (trabajo en vuelo, no documentación).
