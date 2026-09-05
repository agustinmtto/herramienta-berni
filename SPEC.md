# SPEC — Herramienta de Diagnóstico de Portfolio Cripto ("Horse Magnet")

**Versión:** 0.1 (borrador para revisión)
**Fecha:** 2026-09-04
**Fuentes:** video de referencia (Nico Azero, "Horse Magnet") + `transcripcion_audio.md` (requisitos del negocio)
**Estado:** PENDIENTE DE APROBACIÓN — no escribir código hasta cerrar las preguntas abiertas (§11)

---

## 1. Visión y objetivo

Herramienta de captación (lead magnet interactivo) para un **negocio de asesoría/formación en inversión cripto**. El lead responde un cuestionario sobre su situación inversora y recibe, al instante en pantalla, un **diagnóstico personalizado de su portfolio generado con IA**, con la calidad percibida de una consultoría de 2.000€.

**Objetivos de negocio (por orden de prioridad):**

1. **Identificar leads con capital** — saber exactamente cuánto dinero tiene disponible cada persona. A quien declare capital alto (p. ej. ≥ umbral definido) se le contacta directamente por WhatsApp/teléfono.
2. **Dar valor real** — el diagnóstico no puede ser basura genérica; el lead debe sentir que valió la pena dar sus datos.
3. **Generar urgencia comercial** — el diagnóstico empuja (especialmente a quien tiene liquidez parada) hacia la llamada/venta.

**Filosofía (del audio):** "Al final lo que yo quiero saber es la cantidad total de capital. Lo que me pongan en el diagnóstico me da absolutamente igual… pero le tiene que valer la pena."

## 2. Alcance

### In scope (v1)
- Landing single-page con asistente de diagnóstico (formulario wizard, una pregunta por pantalla).
- Generación de diagnóstico personalizado con Claude API (Anthropic) mostrado **en pantalla**.
- Captura de datos del lead (nombre, teléfono, email) al **final** del cuestionario, justo antes de generar el diagnóstico.
- Envío de las respuestas + contacto a Formspree (almacenamiento de leads).
- Video regalo genérico embebido en la pantalla de resultados.
- Despliegue: Cloudflare Pages (estático) + Cloudflare Worker (proxy de la API key).
- Documento paso a paso de despliegue para el equipo.

### Out of scope (v1)
- Envío automático del diagnóstico por email (v1 = en pantalla + email guardado en Formspree; el envío de email con el video se hace manual o con la automatización nativa de Formspree → evaluar en v2).
- Scoring automático de leads / notificación instantánea de "lead caliente" (v2: webhook a Discord/Telegram cuando capital ≥ umbral).
- Panel de administración, analytics propio, A/B testing.
- Multi-idioma (v1: solo español).
- Réplicas para otros nichos ("si funciona lo replicamos con otros") — se diseña parametrizable, pero la v1 solo incluye el nicho cripto.

## 3. Usuarios y flujo

### 3.1 El lead (usuario final)
1. Llega a la landing desde un CTA (historias de Instagram / ads).
2. Ve propuesta de valor: diagnóstico personalizado gratuito de su portfolio cripto.
3. Responde el wizard (preguntas de una en una, con barra/indicador de progreso).
4. En la última pantalla del formulario deja **nombre, teléfono y email** ("¿Dónde te enviamos el diagnóstico completo?").
5. Ve pantalla de carga ("Estamos analizando tu caso…" con pasos de progreso).
6. Recibe en pantalla el **diagnóstico personalizado** + video regalo + CTA final (agendar llamada / escribir por WhatsApp).

### 3.2 El equipo (negocio)
- Recibe cada lead en Formspree (submissions) con todas las respuestas + contacto.
- Revisa submissions, filtra por capital declarado, contacta a los leads calientes.

## 4. Requisitos funcionales

### RF-1 — Landing / Hero
- Diseño oscuro premium (ver §8, pendiente de assets de marca).
- Headline orientada a resultado + subheadline que deje claro que es un diagnóstico personalizado con IA.
- CTA principal que inicia el wizard.
- Texto de transparencia junto al formulario: "Respondemos con un diagnóstico real generado en base a tus respuestas. Tus datos están seguros."
- Duración percibida: "Menos de 2 minutos".

### RF-2 — Wizard de preguntas (orden propuesto)
Las preguntas van **antes** que los datos de contacto. Orden propuesto (a validar en §11):

| # | Pregunta | Tipo | Opciones / formato |
|---|----------|------|--------------------|
| 1 | ¿Cuánto capital tienes **invertido actualmente** en cripto? | Opción única (rangos) | < 1.000$ / 1.000–5.000 / 5.000–25.000 / 25.000–100.000 / > 100.000$ |
| 2 | ¿Cuánto dinero tienes **disponible en efectivo/stablecoins** listo para invertir (dentro o fuera de exchanges)? | Opción única (rangos) | mismos rangos |
| 3 | ¿Qué aportación mensual podrías hacer de forma sostenida los próximos 12 meses? | Opción única (rangos) | 0 / < 500 / 500–2.000 / 2.000–10.000 / > 10.000$ |
| 4 | ¿Cuál es tu perfil de riesgo? | Opción única | Muy agresivo / Agresivo / Moderado / Conservador / Muy conservador |
| 5 | ¿Cuánta experiencia tienes invirtiendo en cripto? | Opción única | Ninguna (novato) / < 1 año / 1–3 años / > 3 años |
| 6 | Distribución de tu portfolio actual | Tabla de porcentajes | BTC __%, ETH __%, Stablecoins (USDT/USDC) __%, Otras altcoins __%, Sin invertir (fiat en cuenta) __%. Validación: suma = 100% (permitir 0 en todo = "aún no invierto"). |
| 7 | (Condicional: si altcoins > 0%) ¿En cuántas altcoins distintas estás invertido? | Opción única | 1–2 / 3–5 / 6–10 / Más de 10 |
| 8 | ¿Cuál es tu mayor preocupación ahora mismo con tus inversiones? | Texto libre (opcional, 280 caracteres) | — |
| 9 | Datos de contacto | Formulario final | Nombre*, Teléfono (WhatsApp)*, Email* + checkbox de consentimiento (privacidad) |

**Reglas:**
- Las preguntas 1–3 son las críticas de negocio (capital total disponible). No se pueden saltar.
- Progreso visible: "Pregunta X de Y".
- Se puede volver atrás.
- RF-2 nota: los rangos exactos de capital son configurables (constante en el HTML) para ajustarlos sin tocar lógica.

### RF-3 — Pantalla de análisis
- Al enviar: animación de progreso con pasos ("Analizando tu perfil de riesgo…", "Cruzando la composición de tu portfolio…", "Detectando desajustes…", "Generando tu plan de acción…").
- Duración: la real de la llamada a la API (mínimo ~3s para que la animación tenga sentido).
- Gestión de errores: si la API falla, mensaje amable + botón reintentar + el lead ya está guardado en Formspree (el envío a Formspree ocurre **antes** de llamar a la IA).

### RF-4 — Diagnóstico generado (output)
Estructura fija del diagnóstico (el prompt del sistema fuerza estas secciones):

1. **Tu situación real, {nombre}** — resumen con sus números: capital invertido, liquidez, aportación mensual, % por activo. Espejo de lo que declaró.
2. **El desajuste principal** — conflicto entre su perfil de riesgo declarado y su portfolio real (ej: "te defines conservador pero tienes 60% en altcoins"; "tienes 10 altcoins distintas: eso no es diversificar, es dispersar"; "mitad ETH mitad XRP no es una estrategia, es una apuesta").
3. **El coste de la liquidez parada** — si tiene efectivo/stablecoins relevante: cuantificar lo que deja de ganar ("tienes el 40% en dólares parados: tu mayor riesgo no es el mercado, es quedarte fuera"). *Esta sección es el gancho comercial principal: es más fácil vender a quien tiene liquidez.*
4. **Tu plan de acción (próximos pasos)** — 3–4 acciones concretas y personalizadas según su caso (novato vs experimentado; perfil; composición).
5. **CTA** — agendar llamada / WhatsApp + video regalo.

**Tono:** directo, experto, con números concretos, sin humo. Nunca consejo financiero vinculante: incluir disclaimer ("Esto no es asesoramiento financiero").

**Límites:** respuesta máx. ~600 palabras; formato HTML seguro (secciones con encabezados) o Markdown renderizado con sanitización.

### RF-5 — Captura de lead
- POST a Formspree con: todas las respuestas del wizard + nombre + teléfono + email + timestamp + (opcional) el diagnóstico generado, para tener todo junto en submissions.
- Checkbox de consentimiento obligatorio.

### RF-6 — Video regalo
- Embebido en pantalla de resultados (YouTube no listado o similar). Placeholder en v1 hasta tener la URL del video real.

## 5. Arquitectura técnica

Replica del stack del video (todo gratis o casi gratis):

```
Lead → [Cloudflare Pages: index.html estático]
            │
            ├─→ POST Formspree (lead + respuestas)         [gratis ≤50 envíos/mes]
            │
            └─→ POST Cloudflare Worker (proxy)
                        │  Authorization: ANTHROPIC_API_KEY (secret, no expuesta al cliente)
                        └─→ Claude API (Anthropic)          [~0,03€ por diagnóstico]
```

**Componentes:**

| Componente | Tecnología | Notas |
|---|---|---|
| `index.html` | HTML + CSS + JS vanilla, sin build, un solo archivo | Wizard, llamada a Formspree, llamada al Worker, render del diagnóstico. Sin frameworks: lo puede editar cualquiera con ayuda de IA. |
| Cloudflare Worker | JS (fetch handler) | Recibe las respuestas del wizard, construye el prompt, llama a `api.anthropic.com` (modelo: Claude Haiku/Sonnet — a decidir §11), devuelve el diagnóstico. API key en *Variables & Secrets* (`ANTHROPIC_API_KEY`). CORS restringido al dominio de Pages. |
| Formspree | form endpoint | Almacén de leads. Notificación por email nativa. |
| Hosting | Cloudflare Pages | Deploy por drag & drop de carpeta con `index.html` (como en el video). |

**Decisiones técnicas clave:**
- Sin backend propio, sin base de datos: Formspree es la "base de datos" de leads.
- La API key de Anthropic **nunca** vive en el HTML: solo en el Worker (secret).
- El prompt del sistema vive en el Worker (editable allí), no en el cliente.
- Modelo recomendado para v1: **Claude Haiku 4.5** (rápido, ~céntimos por diagnóstico); evaluar Sonnet si la calidad no convence.

## 6. Prompt del sistema (borrador — pieza crítica)

Contenido conceptual que llevará el system prompt del Worker:

> Eres un asesor senior de inversión en criptoactivos con 10 años de experiencia. Recibes las respuestas de un lead a un cuestionario (capital invertido, liquidez disponible, aportación mensual, perfil de riesgo, experiencia, distribución del portfolio, nº de altcoins, preocupación principal).
>
> Generas un diagnóstico en español, directo y con números concretos, con EXACTAMENTE estas secciones: [RF-4 §1–5]. Reglas:
> - Usa los números que el lead declaró; calcula ratios y contradicciones reales.
> - Señala el desajuste entre perfil declarado y portfolio real.
> - Si tiene liquidez parada ≥ 20% o ≥ X$, cuantifica el coste de oportunidad y genera urgencia honesta.
> - Si es novato (experiencia = ninguna), simplifica y prioriza educación + primer paso seguro.
> - Si tiene > 5 altcoins, explícale por qué eso es dispersión, no diversificación.
> - Máximo 600 palabras. Nada de promesas de rentabilidad. Cierra con CTA a agendar llamada.
> - Incluye disclaimer: no es asesoramiento financiero.

## 7. Requisitos no funcionales

- **Coste objetivo v1:** ~0€ fijos + ~0,03€/diagnóstico (API). Formspree gratis ≤ 50 leads/mes (si se supera: plan pago ~10$/mes o migración).
- **Rendimiento:** página estática < 100 KB, diagnóstico visible < 15 s tras enviar.
- **Móvil primero:** el tráfico viene de Instagram.
- **Privacidad/legal:** checkbox de consentimiento + enlace a política de privacidad (pendiente texto legal del equipo). RGPD: los datos se usan para contacto comercial.
- **Mantenibilidad:** rangos de capital, textos y prompt parametrizables en constantes claras al inicio del archivo.

## 8. Branding — Sistema de diseño (extraído de las landings existentes)

**Marca:** Metacrypto Club · "Invierte con Berni"
**Referencia:** `el_error_despues_de_perderte_bitcoin.html` y `bitcoin_rompio_el_guion.html` (mismo design system). La herramienta debe verse como una pieza más de este ecosistema.

### Paleta
| Token | Valor | Uso |
|---|---|---|
| `--gold` | `#E1CA71` | Acento principal: eyebrows, índices, números, CTA, bordes activos |
| `--gold-soft` | `#c9b35e` | Variante dorada |
| `--gold-dim` | `rgba(225,202,113,.16)` | Fondos de acento (chips, callouts) |
| `--gold-line` | `rgba(225,202,113,.28)` | Bordes y divisores |
| `--ink` / `--ink-2` | `#000000` / `#0a0a0a` | Fondo base (negro puro) |
| `--panel` | `#0d0d0d` | Paneles/tarjetas (gradiente a `#070707`) |
| `--red` | `#FF4D4D` | Riesgo, errores, warnings |
| `--green` | `#52d273` | Aciertos, highlights positivos |
| `--text` | `#f3f0e6` | Texto principal (blanco cálido) |
| `--text-dim` | `#9b988f` | Texto secundario |
| `--text-faint` | `#65635c` | Metadatos, captions |

### Tipografía (Google Fonts)
- **Display/titulares:** `Oswald` (700, uppercase, letter-spacing amplio en eyebrows `.42em`). Titulares con gradiente dorado: `linear-gradient(180deg,#f6ecbf,var(--gold) 45%,#a8893b)` con `background-clip:text`.
- **Cuerpo:** `Sora` (400–600).
- **Mono (datos/técnicos):** `JetBrains Mono` (labels, métricas, pasos de progreso).

### Patrones de composición a reutilizar
- Hero: `radial-gradient(ellipse 64% 52% at 50% 20%, rgba(225,202,113,.12), transparent 70%)` sobre negro.
- Eyebrow: `METACRYPTO CLUB · DIAGNÓSTICO DE PORTFOLIO`.
- Chips con borde dorado, tarjetas `panel` con borde `#1c1b17` y hover con borde dorado, callouts con borde izquierdo de 3px (gold/red/green).
- Secciones numeradas con índice `.idx` (01, 02…), separadores de línea dorada con fade horizontal.
- Animación de entrada `rise` (translateY 22px → 0, staggered), respetar `prefers-reduced-motion`.
- Footer con disclaimer: "Documento educativo · No constituye asesoramiento financiero personalizado."

### Aplicación a la herramienta
- **Wizard:** una pregunta por pantalla, opciones como tarjetas con borde `#1c1b17` que se iluminan en dorado al seleccionar; progreso en mono (`PREGUNTA 03 / 09`).
- **Pantalla de análisis:** pasos con check mono y estados en dorado (mismo lenguaje que `.metric` / `.idx`).
- **Diagnóstico:** secciones con `.sec-head` + callouts: desajuste principal en rojo (warning), coste de liquidez en dorado (callout), plan de acción en verde (highlight).

## 9. Métricas de éxito (cómo sabremos que funciona)

- Tasa de conversión landing → formulario completado.
- Nº de leads/mes (objetivo inicial: llenar los 50 gratis de Formspree).
- Nº de leads con capital declarado ≥ umbral (leads calientes).
- Nº de contactos efectuados / llamadas agendadas desde leads calientes.
- Feedback cualitativo: ¿el diagnóstico "vale la pena" o parece basura?

## 10. Plan de implementación (cuando se apruebe el spec)

1. **Paso 0 — Setup de cuentas (equipo, guiado por doc):** Anthropic Console (API key + cargar 5$), Formspree (form + endpoint), Cloudflare (cuenta).
2. **Paso 1 — `index.html`:** landing + wizard + análisis + resultados (con URLs placeholder).
3. **Paso 2 — `worker.js`:** proxy con prompt del sistema.
4. **Paso 3 — Conectar:** pegar endpoint Formspree y URL del Worker en el HTML.
5. **Paso 4 — Deploy:** Worker (edit code + secret + deploy), Pages (carpeta con index.html).
6. **Paso 5 — Test end-to-end** con 3 perfiles de prueba: novato conservador con cash, experimentado agresivo con dispersión de altcoins, lead caliente > 100k.
7. **Paso 6 — Ajuste de prompt** con los resultados del test + branding final + URL del video regalo.
8. **Paso 7 — Lanzamiento:** CTA desde historias. Revisar submissions a los 7 días y decidir réplica a otros nichos.

Entregables: `index.html`, `worker/worker.js`, `DEPLOY.md` (paso a paso con capturas), `SPEC.md` (este documento).

## 11. Preguntas abiertas (bloquean el código)

1. **Rangos de capital:** ¿validas los rangos de RF-2 (preguntas 1–3)? ¿Cuál es el **umbral de "lead caliente"** que dispara contacto directo (p. ej. ≥ 25.000$ disponibles)?
2. **Pregunta de experiencia (novato vs experimentado):** el audio menciona que para experimentados "ya lo tenemos más de la mano" y que hay que ver qué tal funciona para novatos. ¿El diagnóstico debe diferenciar ambos caminos (p. ej. novatos → CTA a formación; experimentados → CTA a llamada)? ¿O un solo CTA para todos?
3. **Modelo de IA:** ¿Haiku (rápido/barato) o Sonnet (mejor redacción)? Propongo empezar con Haiku y comparar.
4. **Email con el diagnóstico:** ¿v1 solo en pantalla y el email lo gestiona el equipo manualmente, o activamos el autoresponder de Formspree con enlace al video?
5. ~~Branding~~ ✅ Resuelto: design system de Metacrypto Club (ver §8).
6. **Video regalo:** ¿ya existe (URL) o es placeholder hasta grabarlo?
7. **CTA final:** ¿link a Calendly/agenda o a WhatsApp directo? ¿Número/cuenta?
8. **Legal:** las landings existentes ya usan el footer "METACRYPTO CLUB · Documento educativo · No constituye asesoramiento financiero personalizado." — ¿reutilizo ese disclaimer y añado checkbox de consentimiento genérico, o hay texto legal específico?
9. **Dominio:** ¿se usa subdominio propio (p. ej. diagnostico.metacryptoclub.com) o el `*.pages.dev` de Cloudflare para la v1?
10. **Nombre de la herramienta:** propongo eyebrow "METACRYPTO CLUB · DIAGNÓSTICO DE PORTFOLIO" y headline propio. ¿Validas o prefieres otro nombre (p. ej. "Auditoría Cripto")?

---

*Spec-driven development: este documento es la fuente de verdad. Cualquier cambio de requisitos se edita aquí primero, luego se implementa.*
