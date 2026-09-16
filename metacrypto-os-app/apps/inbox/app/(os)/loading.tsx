/**
 * Pantalla de carga de TODAS las rutas del OS.
 *
 * Antes no existía ninguna: las 16 páginas son `force-dynamic` y hacen 3–4
 * lecturas REST en paralelo, así que al pulsar una entrada del menú la
 * pantalla ANTERIOR se quedaba congelada varios segundos, sin ningún cambio
 * visible. El usuario no distingue eso de un clic que no ha entrado, y vuelve
 * a pulsar.
 *
 * Next lo monta solo mientras el componente de servidor de la ruta resuelve.
 * Al vivir en `(os)/`, sale DENTRO del layout: la navegación lateral no
 * parpadea y el sitio no se descuadra al aparecer el contenido real.
 *
 * Imita la plana que traen casi todas las pantallas —título, cuatro KPIs y
 * una tabla— para que lo que llega después caiga donde el ojo ya estaba
 * mirando, en vez de empujarlo.
 *
 * Los anchos desiguales de las filas los pone el CSS por `nth-child`, no un
 * `style` en línea: el spec de dirección pide cero estilos en el markup, y
 * aquí no hacen falta.
 */
export default function CargandoOs() {
  return (
    <div className="page" aria-busy="true" aria-live="polite">
      {/* La única palabra de la pantalla, y solo para lector de pantalla: un
          esqueleto es evidente mirándolo y mudo si no lo ves. */}
      <span className="sr">Cargando…</span>

      <div className="page-head">
        <div className="sk sk-h1" />
        <div className="sk sk-sub" />
      </div>

      <div className="kpis" aria-hidden="true">
        <div className="sk sk-kpi" />
        <div className="sk sk-kpi" />
        <div className="sk sk-kpi" />
        <div className="sk sk-kpi" />
      </div>

      <div className="card sk-tabla" aria-hidden="true">
        <div className="card-head">
          <div className="sk sk-linea sk-titulo" />
        </div>
        <div className="card-body">
          {/* Seis filas: suficientes para leerse como una tabla, pocas para no
              prometer un alto que luego no se cumpla. */}
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div className="sk-fila" key={i}>
              <div className="sk sk-linea sk-nombre" />
              <div className="sk sk-linea sk-cifra" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
