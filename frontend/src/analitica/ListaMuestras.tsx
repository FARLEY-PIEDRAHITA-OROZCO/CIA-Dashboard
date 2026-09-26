/** Lista de muestras de una señal de analítica: presentacional.
 *
 * Se usa en las tres señales (brecha, aging, rezago). No conoce hooks: recibe
 * los ítems ya ordenados y un `vacio` con el texto a mostrar cuando no hay nada.
 */

import type { MuestraItem } from "../api/tipos";
import { antiguedadLegible } from "../sprints/fechas";

export function ListaMuestras({
  items,
  vacio,
  mostrarSprint = true,
  limite = 20,
}: {
  items: MuestraItem[];
  /** Texto a mostrar si la lista está vacía. */
  vacio: string;
  mostrarSprint?: boolean;
  /** Cuántos se muestran; el resto se resume como «y N más». */
  limite?: number;
}) {
  if (items.length === 0) {
    return <p className="texto-suave">{vacio}</p>;
  }
  const visibles = items.slice(0, limite);
  const resto = items.length - visibles.length;

  return (
    <>
      <ul className="arbol-hus">
        {visibles.map((item) => (
          <li key={`${item.tipo}-${item.azure_id}`}>
            <span className="monospace texto-suave small">#{item.azure_id}</span>{" "}
            <strong>{item.titulo || "(sin título)"}</strong>{" "}
            <span className="badge-estado">{item.estado || "—"}</span>
            {item.persona && <span className="texto-suave small"> · {item.persona}</span>}
            {mostrarSprint && item.sprint && (
              <span className="texto-suave small"> · {item.sprint}</span>
            )}
            {item.modificado && (
              <span className="texto-suave small"> · {antiguedadLegible(item.modificado)}</span>
            )}
          </li>
        ))}
      </ul>
      {resto > 0 && (
        <p className="texto-suave small">
          y {resto} más no se muestran aquí (la lista está limitada a {limite}).
        </p>
      )}
    </>
  );
}
