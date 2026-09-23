# Overview del Proyecto

**Proyecto:** Lead magnet "Diagnóstico de Portfolio" para **Metacrypto Club** (negocio de Berni Pérez, cripto).

**Última actualización:** 22-sep-2026

## Objetivo

Herramienta de captación de leads (lead magnet / quiz funnel): una landing con un wizard de preguntas → el lead responde → recibe un **diagnóstico personalizado de su portfolio cripto generado con un algoritmo determinístico** (todas las respuestas son de opción múltiple) → deja sus datos de contacto al final → los datos entran al sistema del negocio → si es lead caliente (capital ≥ 10.000 USD, desde 10.000 inclusive), un triaje lo llama **en caliente**.

## El flujo de negocio (punta a punta)

1. Berni publica en Instagram (orgánico, primero): *"comenta 'X' y te mando la herramienta"*.
2. El lead abre el link → **ruta pública `/quiz` del OS** (landing + wizard, sin login).
3. El wizard hace 8 preguntas definitivas (situación, dolor, composición, capital, horizonte, reacción a caídas, influencias y reglas). **Datos de contacto al final**.
4. Al terminar → pantalla de análisis → **pantalla final única**: diagnóstico por pantalla + sección "tus recursos" con **3 videos placeholders** (la pregunta 2 determina cuál se destaca) + CTA a WhatsApp con las respuestas precargadas. Sin descarga visible de PDF; la entrega por email queda para una iteración posterior.
5. Cada interacción envía un evento (`started / progress / dropped / completed`) a `POST /api/lead` del OS → RPC transaccional `registrar_diagnostico` → persistencia en Supabase (contrato versionado, `docs/11` §5).
6. Desde el módulo privado `/leads` (permiso `leads`), el triaje ve los recorridos, y post-venta: **vincula** el lead al cliente definitivo (auditado, con rollback exacto) o **descarta** el lead si no hubo venta.
7. Lead caliente (capital ≥ 10.000 USD) → alerta al triaje → llamada rápida.
8. Tracking mínimo: **hasta qué pregunta llega el lead** (dropoff / finalización). UTMs capturadas automáticamente.

## Decisiones ya tomadas (no re-abrir)

| Tema | Decisión |
|---|---|
| Integración | ~~Go High Level~~ → **código propio integrado en su stack: Supabase + Next.js** (branch + PR). GHL queda solo como CRM/agendas |
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
- **Next.js** — frontend del sistema (el funnel vive DENTRO de esa app, como ruta pública)
- **Go High Level (GHL)** — CRM: agendas, conversión, atribución de llamadas
- **Resend** — envío de correos
- **Kapso** — WhatsApp API oficial
- **Fathom** — grabación/análisis de llamadas de venta
- Meta (Instagram) para el lanzamiento orgánico

## Estado actual (22-sep-2026)

**La herramienta vive dentro del OS del negocio** (`metacrypto-os-app/`, ruta pública `/quiz` + módulo privado `/leads`). Rama de trabajo: `feature/leads-a-migracion-rpc`, implementación completa y validada:

- ✅ **Fases 0–C cerradas y Fase D cierre local** (ver `docs/12` §6): migraciones `0068`/`0069`/`0070`/`0071` (la 0071 es de reconciliación: garantiza el estado final sobre cualquier base), RPC transaccional, vinculación post-venta con validación de teléfono, rollback estricto auditado, descarte del lead sin venta, funnel portado con el contrato versionado, endpoint endurecido, módulo `/leads` completo
- ✅ Correcciones de las tres auditorías externas integradas: capital sellado desde la definición publicada, consentimiento canónico (`contacto-v1`), versiones del quiz inmutables al publicar, lock canónico de contacto, rollback estricto sin éxito parcial, RLS cerrada (policies genéricas eliminadas, grants solo `service_role`), tracking con IDs canónicos, rotación de sesión, cross-check país/prefijo
- ✅ Seguridad del funnel: rate limit, same-origin, honeypot, body cap (413 temprano), Content-Type (415), errores honestos, logs sin PII, headers de seguridad globales (nosniff/HSTS/etc.), Next actualizado (fuera las 2 RCE críticas)
- ✅ Suite del OS: **1.329 tests en verde (0 omitidos)** · `tsc` limpio · `eslint` compuerta (0 errores) · build OK · prototipo standalone 39/39
- 🟡 **Pendiente externo (Miled + negocio)**: confirmar números de migración `0068-0071`, permiso `leads`, `KAPSO_WEBHOOK_SECRET` en prod, hosting/rate limit/WAF definitivo, orden de despliegue (`0068 → 0069 → 0070 → 0071 → código → smoke test`). Todo listado con las frases exactas en `docs/13`
- 🎫 **Tickets del OS** (preexistentes, ajenos a nuestro módulo — `docs/13` §4): webhook fail-closed, SSRF de media, autorización por módulo en las APIs del inbox, revocación de sesión, rate limit del login, CSP/frames, alta de `postcss` (exige Next 16)
- ❌ Ya no aplica: deploy del funnel en Netlify (decisión D1 de `docs/11` — el funnel va dentro del OS)

## Mapa de esta documentación

Ver el índice completo en [`docs/README.md`](README.md). Documentación jubilada (reunión, audio, MVP standalone, prototipo): `../docs-obsoletos/`.
