# 15 — Transferencia del funnel al repo del OS

> **Propósito:** cómo llevar el funnel (`/quiz`, `/api/lead`, módulo `/leads`, migraciones `0068–0071`) al repo del negocio: `github.com/miledgassibe/metacrypto-os-app`.

## Contexto

- El **OS del negocio** vive en el repo de Miled y es lo que está **desplegado en producción**.
- Nuestro repo (`herramienta-berni`) tiene el funnel desarrollado adentro de una copia del OS (`metacrypto-os-app/`).
- La transferencia consiste en **sumar el funnel al repo de Miled** sin tocar lo que ya tiene (incluido su fix del teléfono real del 16-sep) y sin meter basura local.

## El artefacto

`release/funnel-leads.patch` — diff que agrega el funnel (32 archivos) sobre un clone limpio del repo de Miled.

**Incluye:** funnel (`/quiz`), módulo `/leads`, endpoint `/api/lead`, `lib/quiz`, migraciones `0068–0071`, tests y los 5 edits a archivos existentes (`modulos.ts`, `middleware.ts`, `next.config.mjs`, `OsNav.tsx`, `inbox.css`).

**No incluye (a propósito):**
- Upgrade de Next `15.0.0 → 15.5.25` (seguridad — 2 RCE; va como PR aparte).
- `seed.sql` / `config.toml` / `scripts/dev.sh` (infra de desarrollo local).
- Archivos desactualizados de nuestra copia (`VentaForm.tsx`, `cuotas.ts`, `persona.ts`) y basura local de Supabase.

> ⚠️ El patch está generado contra el HEAD actual del repo de Miled (commit `fbbd936`, 16-sep-2026). Si el repo de Miled avanza antes de la transferencia, hay que regenerar el patch.

## Pasos

```bash
# 1) Clonar el repo de Miled (OS central en la raíz)
git clone https://github.com/miledgassibe/metacrypto-os-app metacrypto-os
cd metacrypto-os

# 2) Crear la rama
git checkout -b feature/leads-a-migracion-rpc

# 3) Aplicar el funnel (desde nuestro repo)
git apply --check ../herramienta-berni/release/funnel-leads.patch   # verifica que aplique limpio
git apply ../herramienta-berni/release/funnel-leads.patch

# 4) Probar (contra el Supabase local, docs/10)
cd apps/inbox && npm install && npm test

# 5) Commit y push
git add -A
git commit -m "feat(leads): funnel /quiz + modulo /leads + migraciones 0068-0071"
git push -u origin feature/leads-a-migracion-rpc
```

6. Abrir el **pull request** a `main` de Miled, con esta nota obligatoria:

> **Aplicar las migraciones `0068 → 0069 → 0070 → 0071` ANTES de deployar el código.** El código nuevo depende de ellas. La `0071` es de reconciliación: lleva cualquier base al mismo estado final.

## Verificación

- El patch fue verificado con `git apply --check` contra un clone fresco del repo de Miled.
- Es el mismo código que pasó **1.333 tests en verde** en el Supabase local.

## Después de la transferencia

- Sacar `metacrypto-os-app/` de `herramienta-berni` (`git rm -r metacrypto-os-app`) y trabajar directo en el clone del OS. Así queda: OS central en su propio repo, y `herramienta-berni` solo con docs + spec + prototipo.

## Pendientes separados (no van en el patch)

- Upgrade de Next `15.5.25` (seguridad).
- `seed.sql` y `config.toml` para desarrollo local.
