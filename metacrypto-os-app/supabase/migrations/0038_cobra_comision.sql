-- Quién cobra comisión y quién no. Marca POR PERSONA, no por rol.
--
-- El caso que la obliga: Berni y Manuel son los dos `coach`, y solo Manuel
-- cobra. Berni es el dueño — cuando cierra una venta o hace una ascensión no
-- se le paga comisión. Sus palabras el 12-ago-2026: "si lo cierro yo, no se
-- lo lleva nadie, por decirlo así, porque al final lo que queda para la
-- empresa al final de mes es para mí".
--
-- Sin esto, atribuir la venta de Maurizio Jiménez (3.500 €, 6-ago, cerrada
-- por Berni) le habría generado un 10 % = 350 € al dueño del negocio, en
-- silencio. Ver docs/comisiones.md § 1.

alter table team_members
  add column if not exists cobra_comision boolean not null default true;

comment on column team_members.cobra_comision is
  'Si esta persona devenga comisión. NO se deduce del rol: Berni y Manuel son ambos coach y solo Manuel cobra. Un false NO borra la línea del informe — la deja a tasa 0, para que la actividad comercial siga siendo visible.';

-- Los tres que no cobran comisión, cada uno por su motivo:
--
--   Berni  (6cbb5982) — dueño. Ver arriba.
--   Milo   (1d41ed54) — admin, no interviene en la venta.
--   Paula  (fd1d7082) — SÍ cobra, pero un fijo mensual variable, no un 5 %.
--                       Confirmado por Milo el 12-ago y coherente con el
--                       audio de Berni, que la nombró entre los salarios
--                       ("este último mes ha sido 3.000... es un poco a
--                       discreción") y nunca entre las comisiones. Su
--                       salario es una línea de `gastos`, no de comisión.
--
-- Se listan por id y no por nombre: un renombrado no debe poder devolverle
-- la comisión a nadie sin que alguien lo decida.
update team_members
set cobra_comision = false
where id in (
  '6cbb5982-6051-4c00-bc98-97310140e23f',  -- Berni
  '1d41ed54-b111-452b-ad05-c82f91f0578f',  -- Milo
  'fd1d7082-8883-468b-a4aa-108ec4d5244e'   -- Paula
);
