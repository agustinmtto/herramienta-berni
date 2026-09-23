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
| Suite (`npm test`) | **1.333/1.333 en verde (0 omitidos)** — 1.329 de base + 4 tests nuevos de perfiles |
| Integración contra base local | ✅ `lead-route` (12) y `quiz-leads-rpc` (29) corrieron contra `127.0.0.1:54321` |
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

1. **Test de los 4 perfiles** (`lib/quiz/__tests__/quiz-libs.test.ts`): capital alto + mala gestión de riesgo · capital bajo + alta exposición a altcoins · sin sistema de decisión · conservador + poca liquidez. Fijan que cada perfil reciba un diagnóstico coherente (sin secciones vacías ni `undefined`).
2. **`.txt` de auditoría fuera del repo** (uno estaba trackeado, tres estaban en la raíz). Respaldo en `%TEMP%\opencode\audit-txt-backup`.

---

## Qué falta para producción

### Contenido (no bloquea el código, sí la salida)

- **3 videos de Berni** con URL definitiva (hoy `url: ""` en `wizardConfig.videos`).

### Externo / despliegue (depende de Miled y el negocio)

- Aplicar migraciones `0068 → 0069 → 0070 → 0071` en producción **antes** del deploy (y confirmar los números).
- Variables de entorno de producción (`KAPSO_WEBHOOK_SECRET`, `CRON_SECRET`, `SUPABASE_*`, `AUTH_TOKEN`).
- **Backup de producción** (realizar antes de tocar nada, guardar fuera de Supabase, probar restore).
- Hosting definitivo + rate limit distribuido + HTTPS/HSTS (el rate limit hoy es in-memory best-effort).
- Smoke test en producción (usuario real, abandono, UTM, POST inválido).

### Notas de mejora (no bloqueantes)

- El click de WhatsApp no emite evento propio (el CTA es un `<a href="wa.me">`); para medir ese paso hay que agregar un evento, lo que requiere decisión + migración nueva.
- `npm audit`: 1 alta en `postcss` (exige Next 16, ticket aparte).

---

## GO / NO GO

### ✅ GO — a nivel de desarrollo

Preguntas y diagnóstico implementados y aprobados · engine determinístico probado (incluye los 4 perfiles) · `/api/lead` endurecido (rate limit, same-origin, honeypot, allow-list, E.164) · RLS/grants cerrados · build/tests/tsc/lint en verde · lead caliente y abandono validados en base real.

### ❌ NO GO — a nivel de producción (hoy)

1. Videos sin URL definitiva.
2. Migraciones sin aplicar en producción (y números sin confirmar).
3. Variables de entorno de producción sin configurar.
4. Backup de producción no realizado.
5. Hosting / rate limit definitivo / HTTPS-HSTS sin confirmar.
6. Sin smoke test en producción.

---

## Próximos pasos (en orden)

1. Grabar/conseguir los 3 videos y cargar sus URLs.
2. Confirmar números de migración + aplicar `0068–0071` en producción.
3. Configurar env de producción.
4. **Backup de producción.**
5. Mergear la rama y desplegar (migraciones primero, código después).
6. Smoke test real (usuario real, abandono, UTM, POST inválido).
7. Medir performance (Lighthouse + Fast 3G) y probar en celular físico.

---

*Generado el 23-sep-2026. Fuente: `metacrypto-os-app/apps/inbox` + migraciones `0068–0071` + verificación en Supabase local (docs/10).*
