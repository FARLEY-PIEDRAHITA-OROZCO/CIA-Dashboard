import type { EpicResumen } from "../api/tipos";
import { FilaEpica } from "./FilaEpica";

interface Props {
  epicas: EpicResumen[];
  expandidas: ReadonlySet<number>;
  onAlternar: (azureId: number) => void;
}

/** Tabla presentacional de épicas con drill-down (árbol bajo demanda). */
export function TablaEpicas({ epicas, expandidas, onAlternar }: Props) {
  return (
    <div className="tabla-scroll">
      <table className="tabla">
        <caption className="visualmente-oculto">Épicas del backlog de Azure DevOps</caption>
        <thead>
          <tr>
            <th className="td-der" scope="col">ID Azure</th>
            <th scope="col">Épica</th>
            <th scope="col">Estado</th>
            <th className="td-der" scope="col">Acción</th>
          </tr>
        </thead>
        <tbody>
        {epicas.map((epica) => (
          <FilaEpica
            key={epica.azure_id}
            epica={epica}
            expandida={expandidas.has(epica.azure_id)}
            onAlternar={onAlternar}
          />
        ))}
        </tbody>
      </table>
    </div>
  );
}