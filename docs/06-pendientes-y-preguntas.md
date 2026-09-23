# Pendientes, bloqueos y próximas acciones

## Bloqueantes / abiertos

| # | Ítem | Impacto | Propietario | Estado |
|---|---|---|---|---|
| 1 | ~~**Definir las preguntas finales** (psicológicas, orden, fricción)~~ | Desbloquea el JSON y el motor determinístico definitivo | Berni | ✅ Cerrado — 8 preguntas recibidas en orden; composición visual en la pregunta 3 |
| 2 | ~~**Formato JSON final y modelo de tablas**~~ | Cerrado: contrato versionado, respuestas genéricas y tres tablas nuevas en `docs/11` | Agustín | ✅ Cerrado |
| 3 | ~~Validar branch de Supabase como entorno dev~~ | Resuelto en `docs/08` §1.1: se descarta la branch de Supabase (cobra compute); se usa **Supabase local (CLI + Docker)** con migrations | Agustín / Miled | ✅ Cerrado |
| 4 | ~~**Módulo de leads dentro del sistema del negocio**~~ | Cerrado: lo implementa nuestro equipo (`docs/11` D7) | Nuestro equipo | ✅ Cerrado |
| 5 | Benchmark del **quiz funnel de Ramiro** (grabar pantalla, extraer preguntas/flujo) | Alimenta diseño de preguntas | Lisandro | Por confirmar si se hizo |
| 6 | Host de videos + embed trackeable (duración vista) | Requiere definir player (Loom/u otro con eventos) | Miled / dev | Abierto |
| 7 | **PRD** que pidió Miled para arrancar la implementación conjunta | Seco para construir juntos | Agustín/Lisandro | Pendiente — este documento de `docs/` sirve de insumo |
| 8 | ~~Umbral lead caliente~~: desde 10.000 USD inclusive; rangos 2-6 | Cerrado en `docs/11`: cálculo server-side por `answer_id` | Equipo dev | ✅ Cerrado |
| 9 | Videos segmentados de Berni (3–4 por rango de capital) | Dependencia de contenido (si se mantiene el video — depende del final del flujo, ver #11) | Berni | Pendiente |
| 10 | Entorno dev/producción dentro del negocio (hoy solo producción + local) | Coordinar branch/PR | Miled | Acordado armarlo |
| 11 | ~~Decidir el final del flujo~~ → **Resuelto**: pantalla final única con diagnóstico + 3 videos; la pregunta 2 determina cuál se destaca | Sub-pendientes: grabar los videos reales, host del player | Berni / Miled | Parcialmente resuelto |
| 12 | **PDF personalizado por email (producción)**: existen el documento y generador base, sin descarga visible; falta la versión dinámica, Resend del negocio + pixel de apertura | Entrega definitiva del diagnóstico | Miled / Equipo dev | Pendiente — depende de Fase 0 (accesos) |
| 13 | ~~**Teléfono + CTA WhatsApp**~~: teléfono obligatorio y mensaje con respuestas; el botón PDF transitorio fue retirado | Entrega transitoria solicitada para el MVP | Equipo dev | ✅ Cerrado |
| 14 | **Hosting final** (Vercel o Netlify) para producción | Define rate limiting real (reemplazando el in-memory best-effort de `lib/rate-limit.js`) y configuración de headers/HSTS | Agustín / Miled | Abierto |
| 15 | **Rate limiting "real"** (Upstash/Redis o WAF del hosting) reemplazando el in-memory | Anti-abuso del endpoint público | Equipo dev | Pendiente de #14 — call site en `lib/rate-limit.js` ya aislado |
| 16 | ~~**Ámbito de seguridad con integraciones**~~ | Implementado para el módulo de leads: RLS day 1, service_role solo server, IDOR cubierto, SQLi parametrizado — checklist verificado en `docs/09` §Quiz Funnel en el OS | Equipo dev | ✅ Cerrado (Fase D local) |
| 17 | ~~**Upgrade de Next** para cerrar las vulnerabilidades de prod deps~~ → fusionado con #20 | Cerrar `npm audit --omit=dev` en 0 en ambos repos | Equipo dev | 🟡 Fusionado con #20 (críticas cerradas; queda postcss vía Next 16) |
| 18 | ~~**Retención de datos de leads**~~ | Sin vencimiento por decisión de negocio; mantener capacidad futura de eliminación/anonimización | Berni / Equipo dev | ✅ Cerrado |
| 19 | ~~**Número de migración**~~ | Asignados `0068_quiz_leads.sql`, `0069_vinculacion_validacion_rollback.sql`, `0070_descarte_leads.sql` y `0071_reconciliacion_leads.sql` - **falta confirmación formal con Miled antes del release** | Miled | 🟡 Confirmación pendiente |
| 20 | **Upgrade de Next del OS (bloqueante de prod)**: ~~1 RCE crítica en `next`~~ **RESUELTO en el PR de leads: lockfile a `15.5.25` — las 2 RCE críticas y las altas de `nanoid`/`sharp` quedaron cerradas**. Queda la alta de `postcss` cuya solución exige Next 16 (cambio mayor, ticket aparte) y las correcciones de seguridad preexistentes del OS (`docs/13` §4) | Cerrar `npm audit --omit=dev` en 0 | Miled / Equipo dev | 🟡 Parcial: críticas cerradas; Next 16 pendiente |

## Preguntas para Miled (cierre Fase D — bloqueantes de producción)

1. **Hosting del OS**: ¿dónde está desplegado hoy el OS en producción (Vercel, otro)? ¿Qué plan tiene? ¿El host ofrece WAF / rate limiting en el borde?
2. **Rate limit definitivo**: ¿habilitamos Upstash Redis (requiere cuenta + token del negocio) o confiamos en el rate limiting del host? El endpoint público `/api/lead` hoy usa in-memory 10/min por IP (configurable con `LEAD_RATE_LIMIT_MAX` / `LEAD_RATE_LIMIT_WINDOW_MS`).
3. **Números de migración**: confirmar que `0068` y `0069` no fueron reclamados por otra rama antes del release.
4. **Permiso `leads`**: ¿quién del equipo lo recibe (Berni, Miled, closers)? Se asigna por `team_members.modulos`.
5. **Orden de despliegue**: aplicar `0068` + `0069` a producción ANTES de deployar el código (sin eso, PostgREST responde 400 en silencio).
6. **Variables de entorno en prod**: no se agregan claves nuevas; verificar que el deploy tenga `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y `AUTH_TOKEN` (ya usadas por el OS). Opcionales: `LEAD_RATE_LIMIT_*`.
7. **Upgrade de Next** (bloqueante #20): las 2 RCE críticas ya quedaron cerradas en este PR (lockfile `15.5.25`). Queda la alta de `postcss` — ¿se aprueba el salto a Next 16 como ticket aparte?
8. **HTTPS/HSTS**: verificar que el host fuerce HTTPS y configure HSTS al exponer `/quiz`.

## Roadmap

El roadmap vivo (modelo de trabajo + fases) está en **`docs/08-roadmap.md`** — es la referencia autoritativa. El esbozo original a continuación se conserva como contexto:

**Fase 1 — Infraestructura de captación** *(en `feature/wizard-mvp`; MVP hecho, falta Supabase real):*
App Next.js (Netlify) con wizard config-driven + tracking mínimo (session_id + dropoff por sendBeacon). JSON → stub `POST /api/lead` con validación (Supabase del negocio cuando estén los accesos). Merge del PR #1, deploy.

**Fase 2 — Motor determinístico definitivo:**
Migrar la lógica de diagnóstico (reglas/algoritmo sobre las respuestas, todas de opción múltiple) al producto real; el prototipo define tono y estructura (ver `03-especificacion.md` §4), salida estructurada para pantalla y para el PDF.

**Fase 3 — Entrega y triaje:**
Implementar la pantalla final de video (bloqueante #11 resuelto: 3 videos, 2 genéricos + 1 variable según pregunta final); CTA de WhatsApp con respuestas precargadas; PDF base; notificaciones de lead caliente al triaje e integración del módulo de leads con PR.

**Fase 4 — Testeo/experimentación:**
Primeros 1,5–2 meses = testing en orgánico. A/B de formatos (largo vs. pop-up de continuación, orden de preguntas). Con data: automatizaciones de outreach y cadencias.

## Métricas a trackear desde el día 1

- **Métrica clave (mínimo requerido): hasta qué pregunta llega el lead** — % de finalización y en qué pregunta abandona si no termina.
- Sesión identificable vía `session_id` (reproducible y ampliable a futuro).

Métricas de la pantalla final (según host/player que se defina):
- Video: % visto y duración (opcional, según bloqueante #6).
- CTA final: clicks hacia la agenda de llamada / botón de WhatsApp.
- Leads calientes: llamados por el triaje y tiempo de reacción.

## Decisiones técnicas cerradas para la integración

- Especificación autoritativa: `docs/11-migracion-modulo-leads.md`.
- El contrato usa `schema_version` para la API y `quiz_version` para las preguntas/reglas.
- Las preguntas y opciones viven en `quiz_versiones.definicion jsonb`; cambiar preguntas no cambia tablas.
- La primera finalización de un contacto crea una fila en `personas` con `estado='lead'`; quizzes posteriores del mismo contacto reutilizan solo ese lead a través de los envíos del módulo.
- Nunca se busca, reutiliza ni modifica una persona cliente u otro registro ajeno al módulo, aunque tenga el mismo email o teléfono.
- Debido al `UNIQUE` existente de `personas.telefono_e164`, el teléfono del funnel se conserva en `diagnostico_envios.telefono_e164_capturado` y la fila nueva de persona usa teléfono `NULL`.
- No existen `resolucion_identidad` ni `necesita_revision`.
- Se crean únicamente `quiz_versiones`, `diagnostico_envios` y `diagnostico_respuestas`, con FKs desde las tablas nuevas.
- La atribución se captura automáticamente desde la URL; todos los campos UTM son nullable.
- El diagnóstico mostrado se persiste como snapshot JSON para conservar el resultado histórico.
- Primera versión: `diagnostico-cripto-v1-a`; consentimiento: `contacto-v1`.
- Lead caliente desde USD 10.000 inclusive.
- El teléfono se captura con selector de país/prefijo y se normaliza a E.164.
- La primera entrega persiste `started`, `progress`, `dropped` y `completed`.
- La conversión se vincula después de registrar la venta existente: se reasignan diagnósticos al cliente y se archiva el lead temporal.
- El módulo usa una clave de permiso propia `leads`.
- La migración asignada es `0068_quiz_leads.sql`.
- La alerta de triaje queda fuera de la primera migración.

## Estado para comenzar

La especificación de migración, contrato, identidad, conversión, tracking y módulo está cerrada en `docs/11`. Hay luz verde para comenzar las fases A-C en desarrollo local.

Pendientes que no bloquean el desarrollo:

- Videos y hosting del player.
- Hosting final y rate limiting distribuido.
- Upgrade a Next 16.
- Alertas de triaje.
- PDF y envío por email.
