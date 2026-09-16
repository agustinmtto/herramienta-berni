// ============================================================
// La firma que se estampa en el PDF del contrato.
//
// 🔴 EN ESTE REPOSITORIO NO ESTÁ LA FIRMA DE VERDAD, Y ES A PROPÓSITO.
//
// La original es un PNG de la firma manuscrita del fundador. Quien tenga esos
// bytes puede estampar su firma en cualquier documento, y eso no es un secreto
// que se pueda rotar: una vez fuera, está fuera para siempre. Por eso aquí vive
// un trazo de relleno y la de verdad entra por variable de entorno, solo en
// producción.
//
// PARA DESARROLLAR NO HACE FALTA HACER NADA: sin la variable, el contrato se
// genera igual y sale con la raya de relleno. Todo lo demás del documento —el
// texto, los datos, el hash, la firma del cliente— funciona exactamente igual.
//
// En producción: `CONTRATO_FIRMA_PNG_BASE64` con el PNG en base64, sin el
// prefijo `data:image/png;base64,`.
//
// Es una FUNCIÓN y no una constante a propósito: una constante se evaluaría al
// importar el módulo, y entonces el valor dependería del orden de los imports
// en vez de del entorno en el momento de usarla. Los tests necesitan poder
// ponerla y quitarla.
// ============================================================

/** Trazo de relleno: PNG válido de 240×60 con una línea de firma. 200 bytes. */
const RELLENO =
  "iVBORw0KGgoAAAANSUhEUgAAAPAAAAA8CAIAAADXHaAKAAAAj0lEQVR42u3WQQ0AAAgDMWTjHlTwGa0EcsmogSDlBAgaBA2CBkEjaBA0CBoEDYJG0CBoEDQIGgSNoEHQIGgQNAgaQYOgQdAgaBA0ggZBg6BB0CBoBA2CBkGDoEHQCBoEDYIGQSNoEDQIGgQNguZr0A1BBE1W0EYKPzQIGgQNgkbQIGgQNAgaBI2gQdAgaLiwsJwpjOQocewAAAAASUVORK5CYII=";

export function firmaPngBase64(): string {
  return process.env.CONTRATO_FIRMA_PNG_BASE64 || RELLENO;
}
