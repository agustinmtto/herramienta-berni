// País y prefijo telefónico, en una sola tabla.
//
// Existe porque el formulario de nueva venta tenía DOS listas independientes
// —una de países y otra de prefijos— que nadie obligaba a corresponderse. Se
// podía guardar "España" con "+595". Y la de prefijos tenía nueve entradas:
// Paraguay no estaba, así que al registrar a un cliente se eligió "+593"
// (Ecuador) y se pegó el número paraguayo completo detrás → +593595000111222.
// Su recordatorio automático iba a salir a un número que no existe, y WhatsApp
// lo habría dado por entregado.
//
// Con una sola tabla la incoherencia no es que esté prohibida: es que no se
// puede expresar. El país elegido fija el nombre y el prefijo a la vez.

export type Pais = { iso: string; nombre: string; prefijo: string };

/** Los que ya tienen clientes, arriba del desplegable. El resto va alfabético. */
export const FRECUENTES = ["ES", "AR", "US", "VE", "MX", "CO", "CL", "PE", "UY", "PY"];

// La bandera NO se guarda: se calcula del ISO (ver `banderaDe`), así que esta
// tabla no puede desincronizarse con ella.
const RESTO: Pais[] = [
  { iso: "AF", nombre: "Afganistán", prefijo: "+93" },
  { iso: "AL", nombre: "Albania", prefijo: "+355" },
  { iso: "DE", nombre: "Alemania", prefijo: "+49" },
  { iso: "AD", nombre: "Andorra", prefijo: "+376" },
  { iso: "AO", nombre: "Angola", prefijo: "+244" },
  { iso: "AG", nombre: "Antigua y Barbuda", prefijo: "+1" },
  { iso: "SA", nombre: "Arabia Saudí", prefijo: "+966" },
  { iso: "DZ", nombre: "Argelia", prefijo: "+213" },
  { iso: "AM", nombre: "Armenia", prefijo: "+374" },
  { iso: "AU", nombre: "Australia", prefijo: "+61" },
  { iso: "AT", nombre: "Austria", prefijo: "+43" },
  { iso: "AZ", nombre: "Azerbaiyán", prefijo: "+994" },
  { iso: "BS", nombre: "Bahamas", prefijo: "+1" },
  { iso: "BD", nombre: "Bangladés", prefijo: "+880" },
  { iso: "BB", nombre: "Barbados", prefijo: "+1" },
  { iso: "BH", nombre: "Baréin", prefijo: "+973" },
  { iso: "BE", nombre: "Bélgica", prefijo: "+32" },
  { iso: "BZ", nombre: "Belice", prefijo: "+501" },
  { iso: "BJ", nombre: "Benín", prefijo: "+229" },
  { iso: "BY", nombre: "Bielorrusia", prefijo: "+375" },
  { iso: "BO", nombre: "Bolivia", prefijo: "+591" },
  { iso: "BA", nombre: "Bosnia y Herzegovina", prefijo: "+387" },
  { iso: "BW", nombre: "Botsuana", prefijo: "+267" },
  { iso: "BR", nombre: "Brasil", prefijo: "+55" },
  { iso: "BN", nombre: "Brunéi", prefijo: "+673" },
  { iso: "BG", nombre: "Bulgaria", prefijo: "+359" },
  { iso: "BF", nombre: "Burkina Faso", prefijo: "+226" },
  { iso: "BI", nombre: "Burundi", prefijo: "+257" },
  { iso: "BT", nombre: "Bután", prefijo: "+975" },
  { iso: "CV", nombre: "Cabo Verde", prefijo: "+238" },
  { iso: "KH", nombre: "Camboya", prefijo: "+855" },
  { iso: "CM", nombre: "Camerún", prefijo: "+237" },
  { iso: "CA", nombre: "Canadá", prefijo: "+1" },
  { iso: "QA", nombre: "Catar", prefijo: "+974" },
  { iso: "TD", nombre: "Chad", prefijo: "+235" },
  { iso: "CN", nombre: "China", prefijo: "+86" },
  { iso: "CY", nombre: "Chipre", prefijo: "+357" },
  { iso: "VA", nombre: "Ciudad del Vaticano", prefijo: "+379" },
  { iso: "KM", nombre: "Comoras", prefijo: "+269" },
  { iso: "CG", nombre: "Congo", prefijo: "+242" },
  { iso: "KP", nombre: "Corea del Norte", prefijo: "+850" },
  { iso: "KR", nombre: "Corea del Sur", prefijo: "+82" },
  { iso: "CI", nombre: "Costa de Marfil", prefijo: "+225" },
  { iso: "CR", nombre: "Costa Rica", prefijo: "+506" },
  { iso: "HR", nombre: "Croacia", prefijo: "+385" },
  { iso: "CU", nombre: "Cuba", prefijo: "+53" },
  { iso: "DK", nombre: "Dinamarca", prefijo: "+45" },
  { iso: "DM", nombre: "Dominica", prefijo: "+1" },
  { iso: "EC", nombre: "Ecuador", prefijo: "+593" },
  { iso: "EG", nombre: "Egipto", prefijo: "+20" },
  { iso: "SV", nombre: "El Salvador", prefijo: "+503" },
  { iso: "AE", nombre: "Emiratos Árabes Unidos", prefijo: "+971" },
  { iso: "ER", nombre: "Eritrea", prefijo: "+291" },
  { iso: "SK", nombre: "Eslovaquia", prefijo: "+421" },
  { iso: "SI", nombre: "Eslovenia", prefijo: "+386" },
  { iso: "EE", nombre: "Estonia", prefijo: "+372" },
  { iso: "SZ", nombre: "Esuatini", prefijo: "+268" },
  { iso: "ET", nombre: "Etiopía", prefijo: "+251" },
  { iso: "PH", nombre: "Filipinas", prefijo: "+63" },
  { iso: "FI", nombre: "Finlandia", prefijo: "+358" },
  { iso: "FJ", nombre: "Fiyi", prefijo: "+679" },
  { iso: "FR", nombre: "Francia", prefijo: "+33" },
  { iso: "GA", nombre: "Gabón", prefijo: "+241" },
  { iso: "GM", nombre: "Gambia", prefijo: "+220" },
  { iso: "GE", nombre: "Georgia", prefijo: "+995" },
  { iso: "GH", nombre: "Ghana", prefijo: "+233" },
  { iso: "GI", nombre: "Gibraltar", prefijo: "+350" },
  { iso: "GD", nombre: "Granada", prefijo: "+1" },
  { iso: "GR", nombre: "Grecia", prefijo: "+30" },
  { iso: "GL", nombre: "Groenlandia", prefijo: "+299" },
  { iso: "GT", nombre: "Guatemala", prefijo: "+502" },
  { iso: "GN", nombre: "Guinea", prefijo: "+224" },
  { iso: "GQ", nombre: "Guinea Ecuatorial", prefijo: "+240" },
  { iso: "GW", nombre: "Guinea-Bisáu", prefijo: "+245" },
  { iso: "GY", nombre: "Guyana", prefijo: "+592" },
  { iso: "HT", nombre: "Haití", prefijo: "+509" },
  { iso: "HN", nombre: "Honduras", prefijo: "+504" },
  { iso: "HK", nombre: "Hong Kong", prefijo: "+852" },
  { iso: "HU", nombre: "Hungría", prefijo: "+36" },
  { iso: "IN", nombre: "India", prefijo: "+91" },
  { iso: "ID", nombre: "Indonesia", prefijo: "+62" },
  { iso: "IQ", nombre: "Irak", prefijo: "+964" },
  { iso: "IR", nombre: "Irán", prefijo: "+98" },
  { iso: "IE", nombre: "Irlanda", prefijo: "+353" },
  { iso: "IS", nombre: "Islandia", prefijo: "+354" },
  { iso: "MH", nombre: "Islas Marshall", prefijo: "+692" },
  { iso: "SB", nombre: "Islas Salomón", prefijo: "+677" },
  { iso: "IL", nombre: "Israel", prefijo: "+972" },
  { iso: "IT", nombre: "Italia", prefijo: "+39" },
  { iso: "JM", nombre: "Jamaica", prefijo: "+1" },
  { iso: "JP", nombre: "Japón", prefijo: "+81" },
  { iso: "JO", nombre: "Jordania", prefijo: "+962" },
  { iso: "KZ", nombre: "Kazajistán", prefijo: "+7" },
  { iso: "KE", nombre: "Kenia", prefijo: "+254" },
  { iso: "KG", nombre: "Kirguistán", prefijo: "+996" },
  { iso: "KW", nombre: "Kuwait", prefijo: "+965" },
  { iso: "LA", nombre: "Laos", prefijo: "+856" },
  { iso: "LS", nombre: "Lesoto", prefijo: "+266" },
  { iso: "LV", nombre: "Letonia", prefijo: "+371" },
  { iso: "LB", nombre: "Líbano", prefijo: "+961" },
  { iso: "LR", nombre: "Liberia", prefijo: "+231" },
  { iso: "LY", nombre: "Libia", prefijo: "+218" },
  { iso: "LI", nombre: "Liechtenstein", prefijo: "+423" },
  { iso: "LT", nombre: "Lituania", prefijo: "+370" },
  { iso: "LU", nombre: "Luxemburgo", prefijo: "+352" },
  { iso: "MK", nombre: "Macedonia del Norte", prefijo: "+389" },
  { iso: "MG", nombre: "Madagascar", prefijo: "+261" },
  { iso: "MY", nombre: "Malasia", prefijo: "+60" },
  { iso: "MW", nombre: "Malaui", prefijo: "+265" },
  { iso: "MV", nombre: "Maldivas", prefijo: "+960" },
  { iso: "ML", nombre: "Malí", prefijo: "+223" },
  { iso: "MT", nombre: "Malta", prefijo: "+356" },
  { iso: "MA", nombre: "Marruecos", prefijo: "+212" },
  { iso: "MU", nombre: "Mauricio", prefijo: "+230" },
  { iso: "MR", nombre: "Mauritania", prefijo: "+222" },
  { iso: "FM", nombre: "Micronesia", prefijo: "+691" },
  { iso: "MD", nombre: "Moldavia", prefijo: "+373" },
  { iso: "MC", nombre: "Mónaco", prefijo: "+377" },
  { iso: "MN", nombre: "Mongolia", prefijo: "+976" },
  { iso: "ME", nombre: "Montenegro", prefijo: "+382" },
  { iso: "MZ", nombre: "Mozambique", prefijo: "+258" },
  { iso: "MM", nombre: "Myanmar", prefijo: "+95" },
  { iso: "NA", nombre: "Namibia", prefijo: "+264" },
  { iso: "NR", nombre: "Nauru", prefijo: "+674" },
  { iso: "NP", nombre: "Nepal", prefijo: "+977" },
  { iso: "NI", nombre: "Nicaragua", prefijo: "+505" },
  { iso: "NE", nombre: "Níger", prefijo: "+227" },
  { iso: "NG", nombre: "Nigeria", prefijo: "+234" },
  { iso: "NO", nombre: "Noruega", prefijo: "+47" },
  { iso: "NZ", nombre: "Nueva Zelanda", prefijo: "+64" },
  { iso: "OM", nombre: "Omán", prefijo: "+968" },
  { iso: "NL", nombre: "Países Bajos", prefijo: "+31" },
  { iso: "PK", nombre: "Pakistán", prefijo: "+92" },
  { iso: "PW", nombre: "Palaos", prefijo: "+680" },
  { iso: "PS", nombre: "Palestina", prefijo: "+970" },
  { iso: "PA", nombre: "Panamá", prefijo: "+507" },
  { iso: "PG", nombre: "Papúa Nueva Guinea", prefijo: "+675" },
  { iso: "PL", nombre: "Polonia", prefijo: "+48" },
  { iso: "PT", nombre: "Portugal", prefijo: "+351" },
  { iso: "PR", nombre: "Puerto Rico", prefijo: "+1" },
  { iso: "GB", nombre: "Reino Unido", prefijo: "+44" },
  { iso: "CF", nombre: "República Centroafricana", prefijo: "+236" },
  { iso: "CZ", nombre: "República Checa", prefijo: "+420" },
  { iso: "CD", nombre: "República Democrática del Congo", prefijo: "+243" },
  { iso: "DO", nombre: "República Dominicana", prefijo: "+1" },
  { iso: "RW", nombre: "Ruanda", prefijo: "+250" },
  { iso: "RO", nombre: "Rumanía", prefijo: "+40" },
  { iso: "RU", nombre: "Rusia", prefijo: "+7" },
  { iso: "WS", nombre: "Samoa", prefijo: "+685" },
  { iso: "KN", nombre: "San Cristóbal y Nieves", prefijo: "+1" },
  { iso: "SM", nombre: "San Marino", prefijo: "+378" },
  { iso: "VC", nombre: "San Vicente y las Granadinas", prefijo: "+1" },
  { iso: "LC", nombre: "Santa Lucía", prefijo: "+1" },
  { iso: "ST", nombre: "Santo Tomé y Príncipe", prefijo: "+239" },
  { iso: "SN", nombre: "Senegal", prefijo: "+221" },
  { iso: "RS", nombre: "Serbia", prefijo: "+381" },
  { iso: "SC", nombre: "Seychelles", prefijo: "+248" },
  { iso: "SL", nombre: "Sierra Leona", prefijo: "+232" },
  { iso: "SG", nombre: "Singapur", prefijo: "+65" },
  { iso: "SY", nombre: "Siria", prefijo: "+963" },
  { iso: "SO", nombre: "Somalia", prefijo: "+252" },
  { iso: "LK", nombre: "Sri Lanka", prefijo: "+94" },
  { iso: "ZA", nombre: "Sudáfrica", prefijo: "+27" },
  { iso: "SD", nombre: "Sudán", prefijo: "+249" },
  { iso: "SS", nombre: "Sudán del Sur", prefijo: "+211" },
  { iso: "SE", nombre: "Suecia", prefijo: "+46" },
  { iso: "CH", nombre: "Suiza", prefijo: "+41" },
  { iso: "SR", nombre: "Surinam", prefijo: "+597" },
  { iso: "TH", nombre: "Tailandia", prefijo: "+66" },
  { iso: "TW", nombre: "Taiwán", prefijo: "+886" },
  { iso: "TZ", nombre: "Tanzania", prefijo: "+255" },
  { iso: "TJ", nombre: "Tayikistán", prefijo: "+992" },
  { iso: "TL", nombre: "Timor Oriental", prefijo: "+670" },
  { iso: "TG", nombre: "Togo", prefijo: "+228" },
  { iso: "TO", nombre: "Tonga", prefijo: "+676" },
  { iso: "TT", nombre: "Trinidad y Tobago", prefijo: "+1" },
  { iso: "TN", nombre: "Túnez", prefijo: "+216" },
  { iso: "TM", nombre: "Turkmenistán", prefijo: "+993" },
  { iso: "TR", nombre: "Turquía", prefijo: "+90" },
  { iso: "TV", nombre: "Tuvalu", prefijo: "+688" },
  { iso: "UA", nombre: "Ucrania", prefijo: "+380" },
  { iso: "UG", nombre: "Uganda", prefijo: "+256" },
  { iso: "UZ", nombre: "Uzbekistán", prefijo: "+998" },
  { iso: "VU", nombre: "Vanuatu", prefijo: "+678" },
  { iso: "VN", nombre: "Vietnam", prefijo: "+84" },
  { iso: "YE", nombre: "Yemen", prefijo: "+967" },
  { iso: "DJ", nombre: "Yibuti", prefijo: "+253" },
  { iso: "ZM", nombre: "Zambia", prefijo: "+260" },
  { iso: "ZW", nombre: "Zimbabue", prefijo: "+263" },
];

const CABEZA: Pais[] = [
  { iso: "ES", nombre: "España", prefijo: "+34" },
  { iso: "AR", nombre: "Argentina", prefijo: "+54" },
  { iso: "US", nombre: "Estados Unidos", prefijo: "+1" },
  { iso: "VE", nombre: "Venezuela", prefijo: "+58" },
  { iso: "MX", nombre: "México", prefijo: "+52" },
  { iso: "CO", nombre: "Colombia", prefijo: "+57" },
  { iso: "CL", nombre: "Chile", prefijo: "+56" },
  { iso: "PE", nombre: "Perú", prefijo: "+51" },
  { iso: "UY", nombre: "Uruguay", prefijo: "+598" },
  { iso: "PY", nombre: "Paraguay", prefijo: "+595" },
];

/** "Otro" cierra la lista: para lo desconocido, sin inventar prefijo. */
const OTRO: Pais = { iso: "XX", nombre: "Otro", prefijo: "" };
// `banderaDe("XX")` daría 🇽🇽, que se dibuja como dos letras en cajita: se omite
// sola porque `etiquetaDe` solo añade la bandera si existe... y XX no es un país
// real, así que se filtra explícitamente abajo.

export const PAISES: Pais[] = [...CABEZA, ...RESTO, OTRO];

/**
 * ISO de dos letras → bandera, con los *regional indicator symbols* de Unicode.
 * Se calcula en vez de guardarse: así la tabla no puede desincronizarse.
 */
export function banderaDe(iso: string): string {
  const c = (iso ?? "").trim().toUpperCase();
  if (c === "XX") return ""; // "Otro" no es un país: no tiene bandera
  if (!/^[A-Z]{2}$/.test(c)) return "";
  return String.fromCodePoint(...[...c].map((l) => 0x1f1e6 + l.charCodeAt(0) - 65));
}

/** null si no se conoce: nunca se inventa un prefijo (así nació +593595000111222). */
export function paisPorIso(iso: string): Pais | null {
  const c = (iso ?? "").trim().toUpperCase();
  return PAISES.find((p) => p.iso === c) ?? null;
}

/**
 * "Paraguay 🇵🇾 (+595)" — el nombre PRIMERO a propósito: el salto por teclado del
 * <select> nativo hace prefix-match sobre el texto de la opción, así que con la
 * bandera delante teclear "par" no llevaría a Paraguay y habría que recorrer a
 * mano una lista de casi 200. Elegir el país de al lado es otro prefijo
 * equivocado guardado en silencio.
 */
export function etiquetaDe(p: Pais): string {
  const b = banderaDe(p.iso);
  return `${p.nombre}${b ? ` ${b}` : ""}${p.prefijo ? ` (${p.prefijo})` : ""}`;
}
