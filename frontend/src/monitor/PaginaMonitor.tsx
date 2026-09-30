/** Página del monitor de llamadas a Azure DevOps.
 *
 * Muestra cuántas peticiones ha hecho el backend, de qué tipo, cuánto han
 * tardado y cuántas han fallado. Es una herramienta de diagnóstico para
 * entender el coste real de cada vista.
 *
 * El monitor está apagado por defecto (MONITOR_HABILITADA=false). Para
 * encenderlo, añade esa variable al .env del backend y reinicia.
 */

import { Cargando, ErrorAlerta } from "../componentes/retroalimentacion";
import { useMonitorAzure } from "./hooks";

function formatearMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function formatearHora(hora: string): string {
  try {
    return new Date(hora).toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return hora;
  }
}

export default function PaginaMonitor() {
  const { data: datos, error, isLoading } = useMonitorAzure();

  if (isLoading) return <Cargando texto="Cargando monitor de Azure…" />;
  if (error) return <ErrorAlerta mensaje={error.message} />;
  if (!datos) {
    return (
      <div className="pagina">
        <div className="cabecera-pagina">
          <div>
            <h1>Monitor de Azure</h1>
            <p className="texto-suave small">
              El monitor está apagado. Actívalo con{" "}
              <code>MONITOR_HABILITADA=true</code> en el .env del backend y
              reinicia.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const categorias = Object.entries(datos.porCategoria).sort(
    (a, b) => b[1] - a[1],
  );

  return (
    <div className="pagina">
      <div className="cabecera-pagina">
        <div>
          <h1>Monitor de Azure</h1>
          <p className="texto-suave small">
            Peticiones del backend a Azure DevOps en esta sesión
          </p>
        </div>
      </div>

      {datos.avisos.length > 0 && (
        <div className="panel-monitor">
          <h2 className="actividad-subtitulo">Avisos</h2>
          <ul className="lista-avisos">
            {datos.avisos.map((aviso, i) => (
              <li key={i} className="texto-suave small">
                {aviso}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="kpis">
        <div className="kpi">
          <div className="kpi-valor" data-tono="acento">
            {datos.total}
          </div>
          <div className="kpi-etiqueta">Peticiones</div>
        </div>
        <div className="kpi">
          <div
            className="kpi-valor"
            data-tono={datos.errores > 0 ? "alerta" : "ok"}
          >
            {datos.errores}
          </div>
          <div className="kpi-etiqueta">Errores</div>
        </div>
        <div className="kpi">
          <div className="kpi-valor" data-tono="neutro">
            {(datos.tasaError * 100).toFixed(1)}%
          </div>
          <div className="kpi-etiqueta">Tasa de error</div>
        </div>
        <div className="kpi">
          <div className="kpi-valor" data-tono="neutro">
            {formatearMs(datos.latenciaP95Ms)}
          </div>
          <div className="kpi-etiqueta">Latencia p95</div>
        </div>
      </div>

      <section className="panel-monitor">
        <h2 className="actividad-subtitulo">Por categoría</h2>
        <ul className="lista-barras">
          {categorias.map(([nombre, cantidad]) => (
            <li key={nombre} className="barra-fila">
              <span className="barra-etiqueta">{nombre}</span>
              <span className="barra-pista">
                <span
                  className="barra-relleno"
                  style={{
                    width: `${datos.total > 0 ? (cantidad / datos.total) * 100 : 0}%`,
                  }}
                />
              </span>
              <span className="barra-valor monospace">{cantidad}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel-monitor">
        <h2 className="actividad-subtitulo">Llamadas recientes</h2>
        {datos.llamadasRecientes.length === 0 ? (
          <p className="texto-suave small">Sin llamadas registradas.</p>
        ) : (
          <div className="tabla-scroll">
            <table className="tabla">
              <caption className="visualmente-oculto">
                Últimas llamadas a Azure DevOps
              </caption>
              <thead>
                <tr>
                  <th scope="col">Hora</th>
                  <th scope="col">Método</th>
                  <th scope="col">Categoría</th>
                  <th scope="col">Estado</th>
                  <th className="td-der" scope="col">Duración</th>
                </tr>
              </thead>
              <tbody>
                {datos.llamadasRecientes.map((llamada, i) => (
                  <tr key={`${llamada.hora}-${i}`}>
                    <td className="monospace small">
                      {formatearHora(llamada.hora)}
                    </td>
                    <td className="monospace">{llamada.metodo}</td>
                    <td>{llamada.categoria}</td>
                    <td>
                      <span
                        className="chip-rol"
                        data-rol={llamada.estado >= 400 ? "error" : "ok"}
                      >
                        {llamada.estado}
                      </span>
                    </td>
                    <td className="td-der monospace">
                      {formatearMs(llamada.duracionMs)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
