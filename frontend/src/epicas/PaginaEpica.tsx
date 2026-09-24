import type { Epic } from "../api/tipos";
import { ContenidoRico } from "../componentes/ContenidoRico";
import { EstadoTrabajo } from "../componentes/EstadoTrabajo";
import { CajaVacia, Cargando, ErrorAlerta } from "../componentes/retroalimentacion";
import { enlaceA } from "../navegacion";
import { useArbolEpica } from "./hooks";
import { aplanarHistorias, TableroHistorias } from "./TableroHistorias";
import { aplanarTareas } from "./TableroTareas";

function CabeceraEpica({ epica }: { epica: Epic }) {
  const historias = aplanarHistorias(epica);
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
          {tareas.length > 0 && (
            <a
              className="btn secundario"
              href={enlaceA({ pagina: "epicaTareas", azureId: epica.azure_id })}
            >
              Ver tareas ({tareas.length}) ↗
            </a>
          )}
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
        {epica.features.length} feature(s) · {historias.length} {historias.length === 1 ? "historia de usuario" : "historias de usuario"} · {tareas.length} {tareas.length === 1 ? "tarea" : "tareas"}
      </p>
    </div>
  );
}

/** Página dedicada a las historias de una épica (ruta `#/epicas/{id}`). */
export function PaginaEpica({ azureId }: { azureId: number }) {
  const arbol = useArbolEpica(azureId);

  return (
    <div className="pagina">
      <nav className="migas" aria-label="Navegación">
        <a className="enlace-externo small" href={enlaceA({ pagina: "dashboard" })}>
          ← Volver al backlog
        </a>
      </nav>

      {arbol.isFetching && !arbol.data ? (
        <Cargando texto="Cargando historias de la épica…" />
      ) : arbol.isError ? (
        <ErrorAlerta
          mensaje={`No se pudieron cargar las historias: ${
            arbol.error instanceof Error ? arbol.error.message : String(arbol.error)
          }`}
        />
      ) : arbol.data ? (
        (() => {
          const epica = arbol.data;
          const historias = aplanarHistorias(epica);
          return (
            <>
              <CabeceraEpica epica={epica} />
              {historias.length > 0 ? (
                <TableroHistorias historias={historias} features={epica.features} />
              ) : (
                <CajaVacia mensaje="Esta épica no tiene historias de usuario todavía." />
              )}
            </>
          );
        })()
      ) : null}
    </div>
  );
}