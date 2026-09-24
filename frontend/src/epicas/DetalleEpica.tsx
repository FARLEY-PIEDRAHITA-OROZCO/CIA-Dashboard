import type { Epic } from "../api/tipos";
import { ContenidoRico } from "../componentes/ContenidoRico";
import { EstadoTrabajo } from "../componentes/EstadoTrabajo";
import { irA } from "../navegacion";
import { aplanarTareas } from "./TableroTareas";

/** Total de historias de usuario de la épica (directas + las de las Features). */
function totalHistorias(epica: Epic): number {
  return (
    epica.hus.length +
    epica.features.reduce((n, f) => n + f.hus.length, 0)
  );
}

/** Resumen de la épica dentro de la fila expandida: descripción, features y
 * acceso a las páginas dedicadas de historias y de tareas. */
export function DetalleEpica({ epica }: { epica: Epic }) {
  const totalHus = totalHistorias(epica);
  const totalTareas = aplanarTareas(epica).length;

  return (
    <div className="detalle-epica">
      <ContenidoRico html={epica.descripcion} />

      <div className="fila-resumen">
        <p className="texto-suave small">
          {epica.features.length} feature(s) · {totalHus} historias de usuario ·{" "}
          {totalTareas} tareas de usuario
        </p>
        <button
          type="button"
          className="btn primario small"
          disabled={totalHus === 0}
          onClick={() => irA({ pagina: "epica", azureId: epica.azure_id })}
        >
          Ver historias de usuario ({totalHus}) ↗
        </button>
        <button
          type="button"
          className="btn secundario small"
          disabled={totalTareas === 0}
          onClick={() => irA({ pagina: "epicaTareas", azureId: epica.azure_id })}
        >
          Ver tareas de usuario ({totalTareas}) ↗
        </button>
      </div>

      {epica.features.length > 0 ? (
        <ul className="lista-features">
          {epica.features.map((f) => (
            <li className="item-feature" key={f.azure_id}>
              <div className="item-feature-cabecera">
                <span className="monospace arb-id">#{f.azure_id}</span>
                <span className="arb-titulo">{f.titulo || "—"}</span>
                <EstadoTrabajo estado={f.estado} />
                <span className="monospace small">historia(s): {f.hus.length}</span>
              </div>
              {f.descripcion && f.descripcion.trim() && (
                <div className="item-feature-descripcion">
                  <ContenidoRico html={f.descripcion} />
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        totalHus === 0 && (
          <p className="texto-suave small">Esta épica no tiene elementos hijos.</p>
        )
      )}

      {epica.url && (
        <a
          className="enlace-externo small"
          href={epica.url}
          target="_blank"
          rel="noreferrer"
        >
          Abrir la épica en Azure DevOps ↗
        </a>
      )}
    </div>
  );
}
