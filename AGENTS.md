# AGENTS.md — Contexto del proyecto

Herramienta de captación (lead magnet) para el negocio de Berni (Metacrypto Club, cripto): landing con wizard de preguntas → diagnóstico de portfolio generado con IA → captura de lead → integración con el sistema del negocio (Supabase/Next.js) para llamadas en caliente a leads con capital (> 10.000 USD).

**Metodología: spec-driven.** La documentación en `docs/` es la fuente de verdad: los cambios de requisitos se editan primero en `docs/`, luego se implementan.

## Documentación (leer en este orden)

| Archivo | Qué es | Cuándo leerlo |
|---|---|---|
| `docs/00-OVERVIEW.md` | Objetivo, flujo de negocio, decisiones tomadas, stack, estado | Siempre, primero |
| `docs/01-reunion-integracion.md` | Síntesis de la reunión con el negocio (Miled + Berni): arquitectura, tracking, decisiones | Antes de tocar arquitectura/integración |
| `docs/02-audio-berni-requisitos.md` | Ideas de Berni (audio WhatsApp): qué preguntar y por qué, ganchos del diagnóstico | Al diseñar preguntas/prompt IA |
| `docs/03-especificacion.md` | Spec técnico: JSON, wizard, motor IA, integración, tracking | Antes de escribir código |
| `docs/04-design-system.md` | Colores, tipografía, componentes — fuente de verdad visual | Antes de tocar UI |
| `docs/05-prototipo.md` | Qué hace el prototipo actual y su camino a "quitar mock" | Migrar/implementar |
| `docs/06-pendientes-y-preguntas.md` | Bloqueantes, próximas acciones, roadmap, métricas | Al planear sprints |
| `docs/07-scm-gestion-configuracion.md` | Nombrado de archivos, estructura del repo, branches, formato de commits, prácticas | Antes de cualquier commit/PR |
| `docs/08-roadmap.md` | Modelo de trabajo (Supabase local + Docker, migrations, feature branches, PRs) y fases de implementación | Al planear/implementar cualquier fase |

Fuentes primarias (si hace falta el detalle crudo): `Transcripcion_Reunion.md` y `transcripcion_audio.md` en la raíz.

## Decisiones firmes (no re-abrir)

- **Integración por código** con el stack del negocio (Supabase + Next.js, branch + PR). Go High Level fue evaluado y descartado; queda solo como CRM/agendas del negocio.
- **Sin IA**: clasificación de leads y diagnóstico **determinísticos** por algoritmo (las respuestas son todas de opción múltiple).
- Tracking mínimo: la métrica clave es **hasta qué pregunta llega el lead** (si termina el cuestionario o no).
- **Final del flujo (TBD)**: aún no se sabe si el diagnóstico se muestra en el HTML de la página o si se toca un botón de "enviar mensaje por WhatsApp"; tampoco las preguntas. Se construye la estructura de forma que al tenerlas solo haya que cambiar la última parte y las preguntas.
- Lead caliente = capital **> 10.000 USD** → llamada de triaje.

## Estructura del repo

```
index.html            # Prototipo actual: landing + wizard + diagnóstico (JS reglas, sin IA aún)
docs/                 # Documentación viva del proyecto (varios .md — ver tabla arriba)
referencia/
  landings/           # Landings existentes del negocio = design system a replicar (docs/04)
  chat-replicar-*.json # Export de conversación ChatGPT con decisiones tempranas del prototipo
scripts/
  transcribe.py       # Utilidad: transcribe audios con Whisper → docs/*_transcript.md
```

## Convenciones

- Español para textos de UI y documentación; inglés para código.
- Design system fijo (colores/tipografía): ver `docs/04-design-system.md` — no inventar colores nuevos.
- El prototype `index.html` es desechable; el producto real se define en `docs/03-especificacion.md`.
- El prototipo refleja el comportamiento objetivo del diagnóstico (tono, secciones, ganchos) — consérvalo como referencia al migrar a IA.
