# 14 — Estado del proyecto y GO / NO GO

> **Fuente de verdad de readiness.** Refleja el estado real del código y la base local, verificado el **23-sep-2026**. Rama: `feature/leads-a-migracion-rpc` (sin mergear). Producto vivo: `metacrypto-os-app/apps/inbox` (`/quiz`, `/api/lead`, `/leads`).

---

## Qué es el producto

Un quiz de **8 preguntas + contacto** (pantalla final única). Las respuestas alimentan un diagnóstico **determinístico** (sin IA) y se persisten en Supabase a través de `POST /api/lead` → RPC transaccional `registrar_diagnostico`.

| Pieza | Qué hace | Dónde vive |
|---|---|---|
| Preguntas | `situation → challenge → allocation → capital → horizon → drawdown → influence → rules` + contacto | `lib/quiz/question-config.ts` |
| Diagnóstico | 4 secciones: situación real, desajuste principal, señal, plan de acción | `lib/quiz/engine.ts` |
| Lead caliente | Capital **≥ 10.000 USD**, calculado **server-side** (regla `hot-lead-v1`) | migración `0068` (RPC) |
| Resultado | Diagnóstico + 3 videos (1 destacado según pregunta 2) + CTA WhatsApp | `app/quiz/quiz-flow.tsx` |
| CTA WhatsApp | `+54 9 3585 401429` (`5493585401429`), respuestas precargadas | `lib/quiz/whatsapp.ts` |
| Persistencia | 3 tablas (`quiz_versiones`, `diagnostico_envios`, `diagnostico_respuestas`), RLS cerrada | migraciones `0068–0071` |
| Triaje | Módulo `/leads` (listado, filtros, detalle, vincular/descartar) | `app/leads`, `lib/leads.ts` |

---

## Estado de desarrollo: ✅ listo

Verificado **hoy** contra el código y el Supabase local (Docker, `docs/10`):

| Comprobación | Resultado |
|---|---|
| Suite (`npm test`) | **1.343/1.343 en verde (0 omitidos)** — incluye los fixes y tests de la auditoría v4 (`docs/16`) |
| Integración contra base local | ✅ `lead-route` (12) y `quiz-leads-rpc` (34) corrieron contra `127.0.0.1:54321` |
| Tipos (`tsc --noEmit`) | ✅ limpio |
| Lint (`eslint`) | ✅ 0 errores (16 warnings preexistentes) |
| Build (`next build`) | ✅ OK — `/quiz` prerenderizada, `/leads` dinámica |
| **Test real en base** | ✅ completed → `es_lead_caliente: true` · 8/8 respuestas · dropped diferenciado |

### Test real (evidencia)

POST real al RPC `registrar_diagnostico` contra el Supabase local:

```
POST completed → 200 · status: completed · submission_id: sí
POST dropped  → 200 · status: dropped

lectura diagnostico_envios:
  completed → estado: completed · es_lead_caliente: true · capital: 25.000–50.000 · regla: hot-lead-v1
  dropped   → estado: dropped · last_step: allocation

respuestas del completed → 8 de 8 esperadas
✅ lead persistido, caliente calculado y abandono diferenciado
```

### Cambios hechos hoy

1. **Cierre de la auditoría v4** (`docs/16`): migración `0072_reconciliacion_leads_v2.sql` (inmutabilidad de versiones publicadas sin evasión, consentimiento acotado al recorrido y sin inventar `contacto-v1` en históricos, carrera de sesión `version_conflictada`, `revertido_de` con UUID real, `dropped` que registra su paso) + fixes de código (tracking de pasos/retroceso, selector de clientes server-side con programa, `/leads` robusto a fechas inválidas, permiso `leads` sin enlace a `/clientes`, normalización telefónica AR `15`→`9`, rate limit 30/min, honeypot al endpoint, `session_id` comparado en el frontend).
2. **Test de los 4 perfiles** (`lib/quiz/__tests__/quiz-libs.test.ts`): capital alto + mala gestión de riesgo · capital bajo + alta exposición a altcoins · sin sistema de decisión · conservador + poca liquidez. Fijan que cada perfil reciba un diagnóstico coherente (sin secciones vacías ni `undefined`).
3. **Patch de transferencia regenerado** (`release/funnel-leads.patch`, 36 archivos incl. `package.json`/lockfile/`eslint.config.mjs`) y verificado con `git apply --check`.

---

## Qué falta para producción

### Contenido (no bloquea el código, sí la salida)

- **3 videos de Berni** con URL definitiva (hoy `url: ""` en `wizardConfig.videos`).
- **Verificación final del engine determinístico** con decisiones reales: repasar los diagnósticos de los 4 perfiles (y de un par de combinaciones de respuestas) para confirmar que el texto del plan de acción es el que Berni quiere mostrar.

### Externo / despliegue (depende de Miled y el negocio)

- Aplicar migraciones `0068 → 0069 → 0070 → 0071 → 0072` en producción **antes** del deploy (números **ya confirmados** con Miled).
- Variables de entorno de producción (`KAPSO_WEBHOOK_SECRET`, `CRON_SECRET`, `SUPABASE_*`, `AUTH_TOKEN`).
- **Backup de producción** (realizar antes de tocar nada, guardar fuera de Supabase, probar restore).
- Hosting **Vercel Pro** (confirmado por Miled 23-sep) + rate limit distribuido/WAF + HTTPS/HSTS (el rate limit hoy es in-memory best-effort, a confirmar con Milo).
- Smoke test en producción (usuario real, abandono, UTM, POST inválido).

### Notas de mejora (no bloqueantes)

- El click de WhatsApp no emite evento propio (el CTA es un `<a href="wa.me">`); para medir ese paso hay que agregar un evento, lo que requiere decisión + migración nueva.
- `npm audit`: 1 alta en `postcss` (exige Next 16, ticket aparte).

---

## GO / NO GO

### ✅ GO — a nivel de desarrollo (cerrado)

Preguntas y diagnóstico implementados y aprobados · engine determinístico probado (incluye los 4 perfiles) · `/api/lead` endurecido (rate limit, same-origin, honeypot, E.164) · RLS/grants cerrados · **auditoría v4 cerrada** (inmutabilidad, consentimiento, concurrencia, tracking, selector, rate limit — `docs/16`) · build/tests/tsc/lint en verde (1.343 tests) · lead caliente y abandono validados en base real.

### ❌ NO GO — a nivel de producción (hoy)

1. Videos sin URL definitiva.
2. Verificación pendiente del engine con decisiones (review del negocio del texto del diagnóstico).
3. Migraciones sin aplicar en producción (números confirmados; falta aplicarlas).
4. Variables de entorno de producción sin configurar.
5. Backup de producción no realizado.
6. Rate limit definitivo / WAF / HTTPS-HSTS sin confirmar (hosting Vercel Pro ya confirmado).
7. Sin smoke test en producción.

---

## Próximos pasos (en orden)

1. Grabar/conseguir los 3 videos y cargar sus URLs.
2. Verificar el engine determinístico con decisiones (repaso del plan de acción con Berni).
3. Aplicar `0068–0072` en producción **antes** del deploy.
4. Configurar env de producción.
5. **Backup de producción.**
6. Mergear la rama y desplegar (migraciones primero, código después).
7. Smoke test real (usuario real, abandono, UTM, POST inválido).
8. Medir performance (Lighthouse + Fast 3G) y probar en celular físico.

---

*Generado el 23-sep-2026. Fuente: `metacrypto-os-app/apps/inbox` + migraciones `0068–0071` + verificación en Supabase local (docs/10).*
