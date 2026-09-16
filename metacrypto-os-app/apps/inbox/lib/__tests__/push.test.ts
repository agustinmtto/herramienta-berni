import { describe, it, expect } from "vitest";
import {
  destinatarios, contenidoAviso, claveVapidABytes,
  destinatariosVenta, contenidoAvisoVenta, urlAvisoVenta,
  contenidoAvisoContratoFirmado,
  type MiembroPush, type MiembroVenta, filtrarPorAlcanceVenta } from "../push";

// Estado real del equipo el 19-ago-2026.
const MANUEL: MiembroPush = {
  id: "m-manuel", activo: true, acceso_total: false,
  modulos: ["clientes", "inbox", "sesiones"], push_alcance: "todas",
};
const BERNI: MiembroPush = {
  id: "m-berni", activo: true, acceso_total: true, modulos: null, push_alcance: "ninguna",
};
// Los setters no tienen el módulo `inbox`.
const DANI: MiembroPush = {
  id: "m-dani", activo: true, acceso_total: false, modulos: [], push_alcance: "ninguna",
};

const ids = (ms: MiembroPush[], conv: { coach_asignado: string | null }) =>
  destinatarios(ms, conv).map((m) => m.id);

describe("destinatarios", () => {
  it("avisa a quien tiene alcance 'todas'", () => {
    expect(ids([MANUEL], { coach_asignado: null })).toEqual(["m-manuel"]);
  });

  it("no avisa a quien tiene 'ninguna', aunque lo vea todo", () => {
    expect(ids([BERNI], { coach_asignado: null })).toEqual([]);
  });

  it("no avisa a un inactivo", () => {
    expect(ids([{ ...MANUEL, activo: false }], { coach_asignado: null })).toEqual([]);
  });

  // La fuga que importa: un setter suscrito recibiría en la pantalla
  // bloqueada el nombre de un cliente que no puede abrir dentro del OS.
  it("NUNCA avisa a quien no tiene el módulo inbox, aunque le pongan 'todas'", () => {
    expect(ids([{ ...DANI, push_alcance: "todas" }], { coach_asignado: null })).toEqual([]);
  });

  it("el permiso se mira al enviar: quitar el módulo corta los avisos", () => {
    const sinModulo = { ...MANUEL, modulos: ["clientes"] };
    expect(ids([sinModulo], { coach_asignado: null })).toEqual([]);
  });

  it("acceso_total sustituye a la lista de módulos", () => {
    const jefe = { ...BERNI, push_alcance: "todas" };
    expect(ids([jefe], { coach_asignado: null })).toEqual(["m-berni"]);
  });

  describe("alcance 'asignadas'", () => {
    const asignado: MiembroPush = { ...MANUEL, push_alcance: "asignadas" };

    it("avisa si la conversación es suya", () => {
      expect(ids([asignado], { coach_asignado: "m-manuel" })).toEqual(["m-manuel"]);
    });

    it("NO avisa si es de otro coach", () => {
      expect(ids([asignado], { coach_asignado: "m-otro" })).toEqual([]);
    });

    // 72% de las conversaciones no tienen coach (76 de 106 el 19-ago). Si las
    // huérfanas no avisaran, siete de cada diez mensajes de clientes se
    // quedarían sin avisar a nadie y parecería que la función está rota.
    it("SÍ avisa si la conversación no tiene coach", () => {
      expect(ids([asignado], { coach_asignado: null })).toEqual(["m-manuel"]);
    });
  });

  it("con varios miembros devuelve solo a los que tocan", () => {
    const equipo = [MANUEL, BERNI, DANI, { ...BERNI, id: "m-alex", push_alcance: "asignadas" }];
    expect(ids(equipo, { coach_asignado: null })).toEqual(["m-manuel", "m-alex"]);
  });

  it("un alcance desconocido en la base no avisa a nadie", () => {
    expect(ids([{ ...MANUEL, push_alcance: "loquesea" }], { coach_asignado: null })).toEqual([]);
  });
});

describe("contenidoAviso", () => {
  // Decisión de Milo (19-ago): solo el nombre, sin el texto del mensaje.
  it("enseña el nombre del cliente y nunca el mensaje", () => {
    expect(contenidoAviso("esa clienta Etxebarria", "+34600112233")).toEqual({
      title: "esa clienta Etxebarria",
      body: "Nuevo mensaje",
    });
  });

  it("cae al teléfono si el contacto no tiene nombre", () => {
    expect(contenidoAviso(null, "+34620000000").title).toBe("+34620000000");
  });

  it("un nombre en blanco cuenta como sin nombre", () => {
    expect(contenidoAviso("   ", "+34620000000").title).toBe("+34620000000");
  });
});

describe("claveVapidABytes", () => {
  // La clave real de este proyecto (es pública: viaja al navegador).
  const VAPID = "BGb-nnYwhOSxwmNvZ45v4krpqgBgiZmf93LwM9NIW1caUTdk6ZYuhUhRYAxPlTUBAehtFF0Gz2yfVeutfHA_LZk";

  it("devuelve los 65 bytes de una clave P-256 sin comprimir", () => {
    const b = claveVapidABytes(VAPID);
    expect(b).toBeInstanceOf(Uint8Array);
    expect(b.length).toBe(65);
    expect(b[0]).toBe(0x04); // marca de punto sin comprimir
  });

  it("traduce los caracteres propios de base64url", () => {
    // "-" y "_" tienen que volverse "+" y "/" o los bytes salen mal.
    expect(Array.from(claveVapidABytes("-_-_"))).toEqual(
      Array.from(claveVapidABytes("+/+/")),
    );
  });

  it("añade el relleno que falta", () => {
    expect(() => claveVapidABytes("AAA")).not.toThrow();
  });
});

/* ---------------- Aviso de nueva venta ---------------- */

// El aviso de venta es distinto del de inbox A PROPÓSITO: Alex pidió que el
// cierre lo celebre TODO el equipo, tenga los módulos que tenga. La privacidad
// se protege en el contenido (sin monto) y en el destino del clic, no en la
// lista de destinatarios.
const COACH: MiembroVenta = {
  id: "m-coach", nombre: "Manuel", activo: true, acceso_total: false,
  modulos: ["clientes", "inbox", "sesiones"],
};
const JEFE: MiembroVenta = {
  id: "m-jefe", nombre: "Berni", activo: true, acceso_total: true, modulos: null,
};
const SETTER: MiembroVenta = {
  id: "m-setter", nombre: "Dani", activo: true, acceso_total: false, modulos: [],
};

describe("destinatariosVenta", () => {
  it("avisa a todos los activos, tengan los módulos que tengan", () => {
    expect(destinatariosVenta([COACH, JEFE, SETTER]).map((m) => m.id))
      .toEqual(["m-coach", "m-jefe", "m-setter"]);
  });

  it("no avisa a un inactivo", () => {
    expect(destinatariosVenta([{ ...COACH, activo: false }])).toEqual([]);
  });
});

describe("contenidoAvisoVenta", () => {
  // El tier NO entra ni como parámetro, igual que el monto: en el catálogo
  // real los ids de tier SON el precio en euros ('2000', '3500', '5000'…) y
  // el nombre es "€5.000 / 12 meses" — cualquiera de los dos filtraría en la
  // pantalla bloqueada justo lo que este aviso promete no enseñar.
  it("una compra nueva acredita al closer — sin tier ni monto", () => {
    expect(contenidoAvisoVenta({ nombre: "Juan P.", tipo: "nueva", autor: "Alex" })).toEqual({
      title: "🎉 Nuevo cierre",
      body: "Juan P. · closer: Alex",
    });
  });

  // En ascensión/extensión el autor no es un closer (regla de comisiones,
  // Berni 12-ago): la etiqueta cambia y se dice qué tipo de cierre fue.
  it("una ascensión dice el tipo y acredita a quien la hizo", () => {
    expect(contenidoAvisoVenta({ nombre: "Juan P.", tipo: "ascension", autor: "Manuel" }).body)
      .toBe("Juan P. · ascensión · por Manuel");
  });

  it("una extensión sin autor dice el tipo y no deja un 'por' huérfano", () => {
    expect(contenidoAvisoVenta({ nombre: "Juan P.", tipo: "extension", autor: null }).body)
      .toBe("Juan P. · extensión");
  });

  it("compra nueva sin closer se queda en el nombre", () => {
    expect(contenidoAvisoVenta({ nombre: "Juan P.", tipo: "nueva", autor: null }).body)
      .toBe("Juan P.");
  });

  it("un cliente sin nombre no deja el cuerpo vacío", () => {
    expect(contenidoAvisoVenta({ nombre: null, tipo: "nueva", autor: null }).body)
      .toBe("Cliente nuevo");
  });

  // Una ascensión/extensión es por definición de un cliente que YA existe:
  // anunciarla como "Cliente nuevo" mentiría en la pantalla de todo el equipo.
  it("una extensión sin nombre no dice 'Cliente nuevo'", () => {
    expect(contenidoAvisoVenta({ nombre: null, tipo: "extension", autor: "Manuel" }).body)
      .toBe("Cliente · extensión · por Manuel");
  });

  // Texto libre del formulario: un tipo raro no debe inventar etiquetas.
  it("un tipo desconocido acredita en genérico y no pinta el tipo", () => {
    expect(contenidoAvisoVenta({ nombre: "Juan P.", tipo: "loquesea", autor: "Manuel" }).body)
      .toBe("Juan P. · por Manuel");
  });
});

describe("contenidoAvisoContratoFirmado", () => {
  it("nombra al cliente y nada más — sin importe ni tier", () => {
    expect(contenidoAvisoContratoFirmado({ nombre: "Juan P." })).toEqual({ title: "🖊️ Contrato firmado", body: "Juan P." });
    expect(contenidoAvisoContratoFirmado({ nombre: null })).toEqual({ title: "🖊️ Contrato firmado", body: "Cliente" });
  });
});

describe("urlAvisoVenta", () => {
  it("lleva a la ficha del cliente a quien puede abrirla", () => {
    expect(urlAvisoVenta(COACH, "p1")).toBe("/clientes/p1");
    expect(urlAvisoVenta(JEFE, "p1")).toBe("/clientes/p1");
  });

  it("a quien no puede ver clientes lo deja en su inicio, no en un 'sin permiso'", () => {
    const conInbox = { ...SETTER, modulos: ["inbox"] };
    expect(urlAvisoVenta(conInbox, "p1")).toBe("/inbox");
  });

  // Desde el centro de novedades, homePath ya nunca devuelve "/login" para
  // un activo: el miembro sin módulos aterriza en /novedades (donde además
  // vive el botón de activar avisos). La rama null de urlAvisoVenta queda
  // como red por si homePath volviera a producir un destino inválido.
  it("un miembro sin módulos aterriza en /novedades", () => {
    expect(urlAvisoVenta(SETTER, "p1")).toBe("/novedades");
  });
});

describe("filtrarPorAlcanceVenta — quién se entera de qué cierre", () => {
  const DANI = { id: "dani", aviso_venta_alcance: "asignadas" };
  const BERNI = { id: "berni", aviso_venta_alcance: "todas" };
  const ALEX = { id: "alex", aviso_venta_alcance: null };

  it("por defecto no filtra a nadie", () => {
    // 'todas' y null (columna recién creada, fila sin tocar) se comportan
    // igual: es la regla de Alex del 3-sep, el cierre lo celebra todo el
    // equipo. Sin esto, crear la columna habría dejado a media plantilla sin
    // avisos hasta que alguien rellenara el campo.
    expect(filtrarPorAlcanceVenta([BERNI, ALEX], null).map((m) => m.id)).toEqual(["berni", "alex"]);
  });

  it("quien está en 'asignadas' solo entra si es el setter de ESA venta", () => {
    expect(filtrarPorAlcanceVenta([BERNI, DANI], "dani").map((m) => m.id)).toEqual(["berni", "dani"]);
    expect(filtrarPorAlcanceVenta([BERNI, DANI], "juan").map((m) => m.id)).toEqual(["berni"]);
  });

  it("una venta sin setter deja fuera a los de 'asignadas', no dentro", () => {
    // `programas.setter_id` es opcional y viene vacío en más de la mitad de
    // las ventas. Ante la duda se excluye: mandarle a Dani el cierre de otro
    // es peor que no mandarle el suyo.
    expect(filtrarPorAlcanceVenta([BERNI, DANI], null).map((m) => m.id)).toEqual(["berni"]);
  });

  it("no deja fuera a los de 'todas' aunque la venta sí tenga setter", () => {
    expect(filtrarPorAlcanceVenta([BERNI, ALEX, DANI], "dani")).toHaveLength(3);
  });
});
