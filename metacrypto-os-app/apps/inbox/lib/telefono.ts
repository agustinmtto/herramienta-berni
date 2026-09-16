// Normalización de teléfonos. Existe porque el mismo número viaja en dos
// formatos por el sistema y eso ya rompió dos cosas:
//   · Kapso manda el wa_id en dígitos       → "56961111666"
//   · `personas` guarda E.164 con el prefijo → "+56961111666"
// El cruce entre ambos se hacía por igualdad exacta, así que nunca encontraba
// al cliente (los 92 con teléfono lo tienen con "+"). Ver wa-ingest.

/** Dígitos del número, sin +, espacios ni separadores. Clave canónica del hilo. */
export function soloDigitos(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\D/g, "");
}

/** Las dos formas del mismo número, para buscar en tablas que no comparten formato. */
export function variantesE164(raw: string | null | undefined): string[] {
  const d = soloDigitos(raw);
  return d ? [`+${d}`, d] : [];
}

/**
 * Forma canónica para GUARDAR en `personas.telefono_e164`: "+" y dígitos.
 *
 * Existe porque ese campo es la llave de cruce de medio sistema (el inbox
 * busca por él, el envío de plantillas busca por él) y lo que llega de fuera
 * no viene canónico: GoHighLevel devuelve el teléfono tal cual lo tecleó
 * quien creó el contacto — con espacios, guiones o paréntesis, y a veces con
 * el prefijo internacional escrito "00" en vez de "+". Escribir eso crudo
 * deja un valor que ningún cruce posterior encuentra, y encima parece
 * correcto a simple vista.
 *
 * Devuelve `null` cuando no queda un número utilizable: menos de 8 dígitos no
 * es un número internacional (prefijo de país + abonado), es basura o una
 * extensión, y guardarla sería peor que dejar el hueco vacío.
 */
export function aE164(raw: string | null | undefined): string | null {
  let d = soloDigitos(raw);
  // "0034657…" → "34657…". El "00" es el prefijo internacional a la europea;
  // dejarlo daría "+0034657…", que no cruza con nada ni es E.164 válido.
  if (d.startsWith("00")) d = d.slice(2);
  return d.length >= 8 ? `+${d}` : null;
}
