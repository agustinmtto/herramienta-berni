# Análisis integral: Quiz Funnel y módulo de leads de MetaCrypto OS

> ⚠️ **ARCHIVADO / OBSOLETO** (16-sep-2026, diseño técnico previo a la implementación).
> El diseño que se implementó y está vigente es `docs/11-migracion-modulo-leads.md` (spec funcional) + `docs/12-spec-sdd-fases-migracion-leads.md` (fases). Este análisis se conserva como referencia del DDL y del razonamiento previo; **no lo uses como spec**.

Fecha del análisis: 16 de septiembre de 2026

Estado: diseño técnico previo a implementación

Carpeta analizada: `C:\Users\ambal\Desktop\Herramienta`

## 1. Resumen ejecutivo

El objetivo es conectar el Quiz Funnel de captación con MetaCrypto OS para que cada recorrido llegue al sistema, se relacione de forma segura con una persona, pueda clasificarse comercialmente y se consulte desde un nuevo módulo interno de leads.

La conclusión principal es que **no debe crearse una tabla raíz de leads separada**. MetaCrypto OS ya tiene la entidad correcta:

- `personas` representa leads, clientes, exclientes y registros archivados.
- `personas.estado` ya admite `lead`.
- Una persona puede pasar de `lead` a `cliente` sin cambiar de identidad.
- `programas`, pagos, sesiones, contratos y comunicaciones quedan vinculados a la misma `persona_id`.

Lo que sí debe agregarse es:

1. Una tabla de envíos o recorridos del diagnóstico.
2. Una tabla de respuestas asociadas a cada envío.
3. Opcionalmente, una tabla de eventos para tracking avanzado.
4. Un endpoint público, validado e idempotente, dentro de MetaCrypto OS.
5. Un módulo interno `/leads` con listado, filtros y detalle.
6. Clasificación de lead caliente calculada exclusivamente en backend.
7. Una política explícita de deduplicación y resolución de conflictos de identidad.

Arquitectura recomendada:

```text
Instagram / campaña
        |
        v
Landing y Quiz Funnel dentro de apps/inbox
        |
        v
POST /api/lead
        |
        v
Validación + normalización + deduplicación + clasificación
        |
        v
RPC/transacción en Supabase
        |
        +--> personas
        +--> diagnostico_envios
        +--> diagnostico_respuestas
        +--> auditoria / alerta de lead caliente
        |
        v
Módulo interno /leads
```

No se recomienda que el navegador escriba directamente en Supabase ni que conozca la `service_role`. Tampoco se recomienda mantener dos backends, uno en Netlify y otro en Vercel, salvo que exista una razón operativa fuerte.

## 2. Material analizado

El análisis comenzó por `documentacion_prototipo.txt`, tal como se solicitó. Después se revisaron los dos proyectos, su documentación y el esquema SQL.

### 2.1 Raíz de la carpeta

| Recurso | Función |
|---|---|
| `documentacion_prototipo.txt` | Síntesis funcional y técnica del Quiz Funnel |
| `esquema-metacrypto-os.sql` | Volcado ejecutable del esquema actual de MetaCrypto OS |
| `Herramienta_IA/herramienta-berni/` | Prototipo funcional del Quiz Funnel |
| `metacrypto-os-app/` | Aplicación productiva y migraciones de MetaCrypto OS |

### 2.2 Quiz Funnel

Se revisaron, entre otros:

- `app/`, incluido `app/api/lead/route.js`.
- `components/flow.jsx` y `components/diagnosis-document.jsx`.
- `lib/question-config.js`, `lib/engine.js`, `lib/whatsapp.js` y `lib/pdf.js`.
- Tests unitarios y de integración.
- Documentación `docs/00-OVERVIEW.md` a `docs/08-roadmap.md`.
- README, AGENTS, transcripciones y prototipos de referencia.
- Configuración de Next.js y Netlify.

Se excluyeron del análisis de código las dependencias instaladas y artefactos generados como `node_modules` y `.next`, salvo para confirmar su existencia.

### 2.3 MetaCrypto OS

Se revisaron:

- `CLAUDE.md` y `docs/esquema.md`.
- Rutas de `apps/inbox/app/`.
- Componentes, navegación y patrones de tablas.
- Autenticación, permisos y middleware.
- Acceso a Supabase por PostgREST.
- Acciones de servidor y RPC existentes.
- Tests y configuración TypeScript/Next.js/Vercel.
- Los 64 archivos de migración existentes, numerados hasta `0067`, con énfasis en los relacionados con personas, permisos, ventas, comunicación, auditoría y notificaciones.
- `supabase/baseline/esquema-actual.sql`.
- El DDL `esquema-metacrypto-os.sql` ubicado en la raíz.

Los dos volcados SQL tienen el mismo contenido funcional; su hash difiere por el formato de finales de línea.

## 3. Qué existe hoy en el Quiz Funnel

### 3.1 Flujo funcional

El prototipo actual implementa este recorrido:

```text
Landing
  -> 8 preguntas
  -> nombre, email, teléfono y consentimiento
  -> pregunta adicional de segmentación
  -> animación de análisis
  -> POST /api/lead
  -> resultado
  -> videos de muestra
  -> PDF base
  -> WhatsApp
```

Está implementado:

- Wizard responsive.
- Preguntas configurables de opción múltiple.
- Captura de contacto y consentimiento.
- Diagnóstico determinístico sin IA.
- `session_id` mediante UUID.
- Intento de registrar abandono con `pagehide` y `sendBeacon`.
- CTA a WhatsApp con respuestas precargadas.
- PDF A4 generado en el navegador.
- Endpoint `POST /api/lead`.
- Tests actuales con resultado documentado de 21/21.

### 3.2 Contrato actual real

El frontend envía actualmente una estructura similar a esta:

```json
{
  "session_id": "ad5bbfd6-766c-4c43-a72a-13b395ff2abd",
  "lead": {
    "name": "Juan Pérez",
    "email": "juan@email.com",
    "phone": "+54 9 3585 000000",
    "consent": true
  },
  "signals": {
    "dropoff_question": null,
    "finished_at": "2026-09-16T12:00:00.000Z"
  },
  "answers": [
    {
      "pregunta": "¿Cuánto capital total tenés invertido en cripto?",
      "respuesta": "15k a 40k"
    }
  ]
}
```

Características del contrato actual:

- Las preguntas y respuestas se identifican por el texto visible.
- No hay IDs estables de pregunta u opción.
- No hay versión del contrato ni del cuestionario.
- No se envían UTMs.
- No se envía el diagnóstico generado.
- No se envía el flag de lead caliente.
- El consentimiento es solo un booleano, sin versión legal ni fecha propia.
- `finished_at` también se usa en abandonos, por lo que su semántica no es fiable.

### 3.3 Qué hace realmente el endpoint actual

`Herramienta_IA/herramienta-berni/app/api/lead/route.js`:

- Lee el cuerpo completo.
- Verifica un límite declarado de 64 KiB.
- Parsea JSON.
- Valida parcialmente `session_id`, `lead` y `answers`.
- Exige consentimiento `true` cuando existe `lead`.
- Registra el payload en consola.
- Devuelve `{ "ok": true, "session_id": "..." }`.

No hace todavía:

- Persistencia.
- Deduplicación.
- Normalización de teléfono o email.
- Validación UUID real.
- Idempotencia.
- Clasificación comercial en backend.
- Notificaciones.
- Control de origen, rate limit o antispam.
- Eliminación de PII de logs.

### 3.4 Problemas funcionales detectados

| Problema | Consecuencia |
|---|---|
| El endpoint solo escribe en consola | No existe un lead persistido |
| El frontend no comprueba `response.ok` | Un error 4xx/5xx se presenta como éxito |
| El POST ocurre después de la animación | El contacto puede perderse si el usuario cierra durante esos segundos |
| El abandono siempre manda `lead: null` | Se pierde contacto ya consentido |
| Las respuestas usan textos | Cambiar una etiqueta rompe agregaciones históricas |
| No hay versión de cuestionario | No puede saberse qué conjunto de preguntas respondió una persona |
| No hay timestamps de inicio/progreso | El embudo no puede medirse con precisión |
| Se imprime PII en logs | Riesgo de privacidad y operación |

### 3.5 Diagnóstico y lead caliente

El motor determinístico está en `lib/engine.js`. Produce cuatro secciones, pero la interfaz no muestra la primera, “Tu situación real”. Varias respuestas tampoco afectan a ninguna regla.

La mayor divergencia es el lead caliente:

- Requisito documentado: capital superior a 10.000 USD.
- Código actual: solo la opción “Más de 100k” tiene el tag `hot-cap`.
- El flag se calcula en cliente, pero no se usa en la interfaz ni se envía al backend.
- Las bandas actuales incluyen `5k a 15k`, que cruza el umbral de 10.000 y no permite clasificar con certeza.

No debe implementarse la regla definitiva hasta decidir:

1. Si se usa capital invertido, liquidez, capital total gestionable o una combinación.
2. Si el umbral es `> 10.000` o `>= 10.000`.
3. Cómo se reformulan las opciones para que ninguna banda cruce el umbral.

## 4. Arquitectura actual de MetaCrypto OS

### 4.1 Stack y despliegue

MetaCrypto OS es una aplicación productiva:

- Next.js 15 con App Router.
- React 18.
- TypeScript estricto.
- Supabase/PostgreSQL.
- Acceso a la base por PostgREST usando `SUPABASE_SERVICE_ROLE_KEY` solo en servidor.
- Despliegue orientado a Vercel.
- Vitest con una suite amplia de tests.

La aplicación es autónoma dentro de `metacrypto-os-app/apps/inbox`.

### 4.2 Organización de rutas

| Ruta/carpeta | Función |
|---|---|
| `app/(os)/` | Pantallas internas que exigen sesión |
| `app/(os)/clientes` | Listado y ficha de clientes |
| `app/(os)/inbox` | WhatsApp interno |
| `app/(os)/sesiones` | Consultorías y clases |
| `app/(os)/nueva-venta` | Alta de ventas |
| `app/(os)/atribucion` | Ventas sin atribución |
| `app/(os)/contratos` | Gestión de contratos |
| `app/c/[token]` | Firma pública de contratos |
| `app/e/[token]` | Portal público de estrategias |
| `app/api/` | Integraciones, crons y operaciones internas |

No existe actualmente una ruta `/leads` ni un endpoint `/api/lead` en MetaCrypto OS.

### 4.3 Autenticación y permisos

La sesión interna usa una cookie `mcc_session` firmada con HMAC-SHA256 y `AUTH_TOKEN`.

El middleware protege todas las rutas salvo excepciones públicas explícitas. Si se incorpora el funnel, deben habilitarse exactamente:

- La ruta pública de la landing, por ejemplo `/diagnostico`.
- El endpoint público `/api/lead`.

No debe abrirse un prefijo amplio como `/api/`.

Los permisos internos se basan en:

- `team_members.acceso_total`.
- `team_members.modulos` como array de claves.
- `ModuloKey` en `lib/modulos.ts`.
- `requireModulo()` en cada página interna.
- Filtrado de navegación mediante `puedeVer()`.

El nuevo módulo requiere una clave propia `leads`, salvo que el negocio decida que debe heredar el permiso `ventas`. Se recomienda una clave propia porque consultar datos financieros declarados por prospectos es una capacidad distinta a registrar ventas.

### 4.4 Acceso a datos

`lib/supabase.ts` construye llamadas HTTPS directas a PostgREST con la clave de servicio.

Consecuencias relevantes:

- La clave privada permanece en servidor.
- La aplicación salta RLS al usar `service_role`.
- La seguridad efectiva del endpoint público depende del código de la ruta y del RPC.
- El navegador nunca debe importar `lib/supabase.ts`.
- Una respuesta de PostgREST puede ser un objeto de error en vez de un array; el código nuevo debe comprobar status y forma, no degradar fallos a listas vacías.

### 4.5 Patrones de interfaz reutilizables

El módulo de leads puede seguir patrones ya existentes:

- Página server-side en `app/(os)/leads/page.tsx`.
- Guard `requireModulo("leads")`.
- Lecturas en un archivo server-only, preferentemente `lib/leads-datos.ts`.
- Lógica pura de filtros, orden y clasificación en `lib/leads.ts`.
- Tabla cliente inspirada en `ClientesTabla.tsx`.
- Filtros por columna y orden accesible con `aria-sort`.
- Panel de detalle inspirado en `FichaEnPanel`/`PanelLateral`.
- Estilos nuevos en `app/inbox.css`, no en `globals.css`.
- Entrada de navegación en `components/OsNav.tsx`.

Para los primeros volúmenes puede filtrarse en cliente. Si el funnel genera miles de filas, debe usarse paginación y filtros server-side para evitar límites silenciosos de PostgREST.

## 5. Modelo de datos actual

El DDL tiene 28 tablas. El modelo central es:

```text
personas
   |--< programas --< pagos
   |              --< cuotas_programadas
   |--< sesiones
   |--< contratos
   |--< estrategias
   |--< wa_conversaciones --< wa_mensajes
   |--< patrimonio_snapshots
   |--< posiciones
```

### 5.1 Inventario funcional de tablas

| Área | Tablas |
|---|---|
| Núcleo comercial | `personas`, `programas`, `tiers`, `pagos`, `cuotas_programadas`, `programa_eventos` |
| Servicio | `sesiones`, `sesiones_recurrentes`, `sesion_operaciones`, `estrategias`, `portal_accesos`, `onboarding`, `posiciones`, `patrimonio_snapshots` |
| Contratos | `contratos`, `contrato_eventos` |
| Comunicación | `wa_conversaciones`, `wa_mensajes`, `emails_enviados`, `push_suscripciones`, `push_enviados`, `notificaciones_vistas` |
| Inteligencia/atribución | `fathom_llamadas`, `fuentes_atribucion` |
| Operación | `gastos`, `team_members`, `auditoria`, `ajustes_os` |

### 5.2 `personas` es la entidad que debe reutilizarse

Campos relevantes:

| Campo | Uso para leads |
|---|---|
| `id` | Identidad estable de la persona |
| `estado` | Debe insertarse explícitamente como `lead` |
| `nombre` | Nombre del formulario |
| `telefono_e164` | Teléfono normalizado; tiene restricción UNIQUE |
| `email` | Email; actualmente no es único |
| `pais` | Puede derivarse o completarse más adelante |
| `ghl_contact_id` | No sirve como clave universal porque está incompleto |
| `coach_id` | No debe asignarse automáticamente sin regla acordada |
| `created_at` | Alta en el sistema |

Observaciones críticas:

- El default de `estado` es `cliente`; un insert de lead debe escribir `estado='lead'` explícitamente.
- `telefono_e164` es único.
- Hay índice por `telefono_e164`, `estado`, `ghl_contact_id` y `coach_id`.
- `email` no tiene índice único.
- El formato canónico de persona es `+` seguido de dígitos.
- `wa_conversaciones.telefono_e164` usa solo dígitos, por lo que ya existe lógica para convertir entre formatos.

### 5.3 Conversión futura de lead a cliente

El RPC existente `crear_venta` ya busca una persona por `telefono_e164`. Si encuentra una persona con estado `lead`, `reservado` o `ex_cliente`, la reutiliza y la cambia a `cliente`.

Esto permite conservar automáticamente los diagnósticos anteriores si todos cuelgan de la misma `persona_id`.

Limitaciones actuales del RPC de venta:

- Deduplica por teléfono, no por email y teléfono combinados.
- Al reutilizar una persona, cambia el estado pero no actualiza nombre o email con lo escrito en la venta.
- Debe verificarse que la política de identidad del funnel sea compatible con esta lógica.

### 5.4 RLS y service role

Las tablas actuales tienen RLS habilitado, y existe un event trigger que intenta activarlo en tablas nuevas. Sin embargo, MetaCrypto OS usa `service_role`, que ignora RLS.

Por tanto:

- Las tablas nuevas deben tener RLS habilitado de forma explícita en la migración.
- No deben otorgarse escrituras públicas desde el navegador.
- El endpoint público debe validar absolutamente todo.
- La autorización del módulo interno debe realizarse en página, API y acciones de servidor.

## 6. Modelo de datos propuesto

### 6.1 Relación objetivo

```text
personas
   1
   |
   | 0..N
diagnostico_envios
   1
   |
   | 0..N
diagnostico_respuestas

diagnostico_envios
   1
   |
   | 0..N
diagnostico_eventos (fase posterior)
```

### 6.2 Tabla `diagnostico_envios`

Responsabilidad: representar un recorrido completo o parcial del funnel. No representa a una persona; representa una sesión de diagnóstico.

| Campo propuesto | Tipo | Motivo |
|---|---|---|
| `id` | `uuid PK` | Identidad interna |
| `session_id` | `uuid UNIQUE NOT NULL` | Idempotencia entre progreso, abandono y finalización |
| `persona_id` | `uuid NULL FK personas(id) ON DELETE SET NULL` | Vínculo con identidad resuelta |
| `schema_version` | `smallint NOT NULL` | Versión del contrato API |
| `questionnaire_version` | `text NOT NULL` | Preguntas y opciones respondidas |
| `estado` | `text NOT NULL` | `started`, `in_progress`, `dropped`, `completed` |
| `resolucion_identidad` | `text NOT NULL` | `sin_contacto`, `creada`, `vinculada`, `revision` |
| `nombre_capturado` | `text NULL` | Snapshot del contacto enviado |
| `email_capturado` | `text NULL` | Snapshot para auditoría/resolución |
| `telefono_e164_capturado` | `text NULL` | Snapshot normalizado |
| `consentimiento_aceptado` | `boolean` | Evidencia mínima |
| `consentimiento_version` | `text` | Texto legal aceptado |
| `consentimiento_at` | `timestamptz` | Momento de aceptación |
| `started_at` | `timestamptz` | Inicio informado por cliente |
| `last_activity_at` | `timestamptz` | Último progreso recibido |
| `finished_at` | `timestamptz NULL` | Solo finalización real |
| `dropped_at` | `timestamptz NULL` | Abandono conocido |
| `last_question_id` | `text NULL` | Punto exacto del embudo |
| `last_question_index` | `integer NULL` | Reporte de abandono |
| `utm_source` | `text NULL` | Atribución |
| `utm_medium` | `text NULL` | Atribución |
| `utm_campaign` | `text NULL` | Atribución |
| `utm_content` | `text NULL` | Atribución |
| `utm_term` | `text NULL` | Atribución |
| `referrer` | `text NULL` | Origen técnico |
| `capital_min_usd` | `numeric NULL` | Filtros y clasificación reproducible |
| `capital_max_usd` | `numeric NULL` | Rangos abiertos/cerrados |
| `es_lead_caliente` | `boolean NULL` | `NULL` permite representar “indeterminado” |
| `motivo_calificacion` | `text NULL` | Explica la regla aplicada |
| `diagnosis_version` | `text NULL` | Motor utilizado |
| `diagnosis_result` | `jsonb NULL` | Resultado reproducible si se decide persistirlo |
| `necesita_revision` | `boolean NOT NULL DEFAULT false` | Conflicto de identidad o datos |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Recepción inicial del servidor |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Último upsert |

Restricciones recomendadas:

- `UNIQUE(session_id)`.
- CHECK de `estado`.
- CHECK de `resolucion_identidad`.
- CHECK que impida `completed` sin `finished_at`.
- CHECK que impida consentimiento aceptado sin versión y fecha.
- Índice por `(es_lead_caliente, created_at DESC)`.
- Índice por `(estado, created_at DESC)`.
- Índice por `persona_id`.
- Índices por UTMs solo cuando el volumen o consultas lo justifiquen.

Guardar el snapshot de contacto en el envío es intencional: permite conservar lo que se declaró en ese recorrido y gestionar conflictos sin sobrescribir una persona existente. Debe definirse una política de retención porque duplica PII.

### 6.3 Tabla `diagnostico_respuestas`

Responsabilidad: almacenar respuestas versionadas y consultables.

| Campo propuesto | Tipo | Motivo |
|---|---|---|
| `id` | `uuid PK` | Identidad interna |
| `envio_id` | `uuid FK diagnostico_envios(id) ON DELETE CASCADE` | Sesión propietaria |
| `question_id` | `text NOT NULL` | Clave estable |
| `question_text` | `text NOT NULL` | Texto que vio el usuario |
| `answer_id` | `text NULL` | Opción estable |
| `answer_text` | `text NULL` | Etiqueta visible |
| `answer_value` | `jsonb NULL` | Valores estructurados, rangos o porcentajes |
| `question_order` | `integer NOT NULL` | Orden de presentación |
| `questionnaire_version` | `text NOT NULL` | Interpretación histórica |
| `answered_at` | `timestamptz NULL` | Tracking opcional |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Auditoría técnica |

Restricciones e índices:

- `UNIQUE(envio_id, question_id)` para upsert idempotente.
- Índice por `(question_id, answer_id)` para reportes agregados.
- CHECK de orden no negativo.
- Límite de longitudes en API y, cuando corresponda, en base.

No se recomienda guardar únicamente textos. Los IDs estables permiten cambiar copy sin romper la historia y `answer_value` permite representar importes, rangos y porcentajes.

### 6.4 Tabla opcional `diagnostico_eventos`

No es necesaria para la primera persistencia. Es útil en una fase de analítica:

- Inicio del funnel.
- Pantalla vista.
- Respuesta modificada.
- PDF descargado.
- WhatsApp abierto.
- Video reproducido.
- Email abierto/clicado.
- Experimento A/B.

Campos mínimos: `id`, `envio_id`, `tipo`, `ocurrido_at`, `datos jsonb` y una clave de idempotencia opcional.

## 7. Deduplicación e identidad

La deduplicación es el punto más delicado porque una fusión incorrecta expone o mezcla datos financieros de personas diferentes.

### 7.1 Normalización previa

Antes de consultar:

- Nombre: trim y colapso prudente de espacios; no usarlo como clave.
- Email: trim y minúsculas para comparar; conservar el texto original solo si se necesita como evidencia.
- Teléfono: convertir con la lógica de `aE164()` y exigir entre 8 y 15 dígitos.
- Nunca confiar en el formato enviado por el navegador.

### 7.2 Matriz recomendada

| Resultado de búsqueda | Acción |
|---|---|
| Email y teléfono apuntan a la misma persona | Vincular el envío a esa persona |
| No coincide ninguno | Crear `personas` con `estado='lead'` |
| Coincide teléfono y la persona no tiene email | Vincular y, si se aprueba la política, completar el email vacío |
| Coincide email único y la persona no tiene teléfono | Requiere política explícita; opción segura: revisión |
| Coincide uno pero el otro contradice un dato existente | No sobrescribir; guardar envío con `necesita_revision=true` |
| Email y teléfono apuntan a personas distintas | No fusionar; revisión manual obligatoria |
| Hay varias personas con el mismo email | No decidir por email; usar teléfono o revisión |
| Persona existente ya es cliente | Vincular sin cambiarla a `lead` |

La operación debe ejecutarse en una transacción o RPC para evitar que dos solicitudes concurrentes creen identidades duplicadas.

### 7.3 Relación con `crear_venta`

Cuando el lead compra, `crear_venta` podrá reutilizarlo por teléfono y cambiar su estado a `cliente`. El reporte de leads podrá considerar convertido un envío cuando su `persona_id` tenga uno o más `programas`.

Antes de implementar debe decidirse si se adapta `crear_venta` a la misma política de identidad. Si no se hace, la captación será más estricta que la venta y pueden aparecer comportamientos distintos ante conflictos de email/teléfono.

## 8. Contrato API recomendado

No se recomienda mantener el contrato basado solo en textos. Como el funnel y el OS se modificarán juntos, conviene migrar directamente a un contrato versionado.

### 8.1 Ejemplo de finalización

```json
{
  "schema_version": 1,
  "questionnaire_version": "mcc-diagnostico-2026-09-v1",
  "session_id": "ad5bbfd6-766c-4c43-a72a-13b395ff2abd",
  "event": "completed",
  "source": {
    "utm_source": "instagram",
    "utm_medium": "organic",
    "utm_campaign": "diagnostico",
    "utm_content": "reel-123",
    "utm_term": null,
    "referrer": "https://instagram.com/"
  },
  "lead": {
    "name": "Juan Pérez",
    "email": "juan@email.com",
    "phone": "+5493585000000",
    "consent": {
      "accepted": true,
      "version": "lead-contact-v1",
      "accepted_at": "2026-09-16T12:00:00.000Z"
    }
  },
  "signals": {
    "started_at": "2026-09-16T11:57:00.000Z",
    "last_activity_at": "2026-09-16T12:00:00.000Z",
    "finished_at": "2026-09-16T12:00:00.000Z",
    "last_question_id": "path",
    "last_question_index": 9
  },
  "answers": [
    {
      "question_id": "capital_invested",
      "question_text": "¿Cuánto capital total tenés invertido en cripto?",
      "answer_id": "usd_15001_40000",
      "answer_text": "15k a 40k",
      "value": {
        "currency": "USD",
        "min": 15001,
        "max": 40000
      },
      "order": 1
    }
  ]
}
```

### 8.2 Eventos permitidos

| Evento | Cuándo | Contacto obligatorio |
|---|---|---|
| `started` | Al comenzar | No |
| `progress` | Después de respuestas relevantes | No |
| `dropoff` | Cierre o abandono detectado | No; si ya fue consentido debe conservarse |
| `completed` | Cuestionario terminado | Sí |

Para un MVP más pequeño pueden persistirse primero `dropoff` y `completed`, pero no se obtendrá un embudo fiable sin `started` y `progress`.

### 8.3 Respuesta del endpoint

```json
{
  "ok": true,
  "session_id": "ad5bbfd6-766c-4c43-a72a-13b395ff2abd",
  "submission_id": "6f764a18-fbe8-4f37-85dd-62936486fdd1",
  "status": "completed"
}
```

No es necesario devolver al navegador `persona_id`, detalles de deduplicación ni el motivo de lead caliente. Esa información es interna y facilita enumeración o abuso.

### 8.4 Códigos HTTP

| Código | Uso |
|---|---|
| `200` | Upsert de una sesión existente |
| `201` | Primera creación de la sesión |
| `400` | JSON malformado |
| `413` | Cuerpo demasiado grande |
| `422` | Contrato inválido |
| `429` | Rate limit |
| `500` | Error interno |

El frontend debe comprobar `response.ok`, mostrar error recuperable y no marcar el recorrido como enviado antes de recibir confirmación.

## 9. Persistencia transaccional

Se recomienda un RPC de base o una transacción equivalente con esta secuencia:

1. Validar contrato en la ruta Next.js.
2. Normalizar email y teléfono en servidor.
3. Resolver identidad según la matriz acordada.
4. Crear o reutilizar `personas` sin degradar estados existentes.
5. Upsert de `diagnostico_envios` por `session_id`.
6. Upsert de respuestas por `(envio_id, question_id)`.
7. Derivar capital estructurado.
8. Calcular lead caliente en servidor.
9. Marcar conflictos para revisión.
10. Confirmar la transacción.
11. Emitir auditoría/notificación después del commit y de forma idempotente.

Reglas de idempotencia:

- El mismo `session_id` no crea dos envíos.
- Un evento `completed` no puede volver a `in_progress` por un beacon tardío.
- Respuestas repetidas se actualizan, no se duplican.
- Una notificación de lead caliente debe tener una clave única por envío y regla.
- Un retry de red debe devolver éxito si la operación anterior ya quedó guardada.

## 10. Regla de lead caliente

La regla debe vivir en backend y usar datos estructurados. El navegador puede mostrar una experiencia personalizada, pero no decide la prioridad comercial.

Propuesta de salida interna:

```json
{
  "es_lead_caliente": true,
  "motivo_calificacion": "capital_invertido_usd_gt_10000",
  "regla_version": "hot-lead-v1"
}
```

Si se mantienen preguntas por rangos, las opciones deben separar exactamente el umbral. Por ejemplo:

- Menos de 5.000 USD.
- Entre 5.000 y 10.000 USD.
- Más de 10.000 y hasta 15.000 USD.
- Entre 15.001 y 40.000 USD.
- Entre 40.001 y 100.000 USD.
- Más de 100.000 USD.

Si una respuesta antigua cruza el umbral, como `5k a 15k`, la clasificación correcta es `NULL/indeterminada`, no `false`.

## 11. Diseño del módulo interno `/leads`

### 11.1 Ubicación

Se recomienda un grupo visual “Captación” en la navegación, con la entrada “Leads”. Alternativamente puede vivir dentro de “Ventas”, pero el permiso debe seguir siendo explícito.

Archivos previstos:

```text
apps/inbox/app/(os)/leads/page.tsx
apps/inbox/components/LeadsTabla.tsx
apps/inbox/components/LeadDetalle.tsx
apps/inbox/lib/leads.ts
apps/inbox/lib/leads-datos.ts
apps/inbox/lib/__tests__/leads.test.ts
```

Archivos existentes a modificar:

```text
apps/inbox/components/OsNav.tsx
apps/inbox/lib/modulos.ts
apps/inbox/middleware.ts
apps/inbox/app/inbox.css
```

### 11.2 Listado recomendado

Columnas iniciales:

| Columna | Uso |
|---|---|
| Fecha | Orden operativo |
| Nombre | Identificación |
| Email | Contacto |
| Teléfono | Contacto |
| Capital | Priorización |
| Calificación | Caliente, no caliente o indeterminada |
| Estado del funnel | Completo, abandono, en progreso |
| Origen/campaña | Atribución |
| Último paso | Análisis de abandono |
| Persona | Vinculada, creada o requiere revisión |
| Conversión | Lead o ya cliente |

Filtros iniciales:

- Rango de fechas.
- Lead caliente.
- Estado del funnel.
- Estado de identidad/revisión.
- UTM source/campaign/content.
- Banda de capital.
- Pregunta de abandono.
- Convertido/no convertido.
- Búsqueda por nombre, email o teléfono.

### 11.3 Detalle

El panel de detalle debe mostrar:

- Contacto y consentimiento.
- Fuente y UTMs.
- Timeline de inicio, última actividad, abandono o finalización.
- Todas las respuestas en el orden original.
- Diagnóstico y versión del motor, si se persisten.
- Motivo de clasificación comercial.
- Estado de resolución de identidad.
- Enlace a la persona/cliente cuando corresponda.
- Aviso claro si existe conflicto de email o teléfono.

### 11.4 Gestión comercial

No debe confundirse el estado del funnel con el estado comercial.

Si el alcance incluye seguimiento, conviene añadir en una segunda fase:

- `gestion_estado`: `nuevo`, `contactando`, `contactado`, `descartado`, `convertido`.
- `asignado_a` como FK a `team_members`.
- `gestion_notas` o una tabla de actividades.
- `primer_contacto_at` y `ultimo_contacto_at`.

Para una primera entrega de consulta, estos campos pueden quedar fuera y evitar convertir el reporte en un CRM incompleto.

## 12. Alertas y notificaciones

MetaCrypto OS ya posee:

- Centro de novedades basado en `auditoria`.
- Push del navegador.
- Email mediante Resend.
- WhatsApp mediante Kapso.

Sin embargo, insertar una fila arbitraria en `auditoria` no basta. `lib/novedades.ts` utiliza una lista blanca de pares `(entidad, accion)` y descartaría un evento nuevo si no se agrega explícitamente.

Primera versión recomendada:

1. Registrar `entidad='diagnostico'`, `accion='lead_caliente'`.
2. Añadir ese evento a la lista blanca de novedades.
3. Mostrarlo solo a miembros con permiso `leads` o acceso total.
4. Enlazar a `/leads?calificacion=caliente` o al detalle del envío.
5. No incluir capital exacto en push sin aprobación de privacidad.

Email o WhatsApp automático deben ser una fase separada. El repositorio advierte que cualquier cambio que envíe comunicaciones afecta personas reales y requiere validación explícita.

## 13. Seguridad y privacidad

El endpoint será público y manejará PII más señales financieras. Controles mínimos:

- Excepción exacta en middleware.
- Validación server-side con esquema cerrado.
- UUID real para `session_id`.
- Versiones de contrato y cuestionario permitidas.
- Límites de cantidad y longitud de respuestas.
- Límite de cuerpo antes o durante la lectura, no solo después.
- Rate limit por IP y sesión.
- Honeypot y/o CAPTCHA adaptativo.
- Normalización de teléfono y email.
- No confiar en `hot_lead` del cliente.
- No devolver información sobre coincidencias de personas.
- No registrar payload completo, email o teléfono en logs.
- `service_role` únicamente en servidor.
- RLS habilitado en tablas nuevas.
- Política de retención y borrado.
- Consentimiento con texto/versionado y enlace a privacidad.
- Métricas técnicas sin PII.

Si el funnel permanece temporalmente en Netlify, debe llamar a un endpoint autenticado del OS a través de su backend, no desde el navegador directamente a Supabase. Harían falta `LEAD_API_URL`, un secreto interservicio, CORS controlado y rotación de credenciales. Esta alternativa es más compleja y no es la recomendada.

## 14. Cambios concretos previstos

### 14.1 Base de datos

- Crear una migración nueva con numeración confirmada por el operador.
- No asumir que el siguiente número libre visible está disponible en otras ramas.
- Crear `diagnostico_envios` y `diagnostico_respuestas`.
- Crear checks, FKs e índices.
- Habilitar RLS explícitamente.
- Crear RPC transaccional de ingesta.
- No editar migraciones anteriores.
- Aplicación manual por el operador; este repositorio no usa `supabase db push`.

### 14.2 Funnel público

- Portar landing y wizard a `apps/inbox`.
- Adaptar React 19 del prototipo a React 18 del OS sin copiar lockfiles.
- Integrar estilos sin modificar las pantallas internas existentes.
- Añadir IDs estables de pregunta/opción.
- Capturar UTMs al inicio.
- Enviar contacto antes de una animación que pueda perderlo.
- Manejar errores y reintentos.
- Corregir la primera sección del diagnóstico no renderizada.
- Sustituir rangos incompatibles con el umbral.
- Mantener WhatsApp y PDF como capacidades separadas de la persistencia.

### 14.3 Endpoint

- Crear `apps/inbox/app/api/lead/route.ts`.
- Usar runtime Node.js.
- Validar y normalizar antes de llamar al RPC.
- Responder con códigos honestos.
- No imprimir PII.
- Añadir rate limit/antibot.
- Añadir tests de middleware y API.

### 14.4 Módulo administrativo

- Añadir `leads` a `ModuloKey` y `HOME_ORDER` si corresponde.
- Añadir entrada a `OsNav`.
- Proteger página y acciones con `requireModulo("leads")`/`puedeVer`.
- Implementar lecturas server-only.
- Añadir tabla y panel responsive.
- Añadir estilos a `app/inbox.css`.
- Decidir qué miembros reciben el permiso en una migración o ajuste operativo.

## 15. Plan de entrega recomendado

### Fase 0: decisiones

- Cerrar preguntas definitivas.
- Definir capital y umbral exactos.
- Aprobar contrato y consentimiento.
- Aprobar matriz de deduplicación.
- Confirmar quién ve el módulo.
- Confirmar quién recibe alertas.

### Fase 1: persistencia segura

- Migración.
- RPC transaccional.
- Contrato versionado.
- Endpoint público.
- Normalización e idempotencia.
- Tests de base/API/middleware.

Resultado: los leads ya llegan y no se pierden aunque el reporte todavía no exista.

### Fase 2: módulo de consulta

- Permiso `leads`.
- Navegación.
- Listado, filtros y orden.
- Detalle de respuestas.
- Conflictos de identidad visibles.
- Estado de conversión.

### Fase 3: alertas y gestión

- Novedad para lead caliente.
- Push o email si se aprueba.
- Asignación y estado comercial si entra en alcance.
- Auditoría de cambios.

### Fase 4: analítica avanzada

- Eventos de funnel.
- Tiempos por pregunta.
- WhatsApp/PDF/video.
- Conversión a venta por campaña.
- Experimentos A/B.

## 16. Estrategia de pruebas

### 16.1 Unitarias

- Normalización de teléfono.
- Normalización y comparación de email.
- Regla de capital en límites 9.999, 10.000 y 10.001.
- Estado indeterminado para bandas antiguas.
- Transiciones de estado del funnel.
- Orden y filtros del reporte.
- Permisos del módulo.

### 16.2 Integración

- Primer evento crea una sesión.
- Retry con mismo `session_id` no duplica.
- Parcial y completo comparten envío.
- Beacon tardío no degrada un completo.
- Respuestas se actualizan sin duplicarse.
- Persona nueva se crea como `lead`, nunca como `cliente` por default.
- Persona cliente existente no se degrada a lead.
- Coincidencia de email/teléfono vincula correctamente.
- Conflictos quedan en revisión.
- El endpoint público atraviesa middleware.
- Las demás rutas internas siguen protegidas.

### 16.3 Seguridad

- Payload demasiado grande.
- Más respuestas de las permitidas.
- IDs/versiones desconocidos.
- Campos extra rechazados.
- UUID inválido.
- Teléfono inválido.
- Consentimiento incompleto.
- Rate limit.
- Respuesta sin datos internos.
- Logs sin PII.

### 16.4 End-to-end

- Instagram/UTM -> landing -> wizard -> contacto -> finalización -> fila en `/leads`.
- Abandono antes del contacto.
- Abandono después del contacto.
- Error temporal y retry.
- Lead caliente genera una sola alerta.
- Lead existente que compra conserva el diagnóstico y aparece convertido.
- Diseño usable en móvil y escritorio.

Antes de PR deben pasar `npm test` y `npx tsc --noEmit` en `apps/inbox`. Un build debe ejecutarse solo con cualquier `next dev` detenido, según las reglas del repositorio.

## 17. Criterios de aceptación de la primera versión

1. Cada `session_id` corresponde como máximo a un envío.
2. Un retry no crea duplicados.
3. Todo completo con consentimiento conserva nombre, email y teléfono normalizado.
4. Una persona nueva se crea con `estado='lead'`.
5. Una persona existente conserva su estado y su identidad.
6. Los conflictos no sobrescriben datos existentes.
7. Las respuestas usan IDs y versión de cuestionario.
8. La clasificación caliente se calcula en backend.
9. El listado interno requiere permiso.
10. Los filtros muestran calientes, abandonos, campañas y conversiones.
11. El detalle permite reconstruir qué respondió el lead.
12. No se expone `service_role` al navegador.
13. No hay PII en logs de producción.
14. Landing y API públicas no reciben redirect a `/login`.
15. Las rutas internas siguen protegidas.
16. Tests, tipos y smoke test de despliegue pasan.

## 18. Riesgos priorizados

### Críticos

| Riesgo | Mitigación |
|---|---|
| No existe persistencia actual | Implementar fase 1 antes del reporte |
| Regla `>10k` incompatible con rangos | Redefinir opciones antes de clasificar |
| Endpoint público bloqueado por middleware | Excepción exacta y test |
| Duplicación o fusión incorrecta de personas | RPC transaccional y estados de revisión |
| Frontend ignora errores | Comprobar respuesta y permitir retry |

### Altos

| Riesgo | Mitigación |
|---|---|
| Textos usados como claves | IDs y versiones estables |
| PII en logs | Logging estructurado sin payload |
| `service_role` salta RLS | Validación completa y server-only |
| Contacto perdido durante animación | Persistir antes de animar |
| Tracking de abandono no fiable | Started/progress y beacon solo como respaldo |
| Email no único | Matriz de conflictos y revisión manual |

### Medios

| Riesgo | Mitigación |
|---|---|
| Reporte cliente no escala | Paginación server-side al crecer |
| PDF no contiene el diagnóstico real | Aclarar que es guía base o personalizarlo |
| Videos son placeholders | Integrarlos en una fase independiente |
| Consentimiento insuficiente | Versionar texto y fecha |
| Divergencia Netlify/Vercel | Integrar en un único despliegue |

## 19. Decisiones pendientes

Estas preguntas deben resolverse antes de implementar la migración definitiva:

1. ¿Qué variable exacta define un lead caliente?
2. ¿El umbral es mayor que 10.000 o mayor/igual que 10.000?
3. ¿Cuáles son las preguntas y opciones definitivas?
4. ¿Se permite actualizar datos vacíos de una persona existente durante deduplicación?
5. ¿Qué se hace cuando solo coincide email o solo teléfono?
6. ¿Cuánto tiempo se conservan abandonos sin contacto?
7. ¿Cuánto tiempo se conservan snapshots de contacto?
8. ¿Quién puede ver el módulo `leads`?
9. ¿Quién recibe leads calientes?
10. ¿La primera versión es solo consulta o también gestión/asignación?
11. ¿Se persiste el diagnóstico mostrado o se regenera por versión?
12. ¿UTMs forman parte de la primera entrega?
13. ¿El funnel se porta completo al OS desde el inicio?
14. ¿Qué tratamiento legal y texto de consentimiento se aprueban?
15. ¿Se quiere medir conversión desde campaña hasta venta?

## 20. Recomendación final

La implementación debe dividirse en dos entregas mínimas y verificables:

1. **Captación integrada:** contrato nuevo, endpoint, tablas, relación con `personas`, deduplicación, idempotencia y clasificación backend.
2. **Módulo de leads:** permiso, navegación, listado filtrable, detalle, conflictos y conversión.

Después pueden agregarse alertas, asignación comercial y analítica avanzada.

La base actual está preparada para esta evolución: `personas.estado='lead'` ya existe y `crear_venta` puede convertir esa misma identidad en cliente. El trabajo importante no es crear otra entidad de leads, sino guardar correctamente cada diagnóstico, resolver identidades sin mezclar personas y hacer visible esa información dentro del OS.

## 21. Referencias principales

- `documentacion_prototipo.txt`
- `Herramienta_IA/herramienta-berni/components/flow.jsx`
- `Herramienta_IA/herramienta-berni/app/api/lead/route.js`
- `Herramienta_IA/herramienta-berni/lib/question-config.js`
- `Herramienta_IA/herramienta-berni/lib/engine.js`
- `Herramienta_IA/herramienta-berni/docs/03-especificacion.md`
- `Herramienta_IA/herramienta-berni/docs/08-roadmap.md`
- `metacrypto-os-app/CLAUDE.md`
- `metacrypto-os-app/docs/esquema.md`
- `esquema-metacrypto-os.sql`
- `metacrypto-os-app/supabase/baseline/esquema-actual.sql`
- `metacrypto-os-app/apps/inbox/middleware.ts`
- `metacrypto-os-app/apps/inbox/lib/supabase.ts`
- `metacrypto-os-app/apps/inbox/lib/telefono.ts`
- `metacrypto-os-app/apps/inbox/lib/modulos.ts`
- `metacrypto-os-app/apps/inbox/components/OsNav.tsx`
- `metacrypto-os-app/apps/inbox/components/ClientesTabla.tsx`
- `metacrypto-os-app/apps/inbox/lib/novedades.ts`
- `metacrypto-os-app/supabase/migrations/0015_crear_venta_dedupe.sql`
