-- ============================================================
-- 0065 — La firma del contrato dentro del OS.
--
-- Spec: docs/superpowers/specs/2026-09-15-firma-contrato-en-el-os-design.md.
-- Hasta hoy `contratos` sabía generar y mandar al equipo. Ahora tiene que
-- saber: qué texto exacto se mandó (y si Alex lo editó), por qué enlace, si
-- el cliente lo abrió, y cuando firma, con qué nombre, desde dónde y sobre
-- qué documento. Nada de esto existía: `firmado` estaba en la CHECK desde la
-- 0004 y ninguna línea de la app lo escribía.
--
-- 🔴 ANTES DEL DEPLOY, como la 0061 y por lo mismo: `getContratos()` pedirá
-- estas columnas y sin ellas PostgREST responde 400, `rest()` no lanza y la
-- pestaña dice "todavía no hay ninguno".
--
-- `fecha_firma date` (0004) NO se toca: es la fecha nominal que imprime la
-- plantilla ("Fecha de emisión"). La real, con hora, es `firmado_at`.
-- ============================================================
begin;

alter table public.contratos
  -- El enlace del cliente. Uno por CONTRATO, no por persona: venta + ampliación
  -- son dos contratos y dos firmas. Reenviar rota el token.
  add column if not exists token              text unique,
  add column if not exists token_expira_at    timestamptz,
  add column if not exists enviado_cliente_at timestamptz,
  add column if not exists visto_at           timestamptz,   -- PRIMERA apertura; la traza completa va en contrato_eventos
  -- La firma.
  add column if not exists firmado_at         timestamptz,
  add column if not exists firma_nombre       text,
  add column if not exists firma_ip           inet,
  add column if not exists firma_user_agent   text,
  add column if not exists firma_geo          text,
  -- Huellas. `hash_enviado` es el SHA-256 del PDF que se le mandó; al firmar
  -- se comprueba que el PDF servido sigue siendo ese (si Alex lo editó entre
  -- medias, se frena y hay que reenviar). `hash_firmado` es el del PDF final.
  add column if not exists hash_enviado       text,
  add column if not exists hash_firmado       text,
  -- firmados/<programa_id>-<12 primeros del sha256>.pdf; el sin firmar sigue
  -- en pdf_path. El hash va en la clave para que dos firmas simultáneas no
  -- escriban en el mismo objeto (la subida hace upsert): cada render tiene su
  -- sitio y esta columna apunta al fichero cuyo sha256 guarda hash_firmado.
  add column if not exists pdf_firmado_path   text,
  -- Consentimiento: el texto literal que marcó, versionado.
  add column if not exists consentimiento     text,
  add column if not exists consentimiento_v   smallint,
  -- El texto del contrato (spec, decisión 4). `texto_generado` es lo que
  -- produjo la plantilla; `texto_final` lo que se mandó, editado o no. Si son
  -- iguales, nadie lo tocó. El bloque de firma NO va dentro.
  add column if not exists texto_generado     text,
  add column if not exists texto_final        text,
  add column if not exists texto_editado_por  uuid references public.team_members(id),
  add column if not exists texto_editado_at   timestamptz,
  -- Lo que el bloque de firma necesita para rellenarse al firmar
  -- ({cliente_nombre, fecha_firma}). Se escribe al generar.
  add column if not exists datos_bloque       jsonb not null default '{}'::jsonb;

-- Dos estados nuevos. La CHECK se reescribe entera (Postgres no "añade").
alter table public.contratos drop constraint if exists contratos_estado_check;
alter table public.contratos add constraint contratos_estado_check
  check (estado in ('pendiente', 'enviado', 'error_envio', 'enviado_cliente', 'firmado'));
comment on column public.contratos.estado is
  'pendiente = generado, sin mandar · enviado = al equipo (Resend aceptó) · error_envio = no salió a nadie · enviado_cliente = el enlace de firma salió al cliente · firmado = el cliente firmó (firmado_at, firma_nombre, hash_firmado).';

alter table public.contratos drop constraint if exists contratos_tipo_check;
alter table public.contratos add constraint contratos_tipo_check
  check (tipo is null or tipo in ('venta_nueva', 'ampliacion', 'venta_nueva_v2'));

-- El correo al cliente es el séptimo tipo. Misma regla que en 0057: la lista
-- de TypeScript (lib/canales.ts) y esta CHECK se mueven JUNTAS.
alter table public.emails_enviados drop constraint if exists emails_enviados_tipo_check;
alter table public.emails_enviados add constraint emails_enviados_tipo_check
  check (tipo in ('estrategia', 'confirmacion_sesion', 'recordatorio_1h', 'invitacion_calendario',
                  'aviso_venta_equipo', 'contrato', 'contrato_cliente'));

-- La traza, append-only. `marcarAcceso` del portal SOBREESCRIBE
-- `ultimo_acceso_at`; para evidencia hace falta cada evento con su IP.
create table if not exists public.contrato_eventos (
  id          uuid primary key default gen_random_uuid(),
  contrato_id uuid not null references public.contratos(id) on delete cascade,
  tipo        text not null check (tipo in ('enviado', 'abierto', 'firmado', 'rechazado', 'enlace_rotado')),
  ocurrido_at timestamptz not null default now(),
  ip          inet,
  user_agent  text,
  geo         text,
  datos       jsonb not null default '{}'::jsonb
);
create index if not exists idx_contrato_eventos_contrato
  on public.contrato_eventos (contrato_id, ocurrido_at);

-- Cerrada del todo, como portal_accesos (0043): solo service_role.
alter table public.contrato_eventos enable row level security;

commit;
