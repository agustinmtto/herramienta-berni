# 15 - Transferencia del funnel al repositorio del OS

## Estado del artefacto

`release/funnel-leads.patch` se regenera desde la base auditada con las correcciones v5 y `0073`. Queda como artefacto candidato: no debe desplegarse hasta pasar `git apply --check` y todas las compuertas contra el HEAD central real.

El artefacto se considera transferible solo cuando:

1. el operador confirme globalmente `0073`;
2. pase `git apply --check` contra el HEAD central;
3. pase el workflow remoto sin omitidos;
4. el diff integrado sea revisado.

## Procedimiento de transferencia

```bash
git clone <url-del-repo-central> metacrypto-os
cd metacrypto-os
git fetch --prune origin
git switch main
git pull --ff-only
git switch -c fix/quiz-leads-auditoria-v5

git apply --check ../herramienta-berni/release/funnel-leads.patch
git apply ../herramienta-berni/release/funnel-leads.patch
```

No se hace commit, push, merge o PR hasta revisar el diff y ejecutar las compuertas. Nunca se recomienda push directo a `main`.

## Contenido obligatorio del patch final

- `/quiz`, `/api/lead`, tracking, consentimiento, telefono y rate limit.
- `/leads`, selector y acciones de vinculacion/descarte/rollback.
- Tests unitarios, HTTP, RPC, concurrencia y upgrade historico.
- Migraciones `0068` a `0073`.
- Workflow de integracion del modulo.
- `package.json`, lockfile y configuracion indispensables para reproducir el checkout.
- El seed ficticio minimo necesario para que el reset respete el catalogo vigente.

No se incluyen datos reales, basura local, credenciales ni cambios generales del OS.

## Validacion en checkout limpio

```bash
git apply --check ../herramienta-berni/release/funnel-leads.patch

supabase start
supabase db reset

cd apps/inbox
npm ci
LEAD_TESTS_REQUIRE_DB=1 npm run test:integration
LEAD_TESTS_REQUIRE_DB=1 npm test
npm run typecheck
npm run lint
npm run build
```

Ademas se ejecuta la matriz historica definida en `docs/17`. Un `db reset` limpio no sustituye upgrades con datos.

## Orden de produccion

1. Backup y restauracion probada.
2. Preflight de datos historicos.
3. Migraciones `0068 -> 0073`.
4. Verificacion de catalogo y RPC.
5. Deploy de codigo.
6. Smoke del modulo.

No se certifica compatibilidad con el repositorio central hasta repetir este procedimiento contra su HEAD real.
