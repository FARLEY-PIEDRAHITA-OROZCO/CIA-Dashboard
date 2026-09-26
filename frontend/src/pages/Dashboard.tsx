import { useMemo, useState } from "react";

import { EstadoTrabajo, tonoEstado } from "../componentes/EstadoTrabajo";
import { Kpi } from "../componentes/Kpi";
import { CajaVacia, Cargando, ErrorAlerta } from "../componentes/retroalimentacion";
import { BuscadorEpicas, filtrarEpicas, TablaEpicas, useEpicas, useEstadoAzure } from "../epicas";

const ORDEN_ESTADOS = [
  "in progress",
  "committed",
  "approved",
  "new",
  "done",
  "removed",
];

function resumenPorEstado(epicas: Array<{ estado: string }>): Array<[string, number]> {
  const conteo = new Map<string, number>();
  for (const e of epicas) {
    const clave =
      (e.estado || "Sin estado").trim().replace(/\s+/g, " ").toLowerCase() ||
      "sin estado";
    conteo.set(clave, (conteo.get(clave) ?? 0) + 1);
  }
  return [...conteo.entries()].sort((a, b) => {
    const ia = ORDEN_ESTADOS.indexOf(a[0].toLowerCase());
    const ib = ORDEN_ESTADOS.indexOf(b[0].toLowerCase());
    const ordenA = ia === -1 ? 999 : ia;
    const ordenB = ib === -1 ? 999 : ib;
    return ordenA - ordenB || b[1] - a[1];
  });
}

export default function Dashboard() {
  const estadoIntegracion = useEstadoAzure();
  const configurado = Boolean(estadoIntegracion.data?.configurada);
  const [incluirCerradas, setIncluirCerradas] = useState(false);
  const epicasQ = useEpicas(configurado, incluirCerradas);
  const [consulta, setConsulta] = useState("");

  const [expandidas, setExpandidas] = useState<ReadonlySet<number>>(new Set());

  const epicas = epicasQ.data?.epicas ?? [];
  // El filtrado es local: la lista ya está en memoria, así que buscar no
  // genera peticiones a Azure.
  const epicasFiltradas = useMemo(() => filtrarEpicas(epicas, consulta), [epicas, consulta]);
  const hayConsulta = consulta.trim() !== "";
  const sinCoincidencias = hayConsulta && epicasFiltradas.length === 0;
  const porEstado = useMemo(() => resumenPorEstado(epicas), [epicas]);
  const enProgreso = useMemo(
    () => epicas.filter((epica) => tonoEstado(epica.estado) === "progreso").length,
    [epicas],
  );
  const terminadas = useMemo(
    () => epicas.filter((epica) => tonoEstado(epica.estado) === "terminado").length,
    [epicas],
  );

  const alternar = (azureId: number) => {
    setExpandidas((prev) => {
      const siguiente = new Set(prev);
      if (siguiente.has(azureId)) {
        siguiente.delete(azureId);
      } else {
        siguiente.add(azureId);
      }
      return siguiente;
    });
  };

  const estadoCargando = estadoIntegracion.isPending;
  const listaCargando = configurado && epicasQ.isPending && !epicasQ.data;

  return (
    <div className="pagina">
      <div className="cabecera-pagina">
        <div>
          <h1 tabIndex={-1}>Dashboard de Épicas</h1>
          <p className="texto-suave small">
            Backlog de solo lectura · Azure DevOps ·{" "}
            {estadoIntegracion.data?.proyecto ?? "proyecto sin verificar"}
          </p>
        </div>
        <div className="acciones">
          <label className="control-filtro" title="Incluye en el conteo y la tabla las épicas con estado Closed">
            <input
              type="checkbox"
              checked={incluirCerradas}
              onChange={(e) => setIncluirCerradas(e.target.checked)}
            />
            Incluir cerradas
          </label>
        </div>
      </div>

      {estadoIntegracion.isError && (
        <ErrorAlerta mensaje={`No se pudo consultar el estado de Azure: ${estadoIntegracion.error.message}`} />
      )}

      {estadoIntegracion.isSuccess && !configurado && (
        <div className="aviso aviso-alerta">
          Azure DevOps no está configurado. Define{" "}
          <code>AZURE_ORG_URL</code>, <code>AZURE_PROYECTO</code> y{" "}
          <code>AZURE_PAT</code> en <code>backend/.env</code> y reinicia el backend.
        </div>
      )}

      {configurado && estadoIntegracion.data && !estadoIntegracion.data.verificado && (
        <ErrorAlerta
          mensaje={`No se pudo verificar la conexión: ${estadoIntegracion.data.error || "error desconocido"}`}
        />
      )}

      {/* KPIs disponibles desde el resumen (sin descargar los árboles) */}
      {epicas.length > 0 && (
        <div className="kpis">
          <Kpi
            etiqueta={incluirCerradas ? "Épicas totales" : "Épicas activas"}
            valor={epicas.length}
            tono="acento"
          />
          <Kpi etiqueta="Estados distintos" valor={porEstado.length} />
          <Kpi etiqueta="En progreso" valor={enProgreso} tono="ok" />
          <Kpi etiqueta="Terminadas" valor={terminadas} />
        </div>
      )}

      {porEstado.length > 0 && (
        <div className="fila-cinturones" aria-label="Épicas por estado">
          {porEstado.map(([estado, cantidad]) => (
            <span className="cinturon" key={estado}>
              <EstadoTrabajo estado={estado} />
              <span className="monospace small">{cantidad}</span>
            </span>
          ))}
        </div>
      )}

      {estadoCargando && <Cargando texto="Consultando estado de Azure…" />}
      {listaCargando && <Cargando texto="Cargando épicas…" />}

      {epicasQ.isError && epicasQ.error && (
        <ErrorAlerta mensaje={String(epicasQ.error)} />
      )}

      {epicas.length > 0 ? (
        <div className="panel">
          <div className="fila-entre">
            <h2>Exploración del backlog</h2>
            <span className="texto-suave small">
              Pulsa «Explorar» en una épica para ver sus Features y User Stories.
            </span>
          </div>

          <BuscadorEpicas
            consulta={consulta}
            onCambio={setConsulta}
            resultados={epicasFiltradas.length}
            total={epicas.length}
          />

          {sinCoincidencias ? (
            <CajaVacia
              mensaje={`Ninguna épica coincide con «${consulta.trim()}». Prueba con menos términos o revisa la ortografía.`}
            />
          ) : (
            <div id="resultados-busqueda">
              <TablaEpicas
                epicas={epicasFiltradas}
                expandidas={expandidas}
                onAlternar={alternar}
                consulta={consulta}
              />
            </div>
          )}
        </div>
      ) : (
        configurado &&
        !epicasQ.isPending &&
        !epicasQ.isError && <CajaVacia mensaje="Azure no devolvió épicas para el AreaPath configurado." />
      )}
    </div>
  );
}