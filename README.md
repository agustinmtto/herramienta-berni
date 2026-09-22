# Herramienta de Diagnóstico — Metacrypto Club

Lead magnet para el negocio de Berni (Metacrypto Club, cripto): landing con wizard de preguntas → **diagnóstico de portfolio determinístico** (por algoritmo, sin IA) → captura de lead → integración con el sistema del negocio (Supabase + Next.js, branch + PR) para llamadas en caliente a leads con capital ≥ 10.000 USD (desde 10.000 inclusive).

> **Lectura rápida para agentes/devs:** empezar por `AGENTS.md` (decisiones firmes + reglas de trabajo) y `docs/00-OVERVIEW.md`. La documentación es **spec-first**: los cambios de requisitos se editan primero en `docs/`, luego se implementan.

## Estado actual (sept 2026)

- ✅ **Integración implementada en el OS del negocio** (rama `feature/leads-a-migracion-rpc`): funnel portado a `metacrypto-os-app/apps/inbox` como ruta pública `/quiz`, persistencia real en Supabase local (migraciones `0068`/`0069` + RPC transaccional `registrar_diagnostico`), módulo privado `/leads` con permiso propio, vinculación post-venta con validación de teléfono + rollback auditado
- ✅ Fases 0–C cerradas y Fase D cierre local (ver `docs/12` §6) — pendiente solo externo (Miled + negocio)
- ✅ Suite del OS: 1.313 tests en verde · `tsc` limpio
- ✅ **MVP standalone en la raíz** (histórico, conservado como referencia): wizard con 8 preguntas config-driven, motor determinístico (`lib/engine.js`), JSON `pregunta/respuesta` → `POST /api/lead` (stub), tests 39/39 en `test/`
- ⏳ Pendiente externo: hosting/rate limit definitivo, confirmación de migraciones con Miled, upgrade de Next (RCE crítica), videos reales, alerta de triaje, PDF por email (Resend)

## Repositorio unificado

Este repositorio contiene ahora los dos lados de la integración:

- La raíz conserva el Quiz Funnel del MVP standalone (histórico, referencia de comportamiento).
- `metacrypto-os-app/` contiene una copia limpia del sistema interno y sus migraciones, tomada de su `main` en el commit `f2aee5c` — **acá vive la implementación vigente** (`/quiz` + `/leads`).
- `docs/archive/ANALISIS_INTEGRACION_QUIZ_LEADS-v1.0-20260916.md` es el análisis técnico previo (obsoleto como spec; la vigente es `docs/11`).
- `documentacion_prototipo.txt` resume el alcance y estado funcional del funnel.
- `metacrypto-os-app/esquema-metacrypto-os.sql` es el DDL standalone analizado.

La implementación de la integración ya ocurrió (fases 0–C cerradas, `docs/12`): el funnel persiste vía RPC en el Supabase del OS.

## Cómo correrlo y testearlo

```bash
npm install        # primera vez
npm run dev        # desarrollo → http://localhost:3000
npm run build      # build de producción (igual que Netlify)
npm run start      # servidor de producción local
npm test           # suite completa (levanta next start en :3399, requiere build previo)
npm run test:unit  # solo unitarios (rápido, no necesita build)
```

Para ver los datos que envía el wizard: corré `npm run dev`, completá el flujo, y mirá la consola del servidor (línea `[lead-payload] {...}`).

## Estructura del repo

```
app/                    # app Next.js (App Router)
  layout.jsx            #   HTML raíz: fuentes (Oswald/Sora/Mono) + metadata
  page.jsx              #   renderiza el flujo completo
  globals.css           #   design system (negro + oro, docs/04)
  api/lead/route.js     #   endpoint único POST con validación (stub de Supabase)
components/
  flow.jsx              # máquina de estados: hero → wizard → análisis → final
  diagnosis-document.jsx# documento HTML fijo para el PDF, personalizado por nombre
lib/
  question-config.js    # preguntas definitivas + videos + CTA
  engine.js             # motor determinístico: reglas por tags → diagnóstico
  pdf.js                # generador PDF desde el documento HTML (jsPDF + html2canvas)
  whatsapp.js           # genera mensaje y enlace wa.me con las respuestas
test/
  unit.config-engine.test.mjs    # unitarios de config/engine/progress
  integration.api.test.mjs       # integración + seguridad contra servidor real
prototipos/
  index.html            # prototipo original (referencia de tono/UX; desechable como código)
  referencia/landings/  # landings del negocio = fuente del design system
  frames/               # capturas del prototipo
docs/                   # documentación viva (fuente de verdad del proyecto)
  archive/              # transcripciones crudas + análisis previo (obsoletos, referencia)
metacrypto-os-app/      # sistema interno, Supabase, migraciones y DDL de referencia (implementación vigente)
documentacion_prototipo.txt        # síntesis funcional del prototipo
scripts/transcribe.py   # utilidad: transcribe audios con Whisper
```

## Cómo funcionan los datos

1. El wizard guarda las respuestas en estado del componente (nada persiste en el navegador).
2. MVP standalone (raíz): build del **JSON agnóstico** `{session_id, lead, signals, answers[{pregunta,respuesta}]}` → `POST /api/lead` (stub con validación, loguea en consola).
3. **Implementación vigente (OS, `metacrypto-os-app/`):** contrato versionado con eventos `started/progress/dropped/completed` → `POST /api/lead` → RPC transaccional `registrar_diagnostico` → `personas` + `quiz_versiones` + `diagnostico_envios` + `diagnostico_respuestas`, con clasificación server-side, idempotencia y deduplicación. El diseño completo está en `docs/11`.
4. Si el lead **abandona** a mitad del wizard, un `sendBeacon` en `pagehide` manda el payload parcial con las respuestas acumuladas (la métrica clave del negocio: hasta qué pregunta llegó).

## Documentación

| Doc | Contenido |
|---|---|
| `AGENTS.md` | Índice para agentes: decisiones firmes, convenciones, orden de lectura |
| `docs/00-OVERVIEW.md` | Objetivo, flujo de negocio, decisiones, stack, estado |
| `docs/01-reunion-integracion.md` | Reunión con el negocio (transcripción fiel + nota de decisiones posteriores) |
| `docs/02-audio-berni-requisitos.md` | Requisitos de Berni: qué preguntar y por qué, ganchos |
| `docs/03-especificacion.md` | ⚠️ Histórica (MVP standalone): JSON, wizard, motor, tracking, final+PDF — la spec vigente es `docs/11` |
| `docs/04-design-system.md` | Colores (oro/negro), tipografía, componentes |
| `docs/05-prototipo.md` | Qué hace `prototipos/index.html` y qué conservar |
| `docs/06-pendientes-y-preguntas.md` | Bloqueantes y **roadmap vivo** |
| `docs/07-scm-gestion-configuracion.md` | Nombrado, estructura, branches, commits |
| `docs/08-roadmap.md` | Modelo de trabajo (fases) y fases de implementación |
| `docs/09-security.md` | Seguridad del endpoint, rate limiting y checklist preproducción |
| `docs/10-levantar-metacrypto-os-local.md` | Guía para levantar el OS + Supabase local |
| `docs/11-migracion-modulo-leads.md` | **Spec funcional autoritativa** de la migración del módulo de leads |
| `docs/12-spec-sdd-fases-migracion-leads.md` | Fases SDD con compuertas y estado |
| `docs/13-entrega-y-preguntas-milo.md` | Entrega del módulo: qué quedó corregido, qué falta y las 8 preguntas para el negocio |
| `docs/archive/` | Transcripciones crudas y análisis previo, archivados (obsoletos, solo referencia) |
| `documentacion_prototipo.txt` | Síntesis funcional y decisiones del prototipo |

## Cómo desarrollar (flujo de trabajo)

1. Cambios de requisitos → primero commit de `docs/` (spec-first, `docs/07` §5).
2. Branch: `feature/<slug>`, `fix/<slug>`, `docs/<slug>`.
3. Commits: Conventional Commits en inglés, un tema por commit.
4. PR acotado → revisión → merge. Nunca directo a producción.
5. Deploy: Netlify (config en `netlify.toml`); el deploy público final es decisión del negocio.

Documento educativo; no constituye asesoramiento financiero personalizado.
