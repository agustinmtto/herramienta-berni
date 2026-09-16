-- ============================================================
-- 0061 — Las dos marcas de estado del PDF en `contratos`.
--
-- Cuando se corrigen los bonos de un cliente DESPUÉS de emitido el contrato
-- (hallazgo #2 de la revisión de Milo, PR #3), el PDF ya enviado queda con
-- datos viejos y nada lo señala. Hacen falta DOS marcas, no una, porque son
-- dos preguntas distintas:
--
--   `desactualizado_at` — "hay que regenerarlo": alguien cambió los bonos y el
--                         PDF que está en la bandeja del equipo ya no coincide.
--   `recorregido_at`    — "ya se regeneró": este PDF es la versión corregida.
--
-- Cuál manda no se calcula: `recorregirContrato` escribe `recorregido_at` y
-- apaga `desactualizado_at` en el MISMO update, así que las dos solo están
-- puestas a la vez cuando la corrección se quedó a medias —los bonos nuevos
-- guardados y la regeneración fallida—. Ahí el PDF del equipo sigue siendo el
-- viejo, y la pantalla enseña el aviso rojo, que es lo correcto.
--
-- No son booleanos: la fecha cuesta lo mismo que un `true` y además sirve para
-- decirle a quien mira CUÁNDO pasó, y para auditar después.
--
-- POR QUÉ NO SE COMPARAN LOS BONOS en vez de guardar una marca: no hay contra
-- qué compararlos. El insert del contrato guarda `persona_id`, `programa_id`,
-- `tipo`, `estado`, `pdf_path` y `fecha_firma` — en ninguna parte queda con
-- qué bonos se generó ese PDF. Deducirlo exigiría guardar una copia de los
-- bonos al emitir, que es otra columna: el mismo costo, con más código encima.
--
-- 🔴 CUÁNDO APLICARLA: ANTES DEL DEPLOY. El orden NO es libre.
--
-- (Sí da igual respecto al MERGE: mergear en este repo no despliega nada — no
-- hay git-link con Vercel, el deploy es manual. Lo único que no admite
-- inversión es migración antes que deploy.)
--
-- Qué pasa si se despliega sin ella, leído en el código y medido, no supuesto:
--
--   1. `getContratos()` (lib/data.ts) pide `recorregido_at` y
--      `desactualizado_at` en su select, así que PostgREST responde 400 con
--      `42703: column contratos.recorregido_at does not exist`.
--   2. `rest()` NO lanza ante un status de error: devuelve `{status, json}`
--      (lib/supabase.ts).
--   3. `getContratos()` acaba en `return Array.isArray(r.json) ? r.json : []`
--      → array vacío.
--   4. La pestaña dibuja "todavía no hay ninguno" PARA TODOS LOS CONTRATOS.
--
--   O sea: la pestaña no se rompe con un error visible, MIENTE EN SILENCIO. Y
--   es fácil de pasar por alto porque `contratos` tiene 0 filas ahora mismo,
--   así que un deploy fuera de orden se vería idéntico a lo normal hasta el
--   primer contrato de verdad.
--
--   Y además falla "Recorregir", también en silencio: el correo sale y el PDF
--   se regenera, pero el PATCH final escribe `estado`, `recorregido_at` y
--   `desactualizado_at` en la misma sentencia, así que Postgres rechaza el
--   UPDATE entero y la fila no se actualiza en NADA. La pantalla dice que todo
--   salió bien. Solo queda un `console.error` en los logs de Vercel.
--
-- ⚠️ Una versión anterior de este comentario decía lo contrario — que
-- `getContratos()` "deliberadamente NO pide esta columna todavía, justo para
-- que el PR se pueda desplegar en cualquier orden". Dejó de ser verdad cuando
-- el código que las lee entró en este mismo PR. Se deja escrito aquí porque
-- ése es el párrafo que alguien lee justo mientras decide el orden del deploy,
-- y creerlo es exactamente lo que rompe.
--
-- Cómo confirmar que entró, sin fiarse de que alguien lo diga: pedir
-- `contratos?select=id,recorregido_at&limit=1` por REST. Si contesta
-- `42703: column contratos.recorregido_at does not exist`, todavía no está.
-- ============================================================
begin;

alter table public.contratos add column if not exists recorregido_at timestamptz;

comment on column public.contratos.recorregido_at is
  'NULL = el PDF enviado es el original. Con fecha = se regeneró al menos una vez porque cambió un dato del contrato (bonos, duración) después del envío inicial — /contratos lo marca con la cinta dorada "Recorregido".';

alter table public.contratos add column if not exists desactualizado_at timestamptz;

comment on column public.contratos.desactualizado_at is
  'NULL = el PDF que tiene el equipo sigue coincidiendo con la venta. Con fecha = se cambiaron los bonos después de emitirlo y hay que regenerarlo. La escribe editarBonos(); recorregirContrato() la vuelve a NULL al regenerar. Si está puesta, /contratos dibuja la cinta roja en vez de la dorada.';

commit;
