"use client";
import { useState } from "react";
import Modal from "@/components/Modal";

// El botón "Ver" de /contratos abría `/api/contratos/<id>` en una pestaña
// nueva. Pedido de Patricio (8-sep): que se vea sin salir del OS. La ruta ya
// sirve el PDF `inline` con la sesión del usuario, así que un <iframe> normal
// alcanza — el bucket es privado pero el navegador manda las mismas cookies
// que al resto del OS.
// `firmado` elige CUÁL de los dos PDF se abre. Son dos ficheros distintos
// (0065): el que se generó y el que quedó con la firma del cliente. Desde que
// existe el segundo, "Ver" a secas sería ambiguo justo en las filas que más
// se miran, así que el botón se llama distinto y el modal también — el equipo
// tiene que poder decir cuál está viendo sin abrir el PDF y buscar la firma.
export default function ContratoPreview({ id, firmado = false }: { id: string; firmado?: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const titulo = firmado ? "Contrato firmado" : "Contrato";

  return (
    <>
      <button type="button" className="linkbtn" onClick={() => setAbierto(true)}>
        {firmado ? "Ver firmado" : "Ver"}
      </button>
      {abierto && (
        <Modal titulo={titulo} ancho="grande" onCerrar={() => setAbierto(false)}>
          <iframe
            src={`/api/contratos/${id}${firmado ? "?firmado=1" : ""}`}
            title={titulo}
            style={{ width: "100%", height: "88vh", border: "none" }}
          />
        </Modal>
      )}
    </>
  );
}
