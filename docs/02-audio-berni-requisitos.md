# Audio de Berni — Requisitos del formulario prediagnóstico

Fuente: `transcripcion_audio.md` (audio de WhatsApp, 4 sept 2026, ~5 min). Es la fuente de los requisitos de negocio sobre el **qué** debe preguntar y **por qué**.

## Mensaje central de Berni

> El formulario debe (a) recopilar información suficiente para hacer un **buen diagnóstico**, y (b) capturar **nombre + teléfono + email** al final para enviar el diagnóstico y quedarse con los datos.

##Qué quiere saber de cada lead (en orden de importancia para él)

1. **Capital total disponible** — "lo que más me interesa es la cantidad total de capital". Preguntar aparte: cuántos dólares tiene **disponibles** además del portfolio, qué aportación mensual piensa los próximos 12 meses.
2. **Perfil de riesgo** — muy agresivo / agresivo / moderado / conservador / muy conservador.
3. **Composición del portfolio** — formato tipo tabla: % Bitcoin, % USD/stables, % %, una línea de notas. Alternativa: campo de texto libre donde lo describa.

## Psicología / ganchos del diagnóstico (para el motor determinístico)

- **Dólares parados:** "hay que ponerle prisa" por el tema de cuántos dólares tiene. Riesgo de "quedarse fuera" por las condiciones actuales → presión de urgencia.
- **Desajuste perfil/portfolio:** "por regla general esos porfolios no están adecuados a quiénes son como inversores".
- **Dispersión en altcoins:** "tienes 10 altcoins diferentes, no tiene ningún sentido" → punto señalado como ejemplo de diagnóstico.
- **Vender es más fácil al que tiene dólares parados** que al 100% invertido → priorizar el gancho de liquidez.
- **Generar duda** es el outcome clave: el diagnóstico debe dejarle claro al lead qué no sabe / qué le falta plan.

## Detalles de experiencia

- Video de regalo: Berni grabaría un video genérico que se entrega al final (con el diagnóstico), algo "exclusivo" para quien lo completa.
- Hay gente que pone tonterías (100 USD) y gente que pone 100 mil → el video/mensaje a los de capital alto es distinto.
- El diagnóstico debe **"valer la pena"** — no dar "cualquier basura" — porque si el lead siente que le tiraron datos inútiles se pierde la oportunidad.

## Concesión de metodología ("documento del círculo / circle para empezar")

Berni valida la docencia de metodología: empezar con un caso ("hacer el documento de circle para empezar, vemos si funciona y lo replicamos con otros"). Para **novatos** hay que pensar algo específico; con experimentados ya se está más a mano. (Interpretación: primero afinar el flujo con el segmento/persona principal y luego iterar para novatos.)

## Verificación cruzada con lo implementado en el prototipo

El prototipo `index.html` ya traduce esto a preguntas y reglas:
- Capital invertido, liquidez disponible, aportación mensual, perfil de riesgo, experiencia, distribución de portfolio (tabla sumando 100%), nº de altcoins, preocupación (texto libre), contacto al final.
- Motor mock: detecta desajuste perfil-exposición, dispersión de altcoins, liquidez parada como "coste de oportunidad" y hunde el gancho de "quedarte fuera".
- Este motor define el **tono y estructura esperada** del diagnóstico final por algoritmo determinístico (secciones 1–5 + plan de acción numerado). No hay IA: se clasifica/regla directamente sobre las respuestas (todas de opción múltiple).
