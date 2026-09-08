# Prototipo actual (`index.html`)

Archivo único: HTML + CSS + JS inline (~530 líneas). És descartable como código, pero es la **referencia de UX, textos y motor de reglas** para el producto real.

## Pantallas

1. **Hero** — landing: eyebrow, h1 ("Tu portfolio cripto, bajo la lupa"), chips (personalizado / 2 minutos / gratis), CTA dorado, nota de confianza.
2. **Wizard** — una pregunta por pantalla: índice `[01]`, título Oswald, hint Sora, opciones/lista; nav Anterior/Siguiente; barra de progreso + contador.
3. **Analizando** — 5 pasos "IA" animados (perfil → portfolio → desajustes → liquidez → plan).
4. **Resultado** — 5 secciones (situación real, desajuste principal, coste de la liquidez, plan de acción, video regalo) + CTA de llamada.

## Preguntas actuales (state: `{capital, cash, monthly, risk, experience, portfolio{btc,eth,stables,alt,fiat}, altcoins, concern, name, phone, email, consent}`)

| # | key | Tipo |
|---|---|---|
| 1 | capital | opciones (5 rangos: <1k, 1–5k, 5–25k, 25–100k, >100k) |
| 2 | cash | opciones (mismos rangos) |
| 3 | monthly | opciones (0, <500, 500–2k, 2k–10k, >10k) |
| 4 | risk | opciones (muy agresivo → muy conservador) |
| 5 | experience | opciones (nada a más de 3 años) |
| 6 | portfolio | tabla % que debe sumar 100 |
| 7 | altcoins | opciones (1–2, 3–5, 6–10, >10) — **se salta si alt=0** (`skipIf`) |
| 8 | concern | texto libre (280 chars, opcional) |
| 9 | contact | nombre + teléfono + email + consentimiento |

## Motor mock (`buildDiagnosis`)

Aproxima el futuro diagnóstico con IA. Reglas implementadas (mantener como comportamiento objetivo):

- `hotLead` = cash ≥ umbral (25k mock) **o** capital ≥ 100k → log en consola (en producción: flag al backend; **umbral real decidido = 10.000 USD**).
- `exposureMismatch`: perfil conservador (idx ≥ 3) con mucha exposición (alt + 0.5·eth > 30) → warning "tu cartera y tu perfil están peleados".
- `timidMismatch`: agresivo con < 50% invertido → "problema de ejecución".
- `altSpread` ≥ 6 → "dispersión": rotar hacia BTC/ETH.
- Liquidez: `parkedPct` (stables+fiat); ≥ 20% → gancho de urgencia + USD aprox parado; > 0 → plan de despliegue; = 0 → "sin munición".
- Plan de acción dinámico (estructura/consolidación/DCA/etc. según señales).

## Deuda / TODOs marcados en el código

- `CONFIG.ctaUrl` — Calendly/WhatsApp real.
- `CONFIG.videoUrl` — video regalo.
- Diagnóstico **IA real** (Claude vía API del negocio) en vez de mock.
- Envío de lead real a Supabase del negocio (hoy solo `console.info`).
- Umbral de lead caliente: alinear con 10.000.
