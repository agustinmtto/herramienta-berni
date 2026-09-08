# Especificación técnica (v1 — integración con Supabase)

Versión unificada a partir del prototipo + decisiones de la reunión. Los cambios de requisitos se empiezan editando aquí.

## 1. Alcance

- Landing + wizard de preguntas + pantalla "analizando" + resultado (diagnóstico) → **front propio**, diseñado con el design system de Metacrypto (§04).
- Al finalizar el wizard:
  - `POST` de **JSON agnóstico** a la API del negocio (Supabase + Next.js en su repo, vía branch/PR).
  - Diagnóstico mostrado en pantalla, generado por **Claude (API del negocio)** — se reemplaza el motor determinístico mock.
  - Thank-you page: **video de Berni** segmentado por capital + CTA a agenda.
  - **PDF del diagnóstico por email** (Resend del negocio).
- Tracking: eventos de sesión, tiempo por pregunta, abandonos, UTMs, apertura/cliqueo del email, visualización del video.

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

## 4. Motor de diagnóstico (IA)

- Reemplazar el motor determinístico (`buildDiagnosis` en `index.html`) por llamada a la API propiedad del negocio.
- Tono, secciones y ganchos obligatorios del prompt (derivados del audio + prototipo):
  1. "Tu situación real" — espejar las respuestas con números.
  2. "El desajuste principal" — perfil declarado vs. exposición real / dispersión de altcoins.
  3. "El coste de tu liquidez parada" — riesgo de "quedarse fuera" (gancho prioritario).
  4. "Tu plan de acción" — pasos concretos numerados.
  5. Video/C-regalo + CTA a llamada estratégica.
- A mano: el PDF enviado por email debe replicar la misma calidad ("que valga la pena").
- Detectar **lead caliente**: capital > 10.000 USD → flag en el JSON para alerta de triaje.

## 5. Integración con el sistema del negocio

- Repo del negocio (Next.js + Supabase): incorporar la herramienta como **módulo nuevo** (entrada en menú lateral con reporte de leads filtrable), trabajo en **branch** → PR.
- Entorno dev: se propone branch de Supabase como entorno de desarrollo (validar que funciona y controlar compute usage).
- Leads con flag caliente → notificación al triaje.
- PDF por email vía **Resend** (ya lo usan) + tracking de apertura por UTMs.

## 6. Tracking (requisito fuerte del negocio)

- Cada interacción en el wizard: tiempos por pregunta, scrolls, clicks, dropoffs: en qué pregunta cae cada sesión.
- UTMs en el link de Berni (Instagram) → atribución de fuente.
- Email de diagnóstico con pixel/UTM (clicker) para apertura/cliqueo.
- Video embed trackeable con la duración vista (por ej. Loom o un player con eventos).
- Sesión reproducible vía `session_id`; ideal para futuras automatizaciones de outreach.

## 7. Legal / compliance

- Consentimiento explícito para recibir diagnóstico y comunicaciones; opción de baja.
- Disclaimer: "documento educativo, no constituye asesoramiento financiero personalizado".

## 8. Fuera de alcance (ya validado)

- No se integra con Go High Level vía webhook (fue evaluado y descartado en favor de la integración con código).
- No se construye un nuevo sistema de CRM; se integra en el que existe.
