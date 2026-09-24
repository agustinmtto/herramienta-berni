# 16 — To-do para el GO: auditoría v4

> **Fuente:** `respuesta despues de analisis v4.txt` (revisión sobre `origin/main`, commit `e8f6117`), contrastada contra el código real de `metacrypto-os-app/apps/inbox` y las migraciones `0068–0071`.
>
> **Veredicto de la auditoría:** avance real y comprobable (1.333 tests en verde, tsc/lint/build OK), pero **NO GO a producción** hasta cerrar los 2 críticos y los principales de integridad.
>
> **Regla del repo:** migraciones **append-only** (nunca editar `0068`–`0071` ya aplicadas). Todo fix de base va en una migración nueva con número confirmado por Miled. Código en inglés, UI en español.

---

## Estado (23-sep-2026)

**Todos los puntos internos del funnel/módulo están implementados y verificados en local:**

- 🔴 C1 + C2, 🟠 I1–I13, 🟡 M1 + M2 → **cerrados en código** y cubiertos por tests (suite **1.343/1.343 en verde**, `tsc` limpio, `eslint` 0 errores).
- Fixes de base concentrados en la migración nueva **`0072_reconciliacion_leads_v2.sql`** (append-only; número pendiente de confirmación con Miled).
- 🟡 **M3 (patch de transferencia):** queda **pendiente de regenerar** el `release/funnel-leads.patch` incluyendo `package.json` + lockfile + `eslint.config.mjs` (requisito documentado en `docs/15`). Requiere el repo de Miled.
- ⚪ **Externos (OS preexistente):** siguen como tickets ajenos al módulo.

**Para el GO falta únicamente lo externo:** videos con URL, confirmación de números de migración (`0068`–`0072`), env de producción, backup, rate limit distribuido (WAF/Upstash) y smoke test (ver `docs/14`).

---

## Resumen ejecutivo

| Prioridad | Cantidad | ¿Bloquea el GO? |
|---|---|---|
| 🔴 Crítico | 2 | Sí, obligatorio |
| 🟠 Importante | 11 | Sí, obligatorio |
| 🟡 Media | 3 | Recomendado antes del GO |
| ⚪ Externo (OS de Miled) | 10 | No bloquea el módulo; sí un deploy completo |

Los 7 puntos con "solución parcial" (migraciones históricas, inmutabilidad, consentimiento, concurrencia, auditoría, tracking y selector) **siguen abiertos** y son justamente los que hay que cerrar primero.

---

## 🔴 Críticos (bloquean el GO)

### C1 — La actualización desde bases históricas no queda equivalente a una instalación nueva

- **Problema:** `0071_reconciliacion_leads.sql` no redefine `validar_respuestas_quiz`. Una base que aplicó una versión **vieja** de `0068` queda con el validador antiguo: acepta preguntas duplicadas (no tiene el guard `respuestas_duplicadas`) y otras validaciones que sí están en la versión final. `supabase db reset` no lo muestra porque arranca de cero con los archivos actuales.
- **Dónde:** `metacrypto-os-app/supabase/migrations/0071_reconciliacion_leads.sql` (solo hace `revoke/grant` sobre `validar_respuestas_quiz`, nunca `create or replace`). El validador final vive en `0068_quiz_leads.sql` §5.
- **Acción:**
  - [ ] Crear migración nueva `0072_*` (número a confirmar con Miled) que haga `create or replace` de **todas** las funciones/triggers/constraints/grants corregidos en su versión final — en especial `validar_respuestas_quiz`, `registrar_diagnostico`, `vincular_lead_convertido`, `desvincular_lead`, `descartar_lead`, trigger de inmutabilidad y CHECKs.
  - [ ] No tocar `0068`–`0071` ya aplicados.
- **Verificación (compuerta):**
  - [ ] Levantar 3 bases históricas (solo `0068` vieja; `0068`+`0069`; `0068`+`0069`+`0070` viejas), aplicar `0071`+`0072`, y comparar `\df`, constraints y grants contra una instalación limpia: deben coincidir.
  - [ ] En la base histórica actualizada, un `completed` con preguntas duplicadas debe ser **rechazado** igual que en una base nueva.

### C2 — La inmutabilidad de versiones publicadas se puede evadir

- **Problema:** el trigger `quiz_versiones_congelada()` solo protege contra editar/borrar cuando `old.publicada_at` no es null. La evasión en dos pasos: (1) `UPDATE quiz_versiones SET publicada_at = NULL` (la marca se quita sin resistencia), (2) editar `definicion`/`codigo`/`funnel`/`variante`/`version`. Verificado en base real.
- **Dónde:** `0071_reconciliacion_leads.sql`, función `quiz_versiones_congelada()` (líneas ~58–87).
- **Acción:**
  - [ ] Endurecer el trigger: si `old.publicada_at is not null`, rechazar `new.publicada_at = NULL` cuando la versión tiene envíos históricos (o directamente rechazar "despublicar" una versión ya publicada con historial). Aplicarlo en la migración nueva `0072`.
- **Verificación:**
  - [ ] Test de dos pasos (quitar `publicada_at` → editar definición) → debe lanzar excepción.
  - [ ] Una versión en `draft` (nunca publicada) sigue siendo editable/borrable.

---

## 🟠 Importantes (bloquean el GO)

### I1 — Cronología del consentimiento

- **Problema:** el RPC valida "no futura" y "no anterior al inicio con 24 h de tolerancia", pero **no** valida consentimiento anterior al inicio (dentro de esas 24 h) ni posterior a la finalización. Ambos fueron aceptados en la auditoría.
- **Dónde:** `registrar_diagnostico` en `0071_reconciliacion_leads.sql` (líneas ~258–263).
- **Acción:**
  - [ ] Acotar `consentimiento_at` al recorrido: `>= started_at - skew` y `<= finished_at + skew`, con un `skew` de reloj documentado y **chico** (segundos/minutos, no 24 h).
- **Verificación:**
  - [ ] Tests: consentimiento anterior al inicio → rechazo; posterior a `finished_at` → rechazo; dentro del recorrido → aceptado.

### I2 — Constraints permiten strings vacíos por escritura directa

- **Problema:** el CHECK de `completed` usa `is not null`, que deja pasar `nombre_capturado = ''`, `email_capturado = ''`, `telefono_e164_capturado = ''`. Una escritura directa (service_role) los guarda.
- **Dónde:** CHECK `diagnostico_envios_completed_completo_check` (en `0068` y re-aplicado en `0071`).
- **Acción:**
  - [ ] En la migración nueva, re-aplicar el CHECK exigiendo `btrim(...) <> ''` para los campos de contacto de `completed` (nombre, email, teléfono).
- **Verificación:**
  - [ ] Insert directo con `nombre=''` en un `completed` → rechazado por el constraint.

### I3 — `0071` inventa consentimiento para registros históricos

- **Problema:** `0071` rellena `consentimiento_version = 'contacto-v1'` y `consentimiento_at` para filas `completed` históricas que **nunca** tuvieron consentimiento documentado. Eso fabrica evidencia legal inexistente.
- **Dónde:** `0071_reconciliacion_leads.sql` (líneas ~31–34).
- **Acción:**
  - [ ] En la migración nueva, revertir el backfill falso: usar un marcador honesto (p. ej. `consentimiento_version = 'legacy-sin-registro'` con `consentimiento_aceptado` sin afirmar) y **flaggear** esas filas en `/leads` como "consentimiento sin registrar — revisar".
- **Verificación:**
  - [ ] Tras actualizar una base histórica, ninguna fila sin consentimiento real aparece como `contacto-v1`.

### I4 — Carreras de concurrencia

- **Problema:** (a) dos requests simultáneos con el **mismo `session_id`** y **distinta `quiz_version`** pueden competir creando la sesión y validando contra versiones distintas; (b) `desvincular_lead` no siempre toma el lock canónico de contacto en el mismo orden que el resto. No hay tests concurrentes.
- **Dónde:** `registrar_diagnostico` (rama "sesión nueva" sin lock por `session_id` antes del insert), `desvincular_lead`/`vincular_lead_convertido`/`descartar_lead` en `0071_reconciliacion_leads.sql`.
- **Acción:**
  - [ ] Serializar la creación de sesión por `session_id` (advisory lock o confiar en el `UNIQUE` + reintento) antes de validar versión.
  - [ ] Revisar que vincular/desvincular/descartar adquieran el lock de contacto **canónico en el mismo orden** para evitar deadlocks.
  - [ ] Agregar tests concurrentes (dos requests simultáneos mismo `session_id`).
- **Verificación:**
  - [ ] Test concurrente: mismo `session_id`, distinta `quiz_version` → una gana y la otra rechaza limpio, sin envío mezclado.

### I5 — `revertido_de` sigue guardando el dato incorrecto

- **Problema:** en la auditoría de desvinculación, `revertido_de` guarda el booleano `confirmado` en vez del UUID de la vinculación revertida. El UUID correcto ya se guarda, pero en el campo equivocado (`vinculacion_audit_id`).
- **Dónde:** `desvincular_lead` en `0071_reconciliacion_leads.sql` (línea ~685: `'revertido_de', v_datos->'confirmado'`).
- **Acción:**
  - [ ] En la migración nueva, `revertido_de` debe guardar `v_audit_id` (el UUID). Conservar `vinculacion_audit_id` como está.
- **Verificación:**
  - [ ] Test de desvinculación: la fila de auditoría `desvinculacion` tiene `revertido_de` = UUID de la vinculación revertida.

### I6 — Tracking de pasos y abandono

- **Problema:** la primera pregunta se registra como `start`; volver hacia atrás no emite `progress`; un abandono en `challenge/1` quedó como `start`; recargar la página reutiliza una sesión anterior con UI reiniciada.
- **Dónde:** `metacrypto-os-app/apps/inbox/app/quiz/quiz-flow.tsx` (`startWizard`, `goTo`, `move`, `useEffect` de `[screen, qIndex]`, beacon `pagehide`). La persistencia de sesión está en `sessionStorage` (`SESSION_KEY`).
- **Acción:**
  - [ ] Hacer que `lastStepRef` refleje siempre la pregunta **visible** con índice canónico (no `start` para la pregunta 1), incluido el caso de drop inmediato.
  - [ ] Emitir `progress` (o al menos actualizar `lastStepRef`) al navegar hacia atrás (`move`).
  - [ ] Definir y documentar el comportamiento de recarga: rotar a sesión nueva al reiniciar desde HERO o restaurar el estado; no reusar una sesión ya iniciada con UI limpia en silencio.
- **Verificación:**
  - [ ] Tests/checklist: abandono en cada pregunta → `last_step_id` = pregunta real (no `start`); retroceso actualiza el paso.

### I7 — Selector de clientes: el filtro por programa no funciona

- **Problema:** `programas!inner(id)` está como parámetro suelto, no dentro de `select`, así que PostgREST lo ignora y devuelve clientes sin programa (HTTP 200, error silencioso). Verificado creando un cliente sin programa que igual apareció.
- **Dónde:** `getClientesParaVincular` en `metacrypto-os-app/apps/inbox/lib/leads.ts` (líneas ~248–252).
- **Acción:**
  - [ ] Corregir el inner join: `select=id,nombre,email,telefono_e164,programas!inner(id)` (o equivalente que PostgREST aplique de verdad).
- **Verificación:**
  - [ ] Un cliente sin programa **no** aparece en el picker.

### I8 — Selector de clientes: límite silencioso de 500, búsqueda local y sin paginación

- **Problema:** carga solo los primeros 500, la búsqueda filtra localmente sobre lo ya cargado y no muestra el programa del cliente.
- **Dónde:** `getClientesParaVincular` (`limit=500`) + `Picker` en `metacrypto-os-app/apps/inbox/components/VincularLead.tsx` (filtro local).
- **Acción:**
  - [ ] Búsqueda **server-side** (query por nombre/email/teléfono) con debounce y paginación, sin cap de 500.
  - [ ] Mostrar el programa del cliente en la opción del selector.
- **Verificación:**
  - [ ] Con >500 clientes, la búsqueda encuentra clientes más allá del primer lote; la opción muestra el programa.

### I9 — Fechas o páginas inválidas en `/leads` producen 500

- **Problema:** `desde`/`hasta` se concatenan directo a la query (`created_at=gte.${desde}T00:00:00Z`) y `hasta` hace `new Date(...).toISOString()`, que lanza con fechas inválidas → error 500.
- **Dónde:** `buildLeadsQuery`/`getLeads` en `lib/leads.ts`; `page.tsx` de `/leads`.
- **Acción:**
  - [ ] Validar `desde`/`hasta` como `YYYY-MM-DD` reales (ignorar/rechazar los inválidos sin romper) y `page` como entero positivo.
- **Verificación:**
  - [ ] `?desde=abc`, `?hasta=99-99-9999`, `?page=abc` → no dan 500 (respuesta limpia).

### I10 — Usuario con permiso `leads` recibe enlace a `/clientes` sin permiso `clientes`

- **Problema:** el detalle de lead enlaza a `/clientes/{id}` aunque el usuario no tenga el módulo `clientes`.
- **Dónde:** `metacrypto-os-app/apps/inbox/app/(os)/leads/[id]/page.tsx` (línea ~125).
- **Acción:**
  - [ ] Renderizar el enlace a `/clientes` solo si el usuario tiene permiso `clientes` (check server-side con `puedeVer`); si no, mostrar el nombre como texto plano.
- **Verificación:**
  - [ ] Usuario solo con `leads` no ve el enlace a `/clientes`.

### I11 — Normalización telefónica argentina incompleta

- **Problema:** `composePhone` solo quita ceros iniciales para prefijo `54`; no maneja `0`, `15` ni `9` (móvil AR), así que formatos comunes normalizan distinto o mal.
- **Dónde:** `composePhone`/`composePhonePorPais` en `lib/quiz/lead-payload.ts`; `normalizePhoneE164` en `lib/quiz/lead-validate.ts`.
- **Acción:**
  - [ ] Normalizar móvil AR: quitar `0` inicial, quitar `15` y asegurar el `9` de móvil, llegando siempre al mismo E.164. Documentar los formatos aceptados.
- **Verificación:**
  - [ ] Tests unitarios: `0 3585…`, `15 3585…`, `9 3585…`, `3585…` → mismo E.164.

### I12 — Pruebas integradas se omiten y la suite queda verde

- **Problema:** si Supabase local no está arriba, las suites gated se marcan `describe.skip` y la suite aparece verde sin probar DB ni `/api/lead`.
- **Dónde:** `lib/quiz/__tests__/lead-route.test.ts` (línea ~98) y `lib/__tests__/quiz-leads-rpc.test.ts`.
- **Acción:**
  - [ ] En CI, hacer **obligatoria** la ejecución: un job gated que falle si las suites se saltan (p. ej. env `LEAD_TESTS_REQUIRE_DB=1` que convierta el skip en fallo). Mantener la guarda anti-producción.
- **Verificación:**
  - [ ] Correr tests sin Supabase local en CI → rojo, no verde.

### I13 — Rate limit en memoria y puede bloquear el `completed`

- **Problema:** límite de 10 req/min por IP en memoria. Un recorrido con inicio + avances + retrocesos + retry puede consumirlo antes del evento final; y en serverless cada instancia tiene contadores propios.
- **Dónde:** `lib/quiz/rate-limit.ts` + aplicación previa en `app/api/lead/route.ts` (líneas ~47–54).
- **Acción:**
  - [ ] Corto plazo: no dejar que el limiter bloquee el `completed` (eximirlo o subir el presupuesto para un recorrido completo).
  - [ ] Definitivo (antes de tráfico pago): rate limit distribuido (Upstash/WAF del host) — ya trackeado en `docs/06` #14/#15.
- **Verificación:**
  - [ ] Simular un recorrido completo (>10 requests) → `completed` sigue entrando.

---

## 🟡 Media (recomendado antes del GO)

### M1 — El honeypot no llega al endpoint

- **Problema:** la UI tiene el campo trampa `website`, pero `buildQuizPayload` no lo incluye (ni top-level ni en `lead`), así que el servidor nunca recibe esa señal en el recorrido real.
- **Dónde:** `buildQuizPayload` en `lib/quiz/lead-payload.ts` (arma `lead` sin `website`) y `submitContact` en `quiz-flow.tsx`. El endpoint ya lo valida (`input.website` / `lead.website` en `lead-validate.ts`).
- **Acción:**
  - [ ] Incluir `website` en el payload (top-level, que es lo que `validateLeadContract` ya consume y descarta antes del RPC).
- **Verificación:**
  - [ ] Test del builder: un `website` relleno produce payload con `website`; el endpoint responde `ignored` (200 falso) sin persistir.

### M2 — El frontend no compara el `session_id` devuelto

- **Problema:** `submitContact` valida `ok`, `status` y `submission_id`, pero no confirma que `data.session_id === sessionIdRef.current`.
- **Dónde:** `submitContact` en `quiz-flow.tsx` (líneas ~250–256).
- **Acción:**
  - [ ] Agregar la comparación de `session_id` a la condición de éxito.
- **Verificación:**
  - [ ] Un `session_id` devuelto distinto del enviado → se trata como fallo.

### M3 — El patch de transferencia no reproduce todo el entorno revisado

- **Problema:** `release/funnel-leads.patch` no incluye el upgrade de Next (15.5.25), los lockfiles ni la config de ESLint. Aplicarlo solo al repo central no garantiza el mismo resultado probado localmente.
- **Dónde:** `release/funnel-leads.patch` + `docs/15-transferencia-funnel-al-repo-del-os.md`.
- **Acción:**
  - [ ] Regenerar el patch incluyendo dependencias/lockfiles/ESLint necesarios (el upgrade de Next de seguridad puede ir como PR aparte, pero documentado y reproducible). Actualizar `docs/15`.
- **Verificación:**
  - [ ] `git apply --check` + `npm install && npm test && tsc && lint && build` en un clone fresco del repo de Miled.

---

## ⚪ Externo — sistema general del OS (comunicar a Miled, no es del equipo quiz/leads)

No bloquean el módulo, pero sí la seguridad de un deploy completo. Ticket independiente cada uno:

- [ ] Webhook de WhatsApp acepta tráfico si falta el secreto (`KAPSO_WEBHOOK_SECRET`).
- [ ] Posible SSRF y filtración de `KAPSO_API_KEY`.
- [ ] APIs de Inbox sin comprobación del permiso de módulo.
- [ ] Usuarios desactivados conservan sesión.
- [ ] Login sin rate limit.
- [ ] Webhook sin límites suficientes.
- [ ] SVG y otros medios activos servidos inline.
- [ ] Open redirect después del login.
- [ ] Falta CSP y protección contra framing.
- [ ] Vulnerabilidad productiva de PostCSS/Next (salto a Next 16, ticket aparte).

---

## Orden de ejecución sugerido

1. 🔴 C1 (migración `0072` de reconciliación real) + C2 (inmutabilidad) — misma migración.
2. 🟠 I1 + I2 + I3 (consentimiento) + I5 (revertido_de) — misma migración `0072`.
3. 🟠 I4 (carreras) con tests concurrentes.
4. 🟠 I6 (tracking) — frontend.
5. 🟠 I7 + I8 (selector) · I9 (`/leads` robusto) · I10 (permiso) · I11 (teléfono).
6. 🟠 I12 (tests obligatorias en CI) · I13 (rate limit).
7. 🟡 M1 + M2 (honeypot + session_id) · M3 (patch de transferencia).
8. Re-ejecutar la batería completa sobre el commit final y repetir la comparación base histórica ↔ base nueva.

---

## Definición de GO (recomendada)

Solo hay GO a producción cuando:

- ✅ C1 y C2 cerrados y verificados con bases históricas simuladas.
- ✅ I1–I13 cerrados (integridad de consentimiento, concurrencia, tracking, selector, robustez de `/leads`, permisos, teléfono, tests y rate limit).
- ✅ `supabase db reset` limpio + migraciones históricas equivalentes + suite completa **sin tests omitidos** en CI.
- ✅ M1–M3 cerrados.
- ⚪ Los 10 externos, comunicados a Miled como tickets (no bloquean el módulo).

*Generado el 23-sep-2026. Fuente: auditoría v4 (`respuesta despues de analisis v4.txt`) + verificación de código en `metacrypto-os-app/apps/inbox` y migraciones `0068–0071`.*
