# Seguridad — checklist pre-producción (rama `feature/security-review`)

Estado del checklist de seguridad pre-producción recopilado antes del primer deploy.
Convención: ✅ implementado y verificado (tests + curl) · ♻️ cubierto por diseño/código existente · 🟡 parcial · ⏳ no aplica todavía (pendiente para cuando entre la integración real).

## Aclaraciones acordadas (luz verde 2026-09-10)

- **Rate limiting in-memory** es **best-effort** hasta definir hosting (Vercel o Netlify): en serverless cada isolate tiene sus propios contadores, así que el límite es aproximado. Al definir hosting se reemplaza por algo real (Upstash Redis / WAF) sin cambiar el call site — ver `lib/rate-limit.js`.
- **`consent: true`** es válido técnicamente, pero el texto del checkbox debe explicar claramente qué acepta el usuario. Se actualizó el texto (ver ítem 27).
- **Supabase/RLS/Service Role y Resend** se revisan con foco de seguridad **antes de** poner esas integraciones en producción.
- **CSRF no es blocker** para este endpoint público mientras mantenga validación estricta de entrada y controles anti-abuso (se mantiene: validations + rate limit + origin check).

## Validación de `/api/lead` (endpoint público)

| # | Ítem | Estado | Detalle |
|---|---|---|---|
| 1 | Rechazar JSON inválido | ✅ | 400 `invalid_json` (`route.js`) |
| 2 | Campos faltantes / tipos incorrectos / null | ✅ | 422 `invalid_payload` con reason específica |
| 3 | Campos inesperados (allow-list) | ✅ | Allow-list de claves en top-level, `lead` y cada answer; se rechaza 422 |
| 4 | Valores fuera de rango / arrays arbitrariamente grandes | ✅ | ≤64 answers, ≤500 chars pregunta, ≤1000 chars respuesta, ≤64 respuestas |
| 5 | Límite de tamaño de payload | ✅ | 64 KiB, rechaza 413 |
| 6 | Longitud límite por campo | ✅ | session_id 8–64 (formato alfanumérico+guion), nombre 120, email 254, teléfono 40 (8–15 dígitos) |
| 7 | XSS (payload malicioso en nombre/email/respuestas) | ♻️ | La respuesta del endpoint es `application/json` (sin HTML): no hay ejecución. React escapa el contenido de arranque en la UI. Añadido allow-list de campos |
| 8 | XSS en PDF | ♻️ | PDF se genera desde nodos React (html2canvas), que escapan todo texto; nombre solo entra como texto en JSX. Pendiente revisar si el PDF pasa a HTML dinámico (Resend) |
| 9 | Inyección en enlace WhatsApp | ♻️ | `lib/whatsapp.js`: destino sanitizado a dígitos, `encodeURIComponent` del mensaje, colapso de whitespace. Tests: `test/security.test.mjs` |
| 10 | Rate limiting | ✅ | `lib/rate-limit.js` — sliding window 10 req/min por IP, in-memory **best-effort** (ver aclaración arriba). Configurable vía `LEAD_RATE_LIMIT_MAX` / `LEAD_RATE_LIMIT_WINDOW_MS`. Verificado 429 con curl |
| 11 | Anti-spam/bots | ✅ | Honeypot (`lead.website` oculto en el form; bot autocompleta → 200 con body genérico, no se persiste nada) + validación de `Content-Type` + chequeo same-origin de `Origin` |
| 12 | Endpoint público probado directo (sin UI) | ✅ | Suite integración (`test/integration.api.test.mjs`) corre contra `next start` real con fetch/curl |
| 13 | Session_id: formato y manipulación | ✅ | Regex `^[a-zA-Z0-9-]{8,64}$` + longitud. No hay recursos por sesión (stub aún). Revisar en Fase 1 Supabase |
| 14 | sendBeacon no salta validaciones | ✅ | Enviar `Blob` con `Content-Type: application/json` (`components/flow.jsx`); el endpoint valida exactamente igual que un POST normal |
| 15 | CORS | ✅ | No hay CORS abierto: si llega `Origin` debe matchear `Host`, si no 403. Verificado con curl |
| 16 | CSRF | ♻️ | Endpoint público lifetime: no hace requests mutantes a dominios externos. Se mitiga con validación de payload, allow-list, rate limit y origin check. Decisión: no blocker (ver aclaración) |
| 17 | Security headers | ✅ | En `next.config.mjs`: CSP, HSTS, X-Content-Type-Options: nosniff, Referrer-Policy: strict-origin-when-cross-origin, Permissions-Policy, X-Frame-Options: DENY. Verificado con curl. La CSP incluye `unsafe-eval` **solo en dev** (webpack/HMR); en prod queda `script-src 'self' 'unsafe-inline'` |
| 18 | Open redirect | ♻️ | No hay redirecciones parametrizadas en la app; no existe ningún redirect basado en input del usuario |
| 19 | Secrets en Git | ♻️ | No hay secretos en el código; `.env*` ignorado en `.gitignore`. Verificar antes de cada PR |
| 20 | Variables `NEXT_PUBLIC_*` | ✅ | Ninguna en uso (grep del repo limpio) |
| 21 | Logs sin PII en producción | ✅ | El volcado completo del payload solo sale en dev (`isDev`); en producción el log es resúmen sin PII (session_id truncado + cantidad de respuestas). Ni el título del dropoff ni email/teléfono aparecen en producción |
| 22 | npm audit | 🟡 | Producción: 2 vulnerables transitivos vía `next@15` (postcss, alto) — fix requiere Next 16 (breaking) — pendiente. `netlify-cli` (dev) acumula 56; sin riesgo de prod |
| 23 | Production build | ✅ | `next build` + `next start` es lo que corre la suite de integración. Sin páginas ni flags de dev activados |
| 24 | Errores sin stack traces | ✅ | 500 genérico `internal_error`, detalles del error solo en consola dev |
| 25 | Métodos HTTP no soportados | ✅ | GET → 405 (exportado explícito); PUT/PATCH/DELETE → 405 (Next default route). Verificado con curl |
| 26 | HTTP methods extras (OPTIONS/TRACE) | ⏳ | Revisar post-integración real si la app hace preflight |

## Supabase / integración (cuando entre, antes de prod)

| # | Ítem | Estado |
|---|---|---|
| 27 | RLS: lead no puede leer datos de otro lead | ⏳ Pendiente |
| 28 | Service Role Key solo en servidor (nunca client-side ni logs) | ⏳ Pendiente |
| 29 | IDOR/BOLA: intento de manipular session ids por recursos entre leads | ⏳ Pendiente |
| 30 | SQL / DB injection (todos los campos que llegan a DB) | ⏳ Pendiente (usar client parameterizado de Supabase) |

## Consentimiento y privacidad

| # | Ítem | Estado |
|---|---|---|
| 31 | Consentimiento explícito en el wizard antes de guardar PII | ✅ — se actualizó el texto del checkbox en la página de contacto para que sea claro y específico: acepta recibir el diagnóstico y que Metacrypto Club lo contacte |
| 32 | Retención de datos (cuánto tiempo se conservan leads/responses/events) | ⏳ Pendiente — definir con el negocio |
| 33 | HTTPS-only en producción | ⏳ El host debe forzar. En producción: artefacto de build en `next start` detrás del servidor ( servidor del hosting). Verificar al deployar |

## Verificación (luz verde as necessary)

- Tests: `npm test` → 38/38 en verde (unit + integración + seguridad, `test/security.test.mjs` nuevo).
- Config-based rate limit en integración: el servidor de test se arranca con `LEAD_RATE_LIMIT_MAX=1000` para no interferir en tests múltiples; la lógica del limiter se cubre en unit (`test/security.test.mjs`).
- Curl directo contra `next start` (prod build sin `NODE_ENV=development`): 405 en métodos no permitidos, 400/413/415/422 con payloads hostiles, 403 con `Origin` mismatch, 429 al exceder rate limit, headers de seguridad presentes en `/`, honeypot → 200 genérico, log de prod **sin PII**.

## Notas accesorias

- La IP para rate limiting se infiere de `x-forwarded-for` (primer IP de la lista) con fallback a `x-real-ip`. En cada serverless isolate la cuenta es independiente — revisar comportamiento real del hosting tras el primer deploy.
- HSTS `preload` se incluye para dominio final con HTTPS permanente; si el dominio aún no está listo para preload, subir el flag al deploy.
