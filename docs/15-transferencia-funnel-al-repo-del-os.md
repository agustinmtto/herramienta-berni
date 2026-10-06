# 15 - Transferencia del funnel al repositorio del OS

## Estado del artefacto

`release/funnel-leads.patch` es el diff del módulo de leads sobre el baseline del OS (`041d6a6`): 44 archivos (app `/quiz` + `/api/lead` + módulo `/leads`, libs del quiz, tests, **migración única `0068_quiz_leads.sql`**, workflow CI, `package.json`/lockfile/`eslint.config.mjs` y seed ficticio mínimo). Quedan excluidos los archivos de infra local del OS que el repo central ya tiene (`CLAUDE.md`, `apps/inbox/lib/persona.ts`, `scripts/dev.sh`, `supabase/.gitignore`, `supabase/config.toml`, migraciones `0053`/`0066`).

Trabajo de validación sobre el patch: solo archivos del módulo, sin datos reales, sin credenciales y sin cambios generales del OS. El histórico de migraciones `0069–0073` se retiró: consolidado en la 0068 (ver `docs/18` §1).

El artefacto se considera transferible solo cuando:

1. pase `git apply --check` contra el HEAD central (verificado contra el baseline del OS en este repo: ✓);
2. pase el workflow remoto sin omitidos;
3. el diff integrado sea revisado.

## Procedimiento de transferencia

```bash
git clone <url-del-repo-central> metacrypto-os
cd metacrypto-os
git fetch --prune origin
git switch main
git pull --ff-only
git switch -c feature/quiz-leads

git apply --check ../herramienta-berni/release/funnel-leads.patch
git apply ../herramienta-berni/release/funnel-leads.patch
```

No se hace commit, push, merge o PR hasta revisar el diff y ejecutar las compuertas. Nunca se recomienda push directo a `main`.

## Validacion en checkout limpio

```bash
git apply --check ../herramienta-berni/release/funnel-leads.patch

supabase start
supabase db reset

cd apps/inbox
npm ci
LEAD_TESTS_REQUIRE_DB=1 npx vitest run
npm run typecheck
npm run lint
npm run build
```

## Orden de produccion

Resumido del runbook completo: `docs/18`.

1. Backup y restauracion probada.
2. Migracion unica `0068` (convergente, una transaccion).
3. Verificacion de catalogo y RPC.
4. Deploy de codigo.
5. Smoke del modulo (docs/18 §5).
