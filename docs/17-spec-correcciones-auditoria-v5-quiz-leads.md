# 17 - Spec tecnica: correcciones de auditoria v5 del quiz y leads

Estado: vigente para la rama `fix/quiz-leads-auditoria-v5`.

Base verificada: `origin/main` en `79d7f4f27bc5feddf3d9a260ca26b634d3f22db8` el 24-sep-2026.

Esta especificacion complementa `docs/11` y `docs/12`. En caso de conflicto sobre las correcciones de la auditoria v5, este documento prevalece. Las migraciones `0068` a `0072` son inmutables.

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

La siguiente migracion global confirmada sera append-only. Al 24-sep-2026 el numero aun no esta reservado, por lo que no se crea un archivo SQL provisional.

La migracion debe:

- agregar procedencia explicita a envios historicos, con valores equivalentes a `canonical` y `legacy-unknown`;
- clasificar como `legacy-unknown` todo supuesto `completed` que no tenga nombre, email, telefono, persona, fecha final o evidencia verificable de consentimiento;
- conservar snapshots, timestamps y valores vacios originales para trazabilidad; no fabricar contacto, persona, consentimiento ni fechas;
- permitir que esos registros atraviesen el upgrade sin tratarlos como finalizaciones canonicas nuevas;
- mantener validacion estricta para toda escritura nueva por RPC;
- reemplazar constraints mediante `NOT VALID`, clasificacion de datos y `VALIDATE CONSTRAINT` en ese orden;
- reconciliar funciones, constraints, triggers, indices, grants, RLS y firmas RPC para que una instalacion historica converja con una limpia.

La informacion que `0071` ya sintetizo no puede reconstruirse. La migracion no reclasificara por la heuristica `contacto-v1` mas igualdad entre `consentimiento_at` y `finished_at`, porque esa igualdad tambien puede ser legitima. Se preserva el dato existente y se marca su evidencia como historica/desconocida cuando no exista una fuente inequivoca.

### 5.2 Tracking

- Los IDs e indices se validan contra una lista canonica server-side.
- `started` crea la sesion en el paso inicial.
- `progress` solo muta una sesion `started` o `in_progress`.
- El primer `dropped` valido sobre `started` o `in_progress` fija estado, paso y timestamp.
- Ningun evento posterior modifica estado, paso o respuestas de un `dropped`, salvo una finalizacion canonica expresamente aceptada por el contrato.
- Ningun evento degrada ni modifica un `completed`.
- El orden autoritativo es el orden de adquisicion del lock y persistencia en servidor. `occurred_at` se conserva como evidencia del cliente, pero no autoriza a reescribir un estado terminal.
- El cliente actualiza sincronamente el paso visible antes de que `pagehide` pueda emitir abandono.

### 5.3 Concurrencia y locks

Completar, vincular, desvincular y descartar usan el mismo advisory lock derivado del contacto canonico. `desvincular_lead` obtiene el contacto desde los `envio_ids` persistidos en su auditoria, que sobreviven a la vinculacion. Despues de adquirir el lock, cada RPC vuelve a leer y validar persona, auditoria, estado y conjunto exacto de envios antes de mutar.

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

### 5.6 Rate limit

Se mantienen dos presupuestos en memoria:

- tracking: limita `started`, `progress` y `dropped`;
- finalizacion: cuota separada para `completed`, de modo que agotar tracking no bloquee finalizar.

Existe ademas un limite bruto de bytes antes del parseo. La proteccion local sigue siendo `best-effort` por instancia; el limite distribuido requiere WAF/Upstash/Redis del operador y no se simula como resuelto en este repositorio.

### 5.7 Selector y `/leads`

- Busqueda server-side paginada, sin limite silencioso, con tamano acotado y señal `hayMas`.
- Solo devuelve clientes con programa mediante join interno.
- Cada resultado muestra identidad y programa suficientes para desambiguar.
- La UI ignora respuestas cuyo request id ya no sea el vigente y siempre cierra el estado de carga de la peticion vigente.
- `page` solo acepta enteros finitos positivos y queda acotado a un maximo documentado.
- Fechas se validan como fechas calendario reales; `hasta` incluye el dia completo mediante limite superior exclusivo del dia siguiente.
- Todo error PostgREST se propaga de forma controlada, no como lista vacia.
- Vincular, descartar y desvincular revalidan listado y detalle.

## 6. Contrato HTTP

`POST /api/lead`:

- mide el body real con `TextEncoder` en bytes UTF-8 aunque falte `Content-Length`;
- rechaza fechas ISO imposibles aunque coincidan con la expresion regular;
- rechaza paises fuera del catalogo y telefonos no canonizables con 4xx;
- valida paso e indice contra pasos canonicos;
- aplica cuota de tracking o completed despues de identificar de forma segura el evento;
- no convierte datos invalidos del cliente en 500/502;
- conserva respuesta exitosa `{ok, session_id, submission_id, status}` sin `persona_id`.

## 7. Contratos RPC

Las firmas publicas existentes se conservan. La nueva migracion redefine internamente:

- `registrar_diagnostico(jsonb)`: validacion canonica, orden terminal y lock de contacto;
- `vincular_lead_convertido(uuid, uuid, boolean)`: mismo lock y revalidacion post-lock;
- `desvincular_lead(uuid, uuid)`: contacto desde auditoria/envios vinculados, mismo lock y rollback exacto;
- `descartar_lead(uuid, text)`: mismo lock y conflicto determinista.

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

## 10. Matriz historica obligatoria

- Limpia hasta la ultima migracion.
- Primera `0068` historica y luego actuales.
- Primeras `0068 + 0069` historicas y luego actuales.
- Primera `0070` y luego actuales.
- `0071` anterior y luego actuales.
- Datos conflictivos: completed con strings vacios y evidencia de consentimiento ambigua.

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

1. Confirmar y reservar el numero global de migracion.
2. Probar backup y restauracion.
3. Ejecutar preflight de datos historicos y guardar conteos, sin PII.
4. Aplicar migraciones en orden, incluida la nueva reconciliacion.
5. Verificar catalogo y smoke RPC.
6. Desplegar codigo.
7. Ejecutar smoke de `/quiz` y `/leads` con datos ficticios.
8. Activar/confirmar rate limit distribuido del operador.

## 13. Rollback

- Antes del codigo: no desplegar si la migracion o el catalogo final fallan; restaurar el backup probado siguiendo el runbook del operador.
- Despues de migrar: las columnas y marcadores nuevos son aditivos. Revertir solo el deploy de codigo es seguro mientras no se borren objetos usados por la version anterior.
- No se revierte una migracion publicada mediante edicion o SQL destructivo improvisado. Cualquier correccion posterior usa otra migracion append-only.
- Si falla el smoke, detener ingesta del funnel, conservar evidencia y restaurar aplicacion/base segun el punto de corte acordado.

## 14. Bloqueos vigentes

- Falta confirmar el numero global posterior a `0072`; por ello la implementacion SQL y la matriz historica final no pueden cerrarse.
- El rate limit distribuido pertenece a infraestructura externa y debe ser configurado y evidenciado por el operador.
- La compatibilidad con el HEAD del repositorio central solo puede afirmarse tras aplicar y validar el patch contra ese HEAD real.
