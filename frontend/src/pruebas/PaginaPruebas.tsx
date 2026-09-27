/** Vista del proceso de pruebas (`#/pruebas`): veredicto, cinta y lista de trabajo.
 *
 * Es la quinta vista y comparte la estructura de las otras dos de gestión
 * (sprints y analítica) porque es el mismo problema con otros datos: **tres
 * niveles de revelado**, no una pantalla con todo desplegado.
 *
 * 1. Veredicto + cinta de cobertura. Al abrir: una frase y la secuencia de
 *    sprints con la parte probada y la que falta. El plan descartó expresamente
 *    una lista de los 44 planes: un plan es un contenedor al que no se puede
 *    entrar (las rutas de casos devuelven 404), así que listarlo sería la pared
 *    de filas casi idénticas que ya se rechazó en la vista de sprints.
 * 2. Lista de las historias sin caso. Con filtro aparece al instante; sin él,
 *    bajo demanda, porque son 361 filas.
 * 3. Los planes como contexto: quién lleva las pruebas de cada sprint. Se abre
 *    aparte, no compite con la lista.
 *
 * Los filtros y la hoja viajan en el hash (ver `navegacion.ts`), igual que en
 * sprints: una URL filtrada se puede compartir.
 *
 * Todos los datos salen de los índices locales del backend: elegir un sprint
 * **no** genera peticiones a Azure DevOps.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { CajaVacia, Cargando, ErrorAlerta } from "../componentes/retroalimentacion";
import { EstadoTrabajo } from "../componentes/EstadoTrabajo";
import {
  usePersonas,
  usePruebasCobertura,
  usePruebasPlanes,
  usePruebasResumen,
  usePruebasSinCubrir,
} from "../epicas/hooks";
import { porcentaje } from "../sprints/fechas";
import { LineaVeredicto } from "../sprints/LineaVeredicto";
import { Paginacion } from "../sprints/Paginacion";
import { plural } from "../sprints/veredicto";
import {
  contarFiltros,
  hojaPruebasAOffset,
  irA,
  PRUEBAS_POR_PAGINA,
  totalHojasPruebas,
} from "../navegacion";
import type { FiltrosPruebas } from "../navegacion";
import { CintaCobertura } from "./CintaCobertura";
import { construirColumnas, veredictoBrecha, veredictoSprint } from "./cobertura";

/** Espera antes de escribir el texto de persona en la URL. */
const ESPERA_ESCRITURA_MS = 300;

export function PaginaPruebas({
  filtro,
  hoja = 1,
  esperaMs = ESPERA_ESCRITURA_MS,
}: {
  filtro: FiltrosPruebas;
  /** Hoja 1-based leída del hash. */
  hoja?: number;
  /** Retardo del texto libre; inyectable para poder probarlo sin esperar. */
  esperaMs?: number;
}) {
  const resumen = usePruebasResumen();
  const cobertura = usePruebasCobertura();
  const planes = usePruebasPlanes();
  const personas = usePersonas();

  const hayFiltros = contarFiltros(filtro) > 0;
  // Sin filtros no se piden las 361 historias. El total sale de la cobertura,
  // que ya está cargada para dibujar la cinta.
  const sinCubrir = usePruebasSinCubrir(
    { ...filtro, offset: hojaPruebasAOffset(hoja), limite: PRUEBAS_POR_PAGINA },
    hayFiltros,
  );

  const [textoPersona, setTextoPersona] = useState(filtro.persona ?? "");
  const [verPlanes, setVerPlanes] = useState(false);

  const cambiar = useCallback(
    (parcial: Partial<FiltrosPruebas>) => {
      const siguiente: FiltrosPruebas = { ...filtro };
      for (const [clave, valor] of Object.entries(parcial)) {
        if (valor === "" || valor === undefined) {
          delete siguiente[clave as keyof FiltrosPruebas];
        } else {
          (siguiente as Record<string, unknown>)[clave] = valor;
        }
      }
      // Cambiar un filtro vuelve a la primera hoja: quedarse en la 5 con un
      // filtro nuevo mostraría una lista vacía sin explicación.
      irA({ pagina: "pruebas", filtro: siguiente, hoja: 1 });
    },
    [filtro],
  );

  const cinta = useMemo(
    () => construirColumnas(cobertura.data?.sprints ?? []),
    [cobertura.data],
  );

  // El texto se sincroniza con la URL cuando cambia desde fuera (limpiar o una
  // URL compartida), pero no mientras se escribe.
  useEffect(() => {
    if ((filtro.persona ?? "") !== textoPersona) {
      setTextoPersona(filtro.persona ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtro.persona]);

  // Se escribe en la URL **con retardo**: una entrada de historial y una petición
  // por palabra, no por pulsación. Sin esto, teclear «Luis» serían cinco cambios
  // de hash, cinco peticiones a `/api/pruebas/sin-cubrir` y cinco pasos atrás.
  //
  // El retardo no garantiza una sola escritura por palabra: si el render tarda
  // más que el retardo entre dos teclas, se escribe una vez con el valor
  // completo. Es el comportamiento correcto de un debounce.
  useEffect(() => {
    if (textoPersona === (filtro.persona ?? "")) return;
    const temporizador = setTimeout(() => cambiar({ persona: textoPersona }), esperaMs);
    return () => clearTimeout(temporizador);
  }, [textoPersona, filtro.persona, cambiar, esperaMs]);

  const columnaActiva = useMemo(
    () =>
      filtro.sprint
        ? cinta.columnas.find((c) => c.ruta === filtro.sprint || c.nombre === filtro.sprint)
        : undefined,
    [cinta, filtro.sprint],
  );

  const veredicto = columnaActiva
    ? veredictoSprint(columnaActiva)
    : veredictoBrecha(resumen.data, cinta);

  const error = resumen.error ?? cobertura.error;
  const cargando = (resumen.isPending || cobertura.isPending) && !resumen.data && !cobertura.data;
  const nombresPersona: Record<string, string> = {};
  for (const persona of personas.data?.personas ?? []) {
    nombresPersona[persona.guid] = persona.nombre;
  }

  return (
    <div className="pagina">
      <header className="cabecera-pagina">
        <div>
          <h1 tabIndex={-1}>Cobertura de pruebas</h1>
          <p className="texto-suave">
            Cada columna es un sprint: la altura es su volumen, el verde sus
            historias con caso y el naranja las que nadie ha probado. Pulsa una
            columna para verlas.
          </p>
        </div>
      </header>

      {cargando ? (
        <Cargando texto="Leyendo los activos de prueba y cruzando su cobertura. La primera vez tras arrancar el backend tarda unos 15 segundos: necesita los dos índices." />
      ) : error ? (
        <ErrorAlerta
          mensaje={`No se pudo cargar la cobertura: ${
            error instanceof Error ? error.message : String(error)
          }`}
        />
      ) : resumen.data && resumen.data.inventario.total === 0 ? (
        <CajaVacia mensaje="El proyecto no tiene planes, suites ni casos de prueba." />
      ) : (
        <>
          {/* ---------------- Nivel 1: veredicto + cinta ---------------- */}
          <LineaVeredicto veredicto={veredicto} />

          {veredicto.parcial && (
            // El aviso va pegado al veredicto y no aparte: si un lote de
            // relaciones no se pudo leer, las historias sin caso son como máximo
            // las que se indican. Presentarlo como un total sería mentir, y
            // esconderlo en una nota al pie es lo que hace que nadie lo lea.
            <p className="aviso-parcial" role="note">
              Cobertura parcial: algún lote de casos no se pudo leer, así que
              puede haber más historias sin caso de las que se indican.
            </p>
          )}

          {cinta.columnas.length > 0 && (
            <section aria-label="Cobertura por sprint">
              <CintaCobertura
                columnas={cinta.columnas}
                rutaActual={filtro.sprint ?? ""}
                onElegir={(ruta) => cambiar({ sprint: ruta })}
              />
              <p className="texto-suave small">
                {plural(cinta.columnas.length, "sprint")} ·{" "}
                {plural(cinta.sprintsConHueco, "sprint")} con alguna historia sin
                caso de prueba
                {cinta.peorSprint && cinta.peorSprint.sinCubrir > 0
                  ? ` · el peor es ${cinta.peorSprint.nombre} (${porcentaje(
                      cinta.peorSprint.cubiertas,
                      cinta.peorSprint.historias,
                    )}% cubierto)`
                  : ""}
              </p>
            </section>
          )}

          {/* ---------------- Contexto: cómo está el inventario ---------------- */}
          {resumen.data && (
            <section className="rejilla-senales" aria-label="Estado del inventario de pruebas">
              <article className="senal">
                <div className="senal-cabecera">
                  <h3 className="senal-titulo">Casos de prueba</h3>
                  <span className="senal-numero" data-tono="neutro">
                    {resumen.data.inventario.casos}
                  </span>
                </div>
                <p className="senal-nota">
                  {resumen.data.inventario.suites} suites ·{" "}
                  {resumen.data.inventario.planes} planes
                </p>
                <ul className="lista-estados">
                  {Object.entries(resumen.data.estados["Test Case"] ?? {})
                    .sort((a, b) => b[1] - a[1])
                    .map(([estado, cantidad]) => (
                      <li key={estado}>
                        <EstadoTrabajo estado={estado} />
                        <span className="lista-estados-cantidad">{cantidad}</span>
                      </li>
                    ))}
                </ul>
              </article>

              <article className="senal">
                <div className="senal-cabecera">
                  <h3 className="senal-titulo">Automatización</h3>
                  <span className="senal-numero" data-tono="neutro">
                    {resumen.data.automatizacion.pct_automatizado}%
                  </span>
                </div>
                <p className="senal-nota">
                  {plural(resumen.data.automatizacion.manuales, "caso")} sin
                  automatizar de {plural(resumen.data.automatizacion.casos, "caso")}.
                  {resumen.data.automatizacion.planificados > 0 &&
                    ` ${resumen.data.automatizacion.planificados} están planificados para automatizar, y hoy siguen siendo manuales.`}
                </p>
              </article>

              <article className="senal">
                <div className="senal-cabecera">
                  <h3 className="senal-titulo">Diseño de casos</h3>
                  <span className="senal-numero" data-tono="neutro">
                    {resumen.data.diseno.en_diseno}
                  </span>
                </div>
                <p className="senal-nota">
                  casos aún en diseño. {resumen.data.diseno.sin_mover} llevan más
                  de {resumen.data.diseno.dias} días sin tocarse, que no es
                  trabajo en curso sino deuda.
                </p>
              </article>
            </section>
          )}

          {/* ---------------- Nivel 2: lista de trabajo ---------------- */}
          <section className="panel" aria-label="Historias sin caso de prueba">
            <div className="banda-filtros">
              <label className="filtro-campo" htmlFor="p-persona">
                <span className="etiqueta-filtro">Responsable</span>
                <select
                  id="p-persona"
                  value={filtro.persona ?? ""}
                  onChange={(e) => cambiar({ persona: e.target.value })}
                >
                  <option value="">Todas las personas</option>
                  {(personas.data?.personas ?? []).map((p) => (
                    <option key={p.guid} value={p.guid}>
                      {p.nombre} ({p.total})
                    </option>
                  ))}
                </select>
              </label>

              <label className="filtro-campo" htmlFor="p-persona-texto">
                <span className="etiqueta-filtro">Buscar responsable</span>
                <input
                  id="p-persona-texto"
                  type="search"
                  placeholder="nombre o GUID…"
                  value={textoPersona}
                  onChange={(e) => setTextoPersona(e.target.value)}
                />
              </label>

              {hayFiltros && (
                <button
                  type="button"
                  className="btn secundario small"
                  onClick={() => {
                    setTextoPersona("");
                    irA({ pagina: "pruebas", filtro: {}, hoja: 1 });
                  }}
                >
                  Quitar filtros
                </button>
              )}

              {columnaActiva && (
                <span className="texto-suave small">
                  Sprint {columnaActiva.nombre} ·{" "}
                  {plural(columnaActiva.sinCubrir, "historia")} sin caso
                </span>
              )}
            </div>

            {!hayFiltros ? (
              <CajaVacia
                mensaje={`Hay ${plural(
                  cobertura.data?.resumen.sin_cubrir ?? 0,
                  "historia",
                )} sin caso de prueba en el proyecto. Elige un sprint en la cinta o un responsable para verlas.`}
              />
            ) : sinCubrir.isPending ? (
              <Cargando texto="Cargando historias sin caso…" />
            ) : sinCubrir.isError ? (
              <ErrorAlerta
                mensaje={`No se pudo cargar la lista: ${
                  sinCubrir.error instanceof Error
                    ? sinCubrir.error.message
                    : String(sinCubrir.error)
                }`}
              />
            ) : !sinCubrir.data || sinCubrir.data.items.length === 0 ? (
              <CajaVacia
                mensaje={
                  hoja > 1
                    ? `No hay historias en la hoja ${hoja} de ${totalHojasPruebas(
                        sinCubrir.data?.resumen.total ?? 0,
                      )}. Vuelve a la primera.`
                    : "Ninguna historia sin probar cumple los filtros indicados."
                }
              />
            ) : (
              <>
                <ul className="lista-hu">
                  {sinCubrir.data.items.map((historia) => (
                    <li key={historia.azure_id} className="hu-fila">
                      <a
                        className="hu-titulo"
                        href={`#/epicas/${historia.azure_id}`}
                        title="Abrir en el tablero de épicas"
                      >
                        {historia.titulo}
                      </a>
                      <div className="hu-meta">
                        <EstadoTrabajo estado={historia.estado} />
                        <span className="hu-persona">
                          {historia.persona || "sin responsable"}
                        </span>
                        {historia.sprint ? (
                          <span className="hu-sprint">{historia.sprint}</span>
                        ) : (
                          // La historia existe y nadie la ha probado, pero no
                          // está en ninguna iteración: decirlo, porque si no
                          // parece que el filtro de sprint la ocultó.
                          <span className="hu-sprint" data-sin-sprint="true">
                            sin sprint
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
                <Paginacion
                  hoja={hoja}
                  total={sinCubrir.data.resumen.total}
                  hayMas={sinCubrir.data.resumen.hay_mas}
                  porPagina={PRUEBAS_POR_PAGINA}
                  onCambiar={(nueva) => irA({ pagina: "pruebas", filtro, hoja: nueva })}
                />
              </>
            )}
          </section>

          {/* ---------------- Nivel 3: planes como contexto ---------------- */}
          <section className="panel" aria-label="Planes de prueba">
            <div className="banda-filtros">
              <button
                type="button"
                className="btn secundario small"
                onClick={() => setVerPlanes((v) => !v)}
                aria-expanded={verPlanes}
              >
                {verPlanes ? "Ocultar" : "Ver"} los {planes.data?.length ?? 0} planes
              </button>
              <span className="texto-suave small">
                Un plan no se puede abrir: la pertenencia de un caso a un plan no es
                accesible. Solo sirven para saber quién lleva las pruebas de cada
                sprint.
              </span>
            </div>
            {verPlanes && (
              <ul className="lista-planes">
                {(planes.data ?? []).map((plan) => (
                  <li key={plan.azure_id} className="plan-fila">
                    <span className="plan-titulo">{plan.titulo}</span>
                    <span className="hu-meta">
                      <EstadoTrabajo estado={plan.estado} />
                      <span className="hu-persona">{plan.persona || "sin responsable"}</span>
                      <span className="hu-sprint" data-sin-sprint={!plan.sprint ? "true" : undefined}>
                        {plan.sprint || "sin sprint"}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
