// La plantilla v2 del contrato de venta nueva. Nace en este repo (decisión de
// Milo, 15-sep): la cláusula 1 se compone desde `tiers` en `datosContrato`, y
// eso solo lo entiende el OS. Las dos plantillas generadas desde el cockpit
// (`plantillas.ts`) se quedan para regenerar los contratos ya emitidos.
//
// Texto pendiente de aprobación de Berni y Paula. Lo que cambia respecto a la
// vigente: la cláusula 1 entera pasa a ser `{{prestaciones}}`, y con ella se
// van de este fichero los números a mano ("1 sesión", "4 consultorías"),
// "Manuel" y "coach". El texto que los sustituye — "el consultor de turno", el
// plan de acción como entregable propio, "grupales" en los directos — lo
// compone el catálogo, no esta plantilla. Y "Fecha de emisión" en vez de
// "Fecha de firma" en el bloque de firma, porque el PDF nace sin firmar y la
// fecha real de la firma va en la evidencia.
//
// Las cláusulas 2 a 9 son copia literal de `PLANTILLAS.venta_nueva`: no se toca
// una letra sin pasar por Paula, y `plantilla-v2.test.ts` las compara carácter
// a carácter contra el original.

// El cuerpo que el closer ve y puede editar antes de enviar. NO lleva bloque de
// firma: ese lo añade el renderer desde `BLOQUE_FIRMA`, para que nadie pueda
// borrar sin querer la línea donde firma el cliente.
//
// Acaba en la cláusula 9, con la línea en blanco donde en la plantilla
// vigente empezaba el bloque de firma: es un corte literal, no un requisito.
// El renderer no pega las dos mitades en un solo texto: parte cada una por su
// cuenta con `bloques()` (contrato-pdf.ts), que hace `.trim()`, así que el
// espacio del final le da igual. Y las parte aparte a propósito: la línea
// "Firma digital:" de este bloque se pinta con la firma del cliente, mientras
// que la que las plantillas v1 traen dentro de su cuerpo se queda como estaba.
export const PLANTILLA_VENTA_NUEVA_V2 = `CONTRATO DE PRESTACIÓN DE SERVICIOS FORMATIVOS

Entre:

METACRYPTO CLUB, en adelante “EL INSTRUCTOR”,

y

Nombre del cliente: {{cliente_nombre}}

en adelante “EL CLIENTE”,

se celebra el presente contrato de prestación de servicios formativos, conforme a las siguientes
cláusulas:

### 1. Objeto

EL INSTRUCTOR se compromete a proporcionar a EL CLIENTE:

{{prestaciones}}

{{bonos}}

### 2. Naturaleza del Servicio

El presente contrato tiene carácter estrictamente formativo y educativo, no constituyendo
asesoramiento financiero, fiscal, ni recomendación de inversión.

EL CLIENTE declara comprender que toda decisión de inversión derivada del contenido del programa
será de su exclusiva responsabilidad.

### 3. Precio y Forma de Pago

EL CLIENTE abonará a EL INSTRUCTOR la cantidad total de {{importe_total}}€.

Método de pago: {{metodo_pago}}.

- {{forma_pago}}

El incumplimiento o retraso superior a 15 días naturales en el pago de cualquiera de las cuotas
autoriza a EL INSTRUCTOR a suspender temporalmente el acceso a los servicios hasta la
regularización.

### 4. Política de Reembolso

EL CLIENTE podrá solicitar un reembolso total dentro de los 15 días naturales siguientes a la
compra, siempre que no haya consumido más del 20% del contenido.

Fuera de dicho plazo o si se excede el límite de acceso, no se admitirán devoluciones por ningún
motivo.

### 5. Programa de Referidos

Todo cliente que refiera a un nuevo participante y este formalice la compra de un programa tendrá
derecho a percibir una comisión, cuya modalidad podrá elegir libremente entre las dos opciones
siguientes, no siendo estas acumulables entre sí:

a) Comisión en efectivo: el 10% sobre el importe neto efectivamente cobrado por la venta generada.

b) Comisión en forma de descuento (“canje”): el 20% sobre el importe neto efectivamente cobrado por
la venta generada, aplicable como descuento sobre el precio total del siguiente programa al que el
cliente referente desee ascender. Este descuento deberá canjearse en un plazo máximo de 6 meses
desde la fecha de generación de la comisión, transcurrido el cual quedará sin efecto, sin derecho a
compensación alguna.

### 6. Obligaciones del CLIENTE

EL CLIENTE se compromete a:

a) Participar activamente en el programa y comunidad.

b) Mantener un comportamiento ético y respetuoso dentro de los canales oficiales.

c) No compartir, revender, divulgar o hacer uso indebido del contenido.

d) Asumir la total responsabilidad de sus decisiones de inversión.

### 7. Limitación de Responsabilidad

EL INSTRUCTOR no será responsable por pérdidas financieras, decisiones de inversión ni fluctuaciones
de mercado derivadas del uso de la información impartida.

La responsabilidad de EL INSTRUCTOR se limita estrictamente a la correcta prestación de los
servicios formativos contratados.

### 8. Propiedad Intelectual y Confidencialidad

Todo el contenido del programa, incluyendo materiales, grabaciones, textos y documentación, es
propiedad exclusiva de EL INSTRUCTOR y está protegido por las leyes de propiedad intelectual.

EL CLIENTE se obliga a mantener la confidencialidad absoluta del contenido, no pudiendo divulgar,
reproducir o distribuir el material bajo ningún formato sin autorización expresa y escrita del
INSTRUCTOR.

### 9. Aceptación

Ambas partes declaran haber leído y comprendido la totalidad del presente contrato, aceptando
expresamente todas sus cláusulas.

`;

// El bloque que el sistema añade al final. NO se edita en la previsualización
// y NO se guarda en `texto_final`: se rellena al renderizar con
// `contratos.datos_bloque` (+ la firma del cliente cuando la haya).
//
// `{{firma_cliente}}` y `{{firma_evidencia}}` van vacíos hasta que el cliente
// firma; el renderer los sustituye por una línea de firma en blanco para que el
// PDF sin firmar siga siendo legible.
export const BLOQUE_FIRMA = `Fecha de emisión del contrato: {{fecha_firma}}.

Firmado electrónicamente por ambas partes

EL INSTRUCTOR

METACRYPTO CLUB

![firma del fundador](../firma-fundador.png)

Firma autorizada:

Fundador — MetaCrypto Club

EL CLIENTE

Nombre y apellidos: {{cliente_nombre}}

Firma digital: {{firma_cliente}}

{{firma_evidencia}}`;
