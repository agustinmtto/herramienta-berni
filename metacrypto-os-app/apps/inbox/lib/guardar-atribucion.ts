// Guarda la atribución DESPUÉS de crear la venta, con `crear_venta` intacta.
// El RPC ya devuelve `programa_id` y `pago_id`; con esos dos ids basta.

export type Atribucion = {
  sourceId: string | null;
  setterId: string | null;
  closerId: string | null;
  upsellPorId: string | null;
  ghlAppointmentId: string | null;
  decidido: boolean;
};

const oNull = (v: string | null | undefined): string | null => (v ? v : null);

// Lógica pura: del objeto del formulario al parche de PostgREST.
export function parcheDeAtribucion(a: Atribucion): Record<string, unknown> {
  return {
    source_id: oNull(a.sourceId),
    setter_id: oNull(a.setterId),
    closer_id: oNull(a.closerId),
    upsell_por_id: oNull(a.upsellPorId),
    ghl_appointment_id: oNull(a.ghlAppointmentId),
    // Se sella si hubo DECISIÓN, aunque la decisión sea "no vino de agenda".
    atribucion_at: a.decidido ? new Date().toISOString() : null,
  };
}

type Rest = (m: string, path: string, body?: unknown, prefer?: string) =>
  Promise<{ status: number; json: unknown }>;

// Genera el parche de atribución condicionado a si el pago se ató exitosamente.
// CRÍTICO: no sellamos `atribucion_at` si no atamos el pago. Si lo selláramos
// sin atar, la venta desaparecería de la bandeja de pendientes aunque no pueda
// generar comisión (porque `pagos.programa_id` nunca se enlazó). La bandeja es
// la red cuando algo falla; no la perforemos.
function parcheDeAtribucionCondicionado(
  a: Atribucion,
  pagoAtadoExitosamente: boolean,
): Record<string, unknown> {
  const parche = {
    source_id: oNull(a.sourceId),
    setter_id: oNull(a.setterId),
    closer_id: oNull(a.closerId),
    upsell_por_id: oNull(a.upsellPorId),
    ghl_appointment_id: oNull(a.ghlAppointmentId),
  };

  // Solo sellamos si el pago se ató exitosamente. Si falló, dejamos el campo
  // en null para que la venta siga en la bandeja de revisión.
  if (pagoAtadoExitosamente && a.decidido) {
    return { ...parche, atribucion_at: new Date().toISOString() };
  }

  return { ...parche, atribucion_at: null };
}

// Ata UN pago a su venta. Devuelve true solo si PostgREST confirma que tocó
// una fila de verdad.
//
// `status < 300` NO basta: sin `Prefer: return=representation`, un PATCH
// responde 204 "No Content" tanto si actualizó una fila como si el filtro no
// casó con ninguna (p.ej. un `pagoId` que ya no existe). Es la misma forma
// del fallo silencioso que ya mordió al cron que devolvía `{ok:true}` sin
// haber escrito nada. Se pide la fila de vuelta y se cuenta: un array vacío
// es un fallo, no un éxito con cero trabajo.
async function atarPago(programaId: string, pagoId: string, rest: Rest): Promise<boolean> {
  try {
    const r = await rest(
      "PATCH",
      `pagos?id=eq.${pagoId}`,
      { programa_id: programaId },
      "return=representation",
    );
    return r.status < 300 && Array.isArray(r.json) && r.json.length > 0;
  } catch (e) {
    console.error("[atribucion] no se pudo atar el pago a su venta", pagoId, e);
    return false;
  }
}

// Ata el/los pago(s) a su venta y guarda la atribución. NO lanza: la venta ya
// está cobrada y no se puede deshacer por un fallo de contabilidad. Devuelve
// si cada mitad salió, para que quien llama lo registre.
//
// `pagoId` acepta uno o varios: la corrección desde /atribucion (venta que
// YA tenía uno o más pagos con `programa_id` puesto) reatribuye la venta
// entera, no un pago suelto. El sellado exige que TODOS se hayan atado —
// basta uno huérfano para que la venta siga en la bandeja, que es
// exactamente la garantía que esto existe para dar.
export async function guardarAtribucion(
  programaId: string, pagoId: string | string[], a: Atribucion, rest: Rest,
): Promise<{ pagoAtado: boolean; atribucionGuardada: boolean }> {
  const pagoIds = Array.isArray(pagoId) ? pagoId : [pagoId];

  // Paso 1: atar cada pago (CRÍTICO). Sin pagos que atar no hay nada que
  // confirmar — no se inventa un éxito vacío.
  let pagoAtado = pagoIds.length > 0;
  for (const id of pagoIds) {
    if (!(await atarPago(programaId, id, rest))) pagoAtado = false;
  }

  // Paso 2: guardar el resto de atribución, pero solo sella `atribucion_at`
  // si TODOS los pagos del paso 1 se ataron. De lo contrario, la venta se
  // queda en bandeja.
  let atribucionGuardada = false;
  try {
    const parche = parcheDeAtribucionCondicionado(a, pagoAtado);
    const r = await rest("PATCH", `programas?id=eq.${programaId}`, parche);
    atribucionGuardada = r.status < 300;
  } catch (e) {
    console.error("[atribucion] no se pudo guardar la atribución", e);
  }

  return { pagoAtado, atribucionGuardada };
}
