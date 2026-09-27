/** Cinta de cobertura: cuánto de cada sprint está probado, como secuencia.
 *
 * Reutiliza el lenguaje visual de la cinta de sprints (mismas clases, mismas
 * alturas relativas) pero con la barra **apilada** en vez de rellena: aquí la
 * parte buena y la parte que falta se reparten el mismo espacio, y una barra
 * medio verde medio roja se lee sin hacer ninguna división mental.
 *
 * La parte de arriba es la que falta. Va arriba, y no abajo, porque es lo que hay
 * que mirar: una columna con la parte naranja en la base se leería como «esto va
 * bien por abajo», que es justo el mensaje equivocado.
 *
 * Presentacional: recibe columnas ya calculadas y emite `onElegir`. No conoce
 * hooks ni red.
 */

import { describirColumna, tonoColumna } from "./cobertura";
import type { ColumnaCobertura } from "./cobertura";

export function CintaCobertura({
  columnas,
  rutaActual = "",
  onElegir,
}: {
  columnas: ColumnaCobertura[];
  /** Ruta del sprint seleccionado, para marcarlo. */
  rutaActual?: string;
  onElegir: (ruta: string) => void;
}) {
  return (
    <div className="cinta-scroll">
      <ul className="cinta" aria-label="Cobertura de pruebas por sprint">
        {columnas.map((columna) => {
          const activo = columna.ruta === rutaActual;
          const alto = Math.max(3, Math.round(columna.magnitud * 100));
          return (
            <li className="cinta-item" key={columna.ruta}>
              <button
                type="button"
                className="cinta-barra cinta-apilada"
                data-tono={tonoColumna(columna)}
                data-activo={activo ? "true" : undefined}
                onClick={() => onElegir(columna.ruta)}
                disabled={activo}
                aria-pressed={activo}
                title={describirColumna(columna)}
                style={{ height: `${alto}%` }}
              >
                {/* Abajo: lo cubierto. Arriba: lo que falta. La parte cubierta
                    lleva su propia altura y la del hueco ocupa el resto, así que
                    el reparto es exacto con cualquier fracción. */}
                <span
                  className="cinta-parte cinta-cubierta"
                  style={{ height: `${columna.cobertura * 100}%` }}
                />
                <span className="cinta-parte cinta-hueco" />
              </button>
              <span className="visualmente-oculto">{describirColumna(columna)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
