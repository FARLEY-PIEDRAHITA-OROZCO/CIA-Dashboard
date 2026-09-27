/** Vista de sprints (`#/sprints`): catálogo + filtros combinables.
 *
 * Los filtros y la hoja viven en el hash (ver `navegacion.ts`), no en estado
 * local: una URL filtrada se puede compartir sin recurrir a las queries
 * guardadas de Azure DevOps. Cada cambio reescribe el hash, así que el botón
 * atrás del navegador recorre filtros y páginas.
 *
 * Todos los datos salen del índice local del backend: cambiar un filtro **no**
 * genera peticiones a Azure DevOps.
 */

import { useCallback, useEffect, useState } from "react";

import { Kpi } from "../componentes/Kpi";
import { CajaVacia, Cargando, ErrorAlerta } from "../componentes/retroalimentacion";
import { useItems, usePersonas, useSprints } from "../epicas/hooks";
import {
  contarFiltros,
  hojaAOffset,
  irA,
  ITEMS_POR_PAGINA,
  totalHojas,
  TIPOS_INDICE,
} from "../navegacion";
import type { FiltrosSprint } from "../navegacion";
import { Paginacion } from "./Paginacion";
import { TablaItems } from "./TablaItems";
import { TablaSprints } from "./TablaSprints";
import { antiguedadLegible, resumenFiltros } from "./fechas";

/** Espera antes de escribir el texto de persona en la URL. */
const ESPERA_ESCRITURA_MS = 300;

export function PaginaSprints({
  filtros,
  hoja = 1,
  esperaMs = ESPERA_ESCRITURA_MS,
}: {
  filtros: FiltrosSprint;
  /** Hoja 1-based leída del hash. */
  hoja?: number;
  /**
   * Retardo de escritura del texto libre. Es inyectable porque es un parámetro
   * de temporización: las pruebas necesitan controlarlo para comprobar que no
   * hay una escritura por pulsación sin depender de cuánto tarde en renderizar
   * la página.
   */
  esperaMs?: number;
}) {
  const sprints = useSprints();
  const personas = usePersonas();
  const items = useItems({ ...filtros, offset: hojaAOffset(hoja), limite: ITEMS_POR_PAGINA });

  const [textoPersona, setTextoPersona] = useState(filtros.persona ?? "");

  const cambiar = useCallback(
    (parcial: Partial<FiltrosSprint>) => {
      const siguiente: FiltrosSprint = { ...filtros };
      for (const [clave, valor] of Object.entries(parcial)) {
        if (valor === "" || valor === undefined || valor === false) {
          delete siguiente[clave as keyof FiltrosSprint];
        } else {
          (siguiente as Record<string, unknown>)[clave] = valor;
        }
      }
      // Cambiar un filtro vuelve a la primera hoja: quedarse en la 7 con un
      // filtro nuevo mostraría una lista vacía sin explicación.
      irA({ pagina: "sprints", filtros: siguiente, hoja: 1 });
    },
    [filtros],
  );

  // El texto libre se sincroniza con la URL cuando cambia desde fuera (limpiar,
  // el desplegable o una URL compartida), pero no mientras se escribe.
  useEffect(() => {
    if ((filtros.persona ?? "") !== textoPersona) {
      setTextoPersona(filtros.persona ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtros.persona]);

  // Se escribe en la URL **con retardo**: una entrada de historial y una
  // petición por palabra, no por pulsación. Sin esto, teclear «Luis» serían
  // cinco cambios de hash, cinco peticiones a `/api/items` y cinco pasos hacia
  // atrás para deshacer una palabra.
  //
  // El retardo no garantiza una sola escritura por palabra: si el render tarda
  // más que el retardo entre dos teclas, se escribe una vez y se sigue con el
  // valor completo. Es el comportamiento correcto de un debounce.
  useEffect(() => {
    if (textoPersona === (filtros.persona ?? "")) return;
    const temporizador = setTimeout(() => cambiar({ persona: textoPersona }), esperaMs);
    return () => clearTimeout(temporizador);
  }, [textoPersona, filtros.persona, cambiar, esperaMs]);

  const nombresPersona: Record<string, string> = {};
  for (const persona of personas.data?.personas ?? []) {
    nombresPersona[persona.guid] = persona.nombre;
  }

  const cat = sprints.data;
  const activo = filtros.sprint
    ? cat?.sprints.find((s) => s.ruta === filtros.sprint || s.nombre === filtros.sprint)
    : undefined;
  const nFiltros = contarFiltros(filtros);
  const cargandoInicial = sprints.isPending && !cat;
  const errorSprints = sprints.error
    ? sprints.error instanceof Error
      ? sprints.error.message
      : String(sprints.error)
    : "";

  return (
    <div className="pagina">
      <header className="cabecera-pagina">
        <div>
          <h1 tabIndex={-1}>Sprints y responsables</h1>
          <p className="texto-suave">
            Catálogo derivado de los work items del proyecto. Los filtros se
            aplican en el índice local del backend, sin volver a consultar Azure
            DevOps.
          </p>
        </div>
      </header>

      {cargandoInicial ? (
        <Cargando texto="Construyendo el índice local de sprints…" />
      ) : sprints.isError ? (
        <ErrorAlerta mensaje={`No se pudo cargar el catálogo de sprints: ${errorSprints}`} />
      ) : !cat || cat.total === 0 ? (
        <CajaVacia mensaje="No se detectó ningún sprint en el proyecto." />
      ) : (
        <>
          <section className="kpis" aria-label="Resumen de sprints">
            <Kpi etiqueta="Sprints" valor={cat.total} tono="acento" />
            <Kpi
              etiqueta={activo ? `Ítems en ${activo.nombre}` : "Ítems indexados"}
              valor={activo ? activo.total : (items.data?.total ?? 0)}
            />
            <Kpi
              etiqueta={activo ? "Abiertos" : "Personas"}
              valor={activo ? activo.abiertos : (personas.data?.total ?? 0)}
              tono={activo && activo.abiertos > 0 ? "alerta" : "neutro"}
            />
            <Kpi
              etiqueta="Sprint actual"
              valor={<span style={{ fontSize: "1rem" }}>{cat.sprint_actual || "—"}</span>}
              tono="ok"
              titulo="Sprint con el cambio más reciente: sin fechas de calendario en Azure, es el último tocado"
            />
          </section>

          <section className="panel" aria-label="Filtros">
            <div className="banda-filtros">
              <label className="filtro-campo" htmlFor="f-sprint">
                <span className="etiqueta-filtro">Sprint</span>
                <select
                  id="f-sprint"
                  value={filtros.sprint ?? ""}
                  onChange={(e) => cambiar({ sprint: e.target.value })}
                >
                  <option value="">Todos los sprints</option>
                  {cat.sprints.map((s) => (
                    <option key={s.ruta} value={s.ruta}>
                      {s.nombre} ({s.total})
                    </option>
                  ))}
                </select>
              </label>

              <label className="filtro-campo" htmlFor="f-persona">
                <span className="etiqueta-filtro">Persona</span>
                <select
                  id="f-persona"
                  value={filtros.persona ?? ""}
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

              <label className="filtro-campo" htmlFor="f-persona-texto">
                <span className="etiqueta-filtro">Buscar persona</span>
                <input
                  id="f-persona-texto"
                  type="search"
                  placeholder="nombre o GUID…"
                  value={textoPersona}
                  // Solo actualiza el estado local: la URL se escribe en el
                  // efecto con retardo. Llamar a `cambiar` aquí además dejaría
                  // una escritura por pulsación, que es justo lo que el retardo
                  // evita.
                  onChange={(e) => setTextoPersona(e.target.value)}
                />
              </label>

              <label className="filtro-campo" htmlFor="f-tipo">
                <span className="etiqueta-filtro">Tipo</span>
                <select
                  id="f-tipo"
                  value={filtros.tipo ?? ""}
                  onChange={(e) => cambiar({ tipo: e.target.value })}
                >
                  <option value="">Todos los tipos</option>
                  {TIPOS_INDICE.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>

              <label className="filtro-campo" htmlFor="f-etiqueta">
                <span className="etiqueta-filtro">Etiqueta</span>
                <input
                  id="f-etiqueta"
                  type="search"
                  placeholder="p. ej. verificado-qa"
                  value={filtros.etiqueta ?? ""}
                  onChange={(e) => cambiar({ etiqueta: e.target.value })}
                />
              </label>

              <label className="control-filtro">
                <input
                  type="checkbox"
                  checked={filtros.soloAbiertos ?? false}
                  onChange={(e) => cambiar({ soloAbiertos: e.target.checked })}
                />
                Solo abiertos
              </label>

              {nFiltros > 0 && (
                <button
                  type="button"
                  className="btn secundario small chip-limpiar"
                  onClick={() => irA({ pagina: "sprints", filtros: {}, hoja: 1 })}
                >
                  Limpiar {nFiltros} filtro{nFiltros === 1 ? "" : "s"}
                </button>
              )}
            </div>
            <p className="texto-suave small mb-0">
              {resumenFiltros(filtros, cat.sprints, nombresPersona)}
              {activo && ` · último cambio ${antiguedadLegible(activo.ultimo_cambio)}`}
            </p>
          </section>

          <section aria-label="Catálogo de sprints">
            <h2>Catálogo de sprints</h2>
            <TablaSprints
              sprints={cat.sprints}
              rutaActual={filtros.sprint ?? ""}
              onElegir={(ruta) => cambiar({ sprint: ruta })}
            />
          </section>

          <section aria-label="Ítems filtrados">
            <h2>Ítems filtrados</h2>
            {items.isPending ? (
              <Cargando texto="Aplicando filtros…" />
            ) : items.isError ? (
              <ErrorAlerta
                mensaje={`No se pudieron cargar los ítems: ${
                  items.error instanceof Error ? items.error.message : String(items.error)
                }`}
              />
            ) : !items.data || items.data.items.length === 0 ? (
              <CajaVacia
                mensaje={
                  items.data && items.data.total === 0
                    ? "Ningún ítem cumple los filtros indicados."
                    : `No hay ítems en la hoja ${hoja} de ${totalHojas(
                        items.data?.total ?? 0,
                      )}. Vuelve a la primera.`
                }
              />
            ) : (
              <>
                <TablaItems
                  items={items.data.items}
                  total={items.data.total}
                  offset={items.data.offset}
                />
                <Paginacion
                  hoja={hoja}
                  total={items.data.total}
                  hayMas={items.data.hay_mas}
                  onCambiar={(nueva) =>
                    irA({ pagina: "sprints", filtros, hoja: nueva })
                  }
                />
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
