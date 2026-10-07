# Herramienta de Diagnóstico — Metacrypto Club

Lead magnet para el negocio de Berni (Metacrypto Club, cripto): landing con wizard de preguntas → **diagnóstico de portfolio determinístico** (por algoritmo, sin IA) → captura de lead → integración con el sistema del negocio (Supabase + Next.js, branch + PR) para llamadas en caliente a leads con capital ≥ 10.000 USD (desde 10.000 inclusive).

> **Lectura rápida para agentes/devs:** empezar por `AGENTS.md` (decisiones firmes + reglas de trabajo) y `docs/00-OVERVIEW.md`. La documentación es **spec-first**: los cambios de requisitos se editan primero en `docs/`, luego se implementan.

## Estado actual (06-oct-2026)

- ✅ **Implementación consolidada en el OS del negocio** (rama `fix/quiz-leads-auditoria-v5`): el funnel vive en `metacrypto-os-app/apps/inbox/app/` como ruta pública `/quiz` + módulo privado `/leads`, persistencia por el RPC transaccional `registrar_diagnostico` de la **migración única `0068_quiz_leads.sql`** (el histórico de reconciliaciones 0069–0073 se retiró: nunca llegó a producción), vinculación post-venta con validación de teléfono + rollback auditado, descarte del lead sin venta
- ✅ Suite del OS: **1.379 tests en verde (0 omitidos)** · `tsc` limpio · `eslint` 0 errores · `next build` OK
- ✅ Patch de transferencia en `release/funnel-leads.patch` (39 archivos), verificado contra el baseline del OS
- 🟡 Pendiente para el GO técnico: runbook completo en `docs/18-guia-deploy-go.md` (migración en producción, env, rate limit distribuido WAF/Upstash, smoke). Informe QA archivo por archivo: `docs/19-qa-funnel.md`
- 🎫 Deudas de negocio / del OS: videos definitivos, permiso `leads`, tickets preexistentes del OS (`docs/13` §4)

## Estructura

- `metacrypto-os-app/apps/funnel/` — **app pública del funnel** (separación D2): wizard + `/api/lead`, desplegada en su propia instancia/dominio; escribe por el rol mínimo `funnel`.
- `metacrypto-os-app/apps/inbox/` — la app del OS del negocio: módulo `/leads` (triage), inbox, crons. Sin rutas públicas del funnel.
- `metacrypto-os-app/supabase/migrations/` — migraciones aplicables en orden; la `0068` (módulo) y la `0069` (rol `funnel`) son módulo leads.
- `prototipos/` — referencias históricas de diseño (landings del negocio + frames del prototipo).
- `docs/` — documentación viva (índice en `docs/README.md`; el doc de lectura del funnel es `docs/19-qa-funnel.md`).
- ⚙️ Retirado el prototipo standalone de la raíz (06-oct): su lógica vive portada al OS y queda en el git history.
