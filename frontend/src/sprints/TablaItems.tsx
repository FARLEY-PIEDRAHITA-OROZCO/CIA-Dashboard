/** Tabla de ítems del índice local: presentacional.
 *
 * Muestra la proyección plana (`ItemIndice`) con sprint, responsable y fecha de
 * cambio. El orden y el filtrado llegan ya resueltos desde la página.
 */

import type { ItemIndice } from "../api/tipos";
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
  etiquetaConteo = "ítems",
}: {
  items: ItemIndice[];
  /** Total real antes del tope del backend (200). */
  total: number;
  etiquetaConteo?: string;
}) {
  return (
    <>
      <p className="texto-suave small" role="status">
        Mostrando {items.length} de {total} {etiquetaConteo}
        {total > items.length && " (el backend limita a 200 por respuesta)"}
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
                    <span
                      className={`badge-estado ${
                        item.cerrado
                          ? "estado-terminado"
                          : item.estado.toLowerCase().includes("progress") ||
                              item.estado.toLowerCase().includes("active")
                            ? "estado-progreso"
                            : "estado-nuevo"
                      }`}
                    >
                      {item.estado || "—"}
                    </span>
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
