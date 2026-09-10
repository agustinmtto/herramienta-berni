# Especificación técnica (v1 — integración con Supabase)

Versión unificada a partir del prototipo + decisiones de la reunión. Los cambios de requisitos se empiezan editando aquí.

## 1. Alcance

- Landing + wizard de preguntas + pantalla "analizando" + resultado (diagnóstico) → **front propio**, diseñado con el design system de Metacrypto (§04).
- Al finalizar el wizard:
  - `POST` de **JSON agnóstico** a la API del negocio (Supabase + Next.js en su repo, vía branch/PR).
  - Diagnóstico mostrado por pantalla, generado por **algoritmo determinístico** (mismo enfoque que `buildDiagnosis` del prototipo: reglas sobre las respuestas, todas de opción múltiple).
  - **Pantalla final de video**: después de los datos de contacto, una pregunta determina qué video se muestra (opción 1 → video 1, opción 2 → video 2, ...) en un espacio reservado para el reproductor. **3 videos en total: dos genéricos + uno que varía según la respuesta del usuario.**
- Tracking: **mínimo requerido — hasta qué pregunta llega el lead** (si termina el cuestionario o no). Lo demás (UTMs, tiempos) es opcional/ampliable.

## 2. Formato de datos (JSON a definir con Berni)

Principio acordado: JSON **agnóstico**, registros `pregunta / respuesta`. Boceto (por confirmar contra las preguntas definitivas):

```json
{
  "session_id": "uuid",
  "source": {"utm_source": "...", "utm_medium": "...", "utm_campaign": "..."},
  "lead": {"name": "...", "phone": "...", "email": "...", "consent": true},
  "signals": {"total_seconds": 0, "dropoff_question": null, "started_at": "...", "finished_at": "..."},
  "answers": [
    {"pregunta": "¿Cuánto capital tienes invertido...", "respuesta": "25.000 – 100.000 $"},
    {"pregunta": "Portfolio", "respuesta": {"btc":50,"eth":20,"stables":10,"alt":10,"fiat":10}}
  ]
}
```

Campos derivados que el triaje necesita ver: capital total, capital disponible, aportación mensual, perfil de riesgo, composición, nº de altcoins, preocupación declarada.

## 3. Orden y contenido del wizard (BLOQUEADO hasta que Berni defina preguntas)

Estructura de la reunión (a conservar como restricciones duales):
1. Conocer la situación (capital, portfolio, riesgo) **sin** fricción ni pedir datos.
2. Preguntas que hagan relucir dolor / vacíos de conocimiento (gancho para la llamada).
3. Datos de contacto **al final siempre**, como requisito para recibir el diagnóstico.
4. Evitar mostrar nº total de preguntas; barra de progreso que empiece alto (ej. 33%) y avance lento (nota del equipo: cuidado con trackear % honesto vs. % motivador).
5. Posibles experimentos: versión corta con pop-up de continuación vs. versión larga (test A/B futuro).

Las **preguntas actuales del prototipo** (capital, liquidez, aportación, riesgo, experiencia, portfolio, altcoins, preocupación, contacto) sirven de base de trabajo mientras Berni no emita las definitivas.

## 4. Motor de diagnóstico (determinístico, sin IA)

- **No hay IA.** El diagnóstico se genera con un **algoritmo determinístico** sobre las respuestas (todas de opción múltiple). El `buildDiagnosis` del prototipo es la base y define el tono/estructura objetivo.
- El cualquier caso, tono, secciones y ganchos obligatorios del diagnóstico (derivados del audio + prototipo):
  1. "Tu situación real" — espejar las respuestas con números.
  2. "El desajuste principal" — perfil declarado vs. exposición real / dispersión de altcoins.
  3. "El coste de tu liquidez parada" — riesgo de "quedarse fuera" (gancho prioritario).
  4. "Tu plan de acción" — pasos concretos numerados.
  5. Cierre + **pantalla final de video**: un espacio de video cuya selección depende de una pregunta final (segmentación). Mapeo: opción elegida → video. Ver §9.
- Detectar **lead caliente**: capital > 10.000 USD → flag en el JSON para alerta de triaje (regla determinística sobre la respuesta de capital).

## 5. Integración con el sistema del negocio

- Repo del negocio (Next.js + Supabase): incorporar la herramienta como **módulo nuevo** (entrada en menú lateral con reporte de leads filtrable), trabajo en **branch** → PR.
- Entorno dev: Supabase local (CLI + Docker) con migrations (decidido en `docs/08` §1.1).
- Leads con flag caliente → notificación al triaje.

## 6. Tracking (mínimo requerido)

- **Métrica clave: hasta qué pregunta llega el lead** — si termina el cuestionario o en cuál abandona (`dropoff_question`).
- Opcional/ampliable a futuro: UTMs, tiempo por pregunta, aperturas de email, video. No es requisito de lanzamiento.
- Sesión identificable vía `session_id` (permite reproducir y ampliar tracking después).

## 7. Legal / compliance

- Consentimiento explícito para recibir diagnóstico y comunicaciones; opción de baja.
- Disclaimer: "documento educativo, no constituye asesoramiento financiero personalizado".

## 8. Fuera de alcance (ya validado)

- No se integra con Go High Level vía webhook (fue evaluado y descartado en favor de la integración con código).
- No se construye un nuevo sistema de CRM; se integra en el que existe.

## 9. Pantalla final (implementado en MVP)

- Es la **última pantalla** del flujo, y es **única**: diagnóstico + videos en la misma página (referencia visual: el caso de la Screencap con "tu problema principal" + "plan de acción" + "tus recursos para resolverlo").
- Después de los datos de contacto hay una **pregunta de segmentación** que determina qué video se destaca: opción 1 → video 1, opción 2 → video 2, etc. (2 genéricos + 1 variable según la respuesta).
- El diagnóstico se muestra en secciones: problema principal (callout), coste de la liquidez parada, plan de acción numerado, métrica norte, y grid de 3 video-cards (placeholder 16:9, mapeo opción→video **config-driven** en `lib/question-config.js`).
- El orden de la pregunta que segmenta puede cambiar cuando Berni defina las preguntas reales; solo cambia config.

### 9.1 PDF del diagnóstico (parcial)

- **Hoy (desarrollo):** botón "Descargar PDF — solo desarrollo" (`lib/pdf.js`, jsPDF + html2canvas) que genera el PDF del sheet completo con el mismo estilo, A4 paginado. Sirve para afinar el diseño sin depender del email.
- **Después (producción):** envío del PDF por email vía **Resend** del negocio + tracking de apertura; quitar el botón dev.
