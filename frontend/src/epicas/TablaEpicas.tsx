import type { EpicResumen } from "../api/tipos";
import { FilaEpica } from "./FilaEpica";

interface Props {
  epicas: EpicResumen[];
  expandidas: ReadonlySet<number>;
  onAlternar: (azureId: number) => void;
  /** Consulta activa del buscador; se propaga para resaltar las coincidencias. */
  consulta?: string;
  /**
   * Épica → responsables de pruebas, del registro local.
   *
   * Viene ya resuelto desde la página: pedirlo por fila serían 132 peticiones
   * para pintar la misma lista.
   */
  responsablesPorEpica?: Map<number, { nombre: string; rol: string }[]>;
}

/** Tabla presentacional de épicas con drill-down (árbol bajo demanda). */
export function TablaEpicas({
  epicas,
  expandidas,
  onAlternar,
  consulta = "",
  responsablesPorEpica,
}: Props) {
  return (
    <div className="tabla-scroll">
      <table className="tabla">
        <caption className="visualmente-oculto">Épicas del backlog de Azure DevOps</caption>
        <thead>
          <tr>
            <th className="td-der" scope="col">ID Azure</th>
            <th scope="col">Épica</th>
            <th scope="col">Estado</th>
            <th scope="col">Pruebas</th>
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
            consulta={consulta}
            responsables={responsablesPorEpica?.get(epica.azure_id) ?? []}
          />
        ))}
        </tbody>
      </table>
    </div>
  );
}
