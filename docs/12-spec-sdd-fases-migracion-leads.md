# 12 — Spec SDD: fases, validación y roadmap de la migración leads

Documento de **Spec-Driven Development** para ejecutar la migración del módulo de leads (spec funcional en `docs/11`) en fases con **validación de inicio y fin de cada una**. El repo actual es de desarrollo: nada de lo que hacemos acá impacta producción; el objetivo es que cada fase quede lista para migrar a producción sin retrabajo.

> **Regla de oro SDD:** si algo no está en este doc o en `docs/11`, no se implementa. Cualquier cambio de diseño entra **primero** editando el doc correspondiente, y recién después se codea. Cada fase no arranca hasta que la anterior tenga sus criterios de salida todos en ✅.
>
> Especificación funcional autoritativa: `docs/11`. Entorno local: `docs/10`. Seguridad: `docs/09`. Reglas del repo del OS: `metacrypto-os-app/CLAUDE.md`.

## 1. Principios del proceso

| # | Principio | Qué significa en la práctica |
|---|---|---|
| P1 | **Spec-first** | Cambio de requisitos → commit `docs(...)` primero → después el código que lo implementa, referenciándolo |
| P2 | **Fases con compuertas** | Cada fase tiene criterios de inicio (precondiciones) y de salida (DoD verificable con comandos). Nada avanza con compuertas pendientes |
| P3 | **Tests primero** | En el repo del OS: escribir el test, verlo fallar, implementar. Los tests nuevos de cada fase se agregan a su PR |
| P4 | **Solo desarrollo** | Todo se valida contra Supabase local (Docker, `docs/10`). Producción no se toca hasta Fase D |
| P5 | **Append-only + aislamiento** | Migraciones nuevas solamente; cero cambios a tablas/RPCs existentes del OS (docs/11 D3/D4). **Excepciones aprobadas y documentadas (docs/11 §9.4): `0070` amplía el CHECK de `personas.estado` con 'descartado', y `0071` re-aplica los constraints/grants propios del módulo de leads** |
| P6 | **Trazabilidad** | Cada fase cierra con evidencia: comandos ejecutados y resultado (output clave pegado en el PR) |
| P7 | **Un tema por PR** | Una fase = una rama = un PR. PRs chicos, review ágil (docs/07 §5) |

## 2. Convenciones transversales

- **Ramas:** `feature/leads-<fase>-<slug>` desde la rama de integración (ej. `feature/leads-a-migracion-rpc`).
- **Commits:** Conventional Commits en inglés, ligero (docs/07 §4).
- **Entorno de validación:** Supabase local + app dev, levantados según `docs/10` (`./scripts/dev.sh start` + `npm run dev`).
- **Comandos de validación base** (se repiten en cada compuerta de salida):

```bash
cd metacrypto-os-app
supabase db reset                 # migraciones + seed desde cero, sin errores
docker exec supabase_db_metacrypto-os-app psql -U postgres -d postgres -c "..."  # verificaciones SQL puntuales

cd apps/inbox
npm test                          # suite del OS (baseline al inicio: 1.246; actual: 1.329) + tests nuevos de la fase
npx tsc --noEmit                  # tipos limpios
```

- **Estado de las fases:** las casillas de este doc se marcan en el PR que las completa. Si un criterio de salida no se puede cumplir, la fase NO cierra y se documenta el bloqueo en `docs/06`.

## 3. Mapa de fases

```text
Fase 0 ─ preparación y baseline ──┐
                                  ▼
Fase A ─ migración 0068 + RPCs ───┤   (schema + lógica de datos, sin UI)
                                  ▼
Fase B ─ endpoint + funnel /quiz ─┤   (ingesta real desde el wizard portado)
                                  ▼
Fase C ─ módulo /leads ───────────┤   (consulta + vinculación post-venta)
                                  ▼
Fase D ─ pre-producción ──────────┘   (seguridad, release, entrega a Miled)
```

Cada fase produce algo **usable por la siguiente** y nada rompe lo anterior.

---

## Fase 0 — Preparación y baseline

**Objetivo:** arrancar Fase A con el entorno y la línea de base verificadas, y con la migración numerada oficialmente.

### Precondiciones (entrada)

- [ ] Entorno local funcionando según `docs/10` (base + app + login de dev)
- [ ] `docs/11` cerrada como spec autoritativa (hecho)

### Tareas

- [ ] Crear rama de integración de trabajo desde la actual
- [ ] **Confirmar con Miled el número de migración** (`0068` propuesto — puede estar reclamado en otra rama, trampa #5 del CLAUDE.md del OS). Si hay conflicto, actualizar `docs/11` §12 y este doc antes de escribir SQL
- [ ] Registrar el baseline real: `npm test` (cantidad de tests) y `npx tsc --noEmit` limpios
- [ ] Confirmar que `supabase db reset` corre limpio con seed incluido

### Criterios de salida (DoD)

- [ ] Número de migración confirmado por Miled y anotado acá: `____`
- [ ] Baseline registrado: tests `____` pasando · `tsc` limpio · `db reset` limpio
- [ ] Rama de trabajo creada

**Riesgos:** cambio de número de migración a último momento → mitigado confirmando antes de escribir SQL.

---

## Fase A — Migración `0068_quiz_leads.sql` + RPCs

**Objetivo:** el esquema y la lógica de datos del módulo existen en local y funcionan solos, sin UI. Referencia de diseño: `docs/11` §2–§9.

### Precondiciones (entrada)

- [ ] Fase 0 completa

### Tareas (orden)

- [ ] **Tests primero:** tests SQL de comportamiento del RPC (identidad, idempotencia, transiciones de estado, regla caliente) que fallan porque el RPC no existe
- [ ] `0068_quiz_leads.sql`:
  - [ ] Tabla `quiz_versiones` (+ `UNIQUE(codigo)`, `UNIQUE(funnel, variante, version)`, CHECK de estado)
  - [ ] Tabla `diagnostico_envios` (+ CHECKs de estado/consentimiento/capital, índices y `UNIQUE(session_id)` de `docs/11` §3.2)
  - [ ] Tabla `diagnostico_respuestas` (+ `UNIQUE(envio_id, question_id)`, índice `(question_id, answer_id)`)
  - [ ] **RLS habilitado** en las 3 tablas + políticas de lectura para `authenticated` (patrón existente del OS); escritura solo vía RPC con `service_role`
  - [ ] Seed de la versión `diagnostico-cripto-v1-a` con la definición vigente (mapeo de las 8 preguntas de `lib/question-config.js` a IDs estables, 6 rangos de capital exactos, `qualification hot-lead-v1`)
- [ ] RPC de ingesta transaccional (docs/11 §7): validar → normalizar → lock por `session_id` → advisory lock por contacto → reutilizar lead propio → crear `personas` lead con `telefono_e164 = NULL` → upsert respuestas → derivar capital → lead caliente → snapshot diagnóstico → commit. Transiciones de estado de §7 (completed nunca retrocede)
- [ ] RPC `vincular_lead_convertido(p_lead_id, p_cliente_id)` (docs/11 §9): transaccional, idempotente, archiva el lead temporal, no toca datos del cliente
- [ ] Tests SQL green + suite del OS intacta

### Criterios de salida (DoD)

- [ ] `supabase db reset` corre limpio desde cero (migraciones + seed + definición del quiz insertada)
- [ ] Verificación SQL directa del RPC (smoke): un `completed` crea envío + respuestas + persona lead con teléfono `NULL` + `es_lead_caliente` correcto por rango (falso en `capital_lt_10k`, verdadero en los otros 5)
- [ ] Reintento con el mismo `session_id` **no** duplica nada y devuelve el resultado existente
- [ ] Un beacon `dropped` tardío **no** degrada un `completed`
- [ ] `vincular_lead_convertido`: reasigna envíos, archiva el lead temporal, es idempotente al repetirlo
- [ ] Dos pestañas simultáneas con el mismo contacto no crean dos `personas` (advisory lock)
- [ ] Ninguna tabla/restricción/RPC preexistente cambió (`git diff` de la migración solo agrega)
- [ ] `npm test` en baseline + tests nuevos en verde · `tsc` limpio
- [ ] PR abierto con evidencia (§2 P6)

**Fuera de alcance:** endpoint HTTP, UI, funnel (eso es Fase B/C).

---

## Fase B — Endpoint `POST /api/lead` y funnel `/quiz` en el OS

**Objetivo:** el quiz real corre dentro del OS (`apps/inbox`) y persiste de verdad en el Supabase local. Referencias: `docs/11` §5–§6, endurecimiento del stub actual (`app/api/lead/route.js` de este repo) y `docs/09`.

### Precondiciones (entrada)

- [ ] Fase A mergeada
- [ ] Definición `diagnostico-cripto-v1-a` visible vía `quiz_versiones` (para validar el contrato)

### Tareas (orden)

- [ ] **Port del wizard a `apps/inbox`** como ruta pública `/quiz` (React 19 → 18: portar componentes y estilos, **no** copiar el lockfile)
- [ ] Excepciones públicas en `middleware.ts` para `/quiz` y `/api/lead` (patrón de excepciones existente)
- [ ] Selector de país/prefijo en el formulario de contacto (D12) y normalización E.164 server-side
- [ ] Captura automática de UTMs + `referrer` al inicio, persistidas con el `session_id` (§6)
- [ ] Eventos `started`, `progress`, `dropped` (sendBeacon) y `completed` con el contrato JSON de §5
- [ ] `POST /api/lead` (route.ts, runtime Node): validación cerrada contra la definición de la versión, honeypot, body cap, same-origin, rate limit in-memory (el definitivo es Fase D), `service_role` solo server, **cero PII en logs de producción**, respuesta `ok/session_id/submission_id/status` sin exponer `persona_id`
- [ ] Contacto persistido **antes** de mostrar el resultado final (regla §5 Fase B.6 de `docs/11`)
- [ ] Tests: port/adaptación de la suite del quiz + tests nuevos de endpoint (validación, idempotencia, eventos) + OS suite verde

### Criterios de salida (DoD)

- [ ] Flujo completo en local con datos de prueba: `/quiz` → completar → lead visible por SQL con estado `completed`, respuestas, UTMs y diagnóstico snapshot
- [ ] Abandono a mitad del wizard → envío en `dropped` con `last_step_id/index` correctos
- [ ] Payload inválido (campo ajeno, versión de quiz desconocida, pregunta ajena a la versión, body gigante) → rechazo con código honesto y sin PII en logs
- [ ] Honeypot y rate limit funcionando (verificables con curl)
- [ ] El envío del formulario **exige** nombre + email + teléfono + consentimiento (D2) y el servidor re-valida el consentimiento versionado
- [ ] `npm test` en verde · `tsc` limpio · PR con screenshots del flujo

**Riesgo conocido:** trampa #1 del CLAUDE.md — no correr `next build` con el dev arriba.

---

## Fase C — Módulo `/leads`

**Objetivo:** el equipo del negocio consulta los leads y ejecuta la vinculación post-venta. Referencia: `docs/11` §9–§10.

### Precondiciones (entrada)

- [ ] Fase B mergeada (hay leads reales de prueba que mirar)

### Tareas (orden)

- [ ] Permiso `leads`: clave en `ModuloKey` + asignación operativa (quién lo recibe lo define Miled/Berni — anotar en el PR)
- [ ] Entrada de navegación en `OsNav` + protección con `requireModulo("leads")` en página, acciones y APIs (no basta ocultar el menú)
- [ ] Listado server-side con paginación: fecha, versión/variante, contacto capturado, capital, calificación, estado funnel, último paso, campaña, conversión (§10)
- [ ] Filtros de §10 (fechas, caliente, estado, banda de capital, paso de abandono, UTMs, búsqueda)
- [ ] Detalle: contacto/consentimiento, UTMs, timeline, respuestas en orden renderizadas desde snapshots (sin asumir preguntas fijas), diagnóstico mostrado, regla y motivo de calificación, link a la persona
- [ ] Acción de vinculación post-venta con selector de cliente → `vincular_lead_convertido`
- [ ] Seed ampliado: leads de prueba en todos los estados (caliente/no/indeterminado, dropped en distintas preguntas, convertido) para validar filtros
- [ ] CSS nuevo solo en `app/inbox.css` (trampa #3) · tests de las lib nuevas

### Criterios de salida (DoD)

- [ ] Checklist manual de UI (listado + filtros + detalle + vinculación) ejecutado en local con el seed, evidencia en el PR
- [ ] Un usuario **sin** permiso `leads` no accede por URL directa ni por acción (verificado)
- [ ] La vinculación por UI produce el mismo resultado que el SQL de Fase A (reasignación + archivado, idempotente)
- [ ] `npm test` en verde · `tsc` limpio · PR con screenshots

---

## Fase D — Pre-producción y entrega

**Objetivo:** dejar todo listo para que Miled aplique y despliegue sin sorpresas. Referencias: `docs/09` (checklist) y `docs/08` §4.

### Tareas (orden)

- [ ] Checklist de `docs/09` sobre `/api/lead` + tablas nuevas: RLS, headers, rate limit, PII en logs, secrets en variables de entorno (ninguna credencial en el repo)
- [ ] Rate limiting definitivo según hosting del negocio (bloqueante #14/#15 de `docs/06`) — si el hosting lo resuelve por WAF, documentar la configuración pedida
- [ ] Re-sincronización con producción si cambió (`db pull` → migration de diff, con Miled)
- [ ] PR de release: conjunto de migraciones consolidado + revisión de Miled
- [ ] **Miled aplica la migración a producción ANTES del deploy del código** (trampa #4)
- [ ] Variables de entorno necesarias en producción: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `AUTH_TOKEN` (+ existentes del OS); nada nuevo hardcodeado
- [ ] Smoke test en producción con datos falsos (flujo completo + verificación en `/leads` + limpieza de datos de prueba)
- [ ] Actualizar `docs/06` (bloqueantes cerrados) y `docs/08` (estado de fases)

### Criterios de salida (DoD)

- [ ] `0068` aplicada en producción y código desplegado en ese orden
- [ ] Smoke test punta a punta en producción verde
- [ ] Docs actualizadas (`06`, `08`, este doc)

---

## 4. Trazabilidad requisito → fase

| Requisito (docs/11) | Fase | Verificación |
|---|---|---|
| Tablas + RLS + definición del quiz (§2–§3) | A | `db reset` + SQL smoke |
| RPC de ingesta transaccional e idempotente (§7) | A | Tests + reintentos simulados |
| Regla hot-lead-v1 server-side (§8) | A | SQL smoke por cada rango |
| Vinculación post-venta (§9) | A (RPC) + C (UI) | SQL + checklist UI |
| Contrato JSON v1 (§5) | B | Tests de endpoint |
| Funnel portado + UTMs + selector país (§6, D12) | B | Flujo manual + curl |
| Módulo `/leads` con permiso propio (§10, D13) | C | Checklist UI + test de acceso |
| Seguridad/privacidad (§11) | A–D | Checklist docs/09 en Fase D |
| Alerta de triaje (D15) | Post-Fase D (PR separado) | — |

## 5. Cómo se incorporan cambios nuevos después

1. Se edita la doc de diseño que corresponda (`docs/11` o esta) **primero**.
2. Si el cambio toca DB → migración nueva append-only (número confirmado), nunca editar `0068`.
3. Nueva rama + tests primero + mismo circuito de compuertas.
4. `docs/06` actualizado en el mismo PR si afecta bloqueantes.

## 6. Estado actual de las fases

| Fase | Estado | Fecha cierre |
|---|---|---|
| 0 — Preparación | ✅ Baseline verificado (tests, tsc, db reset limpios, rama de trabajo). Número de migración reservado como `0068/0069` — **pendiente única confirmación formal con Miled antes del PR a producción** | — |
| A — Migración + RPCs | ✅ `0068_quiz_leads.sql` (3 tablas + RLS + definición `diagnostico-cripto-v1-a` + RPC `registrar_diagnostico`) y `0069_vinculacion_validacion_rollback.sql` (validación de teléfono + auditoría + `desvincular_lead`). 22 tests de integración | — |
| A-2 — Corrección de bloqueantes | ✅ (22-sep-2026) Corregidos los 6 bloqueantes del análisis externo + los hallazgos propios de la auditoría v2 (teléfono E.164 por país, tracking con IDs canónicos, rotación de sesión, filtros de capital, beacon tardío idempotente, fecha de consentimiento futura, descarte de lead ya vinculado) | 22-sep-2026 |
| A-3 — Reconciliación 0071 | ✅ (22-sep-2026) `0071_reconciliacion_leads.sql` (auditoría v3 H-01): estado final garantizado sobre cualquier base. Incluye: trigger de inmutabilidad de versiones publicadas (H-04), consent solo versión canónica 'contacto-v1' + coherencia temporal (H-05), lock canónico de contacto en vincular/desvincular/descartar (H-06), rollback ESTRICTO sin éxito parcial + UUID real en auditoría (H-07), RLS sin policies genéricas + grants solo service_role (H-08), last_step protegido tras el abandono (H-09c), retry idempotente con versión pausada (M-04). Validación: `db reset` limpio 0001→0071, vitest **1329/1329 (0 omitidos)**, `tsc` limpio, `eslint` compuerta (0 errores), build OK, prototipo 39/39 | 22-sep-2026 |
| B — Endpoint + funnel | ✅ Funnel portado a `/quiz` (layout con fuentes propias + `app/quiz.css` scopeado), middleware con excepciones públicas, selector de país + E.164, UTMs automáticas, eventos `started/progress/dropped/completed` con respuestas acumuladas en cada evento, endpoint endurecido, contacto persistido antes del resultado. **Validado punta a punta por el usuario** | — |
| C — Módulo /leads | ✅ Permiso `leads` + grupo "Captación", listado con filtros y paginación, detalle con snapshots, vinculación post-venta con validación de teléfono (confirmación explícita si difieren), auditoría y rollback (`desvincular_lead`), seed en todos los estados. **Validado por el usuario** (link, confirmación, rollback auditados en `auditoria`) | — |
| D — Pre-producción | 🟡 Cierre local completo: checklist `docs/09` verificado y documentado (RLS/service_role/IDOR/SQLi → ítems 27-30 cerrados; hallazgo: 1 RCE crítica de Next en el toolchain del OS → bloqueante #20), preguntas para Miled listadas en `docs/06`, rate limit definitivo diferido al hosting. Pendiente externo: respuestas de Miled (hosting, números de migración, permiso `leads`), PR/merge y despliegue | — |
| A-4 — Cierre auditoría v4 | ✅ (23-sep-2026) Migración `0072_reconciliacion_leads_v2.sql` (append-only, números confirmados por Miled): C1 validador final redefinido para bases históricas, C2 inmutabilidad sin despublicar, I1 consentimiento acotado al recorrido, I2 CHECK contra strings vacíos, I3 marcador honesto `legacy-sin-registro`, I4a carrera de sesión `version_conflictada`, I5 `revertido_de` con UUID, I6 `dropped` registra su paso. Código: tracking (primera pregunta/retroceso/rotación de sesión), selector de clientes server-side con programa (I7/I8), `/leads` robusto a fechas inválidas (I9), permiso `leads` sin enlace a `/clientes` (I10), teléfono AR `15`→`9` (I11), suites gated obligatorias en CI (I12), rate limit 30/min (I13), honeypot al endpoint (M1), `session_id` comparado (M2). Validación: vitest **1343/1343 (0 omitidos)**, `tsc` limpio, `eslint` 0 errores, `next build` OK, patch de transferencia regenerado y verificado | 23-sep-2026 |
