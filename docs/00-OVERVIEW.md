# Overview del Proyecto

**Proyecto:** Lead magnet "Diagnóstico de Portfolio" para **Metacrypto Club** (negocio de Berni Pérez, cripto).

**Fecha de documentación:** Septiembre 2026

## Objetivo

Herramienta de captación de leads (lead magnet / quiz funnel): una landing con un wizard de preguntas → el lead responde → recibe un **diagnóstico personalizado de su portfolio cripto generado con un algoritmo determinístico** (todas las respuestas son de opción múltiple) → según cómo termina el flujo (TBD, ver abajo) el lead deja sus datos o contacta → los datos entran al sistema del negocio → si es lead caliente (capital > 10.000 USD), un triaje lo llama **en caliente**.

## El flujo de negocio (punta a punta)

1. Berni publica en Instagram (orgánico, primero): *"comenta 'X' y te mando la herramienta"*.
2. El lead abre el link de la herramienta → landing + wizard.
3. El wizard hace preguntas (capital, perfil de riesgo, portfolio, miedos...). **Datos de contacto al final** (decisión clave).
4. Al terminar → pantalla de análisis → **pantalla final única**: diagnóstico por pantalla + sección "tus recursos" con **3 videos placeholders** (2 genéricos + 1 variable según una pregunta de segmentación) + CTA a WhatsApp. El CTA abre una conversación con las respuestas precargadas. En esta etapa también se descarga un PDF base, igual para todos salvo por el nombre del lead; la personalización completa y el envío por email quedan para una iteración posterior.
5. Las respuestas llegan como **JSON agnóstico** (`pregunta/respuesta`) a la base del negocio.
6. Lead caliente (capital > 10.000 USD) → alerta al triaje → llamada rápida.
7. Tracking mínimo: **hasta qué pregunta llega el lead** (dropoff / finalización). UTMs opcional.

## Decisiones ya tomadas (reunión con el negocio)

| Tema | Decisión |
|---|---|
| Integración | ~~Go High Level~~ → **código propio integrado en su stack: Supabase + GitHub** (branch + PR). Fue la decisión final pese a que en la reunión se evaluó GHL |
| Clasificación/diagnóstico | ~~IA~~ → **determinístico por algoritmo** (respuestas todas de opción múltiple). El motor por reglas del prototipo es la base |
| Preguntas | Las define **Berni** (enfoque psicológico: generar duda / vacío de conocimiento). Aún no definidas — BLOQUEANTE principal |
| Final del flujo | **Pantalla final de video**: tras los datos, una pregunta determina cuál de los **3 videos** se muestra (2 genéricos + 1 variable según la respuesta del usuario). Pendiente: definir la pregunta de segmentación y grabar los videos |
| Tracking | Mínimo: **hasta qué pregunta llega el lead** (si termina el cuestionario o no). Puede ampliarse luego |
| Lead caliente | Capital **> 10.000 USD** → llamada de triaje rápida |
| Contacto y CTA | Nombre + email + teléfono al final; CTA a WhatsApp `+54 9 3585 401429` con las respuestas precargadas |
| PDF transitorio | Documento HTML breve y fijo, personalizado solo con el nombre del lead, descargable como PDF |
| Lanzamiento | Primero orgánico (testeo), si funciona → publicidad |

## Stack del negocio (donde integramos)

- **Supabase** — base de datos (backend del sistema de gestión propio)
- **Next.js** — frontend del sistema
- **Go High Level (GHL)** — CRM: agendas, conversión, atribución de llamadas (la venta se cierra fuera: Fathom + formulario de cierre en su sistema)
- **Resend** — envío de correos
- **Capso** — WhatsApp API oficial
- **Fathom** — grabación/análisis de llamadas de venta
- Meta (Instagram) eventualmente

## Estado actual

- **Prototipo funcional** en `prototipos/index.html` (landing + wizard + diagnóstico con reglas JS determinísticas — base del motor final)
- **App MVP funcionando** (Next.js en `feature/wizard-mvp`): wizard con preguntas genéricas config-driven, motor determinístico stub, JSON agnóstico → `POST /api/lead` (stub con validación), tracking de dropoff, pantalla final única diagnóstico+videos, PDF dev-only
- **Entrega WhatsApp en desarrollo** (`feature/whatsapp-delivery`): helper config-driven para mensaje y enlace `wa.me` con las respuestas del lead
- **Suite de tests** en `test/` (unit + integración, 17/17)
- ✅ Design system extraído de landings del negocio
- ✅ Reunión de integración realizada (ver `01-reunion-integracion.md`)
- ⏳ Pendiente: preguntas de Berni → swap en `lib/question-config.js`, acceso Supabase del negocio (Fase 0), deploy Netlify, PDF por email real, videos reales

## Mapa de esta documentación

| Archivo | Contenido |
|---|---|
| `00-OVERVIEW.md` | Este archivo: objetivo, flujo, decisiones, stack, estado |
| `01-reunion-integracion.md` | Síntesis de la reunión con Miled/Berni (decisión de arquitectura) |
| `02-audio-berni-requisitos.md` | Ideas de Berni del audio de WhatsApp (qué preguntas y por qué) |
| `03-especificacion.md` | Especificación técnica del producto: pantallas, datos, wireflow |
| `04-design-system.md` | Colores, tipografía, componentes (fuente de verdad visual) |
| `05-prototipo.md` | Descripción del prototipo `prototipos/index.html` y cómo migrarlo |
| `06-pendientes-y-preguntas.md` | Todo lo que falta definir + acciones de cada persona |
| `07-scm-gestion-configuracion.md` | Nombrado, estructura del repo, branches, commits |
| `08-roadmap.md` | Modelo de trabajo (Supabase local + Docker, migrations, PRs) y fases de implementación |
