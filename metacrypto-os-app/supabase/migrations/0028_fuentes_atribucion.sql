-- ============================================================
-- 0028 — Catálogo de fuentes: traduce el `Source_ID` crudo de GoHighLevel
-- a una fuente canónica y a un setter.
--
-- POR QUÉ UNA TABLA Y NO CÓDIGO
-- `Source_ID` es un campo de TEXTO LIBRE en GHL (custom field
-- OJF2hSyIXnOb4u4kXMgW, `contact.source_id`). Nadie impide un valor nuevo:
-- un typo del setter crea una fuente nueva en silencio. Con el mapeo en una
-- tabla, un valor nuevo se absorbe con un INSERT — sin desplegar — y Berni
-- puede corregir la interpretación sin tocar código.
--
-- EL CASO QUE LO JUSTIFICA
-- `as` (29) y `AS_agenda` (13) son la MISMA fuente escrita de dos formas.
-- Juntas suman 42: la fuente #1 del negocio. Agrupando por el string crudo
-- aparece partida en dos y ninguna gana — el reporte miente sobre dónde
-- está el negocio.
--
-- CONFIRMADO = FALSE A PROPÓSITO
-- Las lecturas de abajo son INTERPRETACIÓN, no dato. Las iniciales cuadran
-- con el equipo (db = Dani Bertólez, js = Juan Segura, pc = Paula Casal),
-- pero nadie lo ha confirmado. Hasta que Berni valide fila por fila,
-- `confirmado` queda en false y ninguna comisión debería calcularse sobre
-- una fila sin confirmar.
--
-- POR QUÉ EL SETTER ES TEXTO Y NO UNA FK
-- Dani, Juan y Paula NO existen en `team_members` — que solo tiene a Alex,
-- Berni, Manuel y Milo, y cuyo `rol` está restringido a coach/closer/admin.
-- Además `team_members` ES la tabla de login (`/api/login` busca ahí) y
-- alimenta el selector de coach del inbox: darles de alta tiene efectos
-- colaterales que son una decisión aparte. `setter_id` queda preparada para
-- cuando esa decisión se tome; hasta entonces manda `setter_nombre`.
-- ============================================================
begin;

create table if not exists public.fuentes_atribucion (
  source_id     text primary key,                       -- tal cual viene de GHL
  fuente        text not null,                          -- canónica, ya deduplicada
  setter_nombre text,                                   -- null = no hay setter (orgánico, autosetter)
  setter_id     uuid references public.team_members(id),-- para cuando los setters existan
  nivel         text not null check (nivel in ('setter','canal','contenido','campana')),
  confirmado    boolean not null default false,
  notas         text,
  created_at    timestamptz not null default now()
);

comment on table public.fuentes_atribucion is
  'Traduce el Source_ID crudo de GHL a fuente canónica + setter. confirmado=false significa que la lectura es una interpretación pendiente de validar con Berni.';

-- Semilla: los 20 valores observados en 181 contactos que agendaron entre
-- mayo y agosto de 2026. `on conflict do nothing` para que reaplicar la
-- migración no pise correcciones ya hechas a mano.
insert into public.fuentes_atribucion (source_id, fuente, setter_nombre, nivel, notas) values
  ('as',                      'AutoSetter',  null,    'canal',     'Misma fuente que AS_agenda. Juntas: 42 agendas, la #1.'),
  ('AS_agenda',               'AutoSetter',  null,    'canal',     'Misma fuente que "as", otra grafía.'),
  ('ig_set_db',               'Instagram',   'Dani',  'setter',    'Canal más fuerte de Dani (36). Desmiente el atajo "Instagram = Juan".'),
  ('wa_set_db',               'WhatsApp',    'Dani',  'setter',    null),
  ('wp_dani',                 'WhatsApp',    'Dani',  'setter',    'Variante de wa_set_db.'),
  ('set_js',                  'Sin canal',   'Juan',  'setter',    'No declara canal, solo setter.'),
  ('ig_set_pc',               'Instagram',   'Paula', 'setter',    null),
  ('ig_bio',                  'Instagram',   null,    'canal',     'Link en la bio.'),
  ('direct',                  'Directo',     null,    'canal',     'Sin intermediario identificado.'),
  ('directo_evento_100K',     'Evento',      null,    'campana',   'Directo del evento de los 100K seguidores.'),
  ('yt_evento',               'YouTube',     null,    'campana',   null),
  ('lm_bottom',               'Lead magnet', null,    'contenido', null),
  ('igreel_shortmayo',        'Instagram',   null,    'contenido', 'Reel.'),
  ('igreel_doc3altcoins',     'Instagram',   null,    'contenido', 'Reel.'),
  ('igreel_DOCtop3altcoins',  'Instagram',   null,    'contenido', 'Reel. Ojo: convive con igreel_doc3altcoins, distinta capitalización.'),
  ('igreel18jun_bottombtc',   'Instagram',   null,    'contenido', 'Reel del 18-jun.'),
  ('igreel_bottomdebitcoin',  'Instagram',   null,    'contenido', 'Reel.'),
  ('igstory_doc3altcoins',    'Instagram',   null,    'contenido', 'Historia.'),
  ('wpdani_doctop3altcoins',  'WhatsApp',    'Dani',  'contenido', 'Pieza concreta repartida por Dani.'),
  ('yt_PRECIOCOMPRARBITCOIN', 'YouTube',     null,    'contenido', null)
on conflict (source_id) do nothing;

commit;
