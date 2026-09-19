# Especificación técnica (v1 — integración con Supabase)

Versión unificada a partir del prototipo + decisiones de la reunión. Los cambios de requisitos se empiezan editando aquí.

## 1. Alcance

- Landing + wizard de preguntas + pantalla "analizando" + resultado (diagnóstico) → **front propio**, diseñado con el design system de Metacrypto (§04).
- Al finalizar el wizard:
  - `POST` de **JSON agnóstico** a la API del negocio (Supabase + Next.js en su repo, vía branch/PR).
  - Diagnóstico mostrado por pantalla, generado por **algoritmo determinístico** (mismo enfoque que `buildDiagnosis` del prototipo: reglas sobre las respuestas, todas de opción múltiple).
  - **Pantalla final de video**: la pregunta 2 (principal dificultad actual) determina qué video se destaca. Hay **3 videos en total: dos genéricos + uno destacado según la respuesta del usuario**, sin agregar una pregunta de segmentación fuera del cuestionario definitivo.
- Tracking: **mínimo requerido — hasta qué pregunta llega el lead** (si termina el cuestionario o no). Lo demás (UTMs, tiempos) es opcional/ampliable.
- Contacto: nombre, email y **teléfono obligatorios** al final del wizard, además del consentimiento.
- CTA final: abre WhatsApp al número del negocio (`+54 9 3585 401429`) con el nombre y todas las respuestas del lead precargadas en el mensaje.
- El PDF no se ofrece en la experiencia visible. Se conservan el documento HTML y el generador existentes como base técnica para una iteración posterior por email.

## 2. Formato de datos

Principio acordado: JSON **agnóstico**, registros `pregunta / respuesta`. La composición conserva el contrato textual y serializa los cuatro rangos en una sola respuesta legible:

```json
{
  "session_id": "uuid",
  "source": {"utm_source": "...", "utm_medium": "...", "utm_campaign": "..."},
  "lead": {"name": "...", "phone": "...", "email": "...", "consent": true},
  "signals": {"total_seconds": 0, "dropoff_question": null, "started_at": "...", "finished_at": "..."},
  "answers": [
    {"pregunta": "¿Cuánto capital tienes invertido...", "respuesta": "25.000 – 100.000 $"},
    {"pregunta": "¿Cómo se distribuye tu portfolio hoy?", "respuesta": "BTC: 25-50% · ETH: 10-25% · ALT: 10-25% · USD: 1-10%"}
  ]
}
```

Campos derivados que el triaje necesita ver: capital total, capital disponible, aportación mensual, perfil de riesgo, composición, nº de altcoins, preocupación declarada.

## 3. Orden y contenido del wizard

Las preguntas definitivas de Berni, en orden, son:

1. Situación actual con las criptomonedas.
2. Principal dificultad actual.
3. Distribución del portfolio: BTC, ETH, altcoins y stablecoins, cada bloque mediante los rangos `0%`, `1-10%`, `10-25%`, `25-50%`, `50-75%` y `75-100%`.
4. Capital actual o previsto para el ciclo.
5. Horizonte temporal.
6. Reacción ante una caída del 30% causada por una noticia negativa.
7. Principal influencia sobre las decisiones de inversión.
8. Existencia y cumplimiento de reglas para aumentar, reducir o cerrar posiciones.

Después de la pregunta 8 se solicitan nombre, email, teléfono y consentimiento. No se agregan preguntas de negocio antes ni después del contacto.

Restricciones de experiencia:
1. Conocer la situación (capital, portfolio, riesgo) **sin** fricción ni pedir datos.
2. Preguntas que hagan relucir dolor / vacíos de conocimiento (gancho para la llamada).
3. Datos de contacto **al final siempre**, como requisito para recibir el diagnóstico.
4. Antes de la primera pregunta debe quedar claro que se obtiene un diagnóstico personalizado del portfolio en menos de 3 minutos.
5. Evitar mostrar el número total de preguntas. La barra psicológica avanza rápido al comienzo, llega aproximadamente al 50% después de las primeras tres respuestas, desacelera en el medio y está cerca del final al llegar a la pregunta 7.
6. Mostrar mensajes contextuales como "Casi terminamos" y "Última pregunta" sin revelar el total.
7. Una pregunta por pantalla, controles táctiles grandes y composición evaluada primero en teléfono.
8. Las opciones simples confirman visualmente la selección y avanzan tras una pausa breve. La composición del portfolio requiere completar sus cuatro rangos y continuar de forma explícita.
9. Posibles experimentos: versión corta con pop-up de continuación vs. versión larga (test A/B futuro).

## 4. Motor de diagnóstico (determinístico, sin IA)

- **No hay IA.** El diagnóstico se genera con un **algoritmo determinístico** sobre las respuestas (todas de opción múltiple). El `buildDiagnosis` del prototipo es la base y define el tono/estructura objetivo.
- El cualquier caso, tono, secciones y ganchos obligatorios del diagnóstico (derivados del audio + prototipo):
  1. "Tu situación real" — espejar las respuestas con números.
  2. "El desajuste principal" — perfil declarado vs. exposición real / dispersión de altcoins.
  3. "El coste de tu liquidez parada" — riesgo de "quedarse fuera" (gancho prioritario).
  4. "Tu plan de acción" — pasos concretos numerados.
  5. Cierre + **pantalla final de video**: un espacio de video cuya selección depende de la pregunta 2. Mapeo config-driven: principal dificultad → video. Ver §9.
- Detectar **lead caliente** mediante la respuesta de capital. Como las opciones son rangos, la regla operativa marca desde `$10k-25k` en adelante; no intenta inferir una cifra exacta dentro del rango.

## 5. Integración con el sistema del negocio

- Repo del negocio (Next.js + Supabase): incorporar la herramienta como **módulo nuevo** (entrada en menú lateral con reporte de leads filtrable), trabajo en **branch** → PR.
- Entorno dev: Supabase local (CLI + Docker) con migrations (decidido en `docs/08` §1.1).
- Leads con flag caliente → notificación al triaje.

## 6. Tracking (mínimo requerido)

- **Métrica clave: hasta qué pregunta llega el lead** — si termina el cuestionario o en cuál abandona (`dropoff_question`). Los identificadores estables son `start`, `q1`…`q8`, `contact`, `analysis` y `result`; no dependen del copy visible.
- El cliente conserva también el recorrido acumulado de etapas y lo incluye en el envío final o en el beacon de abandono. Mientras el endpoint siga sin persistencia, estos hitos se registran como metadatos no sensibles en logs y no constituyen todavía un reporte histórico durable.
- Opcional/ampliable a futuro: UTMs, tiempo por pregunta, aperturas de email, video. No es requisito de lanzamiento.
- Sesión identificable vía `session_id` (permite reproducir y ampliar tracking después).

## 7. Legal / compliance

- Consentimiento explícito para recibir diagnóstico y comunicaciones; opción de baja.
- El consentimiento debe contemplar el contacto por email, teléfono y WhatsApp.
- Disclaimer: "documento educativo, no constituye asesoramiento financiero personalizado".

## 8. Fuera de alcance (ya validado)

- No se integra con Go High Level vía webhook (fue evaluado y descartado en favor de la integración con código).
- No se construye un nuevo sistema de CRM; se integra en el que existe.

## 9. Pantalla final (implementado en MVP)

- Es la **última pantalla** del flujo, y es **única**: diagnóstico + videos en la misma página (referencia visual: el caso de la Screencap con "tu problema principal" + "plan de acción" + "tus recursos para resolverlo").
- La **pregunta 2** determina qué video se destaca mediante un mapeo config-driven (2 genéricos + 1 destacado según la respuesta).
- El diagnóstico se muestra en secciones: problema principal (callout), coste de la liquidez parada, plan de acción numerado, métrica norte, y grid de 3 video-cards (placeholder 16:9, mapeo opción→video **config-driven** en `lib/question-config.js`).
- El cierre ofrece valor antes que conversación comercial: "Tengo un video donde te explico cómo solucionaría exactamente el principal problema que detecté en tu portfolio. Te lo mando por WhatsApp." El botón dice "Recibir mi video por WhatsApp".
- El enlace usa `wa.me/5493585401429` y un mensaje generado en cliente con el nombre, las respuestas del wizard y el video solicitado. Email y teléfono no se repiten dentro del mensaje.
- Mobile-first: a partir de 640 px hacia abajo, CTA a ancho completo, videos en una columna, controles táctiles de al menos 44 px y contenido sin desbordes desde 320 px.

### 9.1 Documento HTML y PDF del diagnóstico (transitorio)

- **Esta etapa:** componente HTML semántico, breve y con el design system de Metacrypto. Su contenido es fijo para todos los perfiles y solo personaliza el nombre del lead.
- `lib/pdf.js` captura exclusivamente ese documento con jsPDF + html2canvas y genera un PDF A4, independiente del ancho del teléfono.
- No hay botón de descarga en la pantalla final. El documento HTML y el generador quedan conservados, pero no se montan ni se cargan durante el flujo.
- **Después:** convertir el documento en un diagnóstico completamente personalizado y enviarlo por email vía **Resend** del negocio con tracking de apertura.
