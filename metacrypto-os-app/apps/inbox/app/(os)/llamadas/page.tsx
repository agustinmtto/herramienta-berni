import { requireModulo } from "@/lib/guard";
import { rest } from "@/lib/supabase";
import { getLlamadas } from "@/lib/fathom-datos";
import LlamadasFathom from "@/components/LlamadasFathom";

export const dynamic = "force-dynamic";

// Módulo `sesiones` y no uno nuevo: esta pantalla existe para convertir
// llamadas en sesiones, que es trabajo del servicio. Así Manuel e Iker la ven
// sin que nadie tenga que acordarse de conceder un permiso más.
//
// Las llamadas de VENTA también salen aquí, y es deliberado: son las que Berni
// pidió poder asociar a cada cliente, no enseñan ni un importe, y separarlas en
// otra pantalla obligaba a mirar en dos sitios lo que es la misma bandeja.
const MODULO = "sesiones" as const;

export default async function LlamadasPage() {
  await requireModulo(MODULO);

  const [llamadas, rClientes] = await Promise.all([
    getLlamadas(),
    // Para el desplegable de emparejar a mano. Solo id y nombre: no hace falta
    // nada más y así la lista de 200 clientes no pesa.
    rest<{ id: string; nombre: string | null }[]>(
      "GET",
      "personas?select=id,nombre&order=nombre&limit=2000",
    ),
  ]);
  const clientes = Array.isArray(rClientes.json) ? rClientes.json : [];

  const sinCliente = llamadas.filter((l) => !l.persona_id && !l.descartada_at).length;
  const porRegistrar = llamadas.filter(
    (l) => l.tipo === "servicio" && l.persona_id && !l.sesion_id && !l.descartada_at,
  ).length;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Llamadas</h1>
        <span className="hint">
          {llamadas.length === 0
            ? "todavía no hay ninguna"
            : `${porRegistrar} por registrar · ${sinCliente} sin cliente`}
        </span>
      </div>

      <p className="hint" style={{ marginBottom: 16, maxWidth: "68ch" }}>
        Lo que Fathom grabó, con su resumen. Se refresca solo cada 15 minutos. Las reuniones
        internas del equipo no salen: solo las llamadas que tuvieron a alguien de fuera.
      </p>

      <LlamadasFathom llamadas={llamadas} clientes={clientes} />
    </div>
  );
}
