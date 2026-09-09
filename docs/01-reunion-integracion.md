# Reunión de Integración (Miled + Berni + equipo dev)

Fuente: `Transcripcion_Reunion.md` (transcripción completa en la raíz del repo).

Participantes: **Berni Pérez** (dueño del negocio), **Miled Gassibe** (cerebro técnico/operativo del negocio), **Lisandro Pecchenino** y **Agustín Maretto** (equipo que desarrolla la herramienta).

> **Nota posterior a la reunión:** transcripción fiel de lo hablado. Décisiones posteriores: diagnóstico determinístico sin IA, tracking limitado a la métrica mínima (hasta qué pregunta llega el lead) y **pantalla final de video** (3 videos: 2 genéricos + 1 variable según pregunta final). Las decisiones vigentes están en `docs/00-OVERVIEW.md` y `docs/03-especificacion.md`.

## 1. Alcance y flujo pactado

- La herramienta es un **workflow**, no un sistema aparte: los datos deben caer en la **misma base** que usa el negocio (evitar dos bases con problemas de integridad).
- El formulario recoge: capital, perfil de riesgo, portfolio, miedos/errores + nombre, teléfono y email **al final**.
- Al finalizar se envía **PDF con el diagnóstico por email** (posible también WhatsApp) y el lead ve un **video de Berni** según su perfil.
- **Lead caliente = capital > 10.000 USD** → aviso al triaje → llamada rápida. Se baraja 25.000 como umbral mock en el prototipo, pero la decisión hablada es **10.000**.

## 2. Decisión de arquitectura (la más importante)

Durante la reunión se evaluaron dos opciones:

- **Opción A — Go High Level:** mandar el JSON a un endpoint de GHL, campos custom, formularios/funnels de GHL. Miled lo ve viable (UTM tracking de emails automático) pero GHL es rígido con formularios, APIs y custom fields "jodidos".
- **Opción B — Código:** branch de **Supabase** + branch del repo **GitHub** del negocio, PR acotado, integrado como módulo nuevo en el sistema (entrada nueva en el menú lateral con reporte de leads filtrable).

**Decisión final (post-reunión, confirmada por el equipo): se hace TODO en código, integrado con su Supabase/GitHub.** GHL queda solo como CRM/agendas. Rationale: integrar con el sistema actual, no fragmentar datos, capacidad de automatizar outreach a futuro. (Ver notas iniciales de AGENTS.md, aggiornadas: se evaluó GHL y se pivoteó a código.)

Detalles logísticos de la opción B:
- Se discute hacer un **branch de la base en Supabase** como entorno de desarrollo; el negocio históricamente tiene solo producción + local → acordaron armar entorno dev.
- Cuidado: Supabase **cobra por compute usage** de branches → mantener el uso acotado.
- Flujo: desarrollar en branch → PR → revisan conflictos/arquitectura → merge → producción.

**Pendiente a validar:** si la branch de Supabase funciona como entorno de desarrollo real para testear con datos falsos sin tocar producción.

## 3. Stack del negocio (para integrar)

- Supabase (base) · Next.js (frontend) · Resend (emails) · Capso (WhatsApp API) · Go High Level (CRM/agendas/conversión) · Fathom (llamadas). Futuro: Instagram, Fathom integrado.

## 4. Requisitos de tracking (énfasis de Miled)

- Trazabilidad granular: **cada clic, cada respuesta, cada capa de abandono** ("hasta dónde llega la gente" — tipo UTM clicker).
- UTMs por fuente/acción, ID de sesión para reproducir la sesión del lead.
- Ver **cuánto tiempo ve el video** (embed medible, ej. Loom o player con eventos).
- Email del PDF con UTMs para saber si **abrió el mail** y si hizo clic.
- Cadencia/automatizaciones de outreach cuando haya data suficiente.
- **Experimentación:** Miled sugiere A/B tests (90/10 split, formato largo vs. pop-up "respondiste 3, ¿sigues?) para medir qué convierte mejor. Primeros 1,5–2 meses = testeos.

## 5. Diseño de preguntas (énfasis de Berni)

- Berni diseñará las preguntas (prometió sacarlas "en estos días") — **todavía no definidas**.
- Orden y fricción importan tanto como las preguntas: pedir datos al principio es un error; pedirlos **al final** ("para mandártelo, deja tus datos") dispara la conversión.
- Filosofía: hacer "relucir el dolor"/vacíos de conocimiento (ej. "¿Tienes un plan para el Clarity Act?") para que la persona acepte la llamada.
- Equilibrio valor/venta: útil incluso para quien no puede ser cliente (capital bajo), sin ser puro humo.
- Coherencia con el funnel de agenda del negocio (preguntas tipo "qué es lo que más buscas de nosotros" / "no sé si estoy llegando a tiempo").
- Benchmark: Lisandro debe entrar al **embudo/quiz de Ramiro** (y los que copió de Alex Hormozi), grabar pantalla, analizar el flujo. Berni capturará los "funnels" de los reels de Instagram (quieren el recurso del "comenta X y te lo mando").

## 6. Videos de regalo

- 3–4 videos genéricos de Berni segmentados por **rango de capital** (ej. solo a > 10.000 se le muestra el video "tengo un club, agenda acá").
- Video en la **thank-you page** (no en el email, para no meter fricción de descarga) con embed trackeable.
- Miled: la decisión de si se ve el video es **determinística** según capital.

## 7. Formato JSON (pendiente pero alineado)

- JSON **agnóstico** para su endpoint: estructura `pregunta / respuesta`.
- No se cierra el formato hasta que Berni defina las preguntas.
- Nosotros definimos el JSON → Miled crea los campos en su sistema / endpoint que espera ese JSON.
- Miled pidió un **PRD** escrito para arrancar con la implementación conjunta.

## 8. Action items (de la reunión)

**Miled:**
- Accesos a GHL (Lead Connector) para evaluar integraciones — ✅ hecho, pero como la decisión final fue código, es solo contexto.
- Coordinación directa con el equipo (grupo de WhatsApp).

**Lisandro:**
- Definir preguntas con Berni.
- Grabar pantalla del quiz funnel de Ramiro para benchmark. → **Verificar si se hizo; si no, es tarea pendiente.**

**Berni:**
- Definir las preguntas psicológicas del formulario. → **Pendiente crítico: bloquea el JSON y la integración.**
- Compartir recursos de funnels/reels.

**Agustín:**
- Revisar repo/estructura del sistema actual → rama de desarrollo.
- Recomendar envío video en página + PDF por mail (aprobado).
