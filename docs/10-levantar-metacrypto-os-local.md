# 10 — Levantar MetaCrypto OS en local (Supabase + Docker)

Guía para que cualquier dev levante el sistema interno del negocio (MetaCrypto OS, `metacrypto-os-app/`) con su **propia base local** en Docker Desktop, sin tocar producción. Es la implementación de la Fase 0 de `docs/08` (§1.1–1.2): N copias locales a costo cero, migraciones como contrato.

>Esta guía vive en el repo `herramienta-berni`. El código y sus propias convenciones están en `metacrypto-os-app/CLAUDE.md` (leerlo antes de tocar la app).

## 1. Requisitos previos

| Herramienta | Instalación | Verificar |
|---|---|---|
| Docker Desktop | [docker.com](https://www.docker.com/products/docker-desktop/) — abrirlo y dejarlo corriendo | `docker info` responde |
| Node.js ≥ 20 | [nodejs.org](https://nodejs.org) | `node --version` |
| Supabase CLI | `brew install supabase/tap/supabase` | `supabase --version` |

No hace falta cuenta de Supabase ni credenciales de producción: todo corre local.

### Windows

Funciona igual con tres diferencias de instalación:

1. **Docker Desktop**: instalar con backend **WSL2** (lo pide el instalador; si no lo tiene, `wsl --install` y reiniciar antes).
2. **Supabase CLI**: `winget install Supabase.CLI` (o `scoop bucket add supabase https://github.com/supabase/scoop-bucket.git && scoop install supabase`).
3. **`scripts/dev.sh`** es bash: correrlo desde **Git Bash** (viene con Git for Windows) o WSL. Alternativa sin script: usar los comandos de Supabase directo en PowerShell — `supabase start`, `supabase stop`, `supabase status`, `supabase db reset`.

El resto (`.env.local`, `npm install`, `npm run dev`, login, seed, migraciones) es idéntico en ambos sistemas.

## 2. Primera vez (desde cero)

Desde la **raíz del repo** (`herramienta-berni/`):

```bash
# 1) Levantar la base (descarga imágenes de Docker la primera vez, ~2-5 min)
cd metacrypto-os-app
supabase start
#    → la primera vez aplica todas las migraciones (69 a la fecha, incluyendo
#      `0068_quiz_leads`, `0069_vinculacion_validacion_rollback`, `0070_descarte_leads` y
#      `0071_reconciliacion_leads`) automáticamente
#      y siembra `supabase/seed.sql` (datos de prueba).
#    → anota las URLs que imprime (API :54321, Studio :54323, DB :54322).

# 2) Configurar las credenciales de la app
cd apps/inbox
cp ../../.env.example .env.local     # el .env.example vive en metacrypto-os-app/, no en apps/inbox (§4)

# 3) Instalar y arrancar la app
npm install
npm run dev                          # http://localhost:3000
```

Iniciar sesión con el usuario de desarrollo: **`milo` / `dev1234`** (admin, acceso total). El resto del equipo del seed (`berni`, `alex`, `manuel`, `paula`) usa la misma `dev1234`.

## 3. Día a día (ya instalado)

```bash
cd metacrypto-os-app
./scripts/dev.sh start               # levanta la base (Docker debe estar corriendo)
cd apps/inbox && npm run dev         # levanta la app

# Al terminar el día:
./scripts/dev.sh stop                # baja la base; los datos persisten
```

El script `metacrypto-os-app/scripts/dev.sh` encapsula todo:

| Comando | Qué hace |
|---|---|
| `./scripts/dev.sh start` | Levanta Supabase local (Docker) |
| `./scripts/dev.sh stop` | Lo baja (los datos **no** se pierden) |
| `./scripts/dev.sh status` | URLs + credenciales locales |
| `./scripts/dev.sh reset` | **BORRA la base** y reaplica migraciones + seed desde cero |
| `./scripts/dev.sh env` | Imprime las variables para `.env.local` |

## 4. `.env.local` de desarrollo

`apps/inbox/.env.local` está gitignoreado (nunca commitear credenciales). Valores para el Supabase local:

```bash
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=<ANON_KEY de `supabase status`>
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY de `supabase status`>
AUTH_TOKEN=dev-local-secret-metacrypto-os-0123456789abcdef
PORTAL_BASE_URL=http://localhost:3000
CONTRATO_FIRMA_PNG_BASE64=
```

Copiá las dos claves JWT de la salida de `supabase status` (o `./scripts/dev.sh env`) — son claves de desarrollo local, no de producción. Las integraciones opcionales (GHL, Kapso, Resend…) quedan vacías: sin ellas esas pantallas no cargan datos reales, que es lo esperado en local.

## 5. Reset y datos de prueba

`supabase db reset` (= `./scripts/dev.sh reset`) **borra todo** y vuelve a aplicar: todas las migraciones (69 a la fecha) + `supabase/seed.sql`. Es el comando obligatorio antes de abrir un PR que toque DB (`docs/08` §1.3) y la forma rápida de volver a un estado conocido.

El seed deja datos en **todas las tablas** del esquema (2–3 filas por tabla, salvo catálogos), con fechas relativas a hoy para que los estados (vencida, agendada…) siempre tengan sentido:

| Módulo | Datos de prueba |
|---|---|
| Equipo | 5 miembros con login (`milo` admin + berni/alex/manuel/paula) + 3 setters |
| Clientes | 6 personas: 3 clientes, 1 lead, 1 reservado, 1 ex-cliente (refund) |
| Ventas | 4 programas (tiers 1800/3000/5000), 2 atribuidos a fuente |
| Cobranza | 10 cuotas (pagadas, **1 vencida**, pendientes) + 4 pagos con 1 refund total |
| Consultorías | 2 sesiones (1 realizada con operaciones cargadas, 1 agendada) |
| Contratos | 1 firmado + 1 enviado al cliente, con sus eventos (enviado/abierto/firmado) |
| Estrategias | 2 documentos publicados |
| Finanzas | 3 gastos + snapshots de patrimonio + posiciones (BTC/ETH) |
| Comunicación | 1 conversación WhatsApp pendiente con 3 mensajes, 2 emails, 2 push |
| Fathom | 2 llamadas (1 servicio, 1 venta) emparejadas |
| Atribución | 3 fuentes de prueba + 20 del catálogo (migración 0028) |
| Portal/Onboarding | 2 accesos al portal + 2 onboarding |

Los usuarios se crean **en el seed** (no en migraciones: los hashes de producción no vienen al repo). Password de dev para todos: `dev1234`.

## 6. Puertos locales

| Servicio | Puerto |
|---|---|
| App (Next.js) | `http://localhost:3000` |
| API Supabase (PostgREST/Auth) | `http://127.0.0.1:54321` |
| Postgres directo | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| Studio (panel web de la base) | `http://127.0.0.1:54323` |
| Mailpit (emails capturados) | `http://127.0.0.1:54324` |

## 7. Problemas frecuentes

- **`docker info` falla** → Docker Desktop no está abierto. Abrirlo primero.
- **Login rechaza `milo`/`dev1234`** → la base quedó sin el seed (p. ej. un reset interrumpido): `./scripts/dev.sh reset`.
- **Pantallas vacías sin error** → migración sin aplicar o datos del seed ausentes; ver trampa #4 de `metacrypto-os-app/CLAUDE.md`. `./scripts/dev.sh reset` arregla.
- **`npm run build` rompe el dev que corre** → trampa #1 del CLAUDE.md: parar `next dev` antes de construir.
- **Puerto ocupado** → si otro proyecto Supabase usa :54321, cambiar `project_id` en `supabase/config.toml` o detener la otra pila.
- **Cambios propios en el seed/migraciones** → siempre `supabase db reset` para validar que corre desde cero.

## 8. Migraciones adaptadas para reset local

Dos migraciones venían de producción y asumían datos que no viajan con el repo. Se ajustaron **sin cambiar su efecto donde los datos existen** (producción), para que un reset desde cero funcione:

- `0053_sesiones_recurrentes.sql` — inserta las sesiones fijas solo si el coach existe (los UUID del equipo son datos, no esquema).
- `0066_catalogo_2026.sql` — los "testigos" del congelado se saltan con base vacía; con datos corren igual.

El equipo con login y todos los datos de prueba viven en `supabase/seed.sql`, que corre después de las migraciones en cada reset.
