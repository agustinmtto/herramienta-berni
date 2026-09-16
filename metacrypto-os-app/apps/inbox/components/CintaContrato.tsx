import type { CintaContrato as Cinta } from "@/lib/contrato-datos";

/**
 * La cinta de la esquina superior derecha de una fila de contrato, con su globo
 * al apuntar. Dorada = "este es el PDF corregido". Roja = "hay que corregirlo":
 * alguien cambió los bonos después de emitirlo y el PDF que tiene el equipo ya
 * no coincide.
 *
 * "Editado a mano" (0065, `texto_editado_at`) reutiliza el color dorado —no
 * es una alerta, es información— y solo cambia título y texto: alguien tocó
 * `texto_final` a mano y "Recorregir" lo pisaría.
 *
 * Vive aquí y no dentro de /contratos porque la pintan DOS pantallas: la
 * pestaña de Contratos y el bloque "Contratos" de la ficha del cliente. Y la
 * ficha importa más de las dos: es donde está alguien justo cuando edita los
 * bonos, o sea en el momento exacto en que un contrato se queda viejo. La
 * pestaña se mira después, si a alguien se le ocurre mirarla.
 *
 * Cuál de las tres manda lo decide `cintaContrato()` por precedencia
 * (desactualizado > editado > recorregido), sin comparar fechas entre sí;
 * aquí solo se pinta. El porqué de los dos colores y del `:hover` sin
 * JavaScript está en globals.css, junto a las reglas, para que no diverjan.
 *
 * Quién decide si hay cinta y cuál es `cintaDeFila()` en lib/contrato-datos.ts
 * — es una regla, no un pixel, y allí la cubren los tests. Aquí solo se pinta.
 */
export default function CintaContrato({ cinta }: { cinta: Cinta }) {
  const esRoja = cinta.tipo === "desactualizado";
  const titulo = cinta.tipo === "desactualizado" ? "Desactualizado" : cinta.tipo === "editado" ? "Editado a mano" : "Recorregido";
  const texto =
    cinta.tipo === "desactualizado"
      ? `Se cambiaron los bonos el ${cinta.fecha} y este PDF todavía es el anterior. Hay que revisarlo.`
      : cinta.tipo === "editado"
        ? `El texto se editó a mano el ${cinta.fecha}. Recorregir desde los datos pisaría esa edición: cámbialo desde Editar.`
        : `Este es el PDF recorregido el ${cinta.fecha}.`;
  return (
    <span
      className={`marca-cinta ${esRoja ? "roja" : "dorada"}`}
      tabIndex={0}
      role="note"
      aria-label={`${titulo}. ${texto}`}
    >
      <span className="cinta" />
      <span className="globo">
        <span className="tit">{titulo}</span>
        <span className="txt">{texto}</span>
      </span>
    </span>
  );
}
