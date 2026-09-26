/** Catálogo de sprints: tabla de conteos, presentacional.
 *
 * No conoce hooks ni red. Recibe el catálogo ya filtrado por la página y emite
 * `onElegir` con la ruta completa del sprint elegido.
 */

import type { Sprint } from "../api/tipos";
import { fechaCorta, porcentaje } from "./fechas";

export function TablaSprints({
  sprints,
  rutaActual = "",
  onElegir,
}: {
  sprints: Sprint[];
  /** Ruta completa del sprint seleccionado, para marcarlo. */
  rutaActual?: string;
  onElegir: (ruta: string) => void;
}) {
  return (
    <div className="tabla-scroll">
      <table className="tabla">
        <caption className="visualmente-oculto">
          Sprints detectados con sus conteos de ítems
        </caption>
        <thead>
          <tr>
            <th scope="col">Sprint</th>
            <th scope="col" className="td-der">
              Ítems
            </th>
            <th scope="col" className="td-der">
              Abiertos
            </th>
            <th scope="col" className="td-der">
              Cerrados
            </th>
            <th scope="col" className="td-der">
              Personas
            </th>
            <th scope="col">Último cambio</th>
            <th scope="col">
              <span className="visualmente-oculto">Acción</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sprints.map((sprint) => {
            const cerrado = porcentaje(sprint.cerrados, sprint.total);
            const activo = sprint.ruta === rutaActual;
            return (
              <tr key={sprint.ruta} data-activo={activo ? "true" : undefined}>
                <th scope="row">
                  {sprint.nombre}
                  {activo && <span className="badge-estado"> filtrando</span>}
                </th>
                <td className="td-der">
                  {sprint.total}
                  <span className="texto-suave small"> · {cerrado}% cerrado</span>
                </td>
                <td className="td-der">{sprint.abiertos}</td>
                <td className="td-der">{sprint.cerrados}</td>
                <td className="td-der">{sprint.personas}</td>
                <td>{fechaCorta(sprint.ultimo_cambio)}</td>
                <td>
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => onElegir(sprint.ruta)}
                    disabled={activo}
                  >
                    {activo ? "Viendo" : "Ver sprint"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
