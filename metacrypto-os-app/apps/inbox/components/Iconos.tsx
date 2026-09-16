// Íconos SVG inline que reemplazan emojis sueltos en la UI (Patricio: nada de
// emoji, se ven baratos). `stroke=currentColor` para heredar el color del
// texto que los rodea, igual que el ícono de landing en ClientesTabla.
import type { SVGProps } from "react";

type Props = SVGProps<SVGSVGElement> & { size?: number };

const Base = ({ size = 14, className, children, ...rest }: Props) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
       className={`mc-icono${className ? ` ${className}` : ""}`} {...rest}>
    {children}
  </svg>
);

export const IconoLink = (p: Props) => (
  <Base {...p}>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <path d="M15 3h6v6" />
    <path d="M10 14 21 3" />
  </Base>
);

export const IconoCheck = (p: Props) => (
  <Base {...p}><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></Base>
);

export const IconoAlerta = (p: Props) => (
  <Base {...p}><path d="M12 3 2 20h20L12 3Z" /><path d="M12 10v4M12 17h.01" /></Base>
);

export const IconoClip = (p: Props) => (
  <Base {...p}><path d="M8 12V6a4 4 0 0 1 8 0v9a3 3 0 0 1-6 0V7" /></Base>
);

export const IconoPersona = (p: Props) => (
  <Base {...p}><circle cx="12" cy="8" r="3.5" /><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" /></Base>
);

export const IconoArchivo = (p: Props) => (
  <Base {...p}><path d="M7 3h7l4 4v14H7Z" /><path d="M14 3v4h4M9 13h6M9 17h6" /></Base>
);

export const IconoPin = (p: Props) => (
  <Base {...p}><path d="M12 21s7-6.3 7-11.5a7 7 0 1 0-14 0C5 14.7 12 21 12 21Z" /><circle cx="12" cy="9.5" r="2.2" /></Base>
);

export const IconoCampana = (p: Props) => (
  <Base {...p}><path d="M6 10a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 14 6 10Z" /><path d="M10 19a2 2 0 0 0 4 0" /></Base>
);

export const IconoPortapapeles = (p: Props) => (
  <Base {...p}><rect x="6" y="4" width="12" height="17" rx="1.5" /><path d="M9 4a3 3 0 0 1 6 0" /><path d="M9 10h6M9 14h6" /></Base>
);

export const IconoMic = (p: Props) => (
  <Base {...p}><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></Base>
);

export const IconoStop = (p: Props) => (
  <Base {...p}><rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none" /></Base>
);

export const IconoGrabacion = (p: Props) => (
  <Base {...p}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M10 9v6l5-3Z" /></Base>
);

export const IconoVideoSala = (p: Props) => (
  <Base {...p}><rect x="2" y="6" width="14" height="12" rx="2" /><path d="m16 10 6-3v10l-6-3Z" /></Base>
);

export const IconoReciclar = (p: Props) => (
  <Base {...p}><path d="M4 12a8 8 0 0 1 13.6-5.7M20 12a8 8 0 0 1-13.6 5.7" /><path d="M14 3.5 17.6 6.3 14 8.5M10 20.5 6.4 17.7 10 15.5" /></Base>
);

export const IconoX = (p: Props) => (
  <Base {...p}><circle cx="12" cy="12" r="9" /><path d="m9 9 6 6M15 9l-6 6" /></Base>
);
