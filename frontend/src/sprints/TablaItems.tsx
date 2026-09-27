/** Tabla de ítems del índice local: presentacional.
 *
 * Muestra la proyección plana (`ItemIndice`) con sprint, responsable y fecha de
 * cambio. El orden y el filtrado llegan ya resueltos desde la página.
 */

import type { ItemIndice } from "../api/tipos";
import { EstadoTrabajo } from "../componentes/EstadoTrabajo";
import { antiguedadLegible } from "./fechas";

const TOPE_TAGS = 3;

/** badges de tags */
function tagsDe(item: ItemIndice): string[] {
  if (!item.tags) return [];
  return item.tags
    .replace(/;/g, ",")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export function TablaItems({
  items,
  total,
  offset = 0,
  etiquetaConteo = "ítems",
}: {
  items: ItemIndice[];
  /** Total real antes de paginar. */
  total: number;
  /** Desplazamiento de esta ventana, para numerar los rangos con verdad. */
  offset?: number;
  etiquetaConteo?: string;
}) {
  return (
    <>
      {/* Sin `role="status"`: es texto estático dentro de una tabla que ya tiene
          su propio estado de carga, y otra región viva haría que un lector de
          pantalla anuncie los dos. */}
      <p className="texto-suave small">
        Mostrando {offset + 1}–{offset + items.length} de {total} {etiquetaConteo}
      </p>
      <div className="tabla-scroll">
        <table className="tabla">
          <caption className="visualmente-oculto">
            {etiquetaConteo} del índice local filtrados
          </caption>
          <thead>
            <tr>
              <th scope="col">ID</th>
              <th scope="col">Título</th>
              <th scope="col">Tipo</th>
              <th scope="col">Estado</th>
              <th scope="col">Responsable</th>
              <th scope="col">Sprint</th>
              <th scope="col">Etiquetas</th>
              <th scope="col">Cambio</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const tags = tagsDe(item);
              const extra = tags.length - TOPE_TAGS;
              return (
                <tr key={item.azure_id}>
                  <td className="monospace">
                    <a
                      className="enlace-externo"
                      href={`https://dev.azure.com/organizacion/_workitems/edit/${item.azure_id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {item.azure_id}
                    </a>
                  </td>
                  <td>{item.titulo || <span className="texto-suave">(sin título)</span>}</td>
                  <td>{item.tipo}</td>
                  <td>
                    {/* `EstadoTrabajo` es la regla única de toda la app para el
                        tono de un estado. Aquí se duplicaba, y la copia
                        contradecía al resto: «Removed» salía verde (como
                        cerrado) y «Testing» salía gris (como sin empezar). */}
                    <EstadoTrabajo estado={item.estado} />
                  </td>
                  <td>{item.persona?.nombre || <span className="texto-suave">sin asignar</span>}</td>
                  <td className="small">{item.sprint.split("\\").pop() || "—"}</td>
                  <td className="small">
                    {tags.slice(0, TOPE_TAGS).map((t) => (
                      <span className="chip" key={t}>
                        {t}
                      </span>
                    ))}
                    {extra > 0 && <span className="texto-suave"> +{extra}</span>}
                  </td>
                  <td className="small texto-suave">{antiguedadLegible(item.modificado)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
