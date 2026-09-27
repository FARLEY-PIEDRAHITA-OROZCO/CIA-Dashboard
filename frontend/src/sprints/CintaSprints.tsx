/** Cinta de sprints: la secuencia como visual, no como tabla de 37 filas.
 *
 * Es el componente que sustituye al catálogo en tabla. Cada columna es un
 * sprint en orden cronológico; la altura es su volumen y el relleno su cierre.
 * La marca inferior son los ítems que ese sprint dejó sin cerrar (rezago).
 *
 * Fusiona en un solo visual lo que antes ocupaba dos zonas —la tabla de 37 filas
 * y la señal ③ de rezago— porque el rezago de un sprint histórico es
 * exactamente su número de ítems abiertos, un dato que `/api/sprints` ya
 * devuelve.
 *
 * Presentacional: recibe columnas ya calculadas y emite `onElegir`. No conoce
 * hooks ni red.
 */

import { describirColumna, tonoColumna } from "./cinta";
import type { ColumnaCinta } from "./cinta";

export function CintaSprints({
  columnas,
  rutaActual = "",
  onElegir,
}: {
  columnas: ColumnaCinta[];
  /** Ruta del sprint seleccionado, para marcarlo. */
  rutaActual?: string;
  onElegir: (ruta: string) => void;
}) {
  return (
    <div className="cinta-scroll">
      <ul className="cinta" aria-label="Sprints en orden cronológico">
        {columnas.map((columna) => {
          const activo = columna.ruta === rutaActual;
          const alto = Math.max(3, Math.round(columna.magnitud * 100));
          return (
            <li className="cinta-item" key={columna.ruta}>
              <button
                type="button"
                className="cinta-barra"
                data-tono={tonoColumna(columna)}
                data-activo={activo ? "true" : undefined}
                data-actual={columna.actual ? "true" : undefined}
                onClick={() => onElegir(columna.ruta)}
                disabled={activo}
                aria-pressed={activo}
                title={describirColumna(columna)}
                style={{ height: `${alto}%` }}
              >
                <span className="cinta-cierre" style={{ height: `${columna.cierre * 100}%` }} />
                {columna.rezago > 0 && (
                  <span
                    className="cinta-rezago"
                    title={`${columna.rezago} ítems sin cerrar`}
                    data-riesgo={columna.rezago > 40 ? "alto" : "medio"}
                  />
                )}
              </button>
              <span className="visualmente-oculto">{describirColumna(columna)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
