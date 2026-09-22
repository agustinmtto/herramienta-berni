# 13 — Entrega del módulo de leads: estado, pendientes y preguntas para Milo/Miled

> **Propósito:** documento único de cierre de entrega. Resume en un lugar: (1) qué se implementó y cómo quedó validado, (2) todo lo que falta antes de abrir `/quiz` al público, separado por quién lo resuelve, y (3) las preguntas concretas para el negocio (Milo/Miled) con el porqué de cada una.
>
> Fuente de las decisiones funcionales: `docs/11`. Estado de fases: `docs/12` §6. Checklist de seguridad propio del módulo: `docs/09` §"Quiz Funnel en el OS".

---

## 1. Qué se entregó (rama `feature/leads-a-migracion-rpc`)

Migraciones `0068` (esquema + RPC de ingesta) y `0069` (validación de teléfono, auditoría, rollback) del OS, más `0070` (descarte de leads), el funnel portado a `/quiz` como ruta pública y el módulo `/leads` con permiso propio.

**Corrección de los 6 bloqueantes del análisis externo** (22-sep-2026, editados in place — ninguna de esas migraciones había sido aplicada a producción):

| # | Bloqueante | Corrección | Test que la ejercita |
|---|---|---|---|
| 1 | Capital falsificable desde el navegador | Los importes (`capital_min/max_usd`) se leen de la **definición publicada** mediante el `answer_id` validado; el `value` del cliente nunca pisa columnas. `question_text`/`answer_text`/`answer_value` también se sellan desde la definición | `(B1) el capital se sella desde la DEFINICIÓN...` |
| 2 | Rollback se atascaba con varios leads por cliente | `desvincular_lead(p_cliente, p_lead_id?, autor)`: revierte UNA vinculación concreta, marca su auditoría `revertido=true`, y usa la misma advisory lock por lead que vincular | `(B2) dos leads vinculados a un cliente...` |
| 3 | "Vinculado ok" al cliente incorrecto | El early-return de lead archivado valida en `auditoria` que ese lead esté vinculado a ESE cliente; si no → `lead_vinculado_a_otro_cliente` | `(B3) vincular sobre un lead ya vinculado...` |
| 4 | Sesión revalidada contra otra versión del quiz | El RPC lockea el envío y **rechaza** (`version_conflictada`) si el payload trae otra versión — nunca valida respuestas de una sesión contra una definición ajena | `(B4) una sesión existente no se revalida...` |
| 5 | Consentimiento incompleto llegó a la base, fecha faltante reemplazada en silencio | completed exige nombre, `consent.version` y `accepted_at` parseable (`contacto_incompleto`); el CHECK de tabla exige versión+fecha; sin defaults silenciosos | `(B5) completed sin nombre/versión/fecha...` |
| 6 | Huecos de validación (selección vacía, ids duplicados, activos duplicados, preguntas repetidas) | Rechazados con `seleccion_vacia` / `respuestas_duplicadas` / `allocation_duplicada` (mapeados a 422 en el endpoint) | 3 tests `(B6)` |

**Endurecimiento adicional del endpoint** (paridad con el standalone):

- `Content-Type: application/json` obligatorio → `415` (había perdido el gate en el port).
- `Content-Length` validado **antes** de leer el body → `413` temprano.
- Orden de gates: rate limit → content-type → same-origin → tamaño → parseo → contrato.

**Nuevo flujo comercial** (`docs/11` §9.3–9.4, migración `0070`):

- Un lead puede completar el funnel **varias veces** (varios envíos bajo la misma persona temporal) y un cliente puede acumular **varias vinculaciones**: cada rollback revierte exactamente su propia vinculación (la auditoría guarda la lista exacta de `envio_ids`).
- Camino "sin venta": botón **"Descartar lead (sin venta)"** en el detalle del envío → estado `'descartado'` (nuevo en el CHECK de `personas.estado`), idempotente, auditado, sin borrar nada. La reactivación queda como update manual apoyado en la auditoría (sin UI en esta fase).
- Docs: regla de lead caliente unificada a **≥ 10.000 USD (desde 10.000 inclusive)** en `AGENTS.md`, `README.md` y `docs/00` (antes decían `>`, en contradicción con lo implementado y decidido en `docs/06` #8 / `docs/11` §8).

**Validación ejecutada (22-sep-2026):**

```
supabase db reset   → 0001 → 0070 aplicando limpio (Supabase local + Docker)
vitest run          → 56 archivos · 1316/1316 tests en verde · 0 omitidos
tsc --noEmit        → limpio
prototipo npm test  → 39/39
npm run build (OS)  → OK
```

Antes de este fix la suite del OS reportaba 22 pruebas omitidas (precisamente las de RPC/API contra Supabase): hoy corren todas.

---

## 2. Qué falta — por categoría y propietario

### 2.1 Lo que resuelve el negocio (jefe: Milo/Miled) — bloqueantes de despliegue

| Item | Riesgo si no se hace | Quién | Esfuerzo |
|---|---|---|---|
| **Confirmar números `0068/0069/0070`** en la secuencia global de migraciones (las ramas remotas no son visibles desde acá) | Colisión de numeración al aplicar en producción | Milo | 5 min |
| **Upgrade de Next en el OS prod**: `next` 15.5.22 tiene **1 RCE crítica** (2 advisories: Windows-hosted + Image Optimization AVIF) + 3 high (postcss/sharp/nanoid). El fix inmediato es bump de lockfile a 15.5.25 (elimina las críticas; la high de postcss exige Next 16, mayor) | Exponer `/quiz` público sobre una app con RCE conocida | Milo + nosotros | Bump pequeño; Next 16 = evaluación aparte |
| **Setear `KAPSO_WEBHOOK_SECRET`** en el entorno del OS | Sin ese secreto, `/api/wa-ingest` acepta cualquier firma (webhook abierto) | Milo — 1 env var | 5 min |
| **Permiso `leads`**: a quién del equipo se asigna (Berni, Milo, closers) | El módulo nace sin usuarios que puedan usarlo | Milo | Decisión |
| **Forzar HTTPS + HSTS** en el dominio que expone `/quiz` y confirmar config de imágenes (AVIF sí/no) | Redirect abierto a http; advisory AVIF condicional | Milo / hosting | Chico |
| **Orden de despliegue** (ver §3): migraciones → código → smoke test | PostgREST responde 400 en silencio si falta una migración (trampa #5 del CLAUDE.md del OS) | Milo + nosotros | Guía abajo |

### 2.2 Lo que resuelve nuestro equipo (ya decidido, sin bloqueantes)

| Item | Estado/Esfuerzo |
|---|---|
| **Rate limiting distribuido** (Upstash o WAF del host, según respuesta de Milo en #14/#15 de docs/06) | Call site ya aislado en `lib/quiz/rate-limit.ts`; reemplazo ~1 archivo |
| **CSP / headers de seguridad globales** (nosniff, frame protection, Permissions-Policy; HSTS si el host no lo fuerza) | Pendiente — tocar `next.config.mjs` del OS afecta toda la app: hacerlo con Milo en el PR |
| **Alerta de triaje** para leads calientes (quedó fuera de la primera migración, docs/06 #84/95) | Fase post-launch |
| **PDF por email (Resend) + pixel** (docs/06 #12) | Post-launch |

### 2.3 Contenido/dependencias del negocio

- **3 videos reales de Berni** + host del player trackeable (docs/06 #9/#11, bloqueante de contenido). Los slots config-driven ya existen (`question-config`, `url: ""` hasta que el negocio los provea).
- **PRD** que pidió Milo para la implementación conjunta (#7) — este documento y `docs/11` sirven de insumo.

### 2.4 Riesgos conocidos del OS, fuera del alcance de este módulo (preexistentes, informados)

Para que no los sorprendan en una auditoría de seguridad: el análisis externo identificó vulnerabilidades preexistentes del OS que no toca el módulo de leads y que recomendamos convertir en tickets aparte:

- APIs internas de Inbox verifican sesión pero **no permiso de módulo** (cualquier usuario logueado puede leer conversaciones/enviar).
- Login sin rate limiting ni bloqueo; sesión de 30 días; usuarios desactivados conservan acceso (el middleware solo valida la firma de la cookie, no `team_members.activo`).
- RLS permisivo para el rol `authenticated` de Supabase (incluye leer hashes de `team_members`, pagos, conversaciones WhatsApp). La app usa `service_role`, así que el riesgo depende de si producción permite usuarios Auth.
- `login` con redirect abierto (`next.startsWith("/")` acepta `//host-atacante`).

Detalles con archivo/línea quedaron en el análisis ("respuesta despues de analisis - herramienta berni.txt"). Recomendación: convertirlos en tickets separados, no mezclarlos con este PR.

---

## 3. Orden de despliegue (guía exacta, una vez respondidas las preguntas)

```bash
# 0) Verificar en producción que 0068-0070 siguen libres (los números ya confirmados)
# 1) Aplicar migraciones AL OPERADOR, en orden (trampa #5: sin migración, PostgREST 400 en silencio)
psql:  0068_quiz_leads.sql → 0069_vinculacion_validacion_rollback.sql → 0070_descarte_leads.sql

# 2) Verificar RPCs/grants de PostgREST (los 3, autenticados por service_role)
curl $SUPABASE_URL/rest/v1/rpc/registrar_diagnostico -X POST -H "apikey: $SERVICE_ROLE_KEY" ...  # ok esperado con payload de prueba
# 3) Deploy del código (PR merge → pipeline del host)
# 4) Smoke test punta a punta:
#    a. /quiz público completo: completed → fila visible en /leads con bandas y calificación
#    b. Vincular lead → cliente | rollback | descartar lead
#    c. `npm audit --omit=dev` vacío tras el bump de Next
```

**Variables de entorno:** el módulo NO agrega claves nuevas: usa las existentes `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `AUTH_TOKEN`. Opcionales para tuning: `LEAD_RATE_LIMIT_MAX`, `LEAD_RATE_LIMIT_WINDOW_MS`.

---

## 4. Preguntas para Milo/Miled (a enviar)

1. **Números de migración** — localmente están asignados `0068_quiz_leads`, `0069_vinculacion_validacion_rollback` y `0070_descarte_leads`. ¿Alguno fue reclamado por otra rama del OS? (Si uno colisiona, renumeramos y ajustamos `docs/11/12` antes del release.)
2. **Upgrade de Next (bloqueante #20 de `docs/06`)** — el OS prod corre `next` 15.5.22 con 1 RCE crítica + 3 high. ¿Lo subís vos (bump de lockfile a 15.5.25, sin cambios de código) o lo mandamos nosotros como rama del PR? Este es el único bloqueante de seguridad real antes de exponer el funnel.
3. **`KAPSO_WEBHOOK_SECRET`** — ¿está seteado en producción? En la copia que revisamos el falta del secreto deja el webhook `wa-ingest` aceptando cualquier firma (5 minutos de fix, independiente del funnel).
4. **Permiso `leads`** — ¿quién del equipo lo recibe (por `team_members.modulos`)?
5. **Hosting del OS** — ¿dónde está desplegado y qué plan? ¿El host ofrece WAF / rate limiting en el borde? Con eso decidimos si `/api/lead` usa Upstash o el rate limit del host (docs/06 #15). ¿El host fuerza HTTPS y configura HSTS?
6. **Imágenes/AVIF** — ¿el OS usa `next/image` con AVIF en producción? (Para descartar el advisory de Image Optimization; no encontramos uso en el código pero no depende solo del repositorio.)
7. **CSP/headers globales** — ¿agregamos los headers de seguridad en el `next.config.mjs` del OS dentro de este PR, o los hacemos en otro ticket para no mezclar alcance?
8. **Alerta de triaje** — ¿la pedimos ya (notificación al equipo cuando cae un lead caliente) o sigue post-launch como estaba acordado?

---

*Documento generado el 22-sep-2026 tras cerrar la corrección de bloqueantes. Estado de fases actualizado en `docs/12` §6 (fila "A-2 — Corrección de bloqueantes").*
