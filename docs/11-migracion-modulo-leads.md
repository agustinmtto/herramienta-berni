# 11 — Migración del módulo de leads: decisiones y enfoque

Doc de trabajo para la integración Quiz Funnel → MetaCrypto OS (persistencia de leads). Consolida lo decidido, deja explícito lo pendiente y fija las reglas de juego del desarrollo para que no queden dudas ni peligros.

> **Estado:** borrador activo. Las secciones marcadas `PENDIENTE (dueño: Agustín)` se completan cuando se definan el JSON y las tablas; recién ahí arranca la implementación (migración + RPC + endpoint).
>
> Insumos: `docs/03` (spec), `docs/08` (fases), `docs/09` (seguridad), `ANALISIS_INTEGRACION_QUIZ_LEADS.md` (diseño completo), `metacrypto-os-app/CLAUDE.md` (reglas del repo del negocio).

## 1. Decisiones cerradas

| # | Decisión | Resolución |
|---|---|---|
| D1 | **Dónde vive el funnel** | **Portado al OS** (`apps/inbox`, ruta pública `/quiz`). Un solo deploy en el hosting del negocio, sin secretos interservicio ni CORS. El repo actual (`herramienta-berni`) queda como prototipo de referencia. |
| D2 | **Contacto obligatorio** | Nombre + email + teléfono + consentimiento son **obligatorios** para pedir el diagnóstico (ya implementado en el wizard). No existen envíos "solo email" ni "solo teléfono". |
| D3 | **Atribución** | Columnas UTM (`utm_source/medium/campaign/content/term` + `referrer`) desde la migración v1, nullable. El wizard las captura si están presentes en la URL. |
| D4 | **Consentimiento** | Validado por el negocio (texto aprobado existe). Al implementar, el JSON debe llevar `consentimiento_version` + timestamp; el texto queda versionado en el repo. |
| D5 | **Rangos de capital** | 6 rangos confirmados (§4). El primero termina justo en el umbral de 10.000 USD. |
| D6 | **Lead caliente** | Regla **server-side** derivada del `answer_id` del rango de capital. Nunca se confía en un flag del cliente. |
| D7 | **Módulo `/leads`** | Lo implementa nuestro equipo (cierra bloqueante #4 de `docs/06`). Permisos y navegación según patrones del OS. |
| D8 | **Alerta de triaje** | **Fase separada** (después de persistencia y módulo). No se implementa en la entrega de la migración. |

## 2. Pendientes de definición — bloquean el arranque del código

### 2.1 Contrato JSON final — `PENDIENTE (dueño: Agustín)`

Cierra el bloqueante #2 de `docs/06`. Criterios mínimos que debe cumplir (el diseño fino es de Agustín):

- [ ] `session_id`: UUID real generado en cliente, estable durante todo el recorrido (idempotencia).
- [ ] `schema_version` (contrato API) y `questionnaire_version` (versión de preguntas) como strings/ints explícitos.
- [ ] Respuestas con **identidad estable** por pregunta y por opción (IDs que no cambien si se edita un texto). Sugerencia del análisis: `question_id`, `answer_id`, `answer_text`, `answer_value` estructurado (para rangos/porcentajes), `question_order` — decisión final abierta entre "IDs estables", "texto libre" o "IDs + snapshot de texto".
- [ ] `signals` de tracking: `reached_stage`, `dropoff_question`, `visited_stages`, `finished_at` (ya existe en el stub).
- [ ] `lead`: `name`, `email`, `phone`, `consent: true`, `consentimiento_version`.
- [ ] UTMs capturadas al inicio del funnel y adjuntas al payload.
- [ ] El mismo payload sirve para finalización y para abandono (beacon), como hoy.

### 2.2 Diseño de tablas — `PENDIENTE (dueño: Agustín)`

- [ ] Tablas del módulo (base propuesta por el análisis: `diagnostico_envios` + `diagnostico_respuestas`, opcional `diagnostico_eventos` más adelante).
- [ ] `session_id` único por envío (upsert idempotente), FK a `personas` nullable, estado del funnel (`started/in_progress/dropped/completed`), snapshot de contacto capturado, flag `es_lead_caliente` + `motivo_calificacion`, `necesita_revision`.
- [ ] Columnas UTM (D3) y campos de consentimiento (D4).
- [ ] **Decisión abierta dentro de este punto:** ¿se persiste `diagnosis_result` (jsonb) o solo `diagnosis_version`?
- [ ] RLS habilitado + índices mínimos: `(es_lead_caliente, created_at DESC)`, `(estado, created_at DESC)`, `persona_id`, `UNIQUE(envio_id, question_id)` para respuestas.
- [ ] Retención de datos: **pendiente de decisión de negocio** (bloqueante #18). No bloquea escribir la migración, sí bloquea producción.

### 2.3 Número de migración

- [ ] Confirmar con Miled el número antes de escribir el archivo (siguiente libre visible: **0068**; puede estar reclamado en ramas sin merge — trampa #5 del CLAUDE.md del OS).

## 3. Identidad y deduplicación (simplificada por D2)

Como el wizard exige **email y teléfono juntos**, desaparecen los casos parciales. Solo quedan tres situaciones, resueltas por el RPC:

| Situación al recibir el envío | Acción |
|---|---|
| Email **y** teléfono coinciden con la misma persona existente | Vincular el envío a esa persona. Si ya es cliente, **no** degradarla a lead. |
| No coincide nada (normalizado) | Crear `personas` con `estado='lead'` y vincular. |
| Coincide algo pero **contradice** (email de una persona con teléfono de otra, o email/teléfono de personas distintas) | **No crear, no fusionar, no sobrescribir.** Guardar el envío con `necesita_revision=true` y `resolucion_identidad='revision'` para que un humano decida. |

Normalización previa en servidor antes de comparar: email trim + minúsculas; teléfono a E.164 (máx. 15 dígitos). Nunca confiar en el formato del navegador. Nunca exponer en la respuesta del endpoint si hubo coincidencias con personas existentes.

## 4. Regla de lead caliente (D5/D6)

Rangos confirmados de la pregunta de capital:

1. Menos de 10.000 USD
2. Entre 10.000 y 25.000 USD
3. Entre 25.000 y 50.000 USD
4. Entre 50.000 y 100.000 USD
5. Entre 100.000 y 250.000 USD
6. Más de 250.000 USD

**Regla:** lead caliente = respuesta en los rangos 2–6 (capital > 10.000 USD). Se calcula **en el RPC** a partir del `answer_id` estructurado, se guarda `es_lead_caliente` + `motivo_calificacion` + versión de la regla (`hot-lead-v1`). Si un envío viejo trae un rango ambiguo respecto del umbral, el flag queda `NULL` (indeterminado), nunca `false`.

## 5. Plan de desarrollo (fases separadas, PRs acotados)

### Fase A — Persistencia segura (arranca cuando §2 esté completa)

1. `0068_diagnostico.sql` (número confirmado): tablas + CHECKs + índices + **RLS day 1**.
2. RPC transaccional de ingesta en la misma migración: identidad (§3) → upsert envío por `session_id` → upsert respuestas → derivar capital → lead caliente (§4) → marca de revisión. Todo-o-nada.
3. Idempotencia: mismo `session_id` no duplica; un `completed` nunca vuelve a `in_progress` por un beacon tardío; respuestas repetidas se actualizan.
4. Endpoint en el OS: `apps/inbox/app/api/lead/route.ts` (port del endurecimiento del stub actual: allow-list, honeypot, body cap, same-origin, rate limit, logs sin PII en prod) que llama al RPC con `service_role` **solo en servidor**.
5. Wizard portado a `apps/inbox` como ruta pública `/quiz` (React 19 → 18: portar componentes, **no** copiar el lockfile).
6. Tests: nuevos (RPC/identidad/idempotencia/endpoint) + los 1.246 del OS en verde + suite del quiz adaptada.
7. `supabase db reset` en limpio antes del PR.

**Salida:** los leads persisten en Supabase aunque el reporte aún no exista.

### Fase B — Módulo `/leads` (consulta)

- Permiso `leads` (`ModuloKey` + asignación a quién define Miled/Berni), entrada en `OsNav`, `requireModulo`.
- Listado: fecha, nombre, contacto, capital, calificación, estado del funnel, último paso (dropoff), estado de identidad, conversión.
- Filtros: fechas, caliente, estado funnel, revisión, banda de capital, pregunta de abandono, búsqueda.
- Detalle: contacto y consentimiento, UTMs, timeline, todas las respuestas en orden, motivo de calificación, aviso de conflicto de identidad, link a la persona.
- CSS nuevo a `app/inbox.css` (nunca `globals.css` — trampa #3).

### Fase C — Alerta de triaje (D8)

- Novedad `entidad='diagnostico', accion='lead_caliente'` en la lista blanca de `lib/novedades.ts`.
- Push/email al triaje solo con aprobación de privacidad (sin capital exacto en la notificación).

### Fase D — Producción (con Miled)

- Revisión del PR de release, `db pull` si producción cambió mientras desarrollábamos.
- Migración aplicada a mano por Miled **antes** de desplegar código (trampa #4).
- Smoke test con datos de prueba + hosting definido (bloqueante #14: ahí se define el rate limit real).

## 6. Reglas fijas (peligros acordados)

1. **Migración antes que código**: aplicar la migración antes de desplegar código que lea las tablas nuevas; si no, PostgREST devuelve 400 en silencio y las pantallas quedan vacías (trampa #4).
2. **Migraciones append-only**: nunca editar una ya mergeada; se agrega una nueva encima.
3. **RLS habilitado desde la creación** de las tablas nuevas; `service_role` únicamente en código de servidor; el endpoint público nunca expone la clave.
4. **Endpoint público endurecido**: validación con esquema cerrado, límites de tamaño/cantidad/longitud, rate limit por IP, honeypot, `session_id` UUID real, códigos HTTP honestos, **cero PII en logs de producción**.
5. **Identidad conservadora**: nunca fusionar ni sobrescribir automáticamente; contradicción → `necesita_revision` (§3).
6. **Lead caliente solo en servidor** (D6); el cliente puede decorar la UI, no decide prioridad comercial.
7. **Idempotencia de beacons**: el abandono no puede pisar una finalización (§5 Fase A.3).
8. **Tests primero en el repo del OS** (tests → verlos fallar → implementar); `supabase db reset` en limpio antes de cada PR.
9. **Retención de datos**: decisión pendiente de Berni (bloqueante #18) — el snapshot de contacto en el envío duplica PII; definir política antes de producción.
10. **Nada bajo `app/c/` ni `app/e/` ni envío de comunicaciones reales** sin validación explícita (reglas del CLAUDE.md del OS).

## 7. Cómo seguimos

1. Agustín completa §2.1 (JSON) y §2.2 (tablas) → se actualiza este doc.
2. Con eso cerrado, se escribe `0068_diagnostico.sql` + RPC, se valida con `supabase db reset` en local (guía `docs/10`).
3. Fase A completa → PR → Fase B → PR → Fase C.
