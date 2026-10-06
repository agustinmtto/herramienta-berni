# 18 - Guía de deploy y GO técnico del funnel (quiz + leads)

Guía **técnica** del operativo de despliegue: deja el módulo listo para el GO de negocio. Omite deudas de negocio (videos, decisiones pendientes de Berni/Miled). El código ya pasó las compuertas completas en local (suites en verde, `tsc` limpio, `eslint` 0 errores, `next build` OK en ambas apps).

**Estado del SQL:** el módulo usa **dos migraciones**: `metacrypto-os-app/supabase/migrations/0068_quiz_leads.sql` (estado final consolidado del módulo: tablas + RPCs + RLS/grants + definición del quiz) y `0069_funnel_db_role.sql` (rol `funnel` con privilegio mínimo para la app pública). El histórico de reconciliaciones del módulo nunca llegó a producción — ver §1.

---

## 0. Artefactos que viajan (dos despliegues, una base)

| Artefacto | Qué es | Dónde deploya |
|---|---|---|
| `metacrypto-os-app/supabase/migrations/0068_quiz_leads.sql` + `0069_funnel_db_role.sql` | Módulo de leads (tablas + RPCs + RLS/grants) y rol mínimo `funnel` | Producción Supabase (una vez) |
| `metacrypto-os-app/apps/funnel/` | **App pública del funnel**: wizard `/quiz` + `/api/lead` (rol mínimo `funnel`) | Su propia instancia/dominio (ej. `quiz.…`), proyecto Vercel aparte con Root Directory = `apps/funnel` |
| `metacrypto-os-app/apps/inbox/` (+ patch) | OS del negocio con módulo `/leads` (triage) — **sin rutas públicas del funnel** | Repo/instancia del OS (patch: `docs/15`) |

**Por qué dos despliegues:** decisión D2 (`docs/00`) — la superficie pública (a la que apunta Instagram) no comparte app, dominio, cookies ni llaves con el login del OS. La frontera es el RPC; la llave pública solo puede *insertar recorridos* (aislamiento verificado con 403 en tablas y RPCs ajenos).

## 1. Validar las migraciones que hay en producción (lo validamos nosotros)

No dependemos de confirmaciones del operador: miramos directamente la base de producción del OS.

```sql
select to_regclass('public.quiz_versiones'), to_regclass('public.diagnostico_envios'),
       to_regprocedure('public.registrar_diagnostico(jsonb)');
```

- **Todo NULL (caso esperado):** falta aplicar `0068` + `0069` (paso 2).
- **Si existe alguna pieza del módulo** (p. ej. una 0068 vieja aplicada a mano): aplicar igual — la migración es **convergente** (`create or replace` + `drop if exists`). Se valida igual con el smoke (§5).

Si produccion ya pasó de `0067`, renombrar los archivos al número libre siguiente (transaccionales independientes; el número no cambia nada más).

## 2. Backup + migraciones

Ambas migraciones entran en **una transacción** cada una (`begin;…commit;`): o entran enteras o no entran.

```bash
# 1) antes de tocar nada: backup del Supabase de producción,
#    con restauración PROBADA en un entorno aparte

# 2) aplicación (psql con la connection string de producción)
psql "$DB_URL" -f supabase/migrations/0068_quiz_leads.sql
psql "$DB_URL" -f supabase/migrations/0069_funnel_db_role.sql

# 3) verificación del esquema final
psql "$DB_URL" -c "
  select proname, pg_get_function_identity_arguments(oid)
    from pg_proc where pronamespace = 'public'::regnamespace
      and proname in ('registrar_diagnostico','vincular_lead_convertido',
                      'desvincular_lead','descartar_lead','validar_respuestas_quiz');
  select rolname from pg_roles where rolname = 'funnel';"
```

Esperado: `registrar_diagnostico(jsonb)`, `vincular_lead_convertido(uuid, uuid, boolean, uuid)`, `desvincular_lead(uuid, uuid, uuid)`, `descartar_lead(uuid, uuid)`, `validar_respuestas_quiz(jsonb, jsonb, boolean)`, la vista `v_clientes_para_vincular` y el rol `funnel`.

## 3. Variables de entorno

**App pública `apps/funnel`** (su propio proyecto de hosting):

| Variable | Para qué | Nota |
|---|---|---|
| `FUNNEL_DB_URL` | URL del Supabase de producción | |
| `FUNNEL_DB_KEY` | JWT con `role=funnel`, **solo puede ejecutar `registrar_diagnostico`** | Se genera con `node scripts/mint-funnel-token.mjs "$JWT_SECRET_DEL_PROYECTO"` (operador; NUNCA publica la service_role del OS). En local: `npm run mint-token` con el secreto de config.toml |

**App OS `apps/inbox`** (unchanged del OS salvo que el funnel ya no existe acá):

| Variable | Para qué | Nota |
|---|---|---|
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Las de siempre del OS | Sin cambios |
| `LEAD_RAW_RATE_LIMIT_MAX` / `LEAD_RATE_LIMIT_MAX` / `LEAD_COMPLETED_RATE_LIMIT_MAX` / `LEAD_RATE_LIMIT_WINDOW_MS` | Rate limit del funnel (opcional, defaults 60/30/5 y 60000 ms) | Best-effort por instancia; el límite DEFINITIVO es WAF/Upstash del hosting (docs/17 §12) |

## 4. Deploy del código (dos instancias)

**App funnel (nueva instancia):**
- Proyecto nuevo (Vercel/Netlify/otro) con **Root Directory = `apps/funnel`**, dominio propio o subdominio (ej. `quiz.…`), HTTPS forzado.
- Revisar el diff: solo archivos de esa carpeta; `npm ci`, compuertas (`vitest`, `typecheck`, `lint`, `build`), deploy.
- El workflow de CI del módulo (`.github/workflows/quiz-leads-integration.yml`) cubre las dos apps localmente; configurar el mismo chequeo en el repo destino.

**App OS (repo central, vía patch — `docs/15`):**
```bash
git clone <url-repo-central> && cd metacrypto-os
git switch -c feature/leads-module
git apply --check /ruta/release/funnel-leads.patch   # dry-run primero
git apply /ruta/release/funnel-leads.patch
```
El patch entrega el módulo `/leads` + migraciones + tests y workflow — ya **no incluye** el funnel público. Revisar diff → compuertas (`npm ci`, `supabase start && supabase db reset`, `LEAD_TESTS_REQUIRE_DB=1 npx vitest run`, `typecheck`, `lint`, `build`) → PR (nunca push directo a main).

## 5. Smoke test (el GO técnico)

Con ambas instancias desplegadas en producción, desde el `/quiz` de la app funnel (datos SIEMPRE ficticios):

1. **Recorrido completo** con capital ≥ 10.000 USD → verificar en la base:
   - fila nueva en `diagnostico_envios` con `estado='completed'` y `es_lead_caliente=true`;
   - persona `estado='lead'` con `telefono_e164` NULL;
   - respuestas persistidas en `diagnostico_respuestas`.
2. **Recorrido abandonado** (cerrar a mitad): fila `dropped` con el `last_step_id` exacto del paso de abandono, sin persona.
3. **Capital < 10.000** → `es_lead_caliente=false`.
4. **Módulo `/leads` del OS** (permiso `leads`): el lead aparece con contacto correcto y la marca de caliente; probar **vincular** hacia un cliente con programa y **desvincular** (rollback exacto sobre los mismos envíos, verificado en `auditoria`).
5. **Aislamiento del funnel**: confirmar que la llave pública NO puede leer (`diagnostico_envios` con `FUNNEL_DB_KEY` → 403) ni llamar `vincular/descartar` (403), y que el OS no expone `/quiz` ni `/api/lead` (la URL vieja del OS ya no tiene funnel).
6. **RLS/permisos**: el endpoint `POST /api/lead` con `Origin` ajeno → 403; honeypot rellenado → 200 falso sin persistir; con un JWT `authenticated` sin permiso no se puede leer `diagnostico_envios`.
7. **Rate limit**: superar la tasa de `completed` desde una IP → 429.

El GO técnico queda declarado cuando todos los pasos pasan. Lo que falte del negocio (videos, etc.) no bloquea esta lista.

## 6. Rollback

- **Código:** revertir el deploy de la app. Siempre seguro por sí solo: los objetos de la base son aditivos y backward-compatible.
- **Base:** nunca revertir una migración aplicada editándola o con SQL destructivo improvisado; si algo falla, restaurar el backup probado del §2. Correcciones posteriores entran como otra migración append-only (siguiente número).

## 7. Regenerar el patch (cuando cambie el funnel otra vez)

El patch es el diff del módulo de LEADS actual contra el baseline del OS (`041d6a6` en este repo):

```bash
git diff 041d6a6 HEAD -- metacrypto-os-app
```

con el prefijo `metacrypto-os-app/` removido y excluyendo, además de los archivos de infra local (`CLAUDE.md`, `apps/inbox/lib/persona.ts`, `scripts/dev.sh`, `supabase/.gitignore`, `supabase/config.toml`, migraciones `0053`/`0066`), **todo lo que vive bajo `apps/funnel/`** (la app pública viaja por su propio despliegue, §0). El artefacto queda en `release/funnel-leads.patch` y se corrobora con `git apply --check` sobre un checkout limpio del OS.
