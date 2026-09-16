import { describe, it, expect } from "vitest";
import {
  tipoContratoDe,
  importe,
  fecha,
  fechaLarga,
  fechaFin,
  formaPago,
  calendarioCuotas,
  datosContrato,
  parrafoBonos,
  cintaContrato,
  cintaDeFila,
} from "../contrato-datos";

describe("tipoContratoDe", () => {
  it("mapea los dos tipos que tienen plantilla", () => {
    // Desde el 16-sep-2026 las ventas nuevas van con la plantilla v2, la que se
    // firma en el OS. `venta_nueva` se queda para regenerar las anteriores.
    expect(tipoContratoDe("nueva")).toBe("venta_nueva_v2");
    expect(tipoContratoDe("ascension")).toBe("ampliacion");
  });

  // Decisión de Patricio del 7-sep: `extension` (renovación) no tiene plantilla
  // ni PDF de ejemplo. Devuelve null y quien llama avisa — no lanza, porque una
  // extensión sin contrato no puede romper una venta ya cobrada.
  it("devuelve null para extensión, que no tiene plantilla", () => {
    expect(tipoContratoDe("extension")).toBeNull();
  });

  it("devuelve null para cualquier cosa que no conozca", () => {
    expect(tipoContratoDe("")).toBeNull();
    expect(tipoContratoDe("inventado")).toBeNull();
  });
});

describe("importe — el € lo pone la plantilla, no esto", () => {
  it("sin decimales cuando son cero, como en los contratos reales", () => {
    expect(importe(8000)).toBe("8.000");
    expect(importe("3000.00")).toBe("3.000");
    expect(importe(500)).toBe("500");
  });

  // Dos decimales, no uno: "2.500,5€" en un contrato se lee como un importe a
  // medio escribir. Es el mismo criterio que `money()` en lib/format.ts:60-61.
  it("con dos decimales cuando los hay", () => {
    expect(importe(2500.5)).toBe("2.500,50");
    expect(importe("1250.75")).toBe("1.250,75");
  });

  // 🔴 El español agrupa a partir de 5 dígitos, no de 4: sin `useGrouping:
  // "always"` esto devolvía "8000" y el contrato aprobado dice "8.000".
  it("agrupa los miles también en importes de 4 dígitos", () => {
    expect(importe(8000)).toBe("8.000");
    expect(importe(1500)).toBe("1.500");
    expect(importe(12000)).toBe("12.000");
  });

  it("no lleva símbolo de moneda: la plantilla ya escribe el € al lado", () => {
    expect(importe(8000)).not.toContain("€");
  });
});

describe("fechas", () => {
  it("la de firma va en dígitos", () => {
    expect(fecha("2026-09-07")).toBe("07/09/2026");
  });

  it("la de vigencia va con el mes en palabras, como en el original de esa clienta", () => {
    expect(fechaLarga("2026-08-01")).toBe("1 de agosto de 2026");
  });

  // 🔴 El bug que `lib/format.ts:80-89` ya pagó una vez: sin timeZone UTC, en
  // America/Santiago (UTC−4) una fecha de calendario se corre al día anterior.
  // En un contrato eso es una fecha de firma equivocada.
  it("no se corre de día según la zona horaria de quien la genera", () => {
    const tz = process.env.TZ;
    process.env.TZ = "America/Santiago";
    expect(fecha("2026-09-07")).toBe("07/09/2026");
    expect(fechaLarga("2026-08-01")).toBe("1 de agosto de 2026");
    process.env.TZ = tz;
  });

  it("fechaFin suma los meses del programa", () => {
    expect(fechaFin("2026-08-01", 12)).toBe("1 de agosto de 2027");
    expect(fechaFin("2026-09-07", 9)).toBe("7 de junio de 2027");
  });

  // 🔴 Lo encontró el revisor. `setUTCMonth` desborda cuando el mes destino es
  // más corto que el de origen: del 31 de enero + 1 mes salía "3 de marzo",
  // porque el 31 de febrero no existe y JS lo pasa al mes siguiente. En la
  // cláusula 2 de una ampliación eso es una fecha de vigencia inventada.
  it("fechaFin no desborda cuando el mes destino es más corto", () => {
    expect(fechaFin("2026-01-31", 1)).toBe("28 de febrero de 2026");
    expect(fechaFin("2026-08-31", 6)).toBe("28 de febrero de 2027");
    expect(fechaFin("2026-03-31", 1)).toBe("30 de abril de 2026");
    // 2028 es bisiesto: ahí el 29 sí existe y hay que llegar hasta él.
    expect(fechaFin("2028-01-31", 1)).toBe("29 de febrero de 2028");
  });
});

describe("formaPago — venta nueva", () => {
  it("pago único cuando no hay cuotas programadas", () => {
    expect(formaPago(2000, [])).toBe("PAGO ÚNICO de 2.000€.");
  });

  // El ejemplo que Patricio aprobó el 7-sep.
  it("cuotas iguales: se dice el importe una vez", () => {
    const texto = formaPago(8000, [
      { numero_cuota: 2, fecha_vencimiento: "2026-10-07", monto: 2000 },
      { numero_cuota: 3, fecha_vencimiento: "2026-11-07", monto: 2000 },
      { numero_cuota: 4, fecha_vencimiento: "2026-12-07", monto: 2000 },
    ]);
    expect(texto).toBe(
      "PAGO EN 4 CUOTAS de 2.000€ cada una: la primera hoy, y las siguientes los días 07/10/2026, 07/11/2026 y 07/12/2026.",
    );
  });

  // 🔴 El caso que hace que esto no pueda ser texto fijo. Un contrato que dice
  // "4 cuotas de 2.000€" cuando la última es de 1.500€ dice algo falso, y es un
  // documento que el cliente firma.
  it("cuotas distintas: las enumera una por una", () => {
    // 5.500 total = 2.000 hoy + 2.000 + 1.500. El primer cobro es lo que queda
    // tras restar las cuotas programadas, no una cuota más de la tabla.
    const texto = formaPago(5500, [
      { numero_cuota: 2, fecha_vencimiento: "2026-10-07", monto: 2000 },
      { numero_cuota: 3, fecha_vencimiento: "2026-11-07", monto: 1500 },
    ]);
    expect(texto).toContain("PAGO EN 3 CUOTAS");
    expect(texto).toContain("2.000€ hoy");
    expect(texto).toContain("2.000€ el 07/10/2026");
    expect(texto).toContain("1.500€ el 07/11/2026");
    expect(texto).not.toContain("cada una");
  });

  it("una sola cuota futura: singular, no plural", () => {
    const texto = formaPago(4000, [
      { numero_cuota: 2, fecha_vencimiento: "2026-10-07", monto: 2000 },
    ]);
    expect(texto).toContain("la siguiente el día 07/10/2026");
    expect(texto).not.toContain("los días");
  });

  // 🔴 Lo encontró el revisor. `VentaForm.tsx:518-522` deja guardar una venta
  // cuyas cuotas no cuadran con el valor total ("se puede guardar igual", dice
  // el texto) y el RPC tampoco lo valida. Sin guard, el contrato salía diciendo
  // "PAGO EN 3 CUOTAS: -1.000€ hoy" — y es un documento que se firma.
  it("LANZA si las cuotas suman más que el total, en vez de escribir un importe negativo", () => {
    expect(() =>
      formaPago(2000, [
        { numero_cuota: 2, fecha_vencimiento: "2026-10-01", monto: 1500 },
        { numero_cuota: 3, fecha_vencimiento: "2026-11-01", monto: 1500 },
      ]),
    ).toThrow(/no cuadra/i);
  });

  it("el caso límite exacto —las cuotas suman el total— NO lanza", () => {
    // Aquí el primer cobro es 0: raro, pero coherente. Solo lo negativo es
    // imposible de escribir en un contrato.
    expect(() =>
      formaPago(2000, [{ numero_cuota: 2, fecha_vencimiento: "2026-10-01", monto: 2000 }]),
    ).not.toThrow();
  });

  it("las cuotas se ordenan aunque lleguen desordenadas de la base", () => {
    const texto = formaPago(6000, [
      { numero_cuota: 3, fecha_vencimiento: "2026-11-07", monto: 2000 },
      { numero_cuota: 2, fecha_vencimiento: "2026-10-07", monto: 2000 },
    ]);
    expect(texto.indexOf("07/10/2026")).toBeLessThan(texto.indexOf("07/11/2026"));
  });
});

describe("calendarioCuotas — ampliación", () => {
  // El caso real de esa clienta: 2.000 de diferencia en 2 cuotas de 1.000.
  it("dos cuotas iguales", () => {
    const texto = calendarioCuotas(2000, [
      { numero_cuota: 2, fecha_vencimiento: "2026-09-01", monto: 1000 },
    ]);
    expect(texto).toContain("en 2 cuotas de 1.000€ cada una");
    expect(texto).toContain("la primera inmediata");
    expect(texto).toContain("la segunda el 01/09/2026");
  });

  // El hueco que la plantilla dejaba anotado: la frase del original solo
  // describe el caso de 2 cuotas.
  it("tres o más cuotas: la frase sigue siendo cierta", () => {
    const texto = calendarioCuotas(3000, [
      { numero_cuota: 2, fecha_vencimiento: "2026-10-01", monto: 1000 },
      { numero_cuota: 3, fecha_vencimiento: "2026-11-01", monto: 1000 },
    ]);
    expect(texto).toContain("en 3 cuotas de 1.000€ cada una");
    expect(texto).toContain("las siguientes el 01/10/2026 y 01/11/2026");
  });

  it("pago único", () => {
    expect(calendarioCuotas(2000, [])).toBe("en un pago único");
  });
});

describe("datosContrato", () => {
  const PROGRAMA = { monto: "8000.00", meses_duracion: 12, fecha_inicio: "2026-09-07" };
  const PAGO = { fecha: "2026-09-07", metodo_pago: "Stripe" };

  it("venta nueva: los 7 placeholders de la plantilla", () => {
    const d = datosContrato("venta_nueva", {
      nombre: "un cliente", programa: PROGRAMA, pago: PAGO, cuotas: [],
    });
    expect(d).toEqual({
      cliente_nombre: "un cliente",
      duracion_meses: "12",
      importe_total: "8.000",
      metodo_pago: "Stripe",
      forma_pago: "PAGO ÚNICO de 8.000€.",
      fecha_firma: "07/09/2026",
      // Este programa no lleva bonos: el párrafo sale vacío y el generador
      // se salta el bloque. Ver `parrafoBonos`.
      bonos: "",
    });
  });

  it("ampliación: el importe es la DIFERENCIA, no el programa nuevo", () => {
    const d = datosContrato("ampliacion", {
      nombre: "una clienta",
      programa: { monto: "5000.00", meses_duracion: 12, fecha_inicio: "2026-08-01" },
      programaPrevio: { monto: "3000.00" },
      pago: { fecha: "2026-08-01", metodo_pago: "Stripe" },
      cuotas: [{ numero_cuota: 2, fecha_vencimiento: "2026-09-01", monto: 1000 }],
    });
    // La cláusula 4 dice literalmente "abonando la diferencia correspondiente".
    expect(d.importe_ampliacion).toBe("2.000");
    expect(d.programa_previo_importe).toBe("3.000");
    expect(d.programa_nuevo_importe).toBe("5.000");
    expect(d.fecha_inicio).toBe("1 de agosto de 2026");
    expect(d.n_cuotas).toBe("2");
  });

  // 🔴 EL TEST MÁS IMPORTANTE DEL FICHERO. El RPC pisa la duración del
  // formulario cuando el bono está activo (0052:113): el form manda 9 y el
  // programa queda en 14. Estos datos salen SIEMPRE de la fila de `programas`.
  it("la duración sale del programa, con el valor que el RPC dejó", () => {
    const conBono = datosContrato("venta_nueva", {
      nombre: "X", programa: { ...PROGRAMA, meses_duracion: 14 }, pago: PAGO, cuotas: [],
    });
    expect(conBono.duracion_meses).toBe("14");
  });

  it("LANZA si el programa llegó sin duración, en vez de escribir 'null meses'", () => {
    expect(() =>
      datosContrato("venta_nueva", {
        nombre: "X", programa: { ...PROGRAMA, meses_duracion: null }, pago: PAGO, cuotas: [],
      }),
    ).toThrow(/duración/i);
  });

  it("LANZA si no hay nombre de cliente", () => {
    expect(() =>
      datosContrato("venta_nueva", { nombre: "  ", programa: PROGRAMA, pago: PAGO, cuotas: [] }),
    ).toThrow(/nombre/i);
  });

  it("LANZA si una ampliación llega sin programa previo", () => {
    expect(() =>
      datosContrato("ampliacion", {
        nombre: "X", programa: PROGRAMA, programaPrevio: null, pago: PAGO, cuotas: [],
      }),
    ).toThrow(/anterior/i);
  });
});

describe("parrafoBonos", () => {
  it("sin bonos no imprime nada, y el generador se salta el bloque", () => {
    expect(parrafoBonos(null)).toBe("");
    expect(parrafoBonos([])).toBe("");
    // Una clave inventada no es un bono: se descarta, no se imprime.
    expect(parrafoBonos(["consultoria_de_mentira"])).toBe("");
  });

  it("enumera los del catálogo por su etiqueta, en el orden del catálogo", () => {
    const p = parrafoBonos(["discord_portafolio", "consultoria_berni"]);
    expect(p).toContain("a) Consultoría extra 1 a 1 con Berni");
    expect(p).toContain("b) Portafolio de Berni en tiempo real vía Discord");
    expect(p).toContain("no alteran el precio");
  });

  it("el +50 % de duración se enumera aunque la cláusula 1 ya lleve la duración final", () => {
    // Decisión de Patricio del 8-sep: el contrato dice lo mismo que el que
    // Berni firma a mano, que sí repite el bono.
    expect(parrafoBonos(["duracion_50"])).toContain("+50 % de duración sin coste");
  });

  it("el bono escrito a mano va después de los del catálogo, con su texto tal cual", () => {
    const p = parrafoBonos(["consultoria_berni", "libre:Acceso al grupo de señales 3 meses"]);
    expect(p).toContain("a) Consultoría extra 1 a 1 con Berni");
    expect(p).toContain("b) Acceso al grupo de señales 3 meses");
  });

  it("un bono escrito solo con espacios no llega al contrato", () => {
    expect(parrafoBonos(["libre:   "])).toBe("");
  });

  it("con la duración final, el bono de duración lleva la cuenta desglosada", () => {
    // Opción B de Paula (9-sep-2026). Sin la cuenta, el único número que el
    // cliente puede multiplicar por 1,5 es el 18 que la cláusula 1 repite dos
    // veces — y reclamar 27 meses con el contrato firmado de su parte.
    expect(parrafoBonos(["duracion_50"], 18)).toContain(
      "+50 % de duración sin coste (ya incluido: 12 meses de catálogo + 6 de bono = 18)",
    );
    // El programa de 2.000 €: 6 → 9.
    expect(parrafoBonos(["duracion_50"], 9)).toContain(
      "(ya incluido: 6 meses de catálogo + 3 de bono = 9)",
    );
  });

  it("si la cuenta no es exacta, la etiqueta sale escueta en vez de sumar mal", () => {
    // 7 meses → Math.ceil(10,5) = 11, y 11 no vuelve a 7. Antes que imprimir
    // una suma que no cuadra en un documento firmado, no se imprime ninguna.
    const p = parrafoBonos(["duracion_50"], 11);
    expect(p).toContain("+50 % de duración sin coste");
    expect(p).not.toContain("ya incluido");
  });
});

describe("cintaContrato", () => {
  it("sin ninguna marca, la fila no lleva cinta", () => {
    expect(cintaContrato(null, null)).toBeNull();
    expect(cintaContrato(undefined, undefined)).toBeNull();
  });

  it("solo desactualizado: cinta roja con su fecha en palabras", () => {
    expect(cintaContrato(null, "2026-09-09T20:14:03.000Z")).toEqual({
      tipo: "desactualizado",
      fecha: "9 de septiembre de 2026",
    });
  });

  it("solo recorregido: cinta dorada", () => {
    expect(cintaContrato("2026-08-01T10:00:00.000Z", null)).toEqual({
      tipo: "recorregido",
      fecha: "1 de agosto de 2026",
    });
  });

  it("con las DOS puestas gana la roja: es una corrección a medias", () => {
    // recorregirContrato apaga `desactualizado_at` en el mismo PATCH en que
    // escribe `recorregido_at`, así que verlas juntas significa que los bonos
    // se guardaron y la regeneración falló. El PDF del equipo es el viejo.
    const c = cintaContrato("2026-09-01T10:00:00.000Z", "2026-09-09T10:00:00.000Z");
    expect(c).toEqual({ tipo: "desactualizado", fecha: "9 de septiembre de 2026" });
  });

  it("recorregir apaga la roja: queda solo la dorada", () => {
    // El caso normal después de un Recorregir que terminó bien.
    expect(cintaContrato("2026-09-09T20:14:05.000Z", null)).toEqual({
      tipo: "recorregido",
      fecha: "9 de septiembre de 2026",
    });
  });
});

describe("cintaDeFila", () => {
  const AYER = "2026-09-08T10:00:00.000Z";

  it("sin pdf_path no hay cinta, aunque las marcas estén puestas", () => {
    // Un contrato en `pendiente` que nunca llegó a generar PDF no tiene
    // documento que pueda estar viejo: marcarlo confundiría más que ayudar.
    expect(cintaDeFila(null, AYER, AYER)).toBeNull();
    expect(cintaDeFila("", AYER, null)).toBeNull();
    expect(cintaDeFila(undefined, null, AYER)).toBeNull();
  });

  it("con pdf_path delega en cintaContrato y la roja gana", () => {
    expect(cintaDeFila("abc.pdf", null, null)).toBeNull();
    expect(cintaDeFila("abc.pdf", AYER, null)?.tipo).toBe("recorregido");
    expect(cintaDeFila("abc.pdf", null, AYER)?.tipo).toBe("desactualizado");
    // Las dos puestas = se recorrigió y DESPUÉS se volvieron a tocar los
    // bonos. Manda la roja: el PDF de la bandeja vuelve a estar viejo.
    expect(cintaDeFila("abc.pdf", "2026-09-01T10:00:00.000Z", AYER)?.tipo).toBe("desactualizado");
  });
});

// Precedencia (spec de la Task 17): desactualizado > editado > recorregido.
// Un test por cada PAR que compite, no uno genérico — el orden entre tres
// estados es justo donde se cuelan los errores.
describe("cintaContrato — editado a mano (tercer estado)", () => {
  it("solo editado: cinta con su tipo y la fecha en palabras", () => {
    expect(cintaContrato(null, null, "2026-09-16")).toEqual({
      tipo: "editado",
      fecha: "16 de septiembre de 2026",
    });
  });

  // Par 1: editado vs recorregido → gana editado. Regenerar desde los datos
  // (que es lo que deja `recorregido_at`) pisaría la edición a mano.
  it("editado vs recorregido: gana editado", () => {
    expect(cintaContrato("2026-09-10", null, "2026-09-16")?.tipo).toBe("editado");
  });

  // Par 2: desactualizado vs editado → gana desactualizado. Si cambiaron los
  // bonos del programa, eso manda sobre una edición manual anterior: el texto
  // editado a mano puede estar hablando de un programa que ya no es este.
  it("desactualizado vs editado: gana desactualizado", () => {
    expect(cintaContrato(null, "2026-09-17", "2026-09-16")?.tipo).toBe("desactualizado");
  });

  // Par 3 (desactualizado vs recorregido) ya lo cubre "con las DOS puestas
  // gana la roja" en el describe("cintaContrato") de arriba — no se repite.

  // Los tres a la vez: sigue mandando la cabeza de la precedencia.
  it("los tres puestos a la vez: sigue ganando desactualizado", () => {
    const c = cintaContrato("2026-09-10", "2026-09-17", "2026-09-16");
    expect(c?.tipo).toBe("desactualizado");
  });

  it("cintaDeFila sigue devolviendo null sin pdf, aunque editadoAt esté puesto", () => {
    expect(cintaDeFila(null, null, null, "2026-09-16")).toBeNull();
  });

  it("cintaDeFila con pdf propaga el tipo editado", () => {
    expect(cintaDeFila("abc.pdf", null, null, "2026-09-16")?.tipo).toBe("editado");
  });
});

import { prestaciones, type TierContrato } from "../contrato-datos";

const T2000: TierContrato = { acceso_vitalicio: false, n_consultorias: 2, n_sesiones_berni: 0, acceso_discord: false, numero_berni: false, sesiones_directo: true };
const T10000: TierContrato = { acceso_vitalicio: true, n_consultorias: 6, n_sesiones_berni: 3, acceso_discord: true, numero_berni: true, sesiones_directo: true };

// Valores REALES del catálogo de producción (medidos 16-sep), no sintéticos
// como T2000 de arriba — este es el que hizo que el Critical 1 de la ronda de
// arreglo 1 sobreviviera a una suite verde: el 2000 real tiene 1 consultoría
// y `sesiones_directo: false`, mientras T2000 (el del brief) usa 2 y `true`.
const T_2000_REAL: TierContrato = { acceso_vitalicio: false, n_consultorias: 1, n_sesiones_berni: 0, acceso_discord: false, numero_berni: false, sesiones_directo: false };
// El OG: 0 consultorías Y sin directos, pero SÍ con Discord — el único tier
// que combina "sin la línea de directos" con "sin la línea de consultorías".
const T_OG: TierContrato = { acceso_vitalicio: true, n_consultorias: 0, n_sesiones_berni: 0, acceso_discord: true, numero_berni: false, sesiones_directo: false };

describe("prestaciones — la cláusula 1 desde el catálogo (acuerdo con Paula, 14-sep)", () => {
  it("2.000 €: 2 consultorías, sin Berni, sin Discord, sin número — cinco letras seguidas", () => {
    const lineas = prestaciones(T2000, 6).split("\n");
    expect(lineas).toEqual([
      'a) Acceso al contenido grabado del programa formativo "MetaCrypto Club" durante 6 meses.',
      "b) Sesión semanal en directo los domingos con Berni y sesión semanal en directo los miércoles con el consultor, durante 6 meses.",
      "c) 2 consultorías individuales 1 a 1 con el consultor asignado.",
      "d) Documento de plan de acción, elaborado en la primera consultoría.",
      "e) Chat privado con el consultor por WhatsApp durante 6 meses.",
    ]);
  });

  it("10.000 €: todo, con las letras corridas y el singular bien puesto", () => {
    const lineas = prestaciones(T10000, 12).split("\n");
    expect(lineas[2]).toBe("c) 6 consultorías individuales 1 a 1 con el consultor asignado.");
    expect(lineas[3]).toBe("d) 3 sesiones individuales 1 a 1 con Berni.");
    expect(lineas[6]).toBe("g) Acceso al Discord privado con los movimientos de Berni durante 12 meses.");
    expect(lineas[7]).toBe("h) Número de teléfono directo de Berni.");
    expect(lineas).toHaveLength(8);
  });

  it("una sola consultoría o una sola sesión van en singular", () => {
    const t: TierContrato = { ...T2000, n_consultorias: 1, n_sesiones_berni: 1 };
    const lineas = prestaciones(t, 6).split("\n");
    expect(lineas[2]).toBe("c) 1 consultoría individual 1 a 1 con el consultor asignado.");
    expect(lineas[3]).toBe("d) 1 sesión individual 1 a 1 con Berni.");
  });

  it("nunca dice mentoría, coach ni Manuel", () => {
    const t = prestaciones(T10000, 12);
    expect(t).not.toMatch(/mentor|coach|Manuel/i);
  });

  // ── Revisión del texto del 16-sep-2026 (Milo, sobre los comentarios de
  // Paula). Tres reglas que antes NO se cumplían, y que este bloque fija
  // para que nadie las deshaga por parecer redundantes.
  it("el vitalicio sale del catálogo, no de la plantilla", () => {
    // Hasta el 16-sep la cláusula 1 prometía "Acceso vitalicio" a TODOS los
    // tiers, porque la línea estaba escrita a mano. El 2.000 € no lo da: da
    // acceso durante los meses que dura el programa.
    expect(prestaciones(T10000, 12).split("\n")[0])
      .toBe('a) Acceso vitalicio al contenido grabado del programa formativo "MetaCrypto Club".');
    expect(prestaciones({ ...T10000, acceso_vitalicio: false }, 12).split("\n")[0])
      .toBe('a) Acceso al contenido grabado del programa formativo "MetaCrypto Club" durante 12 meses.');
  });

  it("no dice «de turno» en ningún tier", () => {
    // La expresión venía de sustituir "Manuel" por un genérico, y sonaba a
    // que al cliente le toca quien caiga. Se cae entera.
    for (const t of [T2000, T10000, T_2000_REAL, T_OG]) {
      expect(prestaciones(t, 12)).not.toMatch(/de turno/);
    }
  });

  it("no califica las sesiones como grupales ni como individuales", () => {
    // La coletilla "Son sesiones grupales, no individuales" desaparece: las
    // sesiones semanales se nombran y ya. Ojo, que "consultorías individuales
    // 1 a 1" SÍ se queda — eso es otra línea y otra cosa.
    const linea = prestaciones(T10000, 12).split("\n")[1];
    expect(linea).toContain("Sesión semanal en directo los domingos con Berni");
    expect(linea).not.toMatch(/grupal/i);
    expect(linea).not.toMatch(/no individuales/i);
    expect(linea).toBe(
      "b) Sesión semanal en directo los domingos con Berni y sesión semanal en directo los miércoles con el consultor, durante 12 meses.",
    );
  });

  // Ronda de arreglo 1, Important 4: los tests de arriba usan fixtures
  // sintéticas donde `sesiones_directo` siempre es `true` y `n_consultorias`
  // nunca es 0 — así que el Critical 1 (la línea de directos se empujaba
  // incondicionalmente, ignorando `sesiones_directo`) pasó una suite verde.
  // Estos dos usan el catálogo real y comprueban el array exacto.
  it("2.000 € real: sin directos (sesiones_directo: false), no se promete el directo semanal", () => {
    const lineas = prestaciones(T_2000_REAL, 6).split("\n");
    expect(lineas).toEqual([
      'a) Acceso al contenido grabado del programa formativo "MetaCrypto Club" durante 6 meses.',
      "b) 1 consultoría individual 1 a 1 con el consultor asignado.",
      "c) Documento de plan de acción, elaborado en la primera consultoría.",
      "d) Chat privado con el consultor por WhatsApp durante 6 meses.",
    ]);
  });

  it("OG: sin directos y sin consultorías, con Discord — ni la línea de directos ni la del plan de acción", () => {
    const lineas = prestaciones(T_OG, 6).split("\n");
    expect(lineas).toEqual([
      'a) Acceso vitalicio al contenido grabado del programa formativo "MetaCrypto Club".',
      "b) Chat privado con el consultor por WhatsApp durante 6 meses.",
      "c) Acceso al Discord privado con los movimientos de Berni durante 6 meses.",
    ]);
  });
});

describe("datosContrato — venta_nueva_v2", () => {
  const base = {
    nombre: "Ana Rodríguez",
    programa: { monto: 3500, meses_duracion: 12, fecha_inicio: "2026-09-15", bonos: [] },
    pago: { fecha: "2026-09-15", metodo_pago: "Stripe" },
    cuotas: [],
    tier: { acceso_vitalicio: true, n_consultorias: 6, n_sesiones_berni: 0, acceso_discord: true, numero_berni: false, sesiones_directo: true },
  };

  it("añade prestaciones y los dos huecos de firma vacíos", () => {
    const d = datosContrato("venta_nueva_v2", base);
    expect(d.prestaciones).toContain("c) 6 consultorías individuales");
    expect(d.firma_cliente).toBe("");
    expect(d.firma_evidencia).toBe("");
    expect(d.importe_total).toBe("3.500");
  });

  it("lanza si falta el tier: sin catálogo no hay cláusula 1", () => {
    const { tier: _, ...sinTier } = base;
    expect(() => datosContrato("venta_nueva_v2", sinTier)).toThrow(/catálogo/);
  });

  it("venta_nueva (v1) sigue exactamente igual — no pide tier", () => {
    const { tier: _, ...sinTier } = base;
    const d = datosContrato("venta_nueva", sinTier);
    expect(d.prestaciones).toBeUndefined();
    expect(d.firma_cliente).toBeUndefined();
  });
});
