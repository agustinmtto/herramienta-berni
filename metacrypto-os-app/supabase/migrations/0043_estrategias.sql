-- ============================================================
-- 0043 — Estrategias del cliente.
--
-- Milo, 20-ago-2026: "necesito un lugar donde los clientes puedan ver sus
-- estrategias".
--
-- Hoy cada estrategia es una landing hecha a mano en GoHighLevel
-- (invierteconberni.com/cliente-NNN) y Airtable solo modela UNA por cliente
-- (`Clients.Landing` + `Landing Password`). El cliente solo sabe que existe
-- si alguien se acuerda de mandarle el enlace, y no tiene ningún sitio al que
-- volver. 37 de los 100 clientes activos con programa vigente tienen una.
--
-- Esto NO produce estrategias: Berni las sigue haciendo con Claude y
-- publicándolas en GHL. Aquí se registran, se ordenan y se le enseñan al
-- cliente.
--
-- Diseño completo en
-- docs/superpowers/specs/2026-08-20-estrategias-design.md
--
-- TODO ADITIVO: dos tablas nuevas y tres funciones. No toca ni una fila
-- existente, y nada financiero mira estas tablas.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1) estrategias — un cliente tiene N
-- ------------------------------------------------------------
-- SIN `sesion_id` a propósito. Se evaluó colgarlas de la sesión en que se
-- hablaron (es donde nacen) y Milo lo descartó explícitamente: una estrategia
-- se revisa y se reemplaza continuamente, y atarla a una consultoría obliga
-- al equipo a pensar en sesiones para una cosa que es del cliente.
--
-- `url` es not null: una estrategia sin enlace no es nada — el documento vive
-- en GoHighLevel y esto es el índice. `password` sí es nullable: hay dos
-- landings sin contraseña en Airtable (Erlend y Javier Rubio).
create table if not exists public.estrategias (
  id                uuid primary key default gen_random_uuid(),
  persona_id        uuid not null references public.personas(id) on delete cascade,
  titulo            text not null,
  url               text not null,
  password          text,
  resumen           text,
  fecha_lanzamiento date not null default current_date,
  -- Lo que el cliente ve. "Quitar" pone esto en false y CONSERVA la fila,
  -- igual que las cuotas anuladas y los clientes archivados: el histórico del
  -- servicio es justo lo que hace que el cliente vea su plan evolucionar.
  visible           boolean not null default true,
  creado_por        uuid references public.team_members(id),
  created_at        timestamptz not null default now()
);

create index if not exists estrategias_persona_idx
  on public.estrategias (persona_id, fecha_lanzamiento desc);

-- El contador de la nav lee esto: cargadas y sin publicar.
create index if not exists estrategias_sin_publicar_idx
  on public.estrategias (visible) where visible = false;

-- ------------------------------------------------------------
-- 2) portal_accesos — la llave del cliente
-- ------------------------------------------------------------
-- El acceso del cliente va EN EL ENLACE, no en un código ni en una
-- contraseña, y no es una preferencia: Meta obliga a que cualquier plantilla
-- que entregue una credencial sea de categoría AUTHENTICATION, y esta WABA
-- NO tiene permiso para crearlas (aislado el 20-ago con un control UTILITY
-- que sí se creó; ver docs/plantillas-whatsapp.md). Por WhatsApp no puede
-- viajar ninguna credencial, así que el enlace es la credencial.
--
-- `persona_id` ÚNICO: un cliente, un enlace vivo. Rotar es escribir un token
-- nuevo; revocar es poner `revocado_at`. Así el enlace que ya se mandó por
-- WhatsApp sigue sirviendo para siempre salvo que alguien lo corte a mano —
-- que es lo que el cliente espera de "mi página".
--
-- EL TOKEN SE GUARDA EN CLARO, y es deliberado: el equipo necesita poder
-- reenviar el enlace, y hasheado sería irrecuperable. Se acepta porque esta
-- misma tabla vecina ya guarda en claro las contraseñas de las landings, y
-- porque a la base solo se entra con service_role.
--
-- El token lo genera Node (crypto.randomBytes(24) → base64url, 192 bits) y no
-- Postgres, para no depender de que pgcrypto esté instalado. 192 bits hacen
-- la fuerza bruta irrelevante — que importa, porque este repo no tiene
-- ninguna infraestructura de rate limiting.
create table if not exists public.portal_accesos (
  id               uuid primary key default gen_random_uuid(),
  persona_id       uuid not null unique references public.personas(id) on delete cascade,
  token            text not null unique,
  creado_por       uuid references public.team_members(id),
  created_at       timestamptz not null default now(),
  ultimo_acceso_at timestamptz,
  revocado_at      timestamptz
);

-- ------------------------------------------------------------
-- 3) RLS — cerradas del todo
-- ------------------------------------------------------------
-- A diferencia de 0035, que da lectura a `authenticated`, aquí NO se crea
-- ninguna política. Estas dos tablas guardan credenciales (la contraseña de
-- cada landing y la llave del portal), así que solo entra `service_role`, que
-- es como accede la app (lib/supabase.ts). Sin política, cualquier otra clave
-- no ve nada.
alter table public.estrategias     enable row level security;
alter table public.portal_accesos  enable row level security;

-- ------------------------------------------------------------
-- 4) Funciones — la auditoría va atómica con el cambio
-- ------------------------------------------------------------

-- Crea la estrategia y, de paso, se asegura de que el cliente tenga llave.
-- Las dos cosas en la misma transacción a propósito: el aviso de WhatsApp que
-- se manda justo después necesita el enlace, y una estrategia publicada cuyo
-- cliente no tiene token es una estrategia que nadie puede ver.
--
-- `token_nuevo` solo se usa si la persona aún no tenía. Si ya tenía, se
-- devuelve el suyo y el generado se tira — así el enlace de un cliente NUNCA
-- cambia por publicarle una estrategia más.
create or replace function public.crear_estrategia(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_persona uuid := nullif(payload->>'persona_id','')::uuid;
  v_autor   uuid := nullif(payload->>'autor_id','')::uuid;
  v_titulo  text := nullif(btrim(payload->>'titulo'), '');
  v_url     text := nullif(btrim(payload->>'url'), '');
  v_token   text := nullif(btrim(payload->>'token_nuevo'), '');
  v_id      uuid;
  v_tok     text;
begin
  if v_persona is null then raise exception 'Falta el cliente'; end if;
  if v_titulo  is null then raise exception 'La estrategia necesita un título'; end if;
  if v_url     is null then raise exception 'La estrategia necesita un enlace'; end if;
  if v_token   is null then raise exception 'Falta el token de acceso'; end if;

  if not exists (select 1 from public.personas where id = v_persona) then
    raise exception 'Ese cliente no existe';
  end if;

  insert into public.estrategias
    (persona_id, titulo, url, password, resumen, fecha_lanzamiento, visible, creado_por)
  values (
    v_persona, v_titulo, v_url,
    nullif(btrim(payload->>'password'), ''),
    nullif(btrim(payload->>'resumen'), ''),
    coalesce(nullif(payload->>'fecha_lanzamiento','')::date, current_date),
    coalesce((payload->>'visible')::boolean, true),
    v_autor
  )
  returning id into v_id;

  -- Get-or-create de la llave. El `do update` no toca el token: existe solo
  -- para que el `returning` devuelva la fila también cuando ya estaba.
  insert into public.portal_accesos (persona_id, token, creado_por)
  values (v_persona, v_token, v_autor)
  on conflict (persona_id) do update set persona_id = excluded.persona_id
  returning token into v_tok;

  insert into public.auditoria (entidad, entidad_id, accion, autor_id, datos)
  values ('estrategia', v_id, 'crear', v_autor,
          jsonb_build_object('persona_id', v_persona, 'titulo', v_titulo, 'url', v_url));

  return jsonb_build_object('ok', true, 'id', v_id, 'token', v_tok);
end;
$$;

create or replace function public.editar_estrategia(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id    uuid := nullif(payload->>'id','')::uuid;
  v_autor uuid := nullif(payload->>'autor_id','')::uuid;
  v_ant   public.estrategias%rowtype;
begin
  select * into v_ant from public.estrategias where id = v_id for update;
  if not found then raise exception 'Esa estrategia no existe'; end if;

  update public.estrategias set
    titulo            = coalesce(nullif(btrim(payload->>'titulo'), ''), titulo),
    url               = coalesce(nullif(btrim(payload->>'url'), ''), url),
    -- password y resumen SÍ se pueden vaciar: mandar "" los borra. Por eso
    -- miran a la clave del jsonb y no a coalesce, que nunca dejaría borrar.
    password          = case when payload ? 'password' then nullif(btrim(payload->>'password'), '') else password end,
    resumen           = case when payload ? 'resumen'  then nullif(btrim(payload->>'resumen'),  '') else resumen  end,
    fecha_lanzamiento = coalesce(nullif(payload->>'fecha_lanzamiento','')::date, fecha_lanzamiento)
  where id = v_id;

  insert into public.auditoria (entidad, entidad_id, accion, autor_id, datos)
  values ('estrategia', v_id, 'editar', v_autor,
          jsonb_build_object('antes', jsonb_build_object(
            'titulo', v_ant.titulo, 'url', v_ant.url, 'resumen', v_ant.resumen,
            'fecha_lanzamiento', v_ant.fecha_lanzamiento), 'cambios', payload - 'autor_id'));

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- Ocultar / mostrar. No borra: el histórico es parte del servicio.
create or replace function public.visibilidad_estrategia(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id      uuid    := nullif(payload->>'id','')::uuid;
  v_autor   uuid    := nullif(payload->>'autor_id','')::uuid;
  v_visible boolean := (payload->>'visible')::boolean;
begin
  if v_visible is null then raise exception 'Falta decir si se muestra o se oculta'; end if;
  update public.estrategias set visible = v_visible where id = v_id;
  if not found then raise exception 'Esa estrategia no existe'; end if;

  insert into public.auditoria (entidad, entidad_id, accion, autor_id, datos)
  values ('estrategia', v_id, case when v_visible then 'mostrar' else 'ocultar' end,
          v_autor, jsonb_build_object('visible', v_visible));

  return jsonb_build_object('ok', true, 'id', v_id, 'visible', v_visible);
end;
$$;

-- Estas funciones son `security definer` y escriben: nadie salvo la app.
revoke all on function public.crear_estrategia(jsonb)       from public, anon, authenticated;
revoke all on function public.editar_estrategia(jsonb)      from public, anon, authenticated;
revoke all on function public.visibilidad_estrategia(jsonb) from public, anon, authenticated;
grant execute on function public.crear_estrategia(jsonb)       to service_role;
grant execute on function public.editar_estrategia(jsonb)      to service_role;
grant execute on function public.visibilidad_estrategia(jsonb) to service_role;

commit;
