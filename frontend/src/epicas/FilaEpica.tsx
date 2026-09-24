import type { EpicResumen } from "../api/tipos";
import { EstadoTrabajo } from "../componentes/EstadoTrabajo";
import { irA } from "../navegacion";
import { useArbolEpica } from "./hooks";
import { DetalleEpica } from "./DetalleEpica";

interface Props {
  epica: EpicResumen;
  expandida: boolean;
  onAlternar: (azureId: number) => void;
}

/** Fila de una épica en la tabla; al expandirse carga el árbol completo. */
export function FilaEpica({ epica, expandida, onAlternar }: Props) {
  const arbol = useArbolEpica(expandida ? epica.azure_id : null);

  return (
    <>
      <tr>
        <td className="monospace td-der">{epica.azure_id}</td>
        <td>{epica.titulo || "—"}</td>
        <td>
          <EstadoTrabajo estado={epica.estado} />
        </td>
        <td className="td-der">
          <div className="acciones-fila">
            <button
              type="button"
              className="btn secundario"
              onClick={() => irA({ pagina: "epica", azureId: epica.azure_id })}
              aria-label={`Ver historias de ${epica.titulo}`}
            >
              Historias ↗
            </button>
            <button
              type="button"
              className="btn secundario"
              onClick={() => onAlternar(epica.azure_id)}
              aria-expanded={expandida}
              aria-label={`${expandida ? "Contraer" : "Expandir"} épica ${epica.titulo}`}
            >
              {expandida ? "Contraer" : "Explorar"}
            </button>
          </div>
        </td>
      </tr>

      {expandida && (
        <tr className="fila-detalle">
          <td colSpan={4}>
            {arbol.isFetching && !arbol.data ? (
              <div className="aviso aviso-info" role="status">
                <span className="spinner" aria-hidden="true" />
                Cargando árbol de la épica…
              </div>
            ) : arbol.isError ? (
              <div className="aviso aviso-error" role="alert">
                {String(arbol.error instanceof Error ? arbol.error.message : arbol.error)}
              </div>
            ) : arbol.data ? (
              <DetalleEpica epica={arbol.data} />
            ) : (
              <div className="aviso aviso-info" role="status">
                <span className="spinner" aria-hidden="true" />
                Cargando…
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}