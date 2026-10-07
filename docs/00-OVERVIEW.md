# Overview del Proyecto

**Proyecto:** Lead magnet "Diagnóstico de Portfolio" para **Metacrypto Club** (negocio de Berni Pérez, cripto).

**Última actualización:** 22-sep-2026

## Objetivo

Herramienta de captación de leads (lead magnet / quiz funnel): una landing con un wizard de preguntas → el lead responde → recibe un **diagnóstico personalizado de su portfolio cripto generado con un algoritmo determinístico** (todas las respuestas son de opción múltiple) → deja sus datos de contacto al final → los datos entran al sistema del negocio → si es lead caliente (capital ≥ 10.000 USD, desde 10.000 inclusive), un triaje lo llama **en caliente**.

## El flujo de negocio (punta a punta)

1. Berni publica en Instagram (orgánico, primero): *"comenta 'X' y te mando la herramienta"*.
2. El lead abre el link → **app pública del funnel** (`apps/funnel/`, instancia/dominio propios — decisión D2). Landing + wizard, sin login.
3. El wizard hace 8 preguntas definitivas (situación, dolor, composición, capital, horizonte, reacción a caídas, influencias y reglas). **Datos de contacto al final**.
4. Al terminar → pantalla de análisis → **pantalla final única**: diagnóstico por pantalla + sección "tus recursos" con **3 videos placeholders** (la pregunta 2 determina cuál se destaca) + CTA a WhatsApp con las respuestas precargadas. Sin descarga visible de PDF; la entrega por email queda para una iteración posterior.
5. Cada interacción envía un evento (`started / progress / dropped / completed`) a `POST /api/lead` del funnel → RPC transaccional `registrar_diagnostico` con el rol mínimo `funnel` (migración `0069`) → persistencia en Supabase (contrato versionado, `docs/11` §5).
6. Desde el módulo privado `/leads` (permiso `leads`), el triaje ve los recorridos, y post-venta: **vincula** el lead al cliente definitivo (auditado, con rollback exacto) o **descarta** el lead si no hubo venta.
7. Lead caliente (capital ≥ 10.000 USD) → alerta al triaje → llamada rápida.
8. Tracking mínimo: **hasta qué pregunta llega el lead** (dropoff / finalización). UTMs capturadas automáticamente.

## Decisiones ya tomadas (no re-abrir)

| Tema | Decisión |
|---|---|
| Integración | ~~Go High Level~~ → **código propio integrado en su stack: Supabase + Next.js** (branch + PR). GHL queda solo como CRM/agendas |
| **D2 — Despliegue del funnel** (06-oct) | **App pública aparte** (`apps/funnel/`, su propio dominio/instancia), comunicada a la base por el RPC con rol mínimo `funnel`. El OS NO expone rutas públicas: `/quiz` y `/api/lead` se retiraron de su app. Motivo: aislar la superficie pública del sistema con login del equipo |
| Clasificación/diagnóstico | ~~IA~~ → **determinístico por algoritmo** (respuestas todas de opción múltiple) |
| Preguntas | **8 preguntas definitivas de Berni**, config-driven; la pregunta 3 captura composición por rangos |
| Final del flujo | **Pantalla final única**: diagnóstico + 3 videos; la pregunta 2 determina cuál se destaca. Pendiente: grabar los videos reales |
| Tracking | Mínimo: **hasta qué pregunta llega el lead**. Puede ampliarse luego |
| Lead caliente | Capital **≥ 10.000 USD** (desde 10.000 inclusive) → llamada de triaje rápida |
| Contacto y CTA | Nombre + email + teléfono al final; CTA a WhatsApp `+54 9 3585 401429` con las respuestas precargadas |
| PDF transitorio | Documento HTML y generador conservados como base técnica, sin descarga visible |
| Lanzamiento | Primero orgánico (testeo), si funciona → publicidad |

## Stack del negocio (donde integramos)

- **Supabase** — base de datos (backend del sistema de gestión propio del negocio)
- **Next.js** — frontend del sistema (el funnel es una app propia separada que habla con el mismo Supabase)
- **Go High Level (GHL)** — CRM: agendas, conversión, atribución de llamadas
- **Resend** — envío de correos
- **Kapso** — WhatsApp API oficial
- **Fathom** — grabación/análisis de llamadas de venta
- Meta (Instagram) para el lanzamiento orgánico

## Estado actual (06-oct-2026)

**La herramienta es doble app sobre el mismo Supabase** (`metacrypto-os-app/`): `apps/funnel` (pública, wizard + `/api/lead`, rol mínimo) + `apps/inbox` (OS del equipo, módulo `/leads`). Rama: `fix/quiz-leads-auditoria-v5`, ambas validated con compuertas completas:

- ✅ **Módulo consolidado**: el histórico de migraciones `0068–0073` (auditorías v3/v4/v5 — nunca llegó a producción) quedó consolidado en la migración principal `0068_quiz_leads.sql` (tablas + RPCs + RLS/grants + definición del quiz, sin maquinaria de compatibilidad histórica ni código muerto, verificada con `supabase db reset` desde cero) **más dos migraciones de la misma iteración**: `0069_funnel_db_role.sql` (rol mínimo `funnel` de la app pública) y `0070_auditoria_lead_del_envio.sql` (lookup SQL nativo del QA E2E). El paquete de control es: **0068 + 0069 + 0070**
- ✅ Correcciones de auditorías integradas en el estado final: capital sellado desde la definición publicada, consentimiento canónico (`contacto-v1`), versiones del quiz inmutables al publicar, lock canónico de contacto ÚNICO para todo el ciclo comercial, rollback estricto sin éxito parcial, RLS cerrada (sin policies, grants solo `service_role`), tracking con IDs canónicos, coherencia país/prefijo del teléfono en el RPC
- ✅ Seguridad del funnel: rate limit (best-effort por instancia; el distribuido es del operador), same-origin, honeypot, body cap (413 temprano), Content-Type (415), errores honestos, logs sin PII, auditorías del módulo sin teléfonos, headers de seguridad globales **+ separación de instancia: la superficie pública ya no comparte app ni cookies con el login del OS, y su llave es de privilegio mínimo (solo ingesta)**
- ✅ Compuertas en verde del commit actual: funnel **5 suites (68 tests) + inbox 55 suites (incl. RPC + leads) todas en verde, cero omitidos** · `tsc` limpio · `eslint` 0 errores · `next build` OK en ambas apps
- ✅ **Aislamiento verificado**: el rol `funnel` puede registrar recorridos y leer la definición publicada, y NO puede leer envíos/personas ni ejecutar vincular/descartar (403, probado con el JWT real)
- 🟡 **Pendiente para el GO**: videos de Berni (URL definitiva) + url del funnel + operativo en producción según `docs/18` (backup, migraciones 0068+0069+0070, env, rate limit distribuido WAF/Upstash, smoke test)
- 🎫 **Tickets del OS** (preexistentes, ajenos a nuestro módulo — `docs/13` §4): webhook fail-closed, SSRF de media, autorización por módulo en las APIs del inbox, revocación de sesión, rate limit del login, CSP/frames, alta de `postcss` (exige Next 16)
- ❌ Ya no aplica: deploy del funnel en Netlify (decisión D1 de `docs/11`); la transferencia viaja por `release/funnel-leads.patch` (25 archivos, migraciones 0068–0070 incluidas, verificado con `git apply --check` contra el baseline del OS)

## Mapa de esta documentación

Ver el índice completo en [`docs/README.md`](README.md). Documentación jubilada (reunión, audio, MVP standalone, prototipo): `../docs-obsoletos/`.
