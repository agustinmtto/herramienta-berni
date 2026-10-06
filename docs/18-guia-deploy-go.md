# 18 - Guía de deploy y GO técnico del funnel (quiz + leads)

Guía **técnica** del operativo de despliegue: deja el módulo listo para el GO de negocio. Omite deudas de negocio (videos, decisiones pendientes de Berni/Miled). El código ya pasó las compuertas completas en local (suite en verde, `tsc` limpio, `eslint` 0 errores, `next build` OK).

**Estado del SQL:** el módulo de leads es **una sola migración**: `metacrypto-os-app/supabase/migrations/0068_quiz_leads.sql` (estado final consolidado del histórico 0068–0073; producción nunca aplicó nada del módulo, así que la numeración intermedia se descartó — ver §1).

---

## 0. Artefactos que viajan

| Artefacto | Qué es |
|---|---|
| `metacrypto-os-app/apps/inbox/` | La app del OS con el funnel integrado: `/quiz`, `/api/lead`, `/leads` |
| `metacrypto-os-app/supabase/migrations/0068_quiz_leads.sql` | Migración única del módulo (tablas + RPCs + RLS/grants + definición del quiz) |
| `release/funnel-leads.patch` | Diff del módulo sobre el repo del OS, para aplicar con `git apply` cuando no se puede abrir un branch directo |

## 1. Validar las migraciones que hay en producción (lo validamos nosotros)

No dependemos de confirmaciones del operador: miramos directamente la base de producción del OS.

```sql
-- ¿Ya existe el módulo?
select to_regclass('public.quiz_versiones'),
       to_regclass('public.diagnostico_envios'),
       to_regclass('public.diagnostico_respuestas'),
       to_regprocedure('public.registrar_diagnostico(jsonb)');
```

- **Todo NULL (caso esperado):** falta aplicar `0068` (paso 2).
- **Si existe alguna pieza del módulo** (p. ej. una 0068 vieja aplicada a mano): aplicar `0068` igual — la migración es **convergente**: `create or replace` + `drop if exists` deja cualquier estado previo del módulo en su estado final (incluye la limpieza del trigger/columnas/funciones viejas). Se valida igual con el smoke (§5).

Anotar además la **última migración aplicada del OS**: si produccion ya pasara de `0067`, renombrar el archivo (p. ej. `0074_quiz_leads.sql`) — es un archivo transaccional independiente, el número no cambia nada más.

## 2. Backup + migración

El módulo entra en **una transacción** (`begin;…commit;`): o entra entero o no entra nada.

```bash
# 1) antes de tocar nada: backup del Supabase de producción,
#    con restauración PROBADA en un entorno aparte

# 2) aplicación (psql con la connection string de producción)
psql "$DB_URL" -f supabase/migrations/0068_quiz_leads.sql

# 3) verificación del esquema final
psql "$DB_URL" -c "
  select proname, pg_get_function_identity_arguments(oid)
    from pg_proc where pronamespace = 'public'::regnamespace
      and proname in ('registrar_diagnostico','vincular_lead_convertido',
                      'desvincular_lead','descartar_lead','validar_respuestas_quiz');"
```

Esperado: `registrar_diagnostico(jsonb)`, `vincular_lead_convertido(uuid, uuid, boolean, uuid)`, `desvincular_lead(uuid, uuid, uuid)`, `descartar_lead(uuid, uuid)`, `validar_respuestas_quiz(jsonb, jsonb, boolean)`, más la vista `v_clientes_para_vincular`.

## 3. Variables de entorno de la app (`apps/inbox`)

| Variable | Para qué | Nota |
|---|---|---|
| `SUPABASE_URL` | URL del Supabase de producción | |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role, **SOLO server-side** | El endpoint `/api/lead` la usa en el servidor; nunca en el cliente |
| `LEAD_RAW_RATE_LIMIT_MAX` | tasa bruta (opcional) | Default 60/min |
| `LEAD_RATE_LIMIT_MAX` | tasa de tracking (opcional) | Default 30/min |
| `LEAD_COMPLETED_RATE_LIMIT_MAX` | tasa de completitud (opcional) | Default 5/min |
| `LEAD_RATE_LIMIT_WINDOW_MS` | ventana del rate limit (opcional) | Default 60000 ms |

Punto separado del operador (ya listado en docs/17 §12): **rate limit distribuido** (WAF/Upstash). El que está en el código es best-effort por instancia y no se simula como resuelto.

## 4. Deploy del código

- **Vía patch** (mainstream hoy, sin push directo al repo central):
  ```bash
  git clone <url-repo-central> && cd metacrypto-os
  git switch -c feature/quiz-leads
  git apply --check /ruta/release/funnel-leads.patch   # dry-run primero
  git apply /ruta/release/funnel-leads.patch
  ```
- **Vía branch + PR** si algún día hay acceso de push (menos frágil; dentro de ese flujo el patch deja de ser necesario).

Aplicado el patch, ANTES del merge/PR:
1. `git apply --check` (o revisión del diff): solo archivos del módulo, nada ajeno al OS.
2. Compuertas en el checkout con el patch aplicado:
   ```bash
   cd apps/inbox && npm ci
   supabase start && supabase db reset            # aplica 0068 + seed ficticio
   LEAD_TESTS_REQUIRE_DB=1 npx vitest run          # cero skips
   npm run typecheck && npm run lint && npm run build
   ```
3. El workflow de CI del módulo (`.github/workflows/quiz-leads-integration.yml`) levanta la base local y ejecuta las mismas suites con cero omitidos: debe pasar en el PR.

## 5. Smoke test (el GO técnico)

Con el servicio desplegado en producción, desde el `/quiz` real (datos SIEMPRE ficticios):

1. **Recorrido completo** con capital ≥ 10.000 USD → verificar en la base:
   - fila nueva en `diagnostico_envios` con `estado='completed'` y `es_lead_caliente=true`;
   - persona `estado='lead'` con `telefono_e164` NULL;
   - respuestas persistidas en `diagnostico_respuestas`.
2. **Recorrido abandonado** (cerrar a mitad): fila `dropped` con el `last_step_id` exacto del paso de abandono, sin persona.
3. **Capital < 10.000** → `es_lead_caliente=false`.
4. **Módulo `/leads`** (permiso `leads`): el lead aparece con contacto correcto y la marca de caliente; probar **vincular** hacia un cliente con programa y **desvincular** (rollback exacto sobre los mismos envíos, verificado en `auditoria`).
5. **RLS/permisos**: el endpoint `/api/lead` con `Origin` ajeno → 403; honeypot rellenado → 200 falso sin persistir; con un JWT `authenticated` sin permiso no se puede leer `diagnostico_envios`.
6. **Rate limit**: superar la tasa de `completed` desde una IP → 429.

El GO técnico queda declarado cuando todos los pasos pasan. Lo que falte del negocio (videos, etc.) no bloquea esta lista.

## 6. Rollback

- **Código:** revertir el deploy de la app. Siempre seguro por sí solo: los objetos de la base son aditivos y backward-compatible.
- **Base:** nunca revertir una migración aplicada editándola o con SQL destructivo improvisado; si algo falla, restaurar el backup probado del §2. Correcciones posteriores entran como otra migración append-only (siguiente número).

## 7. Regenerar el patch (cuando cambie el funnel otra vez)

El patch es el diff del módulo actual contra el baseline del OS (`041d6a6` en este repo):

```bash
git diff 041d6a6 HEAD -- metacrypto-os-app
```

con el prefijo `metacrypto-os-app/` removido y excluyendo archivos de infra local del OS (`CLAUDE.md`, `apps/inbox/lib/persona.ts`, `scripts/dev.sh`, `supabase/.gitignore`, `supabase/config.toml`, y las migraciones `0053`/`0066` que produccion ya tiene). El artefacto queda en `release/funnel-leads.patch` y se corrobora con `git apply --check` sobre un checkout limpio del OS.
