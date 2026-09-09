# Pendientes, bloqueos y próximas acciones

## Bloqueantes / abiertos

| # | Ítem | Impacto | Propietario | Estado |
|---|---|---|---|---|
| 1 | **Definir las preguntas finales** (psicológicas, orden, fricción) | BLOQUEA el JSON y el motor determinístico definitivo | Berni | Pendiente — prometió "en estos días" |
| 2 | **Formato JSON final** `pregunta/respuesta` | BLOQUEA la integración con Supabase | Equipo dev (con Berni las preguntas) | Boceto en `03-especificacion.md` |
| 3 | ~~Validar branch de Supabase como entorno dev~~ | Resuelto en `docs/08` §1.1: se descarta la branch de Supabase (cobra compute); se usa **Supabase local (CLI + Docker)** con migrations | Agustín / Miled | ✅ Cerrado |
| 4 | **Módulo de leads dentro del sistema del negocio** (nueva entrada menú lateral, reporte filtrable) — ¿lo hacemos nosotros o lo hacen ellos? | Duda abierta | Por definir con Miled |
| 5 | Benchmark del **quiz funnel de Ramiro** (grabar pantalla, extraer preguntas/flujo) | Alimenta diseño de preguntas | Lisandro | Por confirmar si se hizo |
| 6 | Host de videos + embed trackeable (duración vista) | Requiere definir player (Loom/u otro con eventos) | Miled / dev | Abierto |
| 7 | **PRD** que pidió Miled para arrancar la implementación conjunta | Seco para construir juntos | Agustín/Lisandro | Pendiente — este documento de `docs/` sirve de insumo |
| 8 | Umbral lead caliente confirmado en 10.000 USD (prototipo usa 25k mock) | Ajustar CONFIG + backend | Equipo dev | Pendiente |
| 9 | Videos segmentados de Berni (3–4 por rango de capital) | Dependencia de contenido (si se mantiene el video — depende del final del flujo, ver #11) | Berni | Pendiente |
| 10 | Entorno dev/producción dentro del negocio (hoy solo producción + local) | Coordinar branch/PR | Miled | Acordado armarlo |
| 11 | ~~Decidir el final del flujo~~ → **Resuelto**: pantalla final de video (una pregunta determina cuál de 3 videos se muestra: 2 genéricos + 1 variable por la respuesta del usuario) | Sub-pendientes: definir la pregunta de segmentación, grabar los videos, host del player | Berni / Miled | Parcialmente resuelto |

## Roadmap

El roadmap vivo (modelo de trabajo + fases) está en **`docs/08-roadmap.md`** — es la referencia autoritativa. El esbozo original a continuación se conserva como contexto:

**Fase 1 — Infraestructura de captación:**
Sustituir el índice del prototipo por aplicación real (Next.js o estático deployado según convenga con el repo del negocio) y el tracking mínimo (session_id + hasta qué pregunta llega el lead / dropoff). JSON → Supabase (branch dev).

**Fase 2 — Motor determinístico definitivo:**
Migrar la lógica de diagnóstico (reglas/algoritmo sobre las respuestas, todas de opción múltiple) al producto real; el prototipo define tono y estructura (ver `03-especificacion.md` §4), salida estructurada para pantalla y para el PDF.

**Fase 3 — Entrega y triaje:**
Implementar la pantalla final de video (bloqueante #11 resuelto: 3 videos, 2 genéricos + 1 variable según pregunta final); notificaciones de lead caliente al triaje, integración del módulo de leads con PR.

**Fase 4 — Testeo/experimentación:**
Primeros 1,5–2 meses = testing en orgánico. A/B de formatos (largo vs. pop-up de continuación, orden de preguntas). Con data: automatizaciones de outreach y cadencias.

## Métricas a trackear desde el día 1

- **Métrica clave (mínimo requerido): hasta qué pregunta llega el lead** — % de finalización y en qué pregunta abandona si no termina.
- Sesión identificable vía `session_id` (reproducible y ampliable a futuro).

Métricas de la pantalla final (según host/player que se defina):
- Video: % visto y duración (opcional, según bloqueante #6).
- CTA final: clicks hacia la agenda de llamada / botón de WhatsApp.
- Leads calientes: llamados por el triaje y tiempo de reacción.
