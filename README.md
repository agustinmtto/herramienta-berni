# Herramienta de Diagnóstico — Metacrypto Club

Lead magnet para el negocio de Berni (Metacrypto Club, cripto): landing con wizard de preguntas → diagnóstico de portfolio generado con IA → captura de lead → integración con el sistema del negocio para llamadas en caliente a leads con capital > 10.000 USD.

## Estado actual (sept 2026)

- ✅ **Prototipo funcional** en `index.html`: landing + wizard (9 preguntas) + pantalla de análisis + diagnóstico generado con reglas JS (mock, sin IA)
- ✅ **Reunión de integración realizada** con Miled y Berni: decisión de integrar por **código** (Supabase + Next.js del negocio, branch + PR); Go High Level descartado como integración (queda solo como CRM/agendas)
- ✅ **Documentación completa** en `docs/` (espec-driven)
- ⏳ **Pendiente crítico:** Berni define las preguntas finales (enfoque psicológico) — bloquea el JSON y la IA
- ⏳ Motor de reglas a reemplazar por **Claude via API del negocio**; umbral de lead caliente a alinear (10.000 USD, prototipo usa 25k mock)

## Documentación

| Doc | Contenido |
|---|---|
| `docs/00-OVERVIEW.md` | Objetivo, flujo de negocio, decisiones, stack, estado |
| `docs/01-reunion-integracion.md` | Reunión con el negocio: arquitectura, tracking, decisiones |
| `docs/02-audio-berni-requisitos.md` | Requisitos de Berni: qué preguntar y por qué, ganchos |
| `docs/03-especificacion.md` | Spec técnica: JSON, wizard, motor IA, integración, tracking |
| `docs/04-design-system.md` | Colores (oro/negro), tipografía, componentes |
| `docs/05-prototipo.md` | Qué hace `index.html` y su camino a producción |
| `docs/06-pendientes-y-preguntas.md` | Bloqueantes, roadmap, métricas |
| `docs/07-scm-gestion-configuracion.md` | Nombrado, branches, commits, prácticas |

## Estructura

```
index.html            # Prototipo actual (referencia, descartable como código)
docs/                 # Documentación viva del proyecto
referencia/
  landings/           # Landings del negocio = design system a replicar
  chat-replicar-*.json# Decisiones tempranas del prototipo (ChatGPT)
scripts/
  transcribe.py       # Transcribe audios con Whisper
```

## Cómo empezar

1. Leer `AGENTS.md` (índice + decisiones firmes) y `docs/00-OVERVIEW.md`.
2. Para implementar: `docs/03-especificacion.md`. Para UI: `docs/04-design-system.md`.
3. Siempre trabajar en branch sobre el repo del negocio — ver `docs/07-scm-gestion-configuracion.md`.

Documento educativo; no constituye asesoramiento financiero personalizado.
