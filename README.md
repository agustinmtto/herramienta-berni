# Herramienta de Diagnóstico — Metacrypto Club

Lead magnet para el negocio de Berni (Metacrypto Club, cripto): landing con wizard de preguntas → **diagnóstico de portfolio determinístico** (por algoritmo, sin IA) → captura de lead → integración con el sistema del negocio (Supabase + Next.js, branch + PR) para llamadas en caliente a leads con capital > 10.000 USD.

> **Lectura rápida para agentes/devs:** empezar por `AGENTS.md` (decisiones firmes + reglas de trabajo) y `docs/00-OVERVIEW.md`. La documentación es **spec-first**: los cambios de requisitos se editan primero en `docs/`, luego se implementan.

## Estado actual (sept 2026)

- ✅ **App MVP** en la branch `feature/wizard-mvp` (Next.js 15, deploy Netlify-ready): wizard con preguntas genéricas config-driven → pregunta de segmentación → análisis → **pantalla final única** con diagnóstico determinístico + 3 video placeholders + CTA
- ✅ Motor determinístico por reglas sobre las respuestas (`lib/engine.js`); sin IA (decisión firme)
- ✅ JSON agnóstico `pregunta/respuesta` → `POST /api/lead` (stub con validación de seguridad; Supabase del negocio cuando estén los accesos)
- ✅ Tracking mínimo: `session_id` + **hasta qué pregunta llega el lead** (dropoff por `sendBeacon`)
- ✅ PDF dev-only con el estilo de la page (`lib/pdf.js`) para refinar el diseño sin el email
- 🚧 Entrega WhatsApp en desarrollo: teléfono obligatorio, CTA al `+54 9 3585 401429`, mensaje con respuestas y PDF base personalizado por nombre
- ✅ Tests: `test/` — unitarios + integración + seguridad (17/17)
- ⏳ **Pendiente crítico:** Berni define las preguntas finales (blocker #1) → swap en `lib/question-config.js`
- ⏳ Accesos a Supabase del negocio (Fase 0), deploy en Netlify, PDF por email real (Resend), videos reales

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
  flow.jsx              # máquina de estados: hero → wizard → segmentación → análisis → final
lib/
  question-config.js    # PREGUNTAS + videos + CTA (swap aquí las de Berni, sin tocar código)
  engine.js             # motor determinístico: reglas por tags → diagnóstico
  pdf.js                # generador PDF desde el documento HTML (jsPDF + html2canvas)
test/
  unit.config-engine.test.mjs    # unitarios de config/engine/progress
  integration.api.test.mjs       # integración + seguridad contra servidor real
prototipos/
  index.html            # prototipo original (referencia de tono/UX; desechable como código)
  referencia/landings/  # landings del negocio = fuente del design system
  frames/               # capturas del prototipo
docs/                   # documentación viva (fuente de verdad del proyecto)
scripts/transcribe.py   # utilidad: transcribe audios con Whisper
```

## Cómo funcionan los datos

1. El wizard guarda las respuestas en estado del componente (nada persiste en el navegador).
2. Al terminar: build del **JSON agnóstico** `{session_id, lead{name,email,consent}, signals{dropoff_question,finished_at}, answers[{pregunta,respuesta}]}` → `POST /api/lead`.
3. **Hoy:** el endpoint valida (413/400/422) y loguea en consola; no se persiste nada.
4. **Mañana:** mismo JSON → tablas Supabase del negocio (leads, respuestas, sesiones, eventos, flag `hot_lead` con RLS). El modelo de trabajo está en `docs/08` (Supabase local + Docker, migrations append-only, PRs).
5. Si el lead **abandona** a mitad del wizard, un `sendBeacon` en `pagehide` manda el payload parcial con `dropoff_question` (la métrica clave del negocio).

## Documentación

| Doc | Contenido |
|---|---|
| `AGENTS.md` | Índice para agentes: decisiones firmes, convenciones, orden de lectura |
| `docs/00-OVERVIEW.md` | Objetivo, flujo de negocio, decisiones, stack, estado |
| `docs/01-reunion-integracion.md` | Reunión con el negocio (transcripción fiel + nota de decisiones posteriores) |
| `docs/02-audio-berni-requisitos.md` | Requisitos de Berni: qué preguntar y por qué, ganchos |
| `docs/03-especificacion.md` | Spec técnica: JSON, wizard, motor, integración, tracking, final+PDF |
| `docs/04-design-system.md` | Colores (oro/negro), tipografía, componentes |
| `docs/05-prototipo.md` | Qué hace `prototipos/index.html` y qué conservar |
| `docs/06-pendientes-y-preguntas.md` | Bloqueantes y **roadmap vivo** |
| `docs/07-scm-gestion-configuracion.md` | Nombrado, estructura, branches, commits |
| `docs/08-roadmap.md` | Modelo de trabajo (fases) y fases de implementación |

## Cómo desarrollar (flujo de trabajo)

1. Cambios de requisitos → primero commit de `docs/` (spec-first, `docs/07` §5).
2. Branch: `feature/<slug>`, `fix/<slug>`, `docs/<slug>`.
3. Commits: Conventional Commits en inglés, un tema por commit.
4. PR acotado → revisión → merge. Nunca directo a producción.
5. Deploy: Netlify (config en `netlify.toml`); el deploy público final es decisión del negocio.

Documento educativo; no constituye asesoramiento financiero personalizado.
