-- 0011_comunicacion_media.sql — media + reacciones en wa_mensajes
alter table public.wa_mensajes
  add column if not exists media_path      text,
  add column if not exists media_kapso_url text,
  add column if not exists media_mime      text,
  add column if not exists media_filename  text,
  add column if not exists media_size      bigint,
  add column if not exists media_status    text not null default 'none'
      check (media_status in ('none','pending','stored','failed')),
  add column if not exists caption         text,
  add column if not exists transcript      text,
  add column if not exists reaccion_emoji  text;

-- Índice para el recolector de pendientes (Task 2.4).
create index if not exists idx_wamsg_media_status
  on public.wa_mensajes(media_status) where media_status in ('pending','failed');
