// Development-only PDF generator — docs/03 says the final deliverable path
// is email with the business stack (Resend). For now we build the exact
// on-screen sheet client-side so the design can be refined without email.
import { wizardConfig } from "./question-config";

export async function downloadDiagnosisPdf() {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);

  const node = document.getElementById("diagnosis-sheet");
  if (!node) return;

  const canvas = await html2canvas(node, {
    backgroundColor: "#000000",
    scale: 2,
    useCORS: true,
    windowWidth: node.scrollWidth,
  });

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const imgW = pageW;
  const imgH = (canvas.height * imgW) / canvas.width;
  const img = canvas.toDataURL("image/jpeg", 0.92);

  let offset = 0;
  while (offset < imgH) {
    if (offset > 0) pdf.addPage();
    pdf.addImage(img, "JPEG", 0, -offset, imgW, imgH);
    offset += pageH;
  }

  pdf.save(`diagnostico-${slug(wizardConfig.brand.name)}.pdf`);
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
