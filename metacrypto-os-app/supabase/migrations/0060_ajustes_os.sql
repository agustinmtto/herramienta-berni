-- ============================================================
-- MetaCrypto OS — Migración 0060: ajustes del OS que se cambian sin desplegar
--
-- Por qué existe: hasta hoy, mandar el contrato a las direcciones de prueba en
-- vez de al equipo se controlaba con `CONTRATO_EMAIL_PRUEBA`, una variable de
-- entorno de Vercel. Cambiar una variable **exige un redeploy**, así que pasar
-- de prueba a producción y volver era un viaje de varios minutos por cada
-- cambio — y el modo de fallo real no es tardar: es **olvidarse la variable
-- puesta** y que el contrato del primer cliente real se vaya a tres Gmail.
--
-- Con esto el cambio es un clic, se ve en pantalla cuál de los dos modos está
-- activo, y queda escrito quién lo cambió y cuándo.
--
-- Por qué una tabla y no una columna en otro sitio: no hay ninguna tabla de
-- configuración en el esquema (63 tablas, ninguna encaja). Es la pieza más
-- pequeña que resuelve el problema: dos columnas de datos y dos de rastro.
--
-- ⚠️ Es una tabla nueva en el esquema de Milo. Si prefiere otra forma, lo que
-- hay que mover es `ajusteOs()` en `apps/inbox/lib/ajustes.ts` y nada más: el
-- resto del código no sabe de dónde sale el valor.
-- ============================================================

begin;

create table if not exists public.ajustes_os (
  clave          text primary key,
  valor          text,
  actualizado_at timestamptz not null default now(),
  autor_id       uuid references public.team_members(id)
);

comment on table public.ajustes_os is
  'Ajustes del OS que se cambian desde la pantalla, sin desplegar. Una fila por ajuste.';

-- Los dos ajustes del contrato ------------------------------------------------
--
-- Están separados a propósito. `contrato_modo_prueba` es el interruptor, y
-- `contrato_email_prueba` guarda a quién se manda mientras esté encendido. Si
-- fueran uno solo, apagar el modo prueba borraría las direcciones y volver a
-- encenderlo obligaría a teclearlas otra vez — que es justo cuando se teclean
-- mal.
--
-- Nace ENCENDIDO. Es el lado seguro: el error caro es que un contrato real se
-- vaya a un buzón de pruebas, pero el error de nacer apagado es peor —
-- mandarle a Berni, Alex y Paula el contrato de la primera venta de prueba.
-- Se apaga con un clic cuando la prueba en producción esté aprobada.
insert into public.ajustes_os (clave, valor) values
  ('contrato_modo_prueba', 'on'),
  ('contrato_email_prueba',
   'dev1@ejemplo.com,dev2@ejemplo.com,dev3@ejemplo.com')
on conflict (clave) do nothing;

-- RLS, como el resto del esquema ---------------------------------------------
--
-- 20 declaraciones de `enable row level security` en las migraciones
-- anteriores: es el patrón, no una opción. Y esta tabla decide a DÓNDE se manda
-- un documento legal — es la última que debería quedarse sin la cerradura que
-- llevan sus vecinas.
--
-- Sin políticas a propósito: `rest()` (apps/inbox/lib/supabase.ts:9) usa la
-- service role, que salta RLS, así que la app la lee y la escribe igual. Lo que
-- queda cerrado es el acceso desde cualquier otra clave. Mismo criterio que la
-- 0055.
alter table public.ajustes_os enable row level security;

commit;
