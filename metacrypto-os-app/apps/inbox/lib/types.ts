// Tipos compartidos entre servidor y cliente (sin `server-only`).

export type EstadoAtencion = "pendiente" | "resuelto";

export type ConversationRow = {
  id: string;
  telefono_e164: string;
  estado: string;
  estado_atencion: EstadoAtencion;
  tier: string | null;
  coach_asignado: string | null;
  ultimo_mensaje_at: string | null;
  persona: { nombre: string | null; estado: string } | null;
  coach: { nombre: string } | null;
  // Nombre (ya resuelto) del autor del último mensaje saliente. null = sin salientes aún.
  // Ausente (undefined) en filas que no pasan por getConversations (p.ej. getConversation singular).
  ultimo_autor?: string | null;
};

export type MessageRow = {
  id: string;
  direction: "in" | "out";
  body: string | null;
  tipo: string | null;
  autor: string | null;
  status: string | null;
  sent_at: string;
  media_path: string | null;
  media_mime: string | null;
  media_filename: string | null;
  caption: string | null;
  transcript: string | null;
  reaccion_emoji: string | null;
};

// `cobra_comision` (migración 0038) no se deduce del `rol`: Berni y Manuel son
// los dos `coach` y solo Manuel cobra. Ver docs/comisiones.md § 1.
export type TeamMember = {
  id: string;
  nombre: string;
  rol: string;
  cobra_comision: boolean;
};

export type GastoRow = {
  id: string;
  concepto: string;
  categoria: string | null;
  monto: number;
  divisa: string;
  fecha: string;
  tipo_gasto: string | null;
  metodo_pago: string | null;
  notas: string | null;
};

export type Contacto = { id: string; nombre: string | null; telefono_e164: string; estado: string };

export type VentaResumen = {
  persona_id: string; programa_id: string; pago_id: string; n_cuotas: number;
  nombre: string; tier: string; pago_monto: number; con_comprobante: boolean;
  // true = compra nueva cuyo teléfono ya existía: se reutilizó la persona en vez de crearla.
  persona_reutilizada: boolean;
  cuotas: { monto: number; fecha: string }[];
  // Para ofrecer la bienvenida sin volver a consultar la persona.
  telefono: string | null;
};
export type VentaResult = { ok: true; resumen: VentaResumen } | { ok: false; error: string };

/* ---------------- Bienvenida ---------------- */
// `yaEstaba` no es un error: el cliente ya tiene su bienvenida, que es
// justo el estado que se buscaba. Se distingue para que la interfaz lo
// cuente en calma en vez de en rojo — un aviso alarmante ante algo que
// está bien enseña al equipo a ignorar los avisos.
export type BienvenidaResult =
  | { ok: true; yaEstaba?: boolean }
  | { ok: false; error: string };

/* ---------------- Cuotas ---------------- */
export type AbonoRow = { id: string; monto: number; fecha: string; comprobante_path: string | null };

export type CuotaDetalle = {
  id: string;
  programa_id: string;
  numero_cuota: number | null;
  fecha_vencimiento: string;
  monto: number;
  divisa: string;
  estado: string;
  fecha_inferida: boolean;
  persona_id: string | null;
  persona_nombre: string | null;
  abonos: AbonoRow[];
  /** Último cambio registrado en auditoria: quién y cuándo. */
  // `motivo` solo viene relleno en las anulaciones (lo escribe `anular_cuota`
  // en `auditoria.datos`). Sin él, el bloque de anuladas diría que una deuda
  // desapareció pero no por qué — que es justo lo que el motivo obligatorio
  // existe para evitar.
  ultimo_cambio: {
    autor: string | null; accion: string; created_at: string; motivo: string | null;
  } | null;
};

export type CuotaResult = { ok: true; mensaje: string } | { ok: false; error: string };

// Mismo shape que CuotaResult. `crearGasto` devolvía `void` y `GastoForm`
// pintaba el check verde pasara lo que pasara — incluido el `return;` en
// silencio y un POST rechazado.
export type GastoResult = { ok: true; mensaje: string } | { ok: false; error: string };

/* ---------------- Ficha del cliente ---------------- */
// Mismo shape que CuotaResult y a propósito: el modal de edición reusa el
// manejo de error/pending de CuotaAcciones. Tipo propio en vez de un alias
// para que puedan divergir sin arrastrarse el uno al otro.
export type PersonaResult = { ok: true; mensaje: string } | { ok: false; error: string };

/* ---------------- Atribución pendiente (bandeja) ---------------- */
export type AtribuirResult = { ok: true } | { ok: false; error: string };

/* ---------------- Fuentes por confirmar ---------------- */
export type ConfirmarFuenteResult = { ok: true } | { ok: false; error: string };

/* ---------------- Devoluciones (spec 2026-08-21) ---------------- */
export type AlcanceDevolucion = "total" | "parcial" | "sin_clasificar";

export type DevolucionFila = {
  devolucion_id: string;
  fecha: string;
  monto: number;            // EUR, negativo o 0
  usd_recibido: number | null;
  alcance: AlcanceDevolucion;
  motivo: string | null;
  revierte_pago_id: string | null;
  persona_id: string;
  persona_nombre: string;
  persona_estado: string;
  programa_id: string | null;
  n_efectos: number;
  autor_id: string | null;
};

export type EfectoDevolucion = {
  accion: string;
  datos: Record<string, unknown>;
  created_at: string;
  autor_id: string | null;
};

// Una línea negativa de comisión, con el contexto que la explica en pantalla.
export type AjusteMes = {
  devolucion_id: string;
  team_member_id: string;
  rol: string;
  importe: number;          // negativo
  persona_nombre: string;
  fecha_devolucion: string;
  fecha_venta: string | null;
};

export type CobroElegible = {
  pago_id: string;
  fecha: string;
  monto: number;
  usd_recibido: number | null;
  tipo: string;
  programa_id: string | null;
  ya_devuelto_usd: number;
};

export type DevolucionResult = { ok: true; mensaje: string } | { ok: false; error: string };

export type ProgramaElegible = {
  programa_id: string;
  tier: string | null;
  monto: number | null;
  motivo: string | null;
  fecha_inicio: string;
};
