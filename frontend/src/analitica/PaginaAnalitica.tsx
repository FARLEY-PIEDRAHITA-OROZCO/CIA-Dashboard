/** Página de analítica QA (`#/analitica`): las señales que Azure no da.
 *
 * Cada señal se carga con su propia query, de modo que un fallo en una no deja
 * las otras en blanco. Todas se calculan en el índice local del backend: leer
 * estas señales no genera peticiones a Azure DevOps.
 */

import { Kpi } from "../componentes/Kpi";
import { CajaVacia, Cargando, ErrorAlerta } from "../componentes/retroalimentacion";
import { useBrechaVerificacion, useRezagoSprints, useTrabajoEstancado } from "../epicas/hooks";
import { porcentaje } from "../sprints/fechas";
import { ListaMuestras } from "./ListaMuestras";

function mensaje(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function PaginaAnalitica() {
  const brecha = useBrechaVerificacion();
  const aging = useTrabajoEstancado();
  const rezago = useRezagoSprints();

  const cargando = (brecha.isPending || aging.isPending || rezago.isPending) &&
    !brecha.data && !aging.data && !rezago.data;
  const errorGlobal = brecha.error ?? aging.error ?? rezago.error;
  const v = brecha.data?.resumen;
  const a = aging.data?.resumen;
  const z = rezago.data?.resumen;

  return (
    <div className="pagina">
      <header className="cabecera-pagina">
        <div>
          <h1 tabIndex={-1}>Analítica QA</h1>
          <p className="texto-suave">
            Señales que Azure DevOps no expone: cruzan el estado del work item
            con su etiqueta de verificación y con su fecha de último cambio.
            Funcionan con un PAT de lectura, sin licencia de Boards.
          </p>
        </div>
      </header>

      {cargando ? (
        <Cargando texto="Calculando señales sobre el índice local…" />
      ) : errorGlobal && !brecha.data && !aging.data && !rezago.data ? (
        <ErrorAlerta mensaje={`No se pudo calcular la analítica: ${mensaje(errorGlobal)}`} />
      ) : (
        <>
          <section className="kpis" aria-label="Resumen de señales">
            <Kpi
              etiqueta="Bugs cerrados sin verificar"
              valor={v?.bugs_cerrados_sin_verificar ?? "—"}
              tono={(v?.bugs_cerrados_sin_verificar ?? 0) > 0 ? "alerta" : "ok"}
              titulo="Bugs en estado terminal sin la etiqueta verificado-qa"
            />
            <Kpi
              etiqueta="Historias sin evidencia"
              valor={v?.historias_sin_evidencia ?? "—"}
              tono={(v?.historias_sin_evidencia ?? 0) > 0 ? "alerta" : "ok"}
            />
            <Kpi
              etiqueta="Inactivos >14 d"
              valor={a?.inactivos ?? "—"}
              tono={(a?.inactivos ?? 0) > 0 ? "alerta" : "ok"}
            />
            <Kpi
              etiqueta="Rezagados"
              valor={z?.rezagados ?? "—"}
              tono="acento"
              titulo="Ítems de sprints anteriores que siguen abiertos"
            />
          </section>

          {/* ---------------- Señal ① ---------------- */}
          <section className="panel" aria-labelledby="t-brecha">
            <h2 id="t-brecha">① Brecha de verificación QA</h2>
            <p className="texto-suave small">
              Azure no tiene el concepto de «verificado por QA»: obtener estos
              datos allí exige cinco queries manuales, y los tags ni siquiera se
              pueden filtrar en el servidor. Aquí se cruza el estado con la
              etiqueta <code>verificado-qa</code>.
            </p>
            {brecha.isError ? (
              <ErrorAlerta mensaje={`No se pudo calcular: ${mensaje(brecha.error)}`} />
            ) : brecha.isPending ? (
              <Cargando />
            ) : !v ? null : (
              <>
                <div className="kpis">
                  <Kpi etiqueta="Bugs" valor={v.bugs} />
                  <Kpi
                    etiqueta="Cerrados sin verificar"
                    valor={v.bugs_cerrados_sin_verificar}
                    tono="alerta"
                    titulo={`${porcentaje(v.bugs_cerrados_sin_verificar, v.bugs)}% de los bugs`}
                  />
                  <Kpi
                    etiqueta="Verificados sin cerrar"
                    valor={v.bugs_verificados_sin_cerrar}
                    tono="alerta"
                  />
                  <Kpi etiqueta="Con verificado-qa" valor={v.verificados} tono="ok" />
                </div>
                <h3>Bugs cerrados que nadie verificó ({v.bugs_cerrados_sin_verificar})</h3>
                <ListaMuestras
                  items={brecha.data?.cerrados_sin_verificar ?? []}
                  vacio="Todos los bugs cerrados están verificados. Nada que revisar."
                />
                {v.bugs_verificados_sin_cerrar > 0 && (
                  <>
                    <h3>Verificados pero sin cerrar ({v.bugs_verificados_sin_cerrar})</h3>
                    <ListaMuestras
                      items={brecha.data?.verificados_sin_cerrar ?? []}
                      vacio="Ninguno pendiente de cerrar."
                    />
                  </>
                )}
                <h3>Historias terminadas sin evidencia ({v.historias_sin_evidencia})</h3>
                <ListaMuestras
                  items={brecha.data?.historias_sin_evidencia ?? []}
                  vacio="Todas las historias terminadas están verificadas."
                />
              </>
            )}
          </section>

          {/* ---------------- Señal ② ---------------- */}
          <section className="panel" aria-labelledby="t-aging">
            <h2 id="t-aging">② Trabajo estancado</h2>
            <p className="texto-suave small">
              Basado en <code>System.ChangedDate</code>, poblado en el 100 % de
              tareas, historias y bugs del proyecto. Los ítems cerrados se
              excluyen: terminado no es estancado.
            </p>
            {aging.isError ? (
              <ErrorAlerta mensaje={`No se pudo calcular: ${mensaje(aging.error)}`} />
            ) : aging.isPending ? (
              <Cargando />
            ) : !a ? null : (
              <>
                <div className="kpis">
                  <Kpi
                    etiqueta={`Inactivos (> ${a.dias_inactivo} d)`}
                    valor={a.inactivos}
                    tono="alerta"
                  />
                  <Kpi
                    etiqueta={`En curso (> ${a.dias_en_curso} d)`}
                    valor={a.en_curso}
                    tono="acento"
                  />
                </div>
                <h3>Sin movimiento ({a.inactivos})</h3>
                <ListaMuestras
                  items={aging.data?.inactivos ?? []}
                  vacio="Nada inactivo con los umbrales actuales."
                />
                <h3>En curso demasiado tiempo ({a.en_curso})</h3>
                <ListaMuestras
                  items={aging.data?.en_curso ?? []}
                  vacio="Nada en curso con los umbrales actuales."
                />
              </>
            )}
          </section>

          {/* ---------------- Señal ③ ---------------- */}
          <section className="panel" aria-labelledby="t-rezago">
            <h2 id="t-rezago">③ Rezago entre sprints</h2>
            <p className="texto-suave small">
              Azure guarda un único sprint por work item, así que el trabajo que
              se quedó atrás no aparece en su tablero. Sprint de referencia:{" "}
              <strong>{z?.sprint_referencia || "—"}</strong>.
            </p>
            {rezago.isError ? (
              <ErrorAlerta mensaje={`No se pudo calcular: ${mensaje(rezago.error)}`} />
            ) : rezago.isPending ? (
              <Cargando />
            ) : !z || (rezago.data?.sprints.length ?? 0) === 0 ? (
              <CajaVacia mensaje="Ningún sprint anterior dejó trabajo abierto." />
            ) : (
              <>
                <div className="kpis">
                  <Kpi
                    etiqueta="Sprints con deuda"
                    valor={`${z.sprints_con_rezago} / ${z.sprints}`}
                    tono="acento"
                  />
                  <Kpi etiqueta="Ítems rezagados" valor={z.rezagados} tono="alerta" />
                </div>
                <h3>Deuda por sprint</h3>
                <div className="tabla-scroll">
                  <table className="tabla">
                    <caption className="visualmente-oculto">
                      Ítems abiertos que arrastra cada sprint anterior
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Sprint</th>
                        <th scope="col" className="td-der">
                          Abiertos
                        </th>
                        <th scope="col">Ejemplos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rezago.data?.sprints.map((fila) => (
                        <tr key={fila.sprint}>
                          <th scope="row">{fila.sprint}</th>
                          <td className="td-der">{fila.abiertos}</td>
                          <td className="small texto-suave">
                            {fila.items
                              .slice(0, 3)
                              .map((i) => `#${i.azure_id} ${i.titulo || "(sin título)"}`)
                              .join(" · ")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
