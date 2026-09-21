# 11 - Migracion del modulo de leads: especificacion cerrada

Documento autoritativo para implementar la persistencia del Quiz Funnel y el modulo `/leads` dentro de MetaCrypto OS. El alcance se limita al dominio nuevo de leads: no se modifica la estructura ni el comportamiento de las tablas existentes.

> **Estado:** especificacion cerrada y con luz verde para desarrollar. Migracion asignada: `0068_quiz_leads.sql`.
>
> Insumos: `docs/03-especificacion.md`, `docs/06-pendientes-y-preguntas.md`, `docs/08-roadmap.md`, `docs/09-security.md`, `docs/10-levantar-metacrypto-os-local.md`, `ANALISIS_INTEGRACION_QUIZ_LEADS.md` y `metacrypto-os-app/CLAUDE.md`.

## 1. Alcance y decisiones cerradas

| # | Decision | Resolucion |
|---|---|---|
| D1 | Ubicacion | El funnel se porta a `apps/inbox` como ruta publica `/quiz`. Hay un solo deploy en el hosting del negocio. |
| D2 | Contacto | Para completar el quiz son obligatorios nombre, email, telefono y consentimiento. Los abandonos anteriores al contacto pueden no tener estos datos. |
| D3 | Aislamiento | La integracion no busca, reutiliza, actualiza, fusiona ni degrada clientes u otras personas existentes. La primera finalizacion de un contacto crea una fila de `personas` con `estado='lead'`; nuevos quizzes del mismo contacto reutilizan solo ese lead creado previamente por este modulo. |
| D4 | Esquema existente | No se modifica ninguna columna, indice, restriccion, RPC ni comportamiento existente. Solo se agregan tablas, FKs desde tablas nuevas y codigo nuevo del modulo. |
| D5 | Versiones del quiz | El contrato y las tablas son agnosticos a las preguntas. Cada variante A/B tiene una fila inmutable en `quiz_versiones`. |
| D6 | Atribucion | Las UTMs y el referrer son opcionales y se capturan automaticamente desde la URL y el navegador. El usuario no los completa. |
| D7 | Consentimiento | El payload incluye aceptacion, version del texto y timestamp. El texto legal versionado vive en el repositorio. |
| D8 | Lead caliente | Se calcula en servidor a partir de la definicion y respuesta estructurada de la pregunta de capital. Nunca se confia en un flag del navegador. |
| D9 | Modulo `/leads` | Lo implementa nuestro equipo respetando permisos, navegacion y CSS del OS. |
| D10 | Conversion | Se incluye en la primera entrega como vinculacion posterior a la venta: el flujo existente crea/encuentra al cliente y luego el modulo reasigna sus diagnosticos y archiva el lead temporal. |
| D11 | Tracking | La primera entrega persiste `started`, `progress`, `dropped` y `completed`. |
| D12 | Telefono | El formulario usa selector de pais/prefijo y el servidor normaliza a E.164. |
| D13 | Permiso | `/leads` usa una clave de permiso propia `leads`. |
| D14 | Retencion | Leads, respuestas y diagnosticos se conservan sin vencimiento, salvo solicitud o cambio futuro de politica. |
| D15 | Alertas | Push/email de triaje se implementan en una fase posterior, no en la migracion inicial. |

No existen los campos `resolucion_identidad` ni `necesita_revision`: el modulo no resuelve identidades contra datos existentes.

## 2. Consideracion obligatoria sobre `personas.telefono_e164`

El esquema actual declara `personas.telefono_e164` como `UNIQUE`. Por tanto, no se pueden insertar dos filas de `personas` con el mismo telefono, aunque una sea `cliente` y otra `lead`.

Para cumplir D3 y D4 al mismo tiempo:

- La primera finalizacion de un contacto crea una fila de `personas` con `estado='lead'`.
- Las finalizaciones posteriores con el mismo email normalizado y telefono capturado reutilizan ese lead a traves de los envios anteriores del modulo.
- Nunca se busca ni reutiliza una persona `cliente`, `reservado`, `ex_cliente` o `archivado`, aunque tenga el mismo contacto.
- Se copian `nombre`, `email` y `pais` cuando esten disponibles.
- `personas.telefono_e164` se inserta como `NULL` para los leads originados por este funnel.
- El telefono obligatorio y normalizado se conserva en `diagnostico_envios.telefono_e164_capturado`.
- El modulo `/leads` muestra el contacto desde el snapshot de `diagnostico_envios`, no desde `personas`.

PostgreSQL permite multiples `NULL` bajo una restriccion `UNIQUE`, por lo que esta estrategia no modifica ni viola el esquema existente.

Consecuencia aceptada: los RPC existentes que buscan personas por `telefono_e164` no encontraran automaticamente estos leads temporales. El flujo de ventas existente crea o encuentra al cliente definitivo y, despues de la venta, la accion nueva `vincular_lead_convertido` conecta los diagnosticos con ese cliente y archiva el lead temporal. No se modifica el flujo de ventas.

## 3. Modelo de datos final

Se agregan tres tablas:

```text
quiz_versiones
       1
       |
       | N
diagnostico_envios N ---- 1 personas (existente)
       1
       |
       | N
diagnostico_respuestas
```

### 3.1 `quiz_versiones`

Una fila por version o variante A/B. Contiene la definicion completa usada para validar, interpretar y comparar el quiz.

| Campo | Tipo | Regla |
|---|---|---|
| `id` | `uuid` | PK, `gen_random_uuid()` |
| `codigo` | `text` | UNIQUE, identificador enviado por el frontend, por ejemplo `diagnostico-cripto-v1-a` |
| `funnel` | `text` | Familia del funnel, por ejemplo `diagnostico-cripto` |
| `variante` | `text` | Variante experimental, por ejemplo `control` o `capital-first` |
| `version` | `integer` | Mayor que cero |
| `estado` | `text` | `draft`, `active`, `paused` o `archived` |
| `definicion` | `jsonb` | Preguntas, opciones, reglas y configuracion completa |
| `publicada_at` | `timestamptz` | Momento de publicacion |
| `created_at` | `timestamptz` | Creacion del registro |

Restricciones:

- `UNIQUE(codigo)`.
- `UNIQUE(funnel, variante, version)`.
- Una version publicada es inmutable.
- Para cambiar preguntas, opciones, orden o reglas se crea otra version.
- Primera version publicada: `diagnostico-cripto-v1-a`.

### 3.2 `diagnostico_envios`

Una fila por recorrido del usuario. Puede representar un inicio, progreso, abandono o finalizacion.

| Campo | Tipo | Regla |
|---|---|---|
| `id` | `uuid` | PK |
| `session_id` | `uuid` | UNIQUE, idempotencia del recorrido |
| `quiz_version_id` | `uuid` | FK obligatoria a `quiz_versiones` |
| `persona_id` | `uuid` | FK a `personas`; nullable antes de completar, obligatoria al completar |
| `schema_version` | `integer` | Version del contrato API, inicialmente `1` |
| `estado` | `text` | `started`, `in_progress`, `dropped` o `completed` |
| `nombre_capturado` | `text` | Snapshot del nombre enviado |
| `email_capturado` | `text` | Snapshot del email normalizado |
| `telefono_e164_capturado` | `text` | Telefono obligatorio normalizado; fuente del modulo de leads |
| `pais_capturado` | `text` | Pais informado o derivado |
| `consentimiento_aceptado` | `boolean` | Debe ser `true` al completar |
| `consentimiento_version` | `text` | Version del texto aceptado |
| `consentimiento_at` | `timestamptz` | Momento de aceptacion |
| `started_at` | `timestamptz` | Inicio del recorrido |
| `last_activity_at` | `timestamptz` | Ultima actividad recibida |
| `finished_at` | `timestamptz` | Finalizacion real |
| `dropped_at` | `timestamptz` | Abandono conocido |
| `last_step_id` | `text` | Ultimo paso visitado |
| `last_step_index` | `integer` | Posicion del ultimo paso |
| `utm_source` | `text` | Capturado automaticamente de la URL; nullable |
| `utm_medium` | `text` | Capturado automaticamente de la URL; nullable |
| `utm_campaign` | `text` | Capturado automaticamente de la URL; nullable |
| `utm_content` | `text` | Capturado automaticamente de la URL; nullable |
| `utm_term` | `text` | Capturado automaticamente de la URL; nullable |
| `referrer` | `text` | `document.referrer`, si esta disponible |
| `capital_min_usd` | `numeric(14,2)` | Limite inferior derivado de la respuesta |
| `capital_max_usd` | `numeric(14,2)` | Limite superior; `NULL` para rango abierto |
| `es_lead_caliente` | `boolean` | Calculado por servidor; `NULL` si no es determinable |
| `qualification_rule_version` | `text` | Version de la regla, inicialmente `hot-lead-v1` |
| `motivo_calificacion` | `text` | Explicacion reproducible de la clasificacion |
| `diagnosis_version` | `text` | Version del motor de diagnostico |
| `diagnosis_result` | `jsonb` | Snapshot del resultado mostrado al usuario |
| `created_at` | `timestamptz` | Creacion |
| `updated_at` | `timestamptz` | Ultimo upsert |

`diagnosis_result` se persiste. Esto permite reproducir exactamente lo que vio el usuario aunque las reglas cambien despues.

La version inicial del consentimiento es `contacto-v1`.

Checks principales:

- `completed` exige `persona_id`, contacto completo, consentimiento y `finished_at`.
- `dropped` exige `dropped_at`.
- `last_step_index >= 0` cuando exista.
- Capital no negativo y `capital_max_usd >= capital_min_usd` cuando ambos existan.
- Un estado `completed` nunca puede volver a un estado anterior.

Indices iniciales:

- `UNIQUE(session_id)`.
- `(quiz_version_id, created_at DESC)`.
- `(estado, created_at DESC)`.
- `(es_lead_caliente, created_at DESC)`.
- `(telefono_e164_capturado, email_capturado)` para localizar el lead propio del modulo.
- `persona_id`.

### 3.3 `diagnostico_respuestas`

Una fila por pregunta respondida dentro de un envio. No existen columnas especificas para preguntas concretas.

| Campo | Tipo | Regla |
|---|---|---|
| `id` | `uuid` | PK |
| `envio_id` | `uuid` | FK a `diagnostico_envios`, `ON DELETE CASCADE` |
| `question_id` | `text` | ID estable dentro de la version |
| `question_type` | `text` | Tipo generico de respuesta |
| `question_text` | `text` | Snapshot del texto mostrado |
| `question_order` | `integer` | Orden mostrado |
| `answer_id` | `text` | ID de opcion, cuando corresponda |
| `answer_text` | `text` | Snapshot legible de la respuesta |
| `answer_value` | `jsonb` | Valor canonico y extensible |
| `answered_at` | `timestamptz` | Momento informado por el cliente |
| `created_at` | `timestamptz` | Persistencia |

Restricciones e indices:

- `UNIQUE(envio_id, question_id)` para upsert idempotente.
- `question_order >= 0`.
- Indice `(question_id, answer_id)`.

Tipos iniciales soportados sin cambiar tablas:

```text
single_choice
multiple_choice
range
allocation
number
boolean
text
```

`answer_value jsonb` permite agregar formatos futuros sin migraciones. El endpoint valida el contenido contra `quiz_versiones.definicion`.

## 4. Definicion de preguntas y opciones

Las preguntas no viven en columnas ni requieren una tabla por version. Se guardan dentro de `quiz_versiones.definicion`:

```json
{
  "schema_version": 1,
  "questions": [
    {
      "id": "capital_disponible",
      "type": "range",
      "required": true,
      "text": "¿Que capital podrias desplegar?",
      "options": [
        {
          "id": "capital_lt_10k",
          "text": "Menos de 10.000 USD",
          "value": {
            "currency": "USD",
            "min": 0,
            "max": 10000,
            "min_inclusive": true,
            "max_inclusive": false
          }
        },
        {
          "id": "capital_10k_25k",
          "text": "Entre 10.000 y 25.000 USD",
          "value": {
            "currency": "USD",
            "min": 10000,
            "max": 25000,
            "min_inclusive": true,
            "max_inclusive": false
          }
        }
      ]
    }
  ],
  "qualification": {
    "version": "hot-lead-v1",
    "question_id": "capital_disponible",
    "hot_answer_ids": [
      "capital_10k_25k",
      "capital_25k_50k",
      "capital_50k_100k",
      "capital_100k_250k",
      "capital_gt_250k"
    ]
  },
  "diagnosis": {
    "version": "diagnostico-v1"
  }
}
```

Puede haber dos o tres variantes con preguntas completamente distintas. Solo deben compartir el contrato exterior y declarar su propia definicion.

## 5. Contrato JSON final

`schema_version` versiona la API. `quiz_version` identifica las preguntas y reglas. Cambiar preguntas no cambia `schema_version`.

```json
{
  "schema_version": 1,
  "quiz_version": "diagnostico-cripto-v1-a",
  "session_id": "68cf2bd5-7c57-4cd3-9548-9197de2ebc44",
  "event": "completed",
  "occurred_at": "2026-09-21T15:40:00.000Z",
  "source": {
    "utm_source": "instagram",
    "utm_medium": "organic",
    "utm_campaign": "diagnostico-septiembre",
    "utm_content": "reel-mercado",
    "utm_term": null,
    "referrer": "https://www.instagram.com/"
  },
  "progress": {
    "step_id": "contact",
    "step_index": 9
  },
  "lead": {
    "name": "Juan Perez",
    "email": "juan@example.com",
    "phone": "+5493585000000",
    "country": "AR",
    "consent": {
      "accepted": true,
      "version": "contacto-v1",
      "accepted_at": "2026-09-21T15:39:40.000Z"
    }
  },
  "answers": [
    {
      "question_id": "experiencia",
      "type": "single_choice",
      "question_text": "¿Como describis tu experiencia?",
      "order": 1,
      "answer_id": "intermedia",
      "answer_text": "Intermedia",
      "value": {
        "code": "intermedia"
      },
      "answered_at": "2026-09-21T15:32:00.000Z"
    },
    {
      "question_id": "capital_disponible",
      "type": "range",
      "question_text": "¿Que capital podrias desplegar?",
      "order": 2,
      "answer_id": "capital_10k_25k",
      "answer_text": "Entre 10.000 y 25.000 USD",
      "value": {
        "currency": "USD",
        "min": 10000,
        "max": 25000,
        "min_inclusive": true,
        "max_inclusive": false
      },
      "answered_at": "2026-09-21T15:35:00.000Z"
    }
  ],
  "client_context": {
    "locale": "es-AR",
    "timezone": "America/Argentina/Cordoba"
  }
}
```

Reglas:

- `started`, `progress` y `dropped` pueden no incluir `lead`.
- `completed` exige `lead`, consentimiento y todas las preguntas requeridas por esa version.
- `source` es opcional; sus campos son nullable.
- El backend obtiene la version por `quiz_version`, valida cada `question_id`, `type` y `answer_id`, y no acepta preguntas ajenas a esa version.
- El backend recalcula valores derivados y no confia en una clasificacion enviada por el cliente.
- La respuesta publica no expone `persona_id`.

Respuesta del endpoint:

```json
{
  "ok": true,
  "session_id": "68cf2bd5-7c57-4cd3-9548-9197de2ebc44",
  "submission_id": "8447869a-a77a-4f4c-b4c8-45507bd5eb21",
  "status": "completed"
}
```

## 6. Captura automatica de atribucion

El usuario no completa UTMs. Al iniciar el recorrido, el frontend lee:

```text
utm_source
utm_medium
utm_campaign
utm_content
utm_term
document.referrer
```

Los valores se guardan junto con el `session_id` para no perderlos durante la navegacion. Si no vienen en la URL, se envian como `null`. El backend aplica limites de longitud y no los usa para construir SQL dinamico.

## 7. Flujo transaccional del RPC

Para `completed`, una sola transaccion:

1. Valida `schema_version`, `quiz_version` activa y contrato cerrado.
2. Normaliza email y telefono E.164.
3. Crea o bloquea la fila de `diagnostico_envios` por `session_id`; si ya esta `completed`, devuelve el resultado existente sin crear otra persona.
4. Toma un advisory lock transaccional derivado del email normalizado y el telefono para evitar carreras entre dos sesiones del mismo contacto.
5. Busca en `diagnostico_envios` un envio completado anterior con el mismo email + telefono y una `persona_id` cuyo estado siga siendo `lead`.
6. Si encuentra ese lead del modulo, lo reutiliza sin actualizarlo. Si no lo encuentra, crea una nueva `personas` con `estado='lead'` y `telefono_e164=NULL`, segun §2.
7. Actualiza el envio reclamado y le asigna la `persona_id`.
8. Hace upsert de respuestas por `(envio_id, question_id)`.
9. Deriva capital y lead caliente desde la definicion almacenada.
10. Persiste el snapshot del diagnostico.
11. Confirma todo o revierte todo.

El bloqueo por `session_id` evita duplicados por reintentos. El advisory lock por contacto evita que dos sesiones distintas y simultaneas creen dos personas lead para el mismo email + telefono.

Transiciones permitidas:

```text
started -> in_progress
started -> dropped
in_progress -> dropped
started -> completed
in_progress -> completed
dropped -> completed
completed -> completed (idempotente)
```

Nunca se permite `completed -> dropped` ni `completed -> in_progress`.

## 8. Regla de lead caliente

Rangos confirmados:

1. Menos de 10.000 USD.
2. Entre 10.000 y 25.000 USD.
3. Entre 25.000 y 50.000 USD.
4. Entre 50.000 y 100.000 USD.
5. Entre 100.000 y 250.000 USD.
6. Mas de 250.000 USD.

Para `hot-lead-v1`, los `answer_id` de los rangos 2 a 6 producen `es_lead_caliente=true`. La regla se ejecuta en servidor y se registra junto con `qualification_rule_version` y `motivo_calificacion`.

La regla efectiva es capital **desde 10.000 USD inclusive** (`>= 10.000`), de acuerdo con las bandas confirmadas.

## 9. Conversion posterior a la venta

La conversion forma parte de la primera entrega, pero no reemplaza ni modifica el flujo actual de ventas.

Secuencia:

1. El equipo registra la venta mediante el flujo existente del OS.
2. Ese flujo crea o encuentra la persona cliente definitiva y registra su programa.
3. Desde `/leads`, un usuario con permiso `leads` selecciona el cliente definitivo.
4. La accion server-side llama a `vincular_lead_convertido(p_lead_id, p_cliente_id)`.
5. La funcion verifica que el origen sea una persona `lead` creada y referenciada por este modulo.
6. Verifica que el destino sea una persona `cliente` y que tenga al menos un programa.
7. Actualiza solo las tablas nuevas: todos los `diagnostico_envios.persona_id` del lead pasan al cliente.
8. Actualiza la persona temporal creada por el modulo a `estado='archivado'`; no la elimina y no le asigna telefono.
9. Devuelve el cliente vinculado y la cantidad de envios reasignados.

La operacion es transaccional e idempotente. Repetirla con el mismo origen y destino no duplica ni pierde datos. No modifica nombre, email, telefono, programas ni ningun otro dato del cliente definitivo.

## 10. Modulo `/leads`

El listado representa envios del quiz, no una tabla raiz adicional llamada `leads`.

Columnas:

- Fecha.
- Version/variante.
- Nombre, email y telefono capturados.
- Capital.
- Calificacion.
- Estado del funnel.
- Ultimo paso.
- Campaña.
- Conversion: pendiente o vinculada a un cliente con programa.

Filtros:

- Fechas.
- Version/variante.
- Lead caliente.
- Estado del funnel.
- Banda de capital.
- Pregunta/paso de abandono.
- UTMs.
- Busqueda por nombre, email o telefono capturados.

Detalle:

- Contacto y consentimiento.
- Version del quiz.
- UTMs y referrer.
- Tiempos y progreso.
- Respuestas en orden.
- Diagnostico mostrado.
- Regla y motivo de calificacion.
- Link a la persona asociada: lead temporal antes de convertir o cliente definitivo despues de vincular.
- Accion manual para vincular el lead con un cliente despues de que la venta exista.

Permisos:

- Nueva clave logica `leads` en el mecanismo existente de modulos.
- Proteccion en pagina, APIs y acciones de servidor; no basta con ocultar la navegacion.
- CSS nuevo en `app/inbox.css`, nunca en `globals.css`.

## 11. Seguridad y privacidad

- RLS habilitado al crear las tres tablas.
- Sin escrituras directas desde el navegador a Supabase.
- `service_role` solo en servidor.
- Esquema de validacion cerrado, con limites de cuerpo, respuestas y longitudes.
- Rate limit compartido o WAF antes de produccion.
- Honeypot y validacion de origen segun `docs/09-security.md`.
- Cero PII en logs de produccion.
- Timestamps del cliente se validan; `created_at` y recepcion del servidor son autoritativos.
- Retencion sin vencimiento por decision de negocio. Debe existir capacidad futura de eliminacion o anonimizacion ante una solicitud aplicable.

## 12. Plan de desarrollo

### Fase A - Migracion y RPC

1. Crear `0068_quiz_leads.sql`.
2. Crear `quiz_versiones`, `diagnostico_envios` y `diagnostico_respuestas`.
3. Crear CHECKs, FKs, indices y RLS.
4. Insertar `diagnostico-cripto-v1-a` con la definicion vigente.
5. Implementar RPC transaccional e idempotente de ingesta.
6. Implementar `vincular_lead_convertido` para la conversion posterior a la venta.
7. Probar migracion con `supabase db reset`.

### Fase B - Endpoint y funnel

1. Portar el wizard a `/quiz` dentro de `apps/inbox`.
2. Incorporar selector de pais/prefijo para normalizacion E.164.
3. Capturar automaticamente UTMs y referrer.
4. Implementar eventos `started`, `progress`, `dropped` y `completed`.
5. Implementar `POST /api/lead` con validacion y controles de seguridad.
6. Persistir el contacto antes de mostrar el resultado final.
7. Adaptar tests del quiz y mantener la suite del OS en verde.

### Fase C - Modulo `/leads`

1. Agregar permiso y navegacion.
2. Crear listado server-side con paginacion y filtros.
3. Crear detalle del envio.
4. Mostrar respuestas dinamicamente desde los snapshots, sin asumir preguntas fijas.
5. Agregar la accion de vinculacion posterior a la venta con selector de cliente.

### Fase D - Alertas y produccion

1. Definir canal y destinatarios de triaje.
2. Implementar alerta idempotente en un PR separado.
3. Implementar rate limiting final.
4. Miled aplica la migracion manualmente antes del codigo.
5. Ejecutar smoke test con datos falsos.

## 13. Criterios de aceptacion

- Cambiar preguntas o lanzar otra variante no requiere migracion ni cambios del endpoint.
- Dos variantes pueden recibir trafico simultaneamente.
- Un `session_id` nunca crea dos envios ni dos personas por reintentos.
- La primera finalizacion de un contacto crea una persona con `estado='lead'`; quizzes posteriores del mismo contacto reutilizan solo ese lead del modulo.
- Ninguna operacion consulta, reutiliza o modifica clientes u otras personas ajenas al modulo.
- La vinculacion posterior a una venta solo reasigna diagnosticos al cliente seleccionado y archiva el lead temporal.
- Nombre, email, telefono y consentimiento quedan disponibles en el modulo de leads.
- Un beacon tardio no degrada un envio completado.
- La clasificacion se reproduce desde version, respuesta y regla almacenadas.
- El modulo renderiza preguntas desconocidas usando sus snapshots.
- No se cambia ninguna tabla, restriccion ni RPC existente.
- Migracion, tests y TypeScript pasan antes del PR.

## 14. Luz verde

No quedan decisiones funcionales o tecnicas bloqueantes para comenzar el desarrollo local. El orden de ejecucion es:

1. Tests de migracion/RPC que fallen.
2. `0068_quiz_leads.sql`.
3. RPC de ingesta y vinculacion posterior a venta.
4. Endpoint y port del funnel.
5. Modulo `/leads`.

Hosting y rate limiting distribuido siguen pendientes para produccion, pero no bloquean la implementacion local ni los PRs de las fases A-C.
