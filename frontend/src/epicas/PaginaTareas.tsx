import type { Epic } from "../api/tipos";
import { ContenidoRico } from "../componentes/ContenidoRico";
import { EstadoTrabajo } from "../componentes/EstadoTrabajo";
import { CajaVacia, Cargando, ErrorAlerta } from "../componentes/retroalimentacion";
import { enlaceA } from "../navegacion";
import { useArbolEpica, useEstadoAzure } from "./hooks";
import { aplanarTareas, TableroTareas } from "./TableroTareas";

function CabeceraEpicaTareas({ epica }: { epica: Epic }) {
  const tareas = aplanarTareas(epica);
  return (
    <div className="cabecera-epica">
      <header className="cabecera-epica-titulos">
        <div>
          <p className="monospace texto-suave small">Épica #{epica.azure_id}</p>
          <h1 tabIndex={-1}>{epica.titulo || "—"}</h1>
        </div>
        <div className="acciones">
          <EstadoTrabajo estado={epica.estado} />
          {epica.url && (
            <a
              className="btn secundario"
              href={epica.url}
              target="_blank"
              rel="noreferrer"
            >
              Abrir en Azure ↗
            </a>
          )}
        </div>
      </header>
      <ContenidoRico html={epica.descripcion} />
      <p className="texto-suave small">
        {epica.features.length} feature(s) · {tareas.length} {tareas.length === 1 ? "tarea" : "tareas"} del backlog
      </p>
    </div>
  );
}

/** Página dedicada a las tareas de una épica (ruta `#/epicas/{id}/tareas`). */
export function PaginaTareas({ azureId }: { azureId: number }) {
  const arbol = useArbolEpica(azureId, true);
  const estadoAzure = useEstadoAzure();
  const edicionHabilitada = Boolean(estadoAzure.data?.configurada);

  return (
    <div className="pagina">
      <nav className="migas" aria-label="Navegación">
        <a className="enlace-externo small" href={enlaceA({ pagina: "epica", azureId })}>
          ← Volver a historias
        </a>
      </nav>

      {arbol.isFetching && !arbol.data ? (
        <Cargando texto="Cargando tareas de la épica…" />
      ) : arbol.isError ? (
        <ErrorAlerta
          mensaje={`No se pudieron cargar las tareas: ${
            arbol.error instanceof Error ? arbol.error.message : String(arbol.error)
          }`}
        />
      ) : arbol.data ? (
        (() => {
          const epica = arbol.data;
          const tareas = aplanarTareas(epica);
          return (
            <>
              <CabeceraEpicaTareas epica={epica} />
              {tareas.length > 0 ? (
                <TableroTareas tareas={tareas} edicionHabilitada={edicionHabilitada} />
              ) : (
                <CajaVacia mensaje="Esta épica no tiene tareas todavía." />
              )}
            </>
          );
        })()
      ) : null}
    </div>
  );
}
