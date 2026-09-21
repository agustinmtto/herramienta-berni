# Overview del Proyecto

**Proyecto:** Lead magnet "Diagnóstico de Portfolio" para **Metacrypto Club** (negocio de Berni Pérez, cripto).

**Fecha de documentación:** Septiembre 2026

## Objetivo

Herramienta de captación de leads (lead magnet / quiz funnel): una landing con un wizard de preguntas → el lead responde → recibe un **diagnóstico personalizado de su portfolio cripto generado con un algoritmo determinístico** (todas las respuestas son de opción múltiple) → según cómo termina el flujo (TBD, ver abajo) el lead deja sus datos o contacta → los datos entran al sistema del negocio → si es lead caliente (capital > 10.000 USD), un triaje lo llama **en caliente**.

## El flujo de negocio (punta a punta)

1. Berni publica en Instagram (orgánico, primero): *"comenta 'X' y te mando la herramienta"*.
2. El lead abre el link de la herramienta → landing + wizard.
3. El wizard hace 8 preguntas definitivas (situación, dolor, composición, capital, horizonte, reacción a caídas, influencias y reglas). **Datos de contacto al final** (decisión clave).
4. Al terminar → pantalla de análisis → **pantalla final única**: diagnóstico por pantalla + sección "tus recursos" con **3 videos placeholders** (la pregunta 2 determina cuál se destaca) + CTA a WhatsApp. El CTA abre una conversación con las respuestas precargadas. No hay descarga visible de PDF; la entrega personalizada por email queda para una iteración posterior.
5. Las respuestas llegan a la base del negocio vía el endpoint `POST /api/lead` del OS → RPC transaccional `registrar_diagnostico` (contrato versionado, `docs/11` §5).
6. Lead caliente (capital > 10.000 USD) → alerta al triaje → llamada rápida.
7. Tracking mínimo: **hasta qué pregunta llega el lead** (dropoff / finalización). UTMs opcional.

## Decisiones ya tomadas (reunión con el negocio)

| Tema | Decisión |
|---|---|
| Integración | ~~Go High Level~~ → **código propio integrado en su stack: Supabase + GitHub** (branch + PR). Fue la decisión final pese a que en la reunión se evaluó GHL |
| Clasificación/diagnóstico | ~~IA~~ → **determinístico por algoritmo** (respuestas todas de opción múltiple). El motor por reglas del prototipo es la base |
| Preguntas | **8 preguntas definitivas de Berni**, config-driven; la pregunta 3 captura composición por rangos |
| Final del flujo | **Pantalla final única**: diagnóstico + 3 videos; la pregunta 2 determina cuál se destaca. Pendiente: grabar los videos reales |
| Tracking | Mínimo: **hasta qué pregunta llega el lead** (si termina el cuestionario o no). Puede ampliarse luego |
| Lead caliente | Capital **> 10.000 USD** → llamada de triaje rápida |
| Contacto y CTA | Nombre + email + teléfono al final; CTA a WhatsApp `+54 9 3585 401429` con las respuestas precargadas |
| PDF transitorio | Documento HTML y generador conservados como base técnica, sin descarga visible |
| Lanzamiento | Primero orgánico (testeo), si funciona → publicidad |

## Stack del negocio (donde integramos)

- **Supabase** — base de datos (backend del sistema de gestión propio)
- **Next.js** — frontend del sistema
- **Go High Level (GHL)** — CRM: agendas, conversión, atribución de llamadas (la venta se cierra fuera: Fathom + formulario de cierre en su sistema)
- **Resend** — envío de correos
- **Capso** — WhatsApp API oficial
- **Fathom** — grabación/análisis de llamadas de venta
- Meta (Instagram) eventualmente

## Estado actual (septiembre 2026)

**La herramienta vive dentro del OS del negocio** (`metacrypto-os-app/`, ruta pública `/quiz` + módulo privado `/leads`). La migración está implementada y validada en local, rama `feature/leads-a-migracion-rpc`:

- ✅ **Fases 0–C cerradas y Fase D cierre local** (ver `docs/12` §6): migraciones `0068`/`0069` aplicadas, RPC transaccional `registrar_diagnostico`, vinculación post-venta con validación de teléfono y rollback auditado, funnel portado con eventos `started/progress/dropped/completed`, endpoint endurecido, módulo `/leads` con permiso propio
- ✅ Suite del OS: 1.304 tests en verde · `tsc` limpio
- ✅ Persistencia real en Supabase (ya no hay stub: el JSON agnóstico de la etapa MVP fue reemplazado por el contrato versionado de `docs/11` §5)
- 🟡 Pendiente externo (Miled + negocio): hosting/rate limit definitivo, confirmación formal de números de migración, permiso `leads`, orden de despliegue, upgrade de Next (RCE crítica, bloqueante #20), videos reales, alerta de triaje, PDF por email (Resend)
- ❌ Ya no aplica: deploy en Netlify del funnel (decisión D1 de `docs/11` — el funnel va dentro del OS)

## Mapa de esta documentación

| Archivo | Contenido |
|---|---|
| `00-OVERVIEW.md` | Este archivo: objetivo, flujo, decisiones, stack, estado |
| `01-reunion-integracion.md` | Síntesis de la reunión con Miled/Berni (decisión de arquitectura) |
| `02-audio-berni-requisitos.md` | Ideas de Berni del audio de WhatsApp (qué preguntas y por qué) |
| `03-especificacion.md` | Especificación técnica del MVP standalone (histórica — la spec vigente de la integración es `docs/11`) |
| `04-design-system.md` | Colores, tipografía, componentes (fuente de verdad visual) |
| `05-prototipo.md` | Descripción del prototipo `prototipos/index.html` y cómo migrarlo |
| `06-pendientes-y-preguntas.md` | Todo lo que falta definir + acciones de cada persona |
| `07-scm-gestion-configuracion.md` | Nombrado, estructura del repo, branches, commits |
| `08-roadmap.md` | Modelo de trabajo (Supabase local + Docker, migrations, PRs) y fases de implementación |
| `09-security.md` | Checklist de seguridad pre-producción |
| `10-levantar-metacrypto-os-local.md` | Guía para levantar MetaCrypto OS + Supabase local |
| `11-migracion-modulo-leads.md` | **Spec funcional autoritativa de la migración del módulo de leads** |
| `12-spec-sdd-fases-migracion-leads.md` | Fases SDD con compuertas de validación y estado |
