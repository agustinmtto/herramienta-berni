# 19 - QA del funnel: cómo funciona todo, qué se usa y qué no

Informe de la revisión de aseguramiento de calidad (06-oct-2026). Alcance: **solo el funnel de leads** (`/quiz`, `/api/lead`, `/leads`, migración `0068`); el resto del OS queda fuera de scope. Conclusiones también resumidas en `AGENTS.md` §Estado.

**Veredicto global: el funnel está bien construido, sin sobre-ingeniería, listo para el GO técnico.** Pendientes únicamente operativas (`docs/18`): patch contra el HEAD central, rate limit distribuido del operador, smoke post-despliegue y los videos (deuda del negocio).

---

## 1. La estructura del repo explicada (por qué existían "dos funnels")

Durante casi todo el proyecto el repo tenía **dos copias** del mismo funnel:

| | Qué era | Estado |
|---|---|---|
| **Prototipo standalone** (raíz del repo: `app/`, `components/`, `lib/`, `test/`) | Un proyecto Next.js propio e independiente, hecho para validar el flujo ANTES de tener acceso al sistema del negocio. Era el `route.js` lleno de `if` que intentaste leer | **Historico. Retirado el 06-oct-2026** (borrado del repo; ```git history``` lo conserva y `docs-obsoletos/` documenta su jubilación) |
| **El funnel real** (`metacrypto-os-app/apps/inbox/`) | El mismo funnel portado a TypeScript DENTRO del sistema del negocio (el "OS"): la ruta pública `/quiz` + módulo privado `/leads`, con las mismas preguntas pero integrado a la base real (clientes, programas, auditoría) | Con la separación D2 (06-oct pm): el funnel público salió de acá y es `apps/funnel/`; en `inbox` quedó el módulo `/leads` |
| **App pública `apps/funnel/`** (decisión D2) | El wizard + `/api/lead` en una app propia, en su propia instancia/dominio, escribiendo por el rol mínimo `funnel` del Supabase. **Esto es lo que deploya como sitio público** | Vigente |

La decisión de negocio D1 (`docs/11`) explica el porqué: el funnel vive como ruta pública **dentro** del OS del negocio, no como un sitio aparte. El prototipo fue una herramienta para llegar acá; quedarse duplicado solo generaba confusión (como el `route.js` que levantaste) y hacía doble trabajo en CI.

## 2. El funnel en simple: cómo funciona punta a punta

1. **El lead entra a `/quiz`** (pública, sin login). `app/quiz/quiz-flow.tsx` renderiza la portada y arranca el wizard con una sesión nueva (`session_id`).
2. **Las 8 preguntas** viven en `lib/quiz/question-config.ts` (datos, no código): cambiar el contenido del quiz toca ese archivo y nada más.
3. Cada avance manda un evento a `POST /api/lead` (`started` / `progress`), y si el lead cierra el navegador a mitad, un beacon manda `dropped` con "en qué pregunta quedó" — esa es la métrica de negocio del tracker.
4. El endpoint (`app/api/lead/route.ts`) valida el paquete (formato cerrado, tamaño, rate limit, honeypot, same-origin) y llama a la base **de una sola pieza**: el RPC transaccional `registrar_diagnostico` (migración `0068`), que guarda respuesta + contacto + diagnóstico y calcula el flag de lead caliente (capital ≥ 10.000 USD, leído de la definición publicada, nunca del navegador).
5. Al terminar, el lead ve su diagnóstico (generado por `lib/quiz/engine.ts`, algoritmo puro: cada respuesta suma tags y las reglas del motor deciden los textos) + sus 3 videos + botón de **WhatsApp** con las respuestas precargadas (`lib/quiz/whatsapp.ts`). En ese mismo momento la pantalla ya confirmó que el contacto quedó guardado.
6. Post-venta, el triaje (módulo `/leads`, permiso `leads`): ve los recorridos, los calientes primero, y **vincula** el lead temporal al cliente definitivo (o lo **descarta** si no hubo venta). Toda mutación va por RPC con auditoría; el rollback (`desvincular_lead`) revierte exactamente lo que vincular movió.

## 3. Inventario archivo por archivo

### 3.1 Funnel público (los únicos archivos que el lead toca)

| Archivo (en `apps/inbox/`) | Qué hace | Veredicto QA |
|---|---|---|
| `app/quiz/page.tsx` (11 l) | Página server que solo renderiza el wizard | ✅ SIMPLE |
| `app/quiz/layout.tsx` (19 l) | Tipografías del funnel (CSS aislado del OS) | ✅ SIMPLE |
| `app/quiz/quiz-flow.tsx` (691 l) | Máquina de estados: hero → wizard → análisis → final. Envía los eventos. Armado en subcomponentes (`ContactForm`, `AllocationQuestion`, `Callout`, `AnalysisTimer`) con comments que documentan por qué cada defensa existe (rotación de sesión, beacon de pagehide, doble-click guard) | ✅ ACEPTABLE — lo único "denso" son defensas contra bugs reales que auditorías v2–v5 sí encontraron; cada una tiene su porqué escrito acá mismo |
| `lib/quiz/question-config.ts` (284 l) | Las 8 preguntas, textos, opciones, tags, barra de progreso, textos de consentimiento | ✅ SIMPLE (datos) |
| `lib/quiz/engine.ts` (125 l) | Diagnóstico determinístico: tags → 4 secciones + plan + flag caliente de pantalla | ✅ SIMPLE (reglas puras) |
| `lib/quiz/lead-payload.ts` (249 l) | Armado del contrato JSON: respuestas → formato backend; teléfono por país/prefijo con la normalización argentina; captura de UTMs | ✅ ACEPTABLE — la tabla de países es el catálogo de 17 del formulario; todo lo demás son helpers puros |
| `lib/quiz/whatsapp.ts` (45 l) | Arma el enlace/mensaje de WhatsApp con saneamiento (solo dígitos + encode) | ✅ SIMPLE |
| `app/quiz.css` | Estilo del funnel | ✅ |

### 3.2 Endpoint público e infra

| Archivo | Qué hace | Veredicto QA |
|---|---|---|
| `app/api/lead/route.ts` (150 l) | POST único: rate limit bruto → content-type → same-origin → body cap ×2 → parse JSON → validación cerrada → honeypot (200 falso) → rate limit por bucket → RPC → verificación de la respuesta → mapeo de errores a HTTP honestos | ✅ ACEPTABLE — 8 compuertas, cada una de 3–6 líneas propias y testeada |
| `lib/quiz/lead-validate.ts` (214 l, ya reducida) | Validación cerrada del contrato (~40 checks) + normalización server-side + validación del resultado del RPC + mapeo de errores | ✅ ACEPTABLE — duplica al RPC a propósito (rechazar basura con 4xx, no 500); con los restos muertos ya fuera, los dos validadores son espejo del mismo contrato |
| `lib/quiz/rate-limit.ts` (55 l) | Contadores in-memory best-effort, honesto sobre su alcance | ✅ SIMPLE |
| `lib/supabase.ts` (70 l) | PostgREST genérico con service_role (server-only) + escape HTML-like | ✅ SIMPLE |
| `middleware.ts` (125 l) | Auth global del OS; funnel exento explícitamente (`/quiz`, `/api/lead`) con el motivo escrito | ✅ (exento bien delimitado; el resto es del OS) |

### 3.3 Base de datos (paquete del módulo)

| Objeto | Qué es | Veredicto QA |
|---|---|---|
| `0068_quiz_leads.sql` (migración única consolidada) | 3 tablas + índices + RPCs (ingesta, vincular, desvincular, descartar) + validador de respuestas + trigger de estados finales + lock canónico + vista del selector + RLS/grants + definición del quiz | ✅ Uno de los pocos objetos grandes pero justificado: todo el comportamiento probado por la suite vive acá, sin compatibilidad histórica |
| RPC `registrar_diagnostico` | Ingesta transaccional completa | ✅ |
| RPCs `vincular/desvincular/descartar` | Ciclo comercial post-venta (docs/11 §9) | ✅ |
| Trigger `diag_envios_guard` | Inmutabilidad de completed + terminalidad de dropped (2 reglas simples) | ✅ (red de seguridad si algún service_role escribe directo) |
| Trigger `quiz_versiones_congelada` | Publicar es irreversible | ✅ |
| Vista `v_clientes_para_vincular` | Solo clientes con programa activo | ✅ |

### 3.4 Módulo interno `/leads` (el triaje)

| Archivo | Veredicto QA |
|---|---|
| `app/(os)/leads/page.tsx` + `lib/leads.ts` (350 l) + `leads-actions.ts` (132 l) + `[id]/page.tsx` + `VincularLead.tsx` | ✅ ACEPTABLE — es el negocio en sí (docs/11 §9); server-side read-only + 3 server actions → RPCs; el picker de clientes paginado existe porque el cap silencioso era un bug real |

### 3.5 Lo retirado en esta iteración (por qué ya no existe)

- **Prototipo standalone** (`app/`, `components/`, `lib/`, `test/`, `package.json` raíz, `next.config.mjs`, `middleware.js` raíz): era referencia histórica; su lógica vive portada y testeada en el OS (`quiz-libs.test.ts` es el port de sus suites). Queda en `git history` + `docs-obsoletos/`.
- **Maquinaria de compatibilidad SQL** (`0069–0073`): staging de preflight, taxonomía `legacy-unknown`, columnas `*_origen`,.trigger viejo subsumido, doble familia de advisory locks — defensas para instalaciones históricas que nunca existieron.
- **Código muerto TS**: honeypot duplicado a nivel raíz, `client_context` (nunca persistido), `normalizePhoneE164`, marker UI `sin registro/revisar`.
- **Workflow de CI raíz duplicado** (copiado 1:1 del del módulo y encima construía el prototipo en PRs de docs).

## 4. Reglas de negocio — validadas por tests automáticos

Cada regla cerrada tiene test: 
- lead caliente **capital ≥ 10.000 USD inclusive** (los 5 rangos desde 10k → `true`; <10k → `false` explícito) — `quiz-leads-rpc.test.ts`,
- diagnóstico **determinístico** y no vacío: 4 perfiles A–D fijados como regresión — `quiz-libs.test.ts`,
- consentimiento con versión canónica y fecha coherente al recorrido (no futura, no anterior al inicio, no posterior a la finalización),
- teléfono argentino a móvil canónico `+549…` con coherencia país/prefijo,
- doble submit / beacon tardío / recarga: idempotencia sin ficheros duplicados ni identidad duplicada,
- vincular ↔ desvincular ↔ descartar: conflictos serializados, cada operación produce UN resultado exacto y auditable,
- quien no es equipo no lee datos del funnel (RLS), y los logs del endpoint no contienen PII.

## 5. Seguridad (nivel "medio-asegurado", correcto para un MVP público)

- ✅ RLS denegado por defecto en las 3 tablas del módulo; lectura/escritura SOLO por los RPCs con `service_role` desde el servidor.
- ✅ Honeypot, same-origin, body cap (413), content-type (415), errores honestos (400/422/502), rate limit por IP con cuotas separadas (tracking 30/min, completed 5/min), sin PII en logs ni en la auditoría.
- ⏳ **Dos piezas dependen del hosting al deployar** (ya son del runbook `docs/18` §3/§5): HTTPS/HSTS efectivos y el rate limit distribuido (WAF/Upstash) — el del código es honesto best-effort.

## 7. Actualización posterior del mismo día (separación D2)

Motivo: seguridad. El OS tiene tickets de seguridad pendientes y quedabaDB el funnel público viviendo en la misma app que el login del equipo — se aisla.

## 6. Qué queda (todo operativo, no de código)

1. Validar el patch contra el HEAD real del repo central (con acceso al repo).
2. Rate limit distribuido del operador.
3. Backup/migración/deploy/smoke según `docs/18`.
4. Deudas de negocio fuera de alcance: videos y URLs definitivas.

## 7. Actualización posterior del mismo día (separación D2)

Motivo: seguridad. El OS tiene tickets de seguridad pendientes y el funnel público operaba dentro de la misma app que el login del equipo — se aísla. Los veredictos QA de §3.1 y §3.2 siguen valiendo tal cual: los archivos se MOVIERON, no se reescribieron.

Qué cambió exactamente:- Nueva app `apps/funnel/` (Next minimal): `app/quiz/*`, `app/quiz.css`, `app/api/lead/route.ts` y `lib/quiz/*` (los mismos archivos, veredictos QA de las §3.1/3.2 valen tal cual) + `lib/db.ts` (cliente mínimo con su env propia) + `scripts/mint-funnel-token.mjs`.
- Nueva migración `0069_funnel_db_role.sql`: rol `funnel` **solo** con EXECUTE de `registrar_diagnostico` + SELECT de la definición publicada. Aislamiento probado con el JWT real: ingesta 200; lectura de envíos/personas 403; RPCs del triage 403.
- En `apps/inbox` se **retiraron** `/quiz`, `/api/lead`, `lib/quiz/*` y las excepciones del middleware en el funnel: el OS no expone rutas públicas. El módulo `/leads` y sus tests quedan intactos.
- Compuertas re-corrídas tras la separación: funnel 5 suites / 68 tests (gated con el rol funnel) + inbox 55 suites (RPC service_role + leads) · `tsc`/`eslint`/`build` OK en ambas apps.

## 8. QA E2E del módulo /leads con browser real (06-oct pm, tanda 2)

Recorrida administrativa completa como triaje (login dev `milo`): listado con filtros y contadores, detalle del lead, picker de clientes, vincular con confirmación, rollback (`desvincular`) y descarte.

**Hallazgo y corrección:** el detalle del lead NUNCA cargaba. El lookup de la auditoría usaba el filtro de contención JSON por REST: con `datos.cs={...}` PostgREST responde 400 (PGRST100) y con la sintaxis de punto esta build (`postgrest/16.4`) IGNORA el filtro silenciosamente (devuelve todas las vinculaciones). La pantalla enseña el error controlado (buen diseño de errores honestos) pero era un bug real. **Fix: migración `0070_auditoria_lead_del_envio.sql`** — RPC SQL `auditoria_lead_del_envio(uuid)` con containment nativo `@>` de Postgres, `stable`, ordenado como las demás RPC del ciclo (`created_at desc, id desc`); `getLeadDetalle` la llama y el EXECUTE queda solo a `service_role`.

**Verificado en vivo con el browser (y cubierto por los RPC de base):**
- Listado: completados con contacto correcto, abandonos "sin contacto", badges Caliente/Frío/Indeterminado
- Picker: SOLO clientes con programa vigente (Sofía excluida porque su programa venció — el filtro I7 funciona de verdad)
- Vincular con teléfonos distintos SIN confirmar → rechazo `telefono_no_coincide` con mensaje claro en UI
- Vincular CONFIRMADO → lead temporal `archivado`, envío reasignado al cliente, auditoría con `envio_ids` exactos y SIN teléfonos (PII strip real)
- Desvincular → rollback EXACTO: persona de vuelta a `lead`, envío devuelto al MISMO temporal, auditoría con `revertido_de` (UUID) y conteos `envios_esperados`/`envios_restaurados`
- Descartar con confirmación → persona `descartado` + auditoría `{envios, motivo:"sin_venta_triage"}` sin PII
