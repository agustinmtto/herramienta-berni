import { CONSENTIMIENTO } from "@/lib/contrato-firma";

// ============================================================
// La pantalla que ve el CLIENTE para firmar. Hermana de PortalEstrategias:
// fuera del shell del OS —ni nav, ni contadores, ni nada del equipo— y la
// MISMA pantalla para todo lo que no sea un enlace vivo (inexistente,
// caducado, sin enviar o revocado). Distinguirlos le confirmaría a quien
// prueba enlaces cuáles existen.
//
// Sin "use client" A PROPÓSITO: es un formulario de los de siempre
// (`<form method="post">`) y funciona con JavaScript desactivado, con el
// bundle a medio cargar o dentro del navegador de la app del correo, que es
// por donde va a entrar la mitad de la gente. Eso obliga a que la validación
// de verdad viva en el servidor (`validarFormularioFirma`): el `required` de
// aquí abajo es una cortesía del navegador, nunca la barrera.
//
// Y sin "use client" por una segunda razón, menos visible: `@/lib/contrato-firma`
// importa `node:crypto`. El día que alguien le ponga la directiva, el build
// se rompe — que es justo lo que se quiere que pase.
// ============================================================

/**
 * Los `?e=` que puede devolver `POST /api/contratos/firmar`. Se escriben para
 * el cliente, no para nosotros: ninguno le cuenta por qué su token no vale, y
 * el de `hash` le dice qué hacer (pedir el reenvío) en vez de qué ha fallado
 * (que el PDF cambió después de mandárselo).
 *
 * `no_activo` no estaba en el plan de esta pantalla y sí puede llegar: la ruta
 * del POST reenvía tal cual el motivo de `firmarContrato`
 * (`api/contratos/firmar:101`), y ése lo devuelve también cuando la lectura
 * por token falla de forma pasajera. En ese caso la fila está perfectamente
 * viva, esta página vuelve a pintar el formulario, y sin esta entrada el
 * cliente se encontraba el formulario otra vez y ni una palabra de lo que
 * había pasado. De ahí que el texto invite a reintentar: si el enlace
 * estuviera muerto de verdad, estaría viendo la otra pantalla.
 *
 * Un `?e=` que no esté aquí no pinta nada: nunca un mensaje inventado.
 */
const ERRORES: Record<string, string> = {
  nombre: "Escribe tu nombre y apellidos tal como quieres que aparezcan en el contrato.",
  acepto: "Para firmar tienes que marcar la casilla de aceptación.",
  hash: "Este contrato se actualizó después de mandarte el enlace. Pide a tu consultor que te lo reenvíe.",
  no_activo: "No pudimos comprobar tu enlace en este momento. Vuelve a intentarlo; si sigue sin funcionar, escríbenos y te mandamos uno nuevo.",
  error: "No se pudo registrar la firma. Inténtalo de nuevo en un momento o escríbenos.",
};

/**
 * El token viaja del `params` de la URL al `href`, así que se codifica antes
 * de pegarlo. Con un token válido (`RE_TOKEN`: letras, dígitos, `-` y `_`)
 * `encodeURIComponent` no cambia ni un carácter; está por lo que llegue que
 * no lo sea — React escapa el HTML, pero no arregla una URL mal formada.
 */
function rutaPdf(token: string | undefined, descargar = false): string {
  const t = encodeURIComponent((token ?? "").trim());
  return `/c/${t}/pdf${descargar ? "?descargar=1" : ""}`;
}

export default function PortalFirma(props: {
  tipo: "listo" | "firmado" | "no_activo";
  token?: string;
  nombre?: string | null;
  firmadoPor?: string | null;
  error?: string | null;
}) {
  if (props.tipo === "no_activo") {
    return (
      <main className="portal">
        <Marca />
        <div className="portal-vacio">
          <h1>Este enlace ya no está activo</h1>
          <p>
            Puede que haya caducado o que se haya reemplazado por uno nuevo.
            Escríbenos y te mandamos el tuyo al momento.
          </p>
        </div>
      </main>
    );
  }

  // No es un error: es el final bueno. Quien vuelve a su enlace después de
  // firmar tiene que poder ver y guardar SU contrato firmado, no un muro.
  if (props.tipo === "firmado") {
    return (
      <main className="portal">
        <Marca />
        <div className="portal-vacio firma-ok">
          <h1>Perfecto, contrato firmado</h1>
          <p>
            {props.firmadoPor ? `Firmado por ${props.firmadoPor}. ` : ""}
            Aguarda las siguientes instrucciones de tu consultor para lo que viene.
          </p>
          <a className="portal-abrir" href={rutaPdf(props.token, true)}>
            Descargar el contrato firmado
          </a>
        </div>
      </main>
    );
  }

  const nombre = (props.nombre ?? "").trim().split(/\s+/)[0] || null;
  const error = props.error ? ERRORES[props.error] ?? null : null;

  return (
    <main className="portal">
      <Marca />
      <header className="portal-head">
        <h1>{nombre ? `Hola, ${nombre}` : "Tu contrato"}</h1>
        <p className="portal-sub">
          Léelo con calma. Si estás de acuerdo, acéptalo y escribe tu nombre para firmarlo.
        </p>
      </header>

      {/* EL ERROR VA ARRIBA DEL TODO, no dentro del formulario. El POST
          responde con una redirección, que devuelve al cliente al principio de
          la página: un mensaje colocado después del visor se queda debajo del
          pliegue y un envío fallido parece que no hizo nada.
          `id` propio para que la redirección pueda apuntar aquí (ver el
          `id="firma"` del formulario, más abajo). */}
      {error && (
        <p className="firma-error" role="alert" id="firma-error">
          {error}
        </p>
      )}

      {/* 🔴 EL ENLACE VA ENCIMA DEL VISOR, y no es una cuestión de gusto.
          Chrome y Firefox en Android NO pintan PDF dentro de un iframe, y en
          iPhone es poco fiable (a veces solo la primera página, a veces nada).
          O sea que para media clientela este visor es un rectángulo gris que
          ocupa media pantalla. Con el enlace debajo, el escape y el formulario
          entero caen bajo el pliegue y el cliente aterriza en una caja vacía.
          El iframe es una comodidad; el enlace es el contrato. */}
      <a className="portal-abrir" href={rutaPdf(props.token)} target="_blank" rel="noreferrer noopener">
        Abrir el contrato en una pestaña
      </a>
      <div className="firma-visor">
        <iframe src={rutaPdf(props.token)} title="Contrato" />
      </div>
      <p className="portal-nota">Si el contrato no se ve aquí, ábrelo con el botón de arriba.</p>

      {/* `id="firma"`: la ruta que recibe el formulario redirige a
          `/c/<token>?e=…#firma` cuando algo falla, para que el cliente vuelva
          al sitio donde se corrige y no al principio de la página. */}
      <form method="post" action="/api/contratos/firmar" className="firma-form" id="firma">
        <input type="hidden" name="token" value={props.token} />
        <label className="firma-check">
          <input type="checkbox" name="acepto" value="si" required />
          <span>{CONSENTIMIENTO}</span>
        </label>
        <label className="firma-nombre">
          Tu nombre y apellidos
          <input
            name="nombre"
            type="text"
            required
            minLength={3}
            maxLength={120}
            autoComplete="name"
            placeholder="Como quieres que aparezca en la firma"
          />
        </label>
        <button type="submit" className="portal-abrir firma-boton">
          Firmar el contrato
        </button>
        <p className="portal-nota">
          Tu nombre se imprimirá en la línea de firma del contrato junto a la fecha,
          la hora y la dirección IP.
        </p>
      </form>
    </main>
  );
}

/** La misma marca que ve el cliente en el portal de estrategias, y por eso el mismo `<img>`. */
function Marca() {
  return (
    <div className="portal-marca">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-horizontal.png" alt="MetaCrypto Club" width={150} height={31} />
    </div>
  );
}
