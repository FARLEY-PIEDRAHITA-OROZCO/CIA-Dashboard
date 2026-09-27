/** Página de analítica QA (`#/analitica`): las señales que Azure no da.
 *
 * Cada señal se carga con su propia query, de modo que un fallo en una no deja
 * las otras en blanco. Todas se calculan en el índice local del backend: leer
 * estas señales no genera peticiones a Azure DevOps.
 *
 * Estructura: una tarjeta por sub-señal, con su cifra grande y sus ejemplos
 * bajo demanda. Antes cada señal era una fila de KPIs más dos o tres listas de
 * hasta 20 elementos, todas a la vez: un muro donde nada destacaba.
 */

import { useState } from "react";

import { Cargando, ErrorAlerta } from "../componentes/retroalimentacion";
import { useBrechaVerificacion, useRezagoSprints, useTrabajoEstancado } from "../epicas/hooks";
import type { ResumenVerificacion } from "../api/tipos";
import { porcentaje } from "../sprints/fechas";
import { plural } from "../sprints/veredicto";
import { ListaMuestras } from "./ListaMuestras";
import { TarjetaSenal } from "./TarjetaSenal";

function mensaje(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Nota de la señal ①.
 *
 * Cuando la API entrega menos ejemplos que el total —porque la lista viene
 * recortada a 50—, se dice cuántos se van a ver. Un botón que promete 136 casos
 * y abre 50 filas es peor que no tener botón.
 */
function notaBrecha(v: ResumenVerificacion, mostrados: number): string {
  if (v.bugs === 0) return "Sin bugs en el índice";
  const base = `${porcentaje(v.bugs_cerrados_sin_verificar, v.bugs)}% de ${plural(
    v.bugs,
    "bug",
  )} · ${plural(v.bugs_verificados_sin_cerrar, "verificado", "verificados")} sin cerrar`;
  return mostrados < v.bugs_cerrados_sin_verificar
    ? `${base} · se muestran ${mostrados}`
    : base;
}

/**
 * Envoltura de carga y error por señal.
 *
 * El error va **dentro** de la tarjeta, no aparte: una señal caída tiene que
 * seguir siendo visible con su título, para que se sepa cuál falló.
 */
function Senal({
  titulo,
  cargando,
  error,
  children,
}: {
  titulo: string;
  cargando: boolean;
  error: unknown;
  children: () => React.ReactNode;
}) {
  if (error) {
    return (
      <TarjetaSenal titulo={titulo} numero="—" tono="neutro">
        <ErrorAlerta mensaje={`No se pudo calcular: ${mensaje(error)}`} />
      </TarjetaSenal>
    );
  }
  if (cargando) {
    return (
      <TarjetaSenal titulo={titulo} numero="…">
        <Cargando />
      </TarjetaSenal>
    );
  }
  return <>{children()}</>;
}

export function PaginaAnalitica() {
  const brecha = useBrechaVerificacion();
  const aging = useTrabajoEstancado();
  const rezago = useRezagoSprints();

  // Qué listas están abiertas. Cerradas por defecto: el número ya dice si hay
  // algo que mirar, y el usuario decide si quiere los nombres.
  const [abiertas, setAbiertas] = useState<Record<string, boolean>>({});
  const alternar = (clave: string) =>
    setAbiertas((previo) => ({ ...previo, [clave]: !previo[clave] }));

  const cargando =
    (brecha.isPending || aging.isPending || rezago.isPending) &&
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
        <div className="rejilla-senales">
          {/* ---------------- Señal ① ---------------- */}
          <Senal titulo="① Brecha de verificación QA" cargando={brecha.isPending} error={brecha.error}>
            {() => {
              if (!v) return <TarjetaSenal titulo="① Brecha de verificación QA" numero="—" />;
              const cerrados = v.bugs_cerrados_sin_verificar;
              const sinVerificar = brecha.data?.cerrados_sin_verificar ?? [];
              const sinCerrar = brecha.data?.verificados_sin_cerrar ?? [];
              const historias = brecha.data?.historias_sin_evidencia ?? [];
              return (
                <>
                  <TarjetaSenal
                    titulo="Bugs cerrados sin verificar"
                    numero={cerrados}
                    tono={cerrados > 0 ? "alerta" : "ok"}
                    nota={notaBrecha(v, sinVerificar.length)}
                    // El botón promete lo que se va a **ver**, no el total: la API
                    // devuelve como mucho 50 ejemplos y prometer 136 sería
                    // mentir. La diferencia se dice en la nota.
                    totalEjemplos={sinVerificar.length}
                    abierta={abiertas.brecha}
                    onAlternar={() => alternar("brecha")}
                  >
                    {abiertas.brecha && (
                      <ListaMuestras
                        items={sinVerificar}
                        vacio="Todos los bugs cerrados están verificados."
                      />
                    )}
                  </TarjetaSenal>

                  {v.bugs_verificados_sin_cerrar > 0 && (
                    <TarjetaSenal
                      titulo="Verificados pero sin cerrar"
                      numero={v.bugs_verificados_sin_cerrar}
                      tono="alerta"
                      nota={
                        sinCerrar.length < v.bugs_verificados_sin_cerrar
                          ? `QA aprobó algo que desarrollo no cerró · se muestran ${sinCerrar.length}`
                          : "QA aprobó algo que desarrollo no cerró"
                      }
                      totalEjemplos={sinCerrar.length}
                      abierta={abiertas.verificados}
                      onAlternar={() => alternar("verificados")}
                    >
                      {abiertas.verificados && (
                        <ListaMuestras
                          items={sinCerrar}
                          vacio="Ninguno pendiente de cerrar."
                        />
                      )}
                    </TarjetaSenal>
                  )}

                  <TarjetaSenal
                    titulo="Historias terminadas sin evidencia"
                    numero={v.historias_sin_evidencia}
                    tono={v.historias_sin_evidencia > 0 ? "alerta" : "ok"}
                    nota={
                      `de ${plural(v.historias, "historia")} · sin la etiqueta verificado-qa` +
                      (historias.length < v.historias_sin_evidencia
                        ? ` · se muestran ${historias.length}`
                        : "")
                    }
                    totalEjemplos={historias.length}
                    abierta={abiertas.historias}
                    onAlternar={() => alternar("historias")}
                  >
                    {abiertas.historias && (
                      <ListaMuestras
                        items={historias}
                        vacio="Todas las historias terminadas están verificadas."
                      />
                    )}
                  </TarjetaSenal>
                </>
              );
            }}
          </Senal>

          {/* ---------------- Señal ② ---------------- */}
          <Senal titulo="② Trabajo estancado" cargando={aging.isPending} error={aging.error}>
            {() => {
              if (!a) return <TarjetaSenal titulo="② Trabajo estancado" numero="—" />;
              return (
                <>
                  <TarjetaSenal
                    titulo={`Sin cambio en más de ${a.dias_inactivo} días`}
                    numero={a.inactivos}
                    tono={a.inactivos > 0 ? "alerta" : "ok"}
                    nota="Incluye los que llevan más de 30 días en curso"
                    totalEjemplos={aging.data?.inactivos.length ?? 0}
                    abierta={abiertas.inactivos}
                    onAlternar={() => alternar("inactivos")}
                  >
                    {abiertas.inactivos && (
                      <ListaMuestras
                        items={aging.data?.inactivos ?? []}
                        vacio="Nada inactivo con los umbrales actuales."
                      />
                    )}
                  </TarjetaSenal>
                  <TarjetaSenal
                    titulo={`En curso más de ${a.dias_en_curso} días`}
                    numero={a.en_curso}
                    tono="acento"
                    nota="Abiertos y sin movimiento desde entonces"
                    totalEjemplos={aging.data?.en_curso.length ?? 0}
                    abierta={abiertas.enCurso}
                    onAlternar={() => alternar("enCurso")}
                  >
                    {abiertas.enCurso && (
                      <ListaMuestras
                        items={aging.data?.en_curso ?? []}
                        vacio="Nada en curso con los umbrales actuales."
                      />
                    )}
                  </TarjetaSenal>
                </>
              );
            }}
          </Senal>

          {/* ---------------- Señal ③ ---------------- */}
          <Senal titulo="③ Rezago entre sprints" cargando={rezago.isPending} error={rezago.error}>
            {() => {
              if (!z) return <TarjetaSenal titulo="③ Rezago entre sprints" numero="—" />;
              if (z.rezagados === 0) {
                return (
                  <TarjetaSenal
                    titulo="Ítems rezagados"
                    numero={0}
                    tono="ok"
                    nota="Ningún sprint anterior dejó trabajo abierto"
                  />
                );
              }
              const filas = rezago.data?.sprints ?? [];
              return (
                <TarjetaSenal
                  titulo="Ítems rezagados"
                  numero={z.rezagados}
                  tono="alerta"
                  nota={`${plural(z.sprints_con_rezago, "sprint")} con deuda, de ${plural(
                    z.sprints,
                    "sprint",
                  )} · referencia ${z.sprint_referencia}`}
                  totalEjemplos={filas.length}
                  nombreEjemplos="sprints"
                  abierta={abiertas.rezago}
                  onAlternar={() => alternar("rezago")}
                >
                  {abiertas.rezago && (
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
                          </tr>
                        </thead>
                        <tbody>
                          {filas.map((fila) => (
                            <tr key={fila.sprint}>
                              <th scope="row">{fila.sprint}</th>
                              <td className="td-der">{fila.abiertos}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </TarjetaSenal>
              );
            }}
          </Senal>
        </div>
      )}
    </div>
  );
}
