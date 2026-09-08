# Pendientes, bloqueos y próximas acciones

## Bloqueantes / abiertos

| # | Ítem | Impacto | Propietario | Estado |
|---|---|---|---|---|
| 1 | **Definir las preguntas finales** (psicológicas, orden, fricción) | BLOQUEA el JSON y la IA | Berni | Pendiente — prometió "en estos días" |
| 2 | **Formato JSON final** `pregunta/respuesta` | BLOQUEA la integración con Supabase | Equipo dev (con Berni las preguntas) | Boceto en `03-especificacion.md` |
| 3 | ~~Validar branch de Supabase como entorno dev~~ | Resuelto en `docs/08` §1.1: se descarta la branch de Supabase (cobra compute); se usa **Supabase local (CLI + Docker)** con migrations | Agustín / Miled | ✅ Cerrado |
| 4 | **Módulo de leads dentro del sistema del negocio** (nueva entrada menú lateral, reporte filtrable) — ¿lo hacemos nosotros o lo hacen ellos? | Duda abierta | Por definir con Miled |
| 5 | Benchmark del **quiz funnel de Ramiro** (grabar pantalla, extraer preguntas/flujo) | Alimenta diseño de preguntas | Lisandro | Por confirmar si se hizo |
| 6 | Host de videos + embed trackeable (duración vista) | Requiere definir player (Loom/u otro con eventos) | Miled / dev | Abierto |
| 7 | **PRD** que pidió Miled para arrancar la implementación conjunta | Seco para construir juntos | Agustín/Lisandro | Pendiente — este documento de `docs/` sirve de insumo |
| 8 | Umbral lead caliente confirmado en 10.000 USD (prototipo usa 25k mock) | Ajustar CONFIG + backend | Equipo dev | Pendiente |
| 9 | Videos segmentados de Berni (3–4 por rango de capital) | Dependencia de contenido | Berni | Pendiente |
| 10 | Entorno dev/producción dentro del negocio (hoy solo producción + local) | Coordinar branch/PR | Miled | Acordado armarlo |

## Roadmap

El roadmap vivo (modelo de trabajo + fases) está en **`docs/08-roadmap.md`** — es la referencia autoritativa. El esbozo original a continuación se conserva como contexto:

**Fase 1 — Infraestructura de captación (sin IA):**
Sustituir el índice del prototipo por aplicación real (Next.js o estático deployado según convenga con el repo del negocio) y el tracking completo (session_id, tiempos por pregunta, dropoffs, UTMs). JSON → Supabase (branch dev).

**Fase 2 — IA:**
Reemplazar el motor determinístico por Claude (API del negocio): prompt con tono/ganchos obligatorios (ver `03-especificacion.md` §4), salida estructurada para pantalla y para el PDF.

**Fase 3 — Entrega y triaje:**
PDF por email (Resend + tracking de apertura), video en thank-you page según capital, notificaciones de lead caliente al triaje, integración del módulo de leads con PR.

**Fase 4 — Testeo/experimentación:**
Primeros 1,5–2 meses = testing en orgánico. A/B de formatos (largo vs. pop-up de continuación, orden de preguntas). Con data: automatizaciones de outreach y cadencias.

## Métricas a trackear desde el día 1 (requisito del negocio)

- % de finalización del wizard y **qué pregunta** causa el abandono.
- Tiempo por pregunta / sesión total.
- Origen de la sesión (UTM) → del link que reparte Berni en Instagram.
- Email del PDF: apertura y cliqueo.
- Video: % visto y duración.
- Leads calientes: llamados por el triaje y tiempo de reacción.
- CTA final: clicks hacia la agenda de llamada.
