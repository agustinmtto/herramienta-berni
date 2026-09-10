# AGENTS.md — Contexto del proyecto

Herramienta de captación (lead magnet) para el negocio de Berni (Metacrypto Club, cripto): landing con wizard de preguntas → **diagnóstico de portfolio determinístico** (algoritmo, sin IA) → captura de lead → integración con el sistema del negocio (Supabase/Next.js) para llamadas en caliente a leads con capital (> 10.000 USD).

**Metodología: spec-driven.** La documentación en `docs/` es la fuente de verdad: los cambios de requisitos se editan primero en `docs/`, luego se implementan.

## Documentación (leer en este orden)

| Archivo | Qué es | Cuándo leerlo |
|---|---|---|
| `docs/00-OVERVIEW.md` | Objetivo, flujo de negocio, decisiones tomadas, stack, estado | Siempre, primero |
| `docs/01-reunion-integracion.md` | Síntesis de la reunión con el negocio (Miled + Berni): arquitectura, tracking, decisiones | Antes de tocar arquitectura/integración |
| `docs/02-audio-berni-requisitos.md` | Ideas de Berni (audio WhatsApp): qué preguntar y por qué, ganchos del diagnóstico | Al diseñar preguntas/motor |
| `docs/03-especificacion.md` | Spec técnico: JSON, wizard, motor determinístico, integración, tracking, final + PDF | Antes de escribir código |
| `docs/04-design-system.md` | Colores, tipografía, componentes — fuente de verdad visual | Antes de tocar UI |
| `docs/05-prototipo.md` | Qué hace el prototipo y qué conservar del comportamiento | Migrar/implementar |
| `docs/06-pendientes-y-preguntas.md` | Bloqueantes, próximas acciones, roadmap, métricas | Al planear sprints |
| `docs/07-scm-gestion-configuracion.md` | Nombrado de archivos, estructura del repo, branches, formato de commits, prácticas | Antes de cualquier commit/PR |
| `docs/08-roadmap.md` | Modelo de trabajo (Supabase local + Docker, migrations, feature branches, PRs) y fases de implementación (con estado real de cada fase) | Al planear/implementar cualquier fase |

Fuentes primarias (si hace falta el detalle crudo): `Transcripcion_Reunion.md` y `transcripcion_audio.md` en la raíz.

## Decisiones firmes (no re-abrir)

- **Integración por código** con el stack del negocio (Supabase + Next.js, branch + PR). Go High Level fue evaluado y descartado; queda solo como CRM/agendas del negocio.
- **Sin IA**: clasificación de leads y diagnóstico **determinísticos** por algoritmo (las respuestas son todas de opción múltiple).
- Tracking mínimo: la métrica clave es **hasta qué pregunta llega el lead** (si termina el cuestionario o no).
- **Final del flujo (decidido): pantalla final única** — diagnóstico + sección "recursos" con 3 videos (2 genéricos + 1 destacado según una pregunta de segmentación). Sin pantalla separada de resultado ni de video. Sin contador de preguntas ni índices en el wizard: solo barra de progreso "mentirosa" (1ra pregunta = 33%, trepa lento).
- **Contacto y CTA**: nombre + email + teléfono al final; CTA a WhatsApp `+54 9 3585 401429` con las respuestas precargadas.
- **PDF transitorio**: documento HTML breve y fijo, personalizado solo con el nombre del lead; después se reemplaza por el diagnóstico completo vía Resend.
- Lead caliente = capital **> 10.000 USD** → llamada de triaje.

## Estructura del repo

```
app/                    # App Next.js (App Router) — ver README.md para el detalle
  layout.jsx, page.jsx, globals.css, api/lead/route.js
components/flow.jsx     # Máquina de estados del flujo completo
lib/
  question-config.js    # Preguntas/videos/CTA (swap de las preguntas de Berni aquí)
  engine.js             # Motor determinístico por tags
  pdf.js                # PDF dev-only
  whatsapp.js           # Mensaje y URL wa.me con las respuestas del lead
test/                   # Suite node:test (unit + integración + seguridad)
prototipos/
  index.html            # Prototipo original (referencia; desechable como código)
  referencia/landings/  # Landings existentes del negocio = design system a replicar (docs/04)
  frames/               # Capturas del prototipo
docs/                   # Documentación viva del proyecto (varios .md — ver tabla arriba)
scripts/
  transcribe.py         # Utilidad: transcribe audios con Whisper → docs/*_transcript.md
```

## Convenciones

- Español para textos de UI y documentación; inglés para código.
- Design system fijo (colores/tipografía): ver `docs/04-design-system.md` — no inventar colores nuevos.
- El prototipo `prototipos/index.html` es desechable; el producto real se define en `docs/03-especificacion.md`.
- El prototipo refleja el comportamiento objetivo del diagnóstico (tono, secciones, ganchos) — consérvalo como referencia del motor determinístico.
- Todo config-driven: las preguntas, el mapeo de videos y la CTA viven en `lib/question-config.js`; cambiar contenido no debe requerir tocar código de componentes.
- Tests: `npm test` debe pasar antes de abrir un PR que toque lógica o el endpoint.
