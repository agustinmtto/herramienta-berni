# El modelo de datos de MetaCrypto OS

Guía de las 28 tablas: qué significa cada una, cómo se conectan y qué es cada campo.

Todo lo que hay aquí está leído de la base de producción el **16-sep-2026**: columnas, claves
externas, restricciones y los comentarios que la propia base lleva dentro. Los recuentos de filas
son reales y sirven para saber qué se usa de verdad y qué está previsto pero vacío.

Acompaña a `esquema-metacrypto-os.sql`, que es el volcado ejecutable (solo estructura, sin datos).

---

## La idea central, en un minuto

El modelo separa **quién es alguien** de **qué ha comprado**.

```
personas ──< programas ──< pagos
   │            │    └──< cuotas_programadas
   │            └── tier ──> tiers
   └──< sesiones, contratos, estrategias, conversaciones…
```

- **`personas`** es toda persona que el negocio conoce: un lead, un cliente, un ex-cliente. Una
  fila por ser humano, para siempre.
- **`programas`** es **una venta**, no un cliente. Quien amplía o renueva no sustituye su fila:
  suma otra. Por eso hay 210 personas y 222 programas.
- **`pagos`** es el dinero que entró de verdad, fila a fila. **`cuotas_programadas`** es lo que
  queda por cobrar.

Esa separación es lo que permite que un lead se convierta en cliente **sin perder su historia**:
no se le crea otra fila ni se le migra, se le inserta un `programa` y se le cambia el `estado`.

> **Convenciones generales:** todas las claves primarias son `uuid` con `gen_random_uuid()`. Los
> `created_at` son `timestamptz` con `now()`. Los importes son `numeric` con su `divisa` al lado
> (nunca se guarda dinero sin divisa). Los teléfonos van en E.164 (`+34600111222`).
> Las columnas `airtable_id` son la referencia al sistema anterior, del que se migró.

---

# 1 · El núcleo

## `personas` — 210 filas

**Toda persona que el negocio conoce.** No es "la tabla de clientes": el `estado` dice en qué
punto está. Un lead y un cliente son la misma fila.

| Campo | Tipo | Qué es |
|---|---|---|
| `id` | uuid | PK. Es el identificador que usa todo el sistema para referirse a una persona |
| `estado` | text | `lead` · `reservado` · `cliente` · `ex_cliente` · `archivado`. **Restringido por CHECK** |
| `nombre` | text | Nombre completo. Puede ser NULL |
| `telefono_e164` | text | Teléfono en formato E.164. Es la clave práctica para cruzar con WhatsApp |
| `email` | text | Correo. Es la clave que usa Fathom para emparejar llamadas |
| `pais` | text | Código de país |
| `ghl_contact_id` | text | Su id en GoHighLevel. **Solo lo tienen 40 de 127 clientes** |
| `coach_id` | uuid | → `team_members.id`. Quién le atiende |
| `divisa_preferida` | text | `EUR` por defecto |
| `consultorias_ajuste` | integer | Cupo de consultorías **congelado** para esta persona, que manda sobre el del tier |
| `consultorias_ajuste_motivo` | text | Por qué está congelado. Un CHECK impide que quede huérfano |
| `airtable_id` | text | Su id en el sistema anterior |

**Estado real hoy:** 127 `cliente`, 76 `archivado` (sin email ni teléfono — restos de una
importación), 7 `ex_cliente`, **0 `lead`, 0 `reservado`**.

> 🔴 **`lead` está previsto en el esquema y nunca se ha usado.** El sitio donde guardar leads ya
> existe y está diseñado; simplemente todavía no escribe nadie en él.

> **Sobre `consultorias_ajuste`:** un disparador (`trg_descongelar_cupo`) lo borra automáticamente
> cuando a esa persona se le inserta un programa nuevo. Es decir: el cupo congelado dura hasta que
> la persona vuelve a comprar.

## `programas` — 222 filas

**Una venta.** Es el centro comercial del modelo.

| Campo | Tipo | Qué es |
|---|---|---|
| `id` | uuid | PK |
| `persona_id` | uuid | → `personas.id`. **Quién compró** |
| `tier` | text | → `tiers.id`. Qué programa compró. 🔴 **El id del tier ES el precio en euros** (`"5000"`) |
| `motivo` | text | `nueva_venta` (209) · `upsell` (12) · `renovacion` (1) · `downsell` · `reactivacion` · `cross_sell` |
| `modo_transicion` | text | `suma` o `reemplaza`: si la venta se añade a la anterior o la sustituye |
| `programa_previo_id` | uuid | → `programas.id`. **Auto-referencia**: encadena ampliaciones y renovaciones |
| `fecha_inicio` | date | Cuándo arranca el programa |
| `meses_duracion` | integer | Cuánto dura |
| `monto` | numeric | Lo vendido. ⚠️ Puede ser NULL en ventas heredadas |
| `divisa` | text | `EUR` por defecto |
| `setter_id` | uuid | → `team_members.id`. Quién agendó |
| `closer_id` | uuid | → `team_members.id`. Quién cerró |
| `upsell_por_id` | uuid | → `team_members.id`. Quién hizo la ampliación |
| `source_id` | text | → `fuentes_atribucion.source_id`. De dónde vino el lead |
| `atribucion_at` | timestamptz | Cuándo se confirmó la atribución |
| `ghl_appointment_id` | text | La cita de GoHighLevel que originó la venta |
| `bonos` | text[] | Bonos aplicados. Claves en `apps/inbox/lib/bonos.ts` |
| `origen` | text | Procedencia del registro |
| `necesita_revision` | boolean | Marca de que algo no cuadra y hay que mirarlo |

## `tiers` — 11 filas

**El catálogo de programas vendibles** y qué incluye cada uno.

| Campo | Tipo | Qué es |
|---|---|---|
| `id` | text | PK. 🔴 **Es el precio en euros**: `"2000"`, `"3500"`, `"5000"`, `"10000"`. Hay uno llamado `OG` |
| `nombre` | text | Nombre comercial |
| `meses_default` | integer | Duración por defecto. ⚠️ Estuvo desactualizado meses: **contrastar con las ventas reales** |
| `n_consultorias` | integer | Consultorías 1 a 1 incluidas |
| `n_sesiones_berni` | integer | Sesiones 1 a 1 con el fundador. *El contrato lo imprime; el OS no lo aplica* |
| `acceso_discord` / `acceso_comunidad` / `sesiones_directo` / `numero_berni` | boolean | Qué incluye el programa |
| `acceso_vitalicio` | boolean | Si el contenido grabado es para siempre. En `false`, solo mientras dure el programa |
| `activo` | boolean | Si se puede vender hoy. Los retirados se quedan, no se borran |

> **Por qué no se borran los tiers retirados:** los clientes que compraron uno siguen apuntando a
> él. Borrarlo rompería su ficha y su contrato.

## `pagos` — 185 filas

**El dinero que entró de verdad.** Una fila por movimiento.

| Campo | Tipo | Qué es |
|---|---|---|
| `id` | uuid | PK |
| `persona_id` | uuid | → `personas.id` |
| `programa_id` | uuid | → `programas.id`. Qué venta paga |
| `cuota_id` | uuid | → `cuotas_programadas.id`. Qué cuota concreta salda, si aplica |
| `tipo` | text | `reserva` · `cuota` · `nueva` · `upsell` · **`refund`** |
| `monto` | numeric | El importe. ⚠️ **Su significado depende de `tipo`** — en un `refund` es negativo o una devolución |
| `divisa` / `fx_rate` / `usd_recibido` | | La divisa, el cambio aplicado y lo recibido en USD |
| `fecha` | date | Cuándo entró |
| `metodo_pago` | text | Stripe, transferencia, etc. |
| `comprobante_path` | text | El justificante en Storage |
| `revierte_pago_id` | uuid | → `pagos.id`. **Auto-referencia**: qué cobro devuelve esta fila |
| `devolucion_alcance` | text | `total` · `parcial` · `sin_clasificar`. **Obligatorio si `tipo='refund'`, prohibido si no** |
| `devolucion_motivo` | text | Por qué se devolvió |

> 🔴 **Las devoluciones se restan en el mes en curso, nunca en el de la venta original.** Es una
> regla de negocio, no un detalle técnico.

## `cuotas_programadas` — 30 filas

**Lo que queda por cobrar.** El calendario de pagos de un programa.

| Campo | Tipo | Qué es |
|---|---|---|
| `programa_id` | uuid | → `programas.id` |
| `numero_cuota` | integer | 1, 2, 3… |
| `fecha_vencimiento` | date | Cuándo toca |
| `fecha_inferida` | boolean | `true` = la fecha se dedujo, no la dio nadie. **No es un dato firme** |
| `monto` / `divisa` | | Cuánto |
| `estado` | text | `pendiente` · `pagada` · `vencida` · `anulada` |

> ⚠️ Para pronosticar caja hay que filtrar `fecha_vencimiento > hoy`: las vistas que suman cuotas
> incluyen también las ya vencidas.

---

# 2 · El servicio

## `sesiones` — 174 filas

**Las consultorías y clases que recibe un cliente.** Mueve cupo y comisiones, así que se escribe
con cuidado.

| Campo | Tipo | Qué es |
|---|---|---|
| `persona_id` / `programa_id` | uuid | A quién y a qué venta pertenece |
| `tipo` | text | `consultoria_1a1` · `grupal` |
| `coach_id` | uuid | → `team_members.id`. Quién la dio |
| `fecha` | timestamptz | Cuándo |
| `duracion_min` | integer | Cuánto duró |
| `estado_asistencia` | text | `asistio` · `no_asistio` · `reprogramada`. **Lo escribe el consultor a mano** |
| `notas` / `proximo_paso` | text | Qué se habló y qué toca después |
| `capital_total` / `exchange` | | Situación del cliente en esa sesión |
| `url_grabacion` / `enlace` | text | Grabación y enlace de la reunión |
| `ghl_appointment_id` | text | La cita de GoHighLevel que la originó |
| `recurrente_id` | uuid | → `sesiones_recurrentes.id`, si nace de una clase periódica |

## `sesiones_recurrentes` — 2 filas

**Las clases periódicas** (por ejemplo, el directo de los domingos). Día de la semana, hora, zona
horaria, coach, enlace, plantilla de recordatorio y a quién va dirigida.

## `sesion_operaciones` — 0 filas *(previsto, sin usar)*

Las operaciones concretas recomendadas dentro de una consultoría: `direccion`
(`short`/`long`/`spot`/`etfs`/`esperar`), activo, capital, apalancamiento, zona de entrada,
objetivo y `estado` (`ejecutada`/`ordenes_puestas`/`planificada`).

## `estrategias` — 37 filas

**Los documentos de estrategia que el equipo publica para cada cliente.** Título, `url`,
`password`, resumen, fecha, visibilidad y quién la creó. Cuelga de `persona_id` en **cascada**: si
se borra la persona, se borran sus estrategias.

## `portal_accesos` — 37 filas

**El enlace privado con el que un cliente entra a ver sus estrategias.** `token` (el secreto va en
la URL), `ultimo_acceso_at` y `revocado_at`. En cascada desde la persona.

## `onboarding` — 0 filas *(previsto, sin usar)*

Los accesos entregados a un cliente nuevo y si se le mandó la bienvenida.

## `posiciones` y `patrimonio_snapshots` — 0 filas *(previstas, sin usar)*

La cartera del cliente (activo, cantidad, precio de entrada) y fotos de su patrimonio total.

---

# 3 · Los contratos

## `contratos` — 3 filas

**El contrato de una venta, desde que se genera hasta que el cliente lo firma.** Es la tabla más
delicada del sistema: sostiene la promesa de que **el cliente firma exactamente lo que leyó**.

| Campo | Tipo | Qué es |
|---|---|---|
| `persona_id` / `programa_id` | uuid | De quién y de qué venta |
| `tipo` | text | `venta_nueva` · `ampliacion` · `venta_nueva_v2` (la plantilla que se firma dentro del OS) |
| `estado` | text | `pendiente` (generado, sin mandar) · `enviado` (al equipo) · `error_envio` · `enviado_cliente` (el enlace salió) · `firmado` |
| `texto_generado` | text | El texto que salió de la plantilla |
| `texto_final` | text | El texto tras las correcciones a mano. **Es lo que se firma** |
| `texto_editado_por` / `texto_editado_at` | | Quién lo tocó y cuándo |
| `pdf_path` / `pdf_firmado_path` | text | Los dos PDF en Storage: el que se mandó y el firmado |
| `hash_enviado` | text | 🔴 **SHA-256 del PDF que se le mandó al cliente** |
| `hash_firmado` | text | SHA-256 del PDF ya firmado |
| `token` | text | 🔴 **El secreto del enlace `/c/<token>`**. Es una credencial viva |
| `token_expira_at` | timestamptz | Caduca a los 60 días — **pero una vez firmado, el enlace no caduca nunca** |
| `enviado_cliente_at` / `visto_at` / `firmado_at` | | Las tres marcas del recorrido |
| `firma_nombre` / `firma_ip` / `firma_user_agent` / `firma_geo` | | La evidencia de quién firmó |
| `consentimiento` / `consentimiento_v` | | El texto aceptado y su versión |
| `recorregido_at` | timestamptz | Se regeneró porque cambió un dato tras el envío |
| `desactualizado_at` | timestamptz | Cambiaron los bonos después de emitirlo y hay que rehacerlo |
| `datos_bloque` | jsonb | Los datos con los que se rellenó la plantilla |

> 🔴 **La invariante:** antes de firmar se compara el hash del PDF que el cliente tiene delante
> contra `hash_enviado`. Si no coinciden, se rechaza la firma. **Romper esa comparación es un
> problema legal, no un bug.**

## `contrato_eventos` — 0 filas *(recién creada)*

La traza de cada contrato: `enviado` · `abierto` · `firmado` · `rechazado` · `enlace_rotado`, con
IP, agente y geolocalización. En cascada desde el contrato.

---

# 4 · La comunicación

## `wa_conversaciones` — 126 filas · `wa_mensajes` — 762 filas

**La bandeja de WhatsApp.** Una conversación por teléfono; los mensajes cuelgan en cascada.

`wa_conversaciones` lleva `persona_id` (si se ha identificado a quién pertenece), `telefono_e164`,
`kapso_conversation_id`, `estado` (`active`/`ended`), `estado_atencion`
(`pendiente`/`resuelto`), el coach asignado y el `tier` del cliente.

`wa_mensajes` lleva `direction` (`in`/`out`), `body`, `autor`, adjuntos (`media_path`,
`media_mime`, `media_status`: `none`/`pending`/`stored`/`failed`), `transcript` de los audios,
reacciones y `plantilla_nombre` si salió de una plantilla de Meta.

> ⚠️ `wa_mensajes.status` se queda en `sent` para siempre: el estado real de entrega **no está en
> esta base**, hay que preguntárselo al proveedor.

## `emails_enviados` — 14 filas

**Registro de correos**, y sobre todo el mecanismo que impide mandarlos dos veces.

| Campo | Qué es |
|---|---|
| `tipo` | `estrategia` · `confirmacion_sesion` · `recordatorio_1h` · `invitacion_calendario` … |
| `destinatario` | A quién |
| `idempotency_key` | 🔴 **La clave que evita el duplicado.** Una por (evento, destinatario) |
| `resend_id` | El id del proveedor |
| `estado` | `enviado` (**el proveedor lo aceptó — NO es una entrega**) · `entregado` · `rebotado` · `quejado` · `rechazado` |

## `push_suscripciones` — 2 filas · `push_enviados` — 253 filas · `notificaciones_vistas` — 8 filas

Las notificaciones del navegador para el equipo: los dispositivos suscritos (con sus claves VAPID),
qué se mandó a quién, y hasta qué momento ha leído cada miembro el centro de novedades.

---

# 5 · Inteligencia y atribución

## `fathom_llamadas` — 28 filas

**Bandeja de llamadas grabadas.** Según el comentario de la propia base:

> *«La ingesta escribe aquí y NUNCA en `sesiones`: convertir una llamada en sesión es un paso con
> una persona delante, porque `sesiones` mueve cupo de consultorías y comisiones.»*

Campos clave: `recording_id` (UNIQUE, hace la ingesta idempotente), `tipo`
(`venta`/`servicio`/`interna`, derivado del rol de quien grabó), `persona_id`, y **`emparejado_por`**:

- `correo` — un invitado externo coincide con `personas.email` → **fiable**
- `titulo` — el título contiene el nombre de un cliente → **sugerencia, hay que confirmar**
- `manual` — lo decidió una persona, y la ingesta no lo pisa

## `fuentes_atribucion` — 23 filas

**Traduce el `Source_ID` crudo de GoHighLevel a una fuente canónica y un setter.**
`nivel` = `setter` · `canal` · `contenido` · `campana`. **`confirmado=false` significa que la
lectura es una interpretación pendiente de validar.**

## `programa_eventos` — 10 filas

Tramos con nombre dentro de un programa (pausas, extensiones): `tipo`, `fecha_inicio`, `fecha_fin`.

---

# 6 · Negocio y sistema

## `gastos` — 107 filas

Los gastos del negocio: `concepto`, `categoria`, `tipo_gasto`, `monto`, `divisa`, `fecha`,
`metodo_pago`. No se conecta con nada — es la otra mitad del P&L.

## `team_members` — 8 filas

**El equipo, y el control de acceso al OS.**

| Campo | Qué es |
|---|---|
| `nombre` / `rol` | `coach` · `closer` · `admin` · `setter` |
| `username` / `password_hash` | Credenciales del OS. ⚠️ Hay miembros sin `username`: no pueden entrar |
| `acceso_total` | `true` = lo ve todo, sin mirar `modulos` |
| `modulos` | text[] con los permisos: `clientes`, `ventas`, `inbox`, `sesiones`, `contratos`… |
| `cobra_comision` | **No se deduce del rol.** Dos personas con el mismo rol pueden diferir |
| `email` | Para los avisos del equipo |
| `push_alcance` | `todas`/`asignadas`/`ninguna` — para la bandeja |
| `aviso_venta_alcance` | `todas`/`asignadas` — para el correo de cierres. **No es lo mismo que el anterior** |

> 🔴 **Esta tabla se lee en una veintena de sitios** —login, comisiones, destinatarios de
> contratos, desplegables de consultor—. Una fila de más los contamina todos. **No insertar aquí
> sin hablarlo.**

## `auditoria` — 326 filas

**El registro de todo lo que pasa**: `entidad`, `entidad_id`, `accion`, `autor_id` y `datos`
(jsonb). Alimenta el centro de novedades del OS.

> ⚠️ Solo registra lo que pasa **por la aplicación**. Lo que se escribe directamente contra la
> base con la clave de servicio no deja rastro aquí.

## `ajustes_os` — 3 filas

**Interruptores que se cambian desde la pantalla, sin desplegar.** `clave` → `valor`.

> ⚠️ `actualizado_at` es un `default now()` **sin disparador**: si un `UPDATE` no la escribe
> explícitamente, se queda con la fecha vieja. **No es prueba de cuándo se cambió algo.**

---

# 7 · Lo que importa para el lead magnet

**No hace falta crear una tabla de leads.** `personas` con `estado='lead'` ya existe y el CHECK lo
admite; simplemente nunca se ha usado.

**Lo que sí hace falta crear:** una tabla para el envío del cuestionario (con `persona_id` como
clave externa y el `session_id` único) y otra para sus respuestas. Eso encaja con el modelo sin
tocar nada de lo que ya funciona.

**Para deduplicar contra `personas`:** por `email` y por `telefono_e164` **a la vez**, nunca por
uno solo — de los 127 clientes, 117 tienen email y 123 teléfono. `ghl_contact_id` **no sirve como
clave**: solo lo tienen 40.

**Cuando un lead compre**, no se crea otra fila: se le inserta un `programa` y se le cambia el
`estado` a `cliente`. Toda su historia anterior —incluidas sus respuestas del cuestionario— sigue
colgando del mismo `persona_id`. **Eso es la atribución que hoy se pierde.**

---

## Dos avisos para quien escriba aquí

1. **La seguridad vive en el código, no en la base.** Hay políticas RLS definidas, pero la
   aplicación habla con PostgREST usando la clave de servicio, que **se las salta todas**. Si
   escribes un endpoint público, la validación es tuya: no hay red debajo.

2. **Nunca metas datos reales de personas en el repositorio** — ni en migraciones, ni en tests, ni
   en comentarios. Si un comentario explica un caso real, que lo explique **sin el nombre**.
