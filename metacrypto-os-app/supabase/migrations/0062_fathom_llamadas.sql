-- ============================================================
-- 0062 — `fathom_llamadas`: las llamadas grabadas en Fathom, con su resumen.
--
-- Berni, en CAMBIOS OS (6-sep): que las sesiones se registren solas cuando
-- Fathom confirme que la llamada ocurrió, y que el consultor solo tenga que
-- "revisar, añadir la landing y validar". Y aparte, poder ver las llamadas de
-- VENTA asociadas a cada cliente.
--
-- POR QUÉ UNA TABLA PROPIA Y NO ESCRIBIR DIRECTO EN `sesiones`:
--
-- `sesiones` es el registro del servicio — de ahí salen el cupo de
-- consultorías de cada cliente y las comisiones de los consultores. Una
-- ingesta automática que escriba ahí mueve dinero sin que nadie lo mire, y
-- basta un emparejamiento equivocado para regalarle una consultoría a quien no
-- la tuvo. Ademas la mitad de lo que graba Fathom NO es una consultoría: son
-- weeklies internas y llamadas de venta.
--
-- Así que esto es una BANDEJA: la ingesta escribe aquí, siempre, sin decidir
-- nada irreversible. Convertir una llamada en sesión es un paso aparte, con
-- una persona delante — que es literalmente lo que pidió Berni.
--
-- IDEMPOTENCIA: `recording_id` es único. La ingesta hace upsert por esa clave,
-- así que puede correr las veces que haga falta sin duplicar. Y NO pisa lo que
-- haya tocado una persona: `persona_id` y `tipo` solo se escriben desde la
-- ingesta cuando `emparejado_por` no es 'manual' (ver lib/fathom.ts).
--
-- 🔴 LA TRAMPA DE LA API, documentada el 2-sep en outputs/fathom-alcance-real.md
-- y todavía vigente: el filtro `?recorded_by[]=` se IGNORA en silencio. Un
-- correo inventado devuelve las mismas reuniones que uno real. Por eso el dueño
-- de cada llamada se lee del campo `recorded_by` DE CADA FILA devuelta, nunca
-- de un filtro en la petición. Si alguien "optimiza" la ingesta pidiéndole a la
-- API solo las de un consultor, se van a guardar las de otro con su nombre.
-- ============================================================
begin;

create table if not exists public.fathom_llamadas (
  id uuid primary key default gen_random_uuid(),

  -- La clave de Fathom. Es el ancla de la idempotencia: un `upsert` por aquí
  -- deja correr la ingesta cuantas veces se quiera.
  recording_id bigint not null unique,

  titulo text,
  -- `url` es la llamada en Fathom (pide sesión). `share_url` es el enlace
  -- público que genera Fathom, y es el que se puede previsualizar dentro del
  -- OS sin que el equipo tenga que estar logueado en Fathom.
  url text,
  share_url text,

  -- Quién grabó. Se guarda el correo Y el nombre a propósito: el correo es la
  -- clave para cruzar con `team_members`, y el nombre sobrevive aunque esa
  -- persona se dé de baja del equipo.
  grabado_por_email text,
  grabado_por_nombre text,
  grabado_por_equipo text,

  inicio timestamptz,
  fin timestamptz,
  duracion_min int,

  -- venta    → la grabó un closer o un setter (`team_members.rol`)
  -- servicio → la grabó un coach
  -- interna  → no hubo NINGÚN invitado externo: no puede ser con un cliente,
  --            por mucho que el título lleve el nombre de uno (pasa: hay
  --            debriefs internos titulados con el nombre del cliente).
  -- El rol se lee de la base, no de una lista de correos en el código.
  tipo text not null default 'interna' check (tipo in ('venta','servicio','interna')),

  persona_id uuid references public.personas(id),
  -- Cómo se emparejó, porque no todos los emparejamientos valen lo mismo:
  --   correo → un invitado externo coincide con `personas.email`. Fiable.
  --   titulo → el título contiene el nombre de un cliente. SUGERENCIA, no
  --            verdad: hay que confirmarlo a mano antes de usarlo para nada.
  --   manual → lo decidió una persona. La ingesta NO lo pisa nunca.
  emparejado_por text check (emparejado_por in ('correo','titulo','manual')),

  -- Los invitados de fuera del dominio, tal como los devuelve Fathom. Se
  -- guardan aunque ya se haya emparejado: son la prueba de por qué se emparejó
  -- así, y sirven para reintentar el cruce cuando un cliente gana correo.
  invitados_externos jsonb not null default '[]'::jsonb,

  -- El resumen que escribe la IA de Fathom, en markdown y con enlaces con
  -- marca de tiempo a la grabación. Es lo que Berni quiere leer sin entrar a
  -- Fathom, y lo que puede acabar en las notas de la sesión.
  resumen_md text,
  acciones jsonb not null default '[]'::jsonb,
  idioma text,

  -- Cuando alguien convierte esta llamada en una sesión del servicio.
  -- `on delete set null`: si se borra la sesión, la llamada sigue existiendo —
  -- es un hecho de Fathom, no del OS.
  sesion_id uuid references public.sesiones(id) on delete set null,

  -- Para no volver a ofrecer una llamada que alguien ya decidió ignorar
  -- (una weekly, una llamada personal). No se borra: se archiva.
  descartada_at timestamptz,

  creado_at timestamptz not null default now(),
  actualizado_at timestamptz not null default now()
);

comment on table public.fathom_llamadas is
  'Bandeja de llamadas grabadas en Fathom. La ingesta escribe aquí y NUNCA en `sesiones`: convertir una llamada en sesión es un paso con una persona delante, porque `sesiones` mueve cupo de consultorías y comisiones.';

comment on column public.fathom_llamadas.recording_id is
  'Id de la grabación en Fathom. UNIQUE — es la clave del upsert que hace idempotente la ingesta.';

comment on column public.fathom_llamadas.emparejado_por is
  '"correo" = un invitado externo coincide con personas.email (fiable). "titulo" = el título contiene el nombre de un cliente (SUGERENCIA, confirmar a mano). "manual" = lo decidió una persona, y la ingesta no lo pisa.';

comment on column public.fathom_llamadas.tipo is
  'Derivado de team_members.rol de quien grabó: closer/setter -> venta, coach -> servicio. "interna" gana sobre las dos cuando no hubo ningún invitado externo.';

-- Los tres accesos reales de la pantalla: la bandeja (lo que falta por
-- revisar), la ficha de un cliente (sus llamadas) y el upsert de la ingesta.
create index if not exists idx_fathom_inicio on public.fathom_llamadas (inicio desc);
create index if not exists idx_fathom_persona on public.fathom_llamadas (persona_id) where persona_id is not null;
create index if not exists idx_fathom_pendientes on public.fathom_llamadas (inicio desc)
  where sesion_id is null and descartada_at is null and tipo <> 'interna';

-- Mismo criterio que el resto del OS: la app entra con la service-role key,
-- que se salta RLS. Se activa igualmente para que la tabla no quede abierta si
-- algún día se expone con la anon key.
alter table public.fathom_llamadas enable row level security;

commit;
