// Generador de PDF solo para desarrollo — docs/03 dice que la entrega final
// va por email con el stack del negocio (Resend). Por ahora generamos
// client-side la misma hoja que se ve en pantalla, para pulir el diseño
// sin depender del email.
import { wizardConfig } from "./question-config";

// Convierte el nodo #diagnosis-document ("diagnosis-document.jsx") a imagen
// con html2canvas y lo vuelca en un PDF A4 multi-página con jsPDF.
export async function downloadDiagnosisPdf(name) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"), // lazy: no cargan hasta que el lead pide el PDF
    import("jspdf"),
  ]);

  const node = document.getElementById("diagnosis-document");
  if (!node) return;

  // Espera a que la tipografía esté lista para no rasterizar fuentes a medias.
  if (document.fonts?.ready) await document.fonts.ready;

  // Snapshot de la hoja a canvas (escala 2 para nitidez al imprimir).
  const canvas = await html2canvas(node, {
    backgroundColor: "#000000",
    scale: 2,
    useCORS: true,
    windowWidth: node.scrollWidth,
  });

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 8;
  const printableH = pageH - margin * 2;
  const imgW = pageW - margin * 2;
  const imgH = (canvas.height * imgW) / canvas.width; // imagen escalada al ancho de página
  const img = canvas.toDataURL("image/jpeg", 0.92);

  // Si la hoja es más alta que una página, reparte en tandas verticales.
  let offset = 0;
  while (offset < imgH) {
    if (offset > 0) pdf.addPage();
    pdf.addImage(img, "JPEG", margin, margin - offset, imgW, imgH);
    offset += printableH;
  }

  // Nombre de archivo seguro: slugify quita espacios/acentos/raros (anti-inyección en filename).
  pdf.save(`diagnostico-${slug(name || wizardConfig.brand.name)}.pdf`);
}

// Convierte un string a slug de archivo: minúsculas, sin acentos, solo a-z0-9 y guiones.
function slug(s) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
