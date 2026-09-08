# Overview del Proyecto

**Proyecto:** Lead magnet "Diagnóstico de Portfolio" para **Metacrypto Club** (negocio de Berni Pérez, cripto).

**Fecha de documentación:** Septiembre 2026

## Objetivo

Herramienta de captación de leads (lead magnet / quiz funnel): una landing con un wizard de preguntas → el lead responde → recibe un **diagnóstico personalizado de su portfolio cripto** generado con IA → el lead deja sus datos de contacto → los datos entran al sistema del negocio → si es lead caliente (capital > 10.000 USD), un triaje lo llama **en caliente**.

## El flujo de negocio (punta a punta)

1. Berni publica en Instagram (orgánico, primero): *"comenta 'X' y te mando la herramienta"*.
2. El lead abre el link de la herramienta → landing + wizard.
3. El wizard hace preguntas (capital, perfil de riesgo, portfolio, miedos...). **Datos de contacto al final** (decisión clave).
4. Al terminar → pantalla de análisis → diagnóstico por pantalla + **video de Berni personalizado según el capital** (en la thank-you page) + **PDF por email**.
5. Las respuestas llegan como **JSON agnóstico** (`pregunta/respuesta`) a la base del negocio.
6. Lead caliente (capital > 10.000 USD) → alerta al triaje → llamada rápida.
7. Tracking completo: UTMs, tiempo por pregunta, abandono, apertura de emails, visualización del video.

## Decisiones ya tomadas (reunión con el negocio)

| Tema | Decisión |
|---|---|
| Integración | ~~Go High Level~~ → **código propio integrado en su stack: Supabase + GitHub** (branch + PR). Fue la decisión final pese a que en la reunión se evaluó GHL |
| IA | Se usa la **API propia del negocio** (Anthropic/Claude). El diagnóstico ya NO es determinístico |
| Preguntas | Las define **Berni** (enfoque psicológico: generar duda / vacío de conocimiento). Aún no definidas |
| Datos de contacto | Al **final** del wizard, como requisito para recibir el diagnóstico |
| Diagnóstico | **PDF por email** + **video en thank-you page** según segmento de capital |
| Lead caliente | Capital **> 10.000 USD** → llamada de triaje rápida |
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

- ✅ Prototipo funcional en `index.html` (landing + wizard + diagnóstico mock con reglas JS, sin IA)
- ✅ Design system extraído de landings del negocio
- ✅ Reunión de integración realizada (ver `01-reunion-integracion.md`)
- ⏳ Pendiente: preguntas de Berni → JSON final, entorno dev en Supabase, PRD para Miled

## Mapa de esta documentación

| Archivo | Contenido |
|---|---|
| `00-OVERVIEW.md` | Este archivo: objetivo, flujo, decisiones, stack, estado |
| `01-reunion-integracion.md` | Síntesis de la reunión con Miled/Berni (decisión de arquitectura) |
| `02-audio-berni-requisitos.md` | Ideas de Berni del audio de WhatsApp (qué preguntas y por qué) |
| `03-especificacion.md` | Especificación técnica del producto: pantallas, datos, wireflow |
| `04-design-system.md` | Colores, tipografía, componentes (fuente de verdad visual) |
| `05-prototipo.md` | Descripción del prototipo `index.html` y cómo migrarlo |
| `06-pendientes-y-preguntas.md` | Todo lo que falta definir + acciones de cada persona |
| `07-scm-gestion-configuracion.md` | Nombrado, estructura del repo, branches, commits |
| `08-roadmap.md` | Modelo de trabajo (Supabase local + Docker, migrations, PRs) y fases de implementación |
