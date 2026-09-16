import { estadoWa } from "@/lib/wa-estado";

// Aviso global de canal caído. Va en el layout del OS, no en el inbox, porque
// WhatsApp no sale solo del inbox: la bienvenida se dispara desde la ficha del
// cliente y las confirmaciones y recordatorios salen de los crons. Si el aviso
// viviera solo en /inbox, quien entra por /clientes no se enteraría.
//
// No se puede cerrar a propósito. El incidente del 2-sep-2026 duró tres horas
// precisamente porque nada en la pantalla decía que el canal estaba muerto.
export default function AvisoWaCaido() {
  const wa = estadoWa();
  if (!wa.bloqueado) return null;
  return (
    <div className="aviso-wa-caido" role="status">
      <strong>WhatsApp está caído.</strong> {wa.motivo}
    </div>
  );
}
