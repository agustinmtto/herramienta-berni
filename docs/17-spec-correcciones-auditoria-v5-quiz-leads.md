# 17 - Spec tecnica: correcciones de auditoria v5 del quiz y leads

Estado: vigente para la rama `fix/quiz-leads-auditoria-v5`; implementacion local cerrada y lista para auditoria independiente, aun `NO GO` de produccion.

Base original: `origin/main` en `79d7f4f27bc5feddf3d9a260ca26b634d3f22db8`. Punto de partida verificado: rama local y remota en `32c3b4326d95b266e8ff8fb88d008e97527d2219` el 27-sep-2026, con arbol limpio.

Esta especificacion complementa `docs/11` y `docs/12`. En caso de conflicto sobre las correcciones de la auditoria v5, este documento prevalece. Las migraciones `0068` a `0072` son inmutables.

> **Reconciliación consolidada (06-oct-2026):** las migraciones `0068–0073` del histórico (con el aparato de compatibilidad para instalaciones que nunca existieron: staging/preflight, taxonomía `legacy-unknown`, doble familia de locks y columnas `*_origen`) se consolidaron en la migración principal `0068_quiz_leads.sql`, que es **convergente** (limpia cualquier estado previo del módulo); se sumaron `0069` (rol funnel) y `0070` (lookup de auditoría). La "matriz histórica" del §10 y el preflight del §5.1 ya no aplican: no hubo datos en producción. Este documento conserva el detalle semántico de cada corrección — el comportamiento no cambia.

## 1. Problema

La auditoria v5 demostro defectos reproducibles en upgrades historicos, seguridad del arnes de tests, orden de eventos, locks de rollback, inmutabilidad, telefonos argentinos, CI, rate limit, evidencia de consentimiento, selector de clientes y validaciones HTTP/UI. Un reset limpio o una suite verde con tests omitidos no demuestra compatibilidad historica ni seguridad operativa.

## 2. Alcance

- Funnel publico `/quiz`, `POST /api/lead` y sus librerias.
- Tracking, consentimiento y normalizacion telefonica del funnel.
- Tablas, RLS, grants, triggers, constraints y RPC exclusivos de quiz/leads.
- Modulo interno `/leads`, selector, vinculacion, descarte y rollback.
- Tests, CI, documentacion y patch de transferencia exclusivos del modulo.

## 3. Fuera de alcance

No se modifican WhatsApp/webhooks, Inbox, autenticacion general, SSRF de media, CSP/framing, SVG, sesiones de usuarios desactivados, APIs ajenas a leads ni dependencias globales no indispensables. Los riesgos generales del OS no se mezclan con el estado de este modulo.

## 4. Decisiones de negocio

1. Publicar es irreversible. Una version que alguna vez tuvo `publicada_at` no vuelve a draft, no se elimina y no cambia ningun dato historico. Puede transicionar entre `active`, `paused` y `archived`.
2. Los drafts nunca publicados pueden editarse y eliminarse. No pueden estar `active`.
3. El funnel captura telefonos moviles. Para Argentina se asume movil cuando un numero nacional valido omite `9` y `15`; se persiste `+549` seguido de los diez digitos nacionales.
4. Ausencia de evidencia historica de consentimiento significa `sin registro/revisar`, nunca consentimiento afirmativo.

## 5. Diseno

### 5.1 Upgrade y compatibilidad historica

La migracion global append-only confirmada es `0073_reconciliacion_quiz_leads_v3.sql`. La disponibilidad se volvio a comprobar despues de `git fetch --prune origin`: ninguna referencia local o remota disponible usa `0073`.

La migracion debe:

- agregar `registro_origen` y `consentimiento_origen` con los valores cerrados `canonical` y `legacy-unknown`;
- clasificar conservadoramente como `legacy-unknown` todo `completed` anterior a `0073`: las migraciones anteriores no guardaron procedencia inequivoca y no se infiere consentimiento por igualdad o diferencia de timestamps;
- conservar snapshots, timestamps y valores vacios originales para trazabilidad; no fabricar contacto, persona, consentimiento ni fechas;
- permitir que esos registros atraviesen el upgrade sin tratarlos como finalizaciones canonicas nuevas;
- mantener validacion estricta para toda escritura nueva por RPC;
- reemplazar constraints mediante `NOT VALID`, clasificacion de datos y `VALIDATE CONSTRAINT` en ese orden;
- reconciliar funciones, constraints, triggers, indices, grants, RLS y firmas RPC para que una instalacion historica converja con una limpia.

La informacion que `0071` ya sintetizo no puede reconstruirse. La migracion no reclasificara por la heuristica `contacto-v1` mas igualdad entre `consentimiento_at` y `finished_at`, porque esa igualdad tambien puede ser legitima. Se preserva el dato existente y se marca su evidencia como historica/desconocida cuando no exista una fuente inequivoca.

`0072` agrega su constraint estricto antes de que `0073` pueda ejecutarse. Para instalaciones que aun no aplicaron `0072` y contienen `completed` incompatibles, el runbook incluye un preflight transaccional, con ingesta detenida y backup/restauracion probados: guarda solo los UUID y el estado original en `quiz_leads_legacy_upgrade_stage`, mueve temporalmente esos envios a `in_progress`, aplica `0072` y deja que `0073` los restaure como `completed/legacy-unknown`. Sin ese puente, la ruta queda bloqueada antes de alcanzar `0073`. La tabla staging tiene RLS, no copia PII y se elimina al verificar la convergencia.

### 5.1.1 Modelo final de datos

- Nuevas finalizaciones por `registrar_diagnostico` escriben ambas procedencias como `canonical`.
- Un constraint `NOT VALID`, luego clasificado y validado, exige contacto y consentimiento completos solo a `completed/canonical`; permite preservar los valores originales de `completed/legacy-unknown`.
- Un trigger impide insertar directamente un nuevo `completed/legacy-unknown` o convertir una fila nueva a ese estado; la excepcion de reconciliacion existe solo dentro de la migracion antes de crear el trigger.
- Las filas terminales no pueden actualizarse mediante escritura directa, salvo la transicion contractual `dropped -> completed` y los cambios de propietario validados por las RPC canonicas. La eliminacion de mantenimiento sigue reservada a `service_role`.

### 5.2 Tracking

- Los IDs e indices se validan como pareja contra `quiz_versiones.definicion.steps` en la frontera RPC; el endpoint conserva la misma lista canonica.
- `started` crea la sesion en el paso inicial.
- `progress` solo muta una sesion `started` o `in_progress`.
- El primer `dropped` valido sobre `started` o `in_progress` fija estado, paso y timestamp.
- Ningun evento posterior modifica estado, paso o respuestas de un `dropped`, salvo una finalizacion canonica expresamente aceptada por el contrato.
- Ningun evento degrada ni modifica un `completed`.
- El orden autoritativo es el orden de adquisicion del lock y persistencia en servidor. `occurred_at` se conserva como evidencia del cliente, pero no autoriza a reescribir un estado terminal.
- El cliente actualiza sincronamente el paso visible antes de que `pagehide` pueda emitir abandono.

### 5.3 Concurrencia y locks

Completar, vincular, desvincular y descartar usan el mismo advisory lock derivado del contacto canonico. `desvincular_lead` obtiene el contacto desde los `envio_ids` persistidos en su auditoria, que sobreviven a la vinculacion. Despues de adquirir el lock, cada RPC vuelve a leer y validar persona, auditoria, estado y conjunto exacto de envios antes de mutar.

La clave se deriva exclusivamente del telefono E.164 canonico mediante un helper SQL interno. Los conjuntos auditados se ordenan por UUID y toda busqueda de auditoria usa `created_at DESC, id DESC`; email, `lead_id` y timestamps no forman claves alternativas.

Resultados concurrentes:

- completar contra vincular o desvincular serializa por contacto;
- vincular contra descartar deja exactamente una operacion aplicada y la otra recibe un conflicto de dominio;
- dos rollbacks del mismo evento dejan uno aplicado y el otro idempotente o rechazado como ya revertido;
- ninguna operacion produce rollback parcial ni dos leads temporales activos para el mismo contacto.

### 5.4 Inmutabilidad de versiones

- Draft: `publicada_at IS NULL`, editable y borrable; estados permitidos `draft` o `archived`.
- Publicada: `publicada_at IS NOT NULL`; codigo, version, variante, funnel, definicion, `created_at` y `publicada_at` quedan congelados.
- Estados publicados: `active`, `paused`, `archived`; no se permite volver a `draft`.
- `TG_OP='DELETE'` devuelve `OLD` para drafts y rechaza versiones publicadas.
- La proteccion se prueba columna por columna, en una y dos sentencias.

### 5.5 Telefono

El navegador ayuda a componer, pero el servidor es autoritativo.

- Solo se aceptan digitos y separadores telefonicos explicitos (`+`, espacios, parentesis y guiones); letras u otros caracteres se rechazan.
- Pais debe pertenecer al catalogo del funnel; `ZZ` se rechaza.
- Argentina acepta `+549...`, `+54...`, troncal `0`, marcador movil `15` y numero nacional sin `9`.
- Se elimina `54`, troncal `0`, indicador `9` y marcador `15` segun corresponda; el numero nacional resultante debe tener exactamente diez digitos.
- El resultado argentino siempre es `+549` mas esos diez digitos, por la decision de negocio de asumir movil.
- Otros paises conservan normalizacion E.164 y coherencia con su prefijo configurado.
- Un prefijo ya escrito, con o sin `+`, se consume una sola vez. Los paises que comparten `+1` se validan contra su prefijo configurado completo; los casos ambiguos se rechazan.

### 5.6 Rate limit

Se mantienen dos presupuestos en memoria:

- tracking: limita `started`, `progress` y `dropped`;
- finalizacion: cuota separada para `completed`, de modo que agotar tracking no bloquee finalizar.

Existe ademas un limite bruto de bytes antes del parseo. La proteccion local sigue siendo `best-effort` por instancia; el limite distribuido requiere WAF/Upstash/Redis del operador y no se simula como resuelto en este repositorio.

### 5.7 Selector y `/leads`

- Busqueda server-side paginada, sin limite silencioso, con tamano acotado y señal `hayMas`.
- Solo devuelve clientes con programa vigente segun `v_programa_activo`; nunca usa un `programas[0]` sin orden.
- Cada resultado muestra identidad y programa suficientes para desambiguar.
- La UI ignora respuestas cuyo request id ya no sea el vigente y siempre cierra el estado de carga de la peticion vigente.
- `page` solo acepta enteros finitos positivos y queda acotado a un maximo documentado.
- Fechas se validan como fechas calendario reales; `hasta` incluye el dia completo mediante limite superior exclusivo del dia siguiente.
- Todo error PostgREST se propaga de forma controlada, no como lista vacia.
- Vincular, descartar y desvincular revalidan listado y detalle.
- El detalle solo consulta el picker para una persona temporal en estado `lead`; un fallo del picker no rompe estados que no pueden vincularse.
- `page` se normaliza a 1 salvo que sea un entero finito entre 1 y `10000`. `hasta=9999-12-31` se expresa sin construir un ano ISO 10000.

### 5.8 Privacidad acotada

Las auditorias de vinculacion, desvinculacion y descarte no persisten `telefono_lead` ni `telefono_cliente`; `envio_ids` es la fuente durable del rollback y del lock. `0073` elimina solo esas claves de filas historicas propias del modulo y agrega una restriccion acotada a esas acciones. No se modifica la policy generica de la tabla compartida `auditoria`. La verificacion usa un usuario Auth real y confirma que ninguna consulta como `authenticated` expone telefonos del funnel.

## 6. Contrato HTTP

`POST /api/lead`:

- mide el body real con `TextEncoder` en bytes UTF-8 aunque falte `Content-Length`;
- rechaza fechas ISO imposibles aunque coincidan con la expresion regular;
- rechaza paises fuera del catalogo y telefonos no canonizables con 4xx;
- valida paso e indice contra pasos canonicos;
- aplica cuota de tracking o completed despues de identificar de forma segura el evento;
- no convierte datos invalidos del cliente en 500/502;
- conserva respuesta exitosa `{ok, session_id, submission_id, status}` sin `persona_id`.
- valida en runtime la respuesta de la RPC: `ok`, estado permitido, UUIDs, presencia de `submission_id` y coincidencia estricta de `session_id`; un HTTP 200 interno con forma incorrecta se convierte en 502 y nunca en exito publico.
- acepta el honeypot solo ausente o como string; string no vacio se ignora como bot y cualquier otro tipo se rechaza con 400.

## 7. Contratos RPC

Las firmas reales obtenidas de `0072` y que `0073` conserva son:

- `registrar_diagnostico(jsonb)`: validacion canonica, orden terminal y lock de contacto;
- `vincular_lead_convertido(uuid, uuid, boolean, uuid)`: mismo lock y revalidacion post-lock;
- `desvincular_lead(uuid, uuid, uuid)`: contacto desde auditoria/envios vinculados, mismo lock y rollback exacto;
- `descartar_lead(uuid, uuid)`: mismo lock y conflicto determinista;
- `validar_respuestas_quiz(jsonb, jsonb, boolean)`: helper interno sin acceso de clientes.

Solo `service_role` recibe `EXECUTE`; `public`, `anon` y `authenticated` quedan revocados. Las tablas mantienen RLS habilitado y sin lectura generica. Las funciones `SECURITY DEFINER` fijan `search_path`.

## 8. Seguridad de tests y CI

- La suite solo se registra como destructiva si la URL es local (`localhost`, `127.0.0.1` o `::1`).
- Cada helper de insercion/limpieza comprueba nuevamente la URL local antes de llamar a `fetch`.
- Una URL externa produce cero llamadas HTTP, incluso en hooks de cierre.
- `LEAD_TESTS_REQUIRE_DB=1` convierte Supabase ausente en fallo real.
- El workflow versionado levanta Supabase local, hace reset, ejecuta suites integradas con la variable obligatoria y falla ante tests omitidos.

## 9. Plan de tests

Tests de regresion primero, observados fallando contra la base auditada:

1. URL externa con cero llamadas a `fetch` en ambas suites.
2. Upgrade historico con strings vacios y consentimiento ambiguo.
3. `dropped` seguido de `progress` tardio; eventos sobre `completed`.
4. Primera pregunta, avance, retroceso, abandono, recarga y doble clic.
5. Completar/desvincular, completar/vincular, vincular/descartar y doble rollback concurrentes.
6. Matriz de columnas y transiciones de `quiz_versiones`, edicion en dos pasos y DELETE.
7. Matriz argentina y matriz de caracteres, longitudes, pais y prefijo server-side.
8. Recorrido que agota tracking y aun completa; abuso de completed limitado.
9. Migracion y render de consentimiento historico.
10. Selector con mas de 50 coincidencias, paginacion, respuesta obsoleta y cliente sin programa.
11. Paginas decimales, infinitas, cero, negativas y enormes; fechas imposibles y ultimo dia completo; errores PostgREST.
12. Body multibyte sin `Content-Length`, ISO imposible y `ZZ`, todos con 4xx.
13. Inspeccion de catalogo y comportamiento sobre instalacion limpia y cada ruta historica.
14. JWT `authenticated` real contra tablas del modulo y `auditoria`, ademas de grants RPC.
15. Respuesta RPC malformada, honeypots tipados y doble `completed` mientras el POST sigue pendiente.

## 10. Matriz historica obligatoria

- Limpia hasta la ultima migracion.
- Primera `0068` historica y luego actuales.
- Primeras `0068 + 0069` historicas y luego actuales.
- Primera `0070` y luego actuales.
- `0071` anterior y luego actuales.
- Datos conflictivos: completed con strings vacios y evidencia de consentimiento ambigua.
- Cada ruta anterior ejecuta tambien `0073`; las rutas incompatibles con `0072` usan el preflight documentado y verifican restauracion exacta.

Cada ruta debe converger en funciones, constraints, triggers, indices, grants, RLS, firmas RPC y comportamiento. Una ruta que no pueda atravesar una migracion publicada anterior se documenta como bloqueo operacional y requiere preflight antes de aplicar esa migracion; una migracion posterior no puede reparar SQL que nunca llego a ejecutarse.

## 11. Criterios de aceptacion

- Cada hallazgo tiene un test observado en rojo antes y verde despues.
- Cero requests externos en tests destructivos.
- Cero tests omitidos con `LEAD_TESTS_REQUIRE_DB=1`.
- Reset limpio y todas las rutas historicas convergen, incluidos datos conflictivos.
- Suites completas de OS y raiz, TypeScript, ESLint y builds pasan.
- Documentacion `13` a `16` refleja conteos ejecutados, migraciones reales y orden backup -> migraciones -> codigo.
- El patch contiene exactamente los cambios del modulo y pasa `git apply --check` sobre checkout limpio cuando este disponible.
- No se declara compatibilidad con el HEAD central ni rate limit distribuido sin evidencia externa.

## 12. Rollout

1. Probar backup y restauracion.
2. Detener ingesta y ejecutar el preflight historico; guardar conteos sin PII.
3. Aplicar migraciones en orden hasta `0073`.
4. Verificar catalogo, restauracion del staging y smoke RPC.
5. Desplegar el codigo del mismo checkout validado.
6. Ejecutar smoke de `/quiz` y `/leads` con datos ficticios.
7. Activar/confirmar rate limit distribuido del operador.

## 13. Rollback

- Antes del codigo: no desplegar si la migracion o el catalogo final fallan; restaurar el backup probado siguiendo el runbook del operador.
- Despues de migrar: las columnas y marcadores nuevos son aditivos. Revertir solo el deploy de codigo es seguro mientras no se borren objetos usados por la version anterior.
- No se revierte una migracion publicada mediante edicion o SQL destructivo improvisado. Cualquier correccion posterior usa otra migracion append-only.
- Si falla el smoke, detener ingesta del funnel, conservar evidencia y restaurar aplicacion/base segun el punto de corte acordado.

## 14. Bloqueos vigentes

- El preflight historico requiere ventana operativa con ingesta detenida; una migracion posterior no puede atravesar por si sola una `0072` que aborta.
- El rate limit distribuido pertenece a infraestructura externa y debe ser configurado y evidenciado por el operador.
- La compatibilidad con el HEAD del repositorio central solo puede afirmarse tras aplicar y validar el patch contra ese HEAD real.
