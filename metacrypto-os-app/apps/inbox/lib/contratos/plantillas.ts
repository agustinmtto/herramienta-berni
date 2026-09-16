// ⚠️ ARCHIVO GENERADO — no editar a mano.
// Sale de `metacrypto-club-cockpit/contratos/exportar-a-repo.mjs`, que lo
// construye desde los .md de ese repo. Para cambiar el texto de un contrato se
// edita el .md y se vuelve a correr el script; editar aquí hace que las dos
// copias digan cosas distintas y la que se le manda al cliente es esta.

export type TipoContrato = "venta_nueva" | "ampliacion";

export const PLANTILLAS: Record<TipoContrato, string> = {
  venta_nueva: `CONTRATO DE PRESTACIÓN DE SERVICIOS FORMATIVOS

Entre:

METACRYPTO CLUB, en adelante “EL INSTRUCTOR”,

y

Nombre del cliente: {{cliente_nombre}}

en adelante “EL CLIENTE”,

se celebra el presente contrato de prestación de servicios formativos, conforme a las siguientes
cláusulas:

### 1. Objeto

EL INSTRUCTOR se compromete a proporcionar a EL CLIENTE:

a) Acceso vitalicio al contenido grabado del programa formativo “Metacrypto Club”.

b) Acceso a las sesiones en directo de Berni y Manuel durante un período inicial de
{{duracion_meses}} meses a partir de la activación del programa

c) Acceso a 1 sesión de consultoría  privada 1 a 1 con Berni, agendables según disponibilidad mutua.

d) Un chat privado con el coach del Club a través de Whatsapp durante un período inicial de
{{duracion_meses}} meses + 4 consultorías con el coach 1 a 1.

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

Fecha de firma del contrato: {{fecha_firma}}.

Firmado electrónicamente por ambas partes

EL INSTRUCTOR

METACRYPTO CLUB

![firma del fundador](../firma-fundador.png)

Firma autorizada:

Fundador — MetaCrypto Club

EL CLIENTE

Nombre y apellidos: {{cliente_nombre}}

Firma digital:`,
  ampliacion: `CONTRATO DE AMPLIACIÓN DE SERVICIOS FORMATIVOS

Entre:

METACRYPTO CLUB, en adelante “EL INSTRUCTOR”,

y

Nombre del cliente: {{cliente_nombre}}

en adelante “EL CLIENTE”,

se celebra el presente contrato de ampliación de servicios formativos, como complemento y extensión
al contrato original firmado previamente, conforme a las siguientes cláusulas:

### 1. Objeto

EL CLIENTE, habiendo completado previamente el programa de {{programa_previo_importe}}€, acuerda la
ampliación al programa de {{programa_nuevo_importe}}€, incorporando los siguientes accesos y
beneficios adicionales, por {{duracion_meses}} meses extra a lo que ya tenía:

a) Acceso vitalicio a la Formación.

b) Acceso a las sesiones en directo de los domingos durante {{duracion_meses}} meses.

c) Coach 1 a 1 con seguimiento por WhatsApp durante {{duracion_meses}} meses.

d) 4 consultorías 1 a 1 con el Coach.

e) 1 consultoría 1 a 1 con Berni.

f) Acceso al Discord privado con los movimientos de Berni durante {{duracion_meses}} meses.

{{bonos}}

### 2. Período de Vigencia

Fecha de inicio: {{fecha_inicio}}

Fecha de finalización: {{fecha_fin}}

### 3. Naturaleza del Servicio

El presente contrato tiene carácter estrictamente formativo y educativo, no constituyendo
asesoramiento financiero, fiscal, ni recomendación de inversión.

EL CLIENTE declara comprender que toda decisión de inversión derivada del contenido del programa
será de su exclusiva responsabilidad.

### 4. Precio y Forma de Pago

EL CLIENTE, habiendo adquirido previamente el programa de {{programa_previo_importe}}€, acuerda la
ampliación al programa de {{programa_nuevo_importe}}€, abonando la diferencia correspondiente:

Importe de la ampliación: {{importe_ampliacion}}€ {{calendario_cuotas}}.

Método de pago: {{metodo_pago}}.

Pago en {{n_cuotas}} cuotas.

El incumplimiento o retraso superior a 15 días naturales en el pago de cualquiera de las cuotas
autoriza a EL INSTRUCTOR a suspender temporalmente el acceso a los servicios hasta la
regularización.

### 5. Política de Reembolso

EL CLIENTE podrá solicitar un reembolso total dentro de los 15 días naturales siguientes a la firma
del presente contrato de ampliación, siempre que no haya hecho uso de los nuevos accesos
incorporados.

Fuera de dicho plazo o si se han utilizado los nuevos servicios, no se admitirán devoluciones por
ningún motivo.

### 6. Programa de Referidos

Todo cliente que refiera nuevos participantes que formalicen la compra del programa recibirá una
comisión del 20% sobre el importe neto efectivamente cobrado.

El pago de dicha comisión se realizará en un plazo máximo de 30 días naturales posteriores a la
confirmación del pago del nuevo alumno, mediante el método acordado.

### 7. Obligaciones del Cliente

EL CLIENTE se compromete a:

a) Participar activamente en el programa y comunidad.

b) Mantener un comportamiento ético y respetuoso dentro de los canales oficiales.

c) No compartir, revender, divulgar o hacer uso indebido del contenido.

d) Asumir la total responsabilidad de sus decisiones de inversión.

### 8. Limitación de Responsabilidad

EL INSTRUCTOR no será responsable por pérdidas financieras, decisiones de inversión ni fluctuaciones
de mercado derivadas del uso de la información impartida.

La responsabilidad de EL INSTRUCTOR se limita estrictamente a la correcta prestación de los
servicios formativos contratados.

### 9. Propiedad Intelectual y Confidencialidad

Todo el contenido del programa, incluyendo materiales, grabaciones, textos y documentación, es
propiedad exclusiva de EL INSTRUCTOR y está protegido por las leyes de propiedad intelectual.

EL CLIENTE se obliga a mantener la confidencialidad absoluta del contenido, no pudiendo divulgar,
reproducir o distribuir el material bajo ningún formato sin autorización expresa y escrita del
INSTRUCTOR.

### 10. Aceptación

Ambas partes declaran haber leído y comprendido la totalidad del presente contrato, aceptando
expresamente todas sus cláusulas.

Fecha de firma del contrato: {{fecha_firma}}.

Firmado electrónicamente por ambas partes

EL INSTRUCTOR

METACRYPTO CLUB

![firma del fundador](../firma-fundador.png)

Firma autorizada:

Fundador — MetaCrypto Club

EL CLIENTE

Nombre y apellidos: {{cliente_nombre}}

Firma digital:`,
};
