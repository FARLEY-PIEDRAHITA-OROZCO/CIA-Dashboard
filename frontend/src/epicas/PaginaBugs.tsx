import { useState } from "react";

import { Kpi } from "../componentes/Kpi";
import { CajaVacia, Cargando, ErrorAlerta } from "../componentes/retroalimentacion";
import { enlaceA } from "../navegacion";
import { useBugsEpica } from "./hooks";
import { TableroBugs } from "./TableroBugs";

/** Página dedicada a bugs y métricas de una épica (`#/epicas/{id}/bugs`). */
export function PaginaBugs({ azureId }: { azureId: number }) {
  const [incluirCerradas, setIncluirCerradas] = useState(false);
  const detalle = useBugsEpica(azureId, incluirCerradas);

  return (
    <div className="pagina">
      <nav className="migas" aria-label="Navegación">
        <a className="enlace-externo small" href={enlaceA({ pagina: "epica", azureId })}>
          ← Volver a historias
        </a>
      </nav>

      <header className="cabecera-epica">
        <div className="cabecera-epica-titulos">
          <div>
            <p className="monospace texto-suave small">Épica #{azureId}</p>
            <h1 tabIndex={-1}>Bugs de la épica</h1>
          </div>
        </div>
        <label className="control-filtro">
          <input
            type="checkbox"
            checked={incluirCerradas}
            onChange={(evento) => setIncluirCerradas(evento.target.checked)}
          />
          Incluir bugs cerrados
        </label>
      </header>

      {detalle.isFetching && !detalle.data ? (
        <Cargando texto="Cargando bugs de la épica…" />
      ) : detalle.isError ? (
        <ErrorAlerta
          mensaje={`No se pudieron cargar los bugs: ${
            detalle.error instanceof Error ? detalle.error.message : String(detalle.error)
          }`}
        />
      ) : detalle.data ? (
        <>
          <section className="kpis" aria-label="Métricas de bugs">
            <Kpi etiqueta="Bugs totales" valor={detalle.data.metricas.total} tono="acento" />
            <Kpi etiqueta="Abiertos" valor={detalle.data.metricas.abiertos} tono="alerta" />
            <Kpi etiqueta="Cerrados" valor={detalle.data.metricas.cerrados} tono="ok" />
            <Kpi
              etiqueta="Relacionados"
              valor={detalle.data.metricas.por_relacion.related ?? 0}
            />
          </section>
          {detalle.data.bugs.length > 0 ? (
            <TableroBugs bugs={detalle.data.bugs} />
          ) : (
            <CajaVacia mensaje="Esta épica no tiene bugs visibles todavía." />
          )}
        </>
      ) : null}
    </div>
  );
}
