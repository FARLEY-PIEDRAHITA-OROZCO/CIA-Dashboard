/** Vista de sprints (`#/sprints`): veredicto, cinta y filtros combinables.
 *
 * La estructura es de **tres niveles de revelado**, no una pantalla con todo
 * desplegado a la vez:
 *
 * 1. Veredicto + cinta. Es lo que se ve al abrir: una frase y la secuencia de
 *    sprints. Antes eran 4 tarjetas de KPIs que mostraban las mismas constantes
 *    haya cual fuera el filtro, más una tabla de 37 filas y otra de 200.
 * 2. Detalle: los ítems del sprint o la persona elegidos. Con filtros aparece
 *    al instante; sin ellos, bajo demanda, porque el estado por defecto son
 *    miles de filas y nadie las ha pedido.
 * 3. Ficha del ítem: ya existe en la vista de épica.
 *
 * Los filtros y la hoja viven en el hash (ver `navegacion.ts`), no en estado
 * local: una URL filtrada se puede compartir sin recurrir a las queries
 * guardadas de Azure DevOps.
 *
 * Todos los datos salen del índice local del backend: cambiar un filtro **no**
 * genera peticiones a Azure DevOps.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

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
import { CintaSprints } from "./CintaSprints";
import { construirCinta } from "./cinta";
import { Embudo } from "./Embudo";
import type { FiltroActivo } from "./Embudo";
import { LineaVeredicto } from "./LineaVeredicto";
import { Paginacion } from "./Paginacion";
import { TablaItems } from "./TablaItems";
import { veredictoFiltrado, veredictoSprint } from "./veredicto";
import { resumenFiltros } from "./fechas";

/** Espera antes de escribir el texto de persona en la URL. */
const ESPERA_ESCRITURA_MS = 300;

/** Etiquetas legibles de cada filtro activo, para el embudo. */
const ETIQUETAS: Record<keyof FiltrosSprint, (valor: string) => string> = {
  sprint: (v) => `Sprint ${v.split("\\").pop() ?? v}`,
  persona: (v) => `Persona: ${v}`,
  tipo: (v) => `Tipo: ${v}`,
  etiqueta: (v) => `Etiqueta: ${v}`,
  soloAbiertos: () => "Solo abiertos",
};

export function PaginaSprints({
  filtros,
  hoja = 1,
  desplegado = false,
  esperaMs = ESPERA_ESCRITURA_MS,
}: {
  filtros: FiltrosSprint;
  /** Hoja 1-based leída del hash. */
  hoja?: number;
  /**
   * Muestra los ítems aunque no haya filtros. Viaja en el hash
   * (`&desplegado=1`) para que la decisión sea compartible.
   */
  desplegado?: boolean;
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

  const hayFiltros = contarFiltros(filtros) > 0;
  // Sin filtros y sin pedido explícito no se descargan 200 filas que nadie ha
  // pedido. `enabled` evita la petición; el total del veredicto sale de
  // `/api/sprints`, que ya está cargado para dibujar la cinta.
  const items = useItems(
    { ...filtros, offset: hojaAOffset(hoja), limite: ITEMS_POR_PAGINA },
    hayFiltros || desplegado,
  );

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
      // filtro nuevo mostraría una lista vacía sin explicación. Y el revelado
      // manual se pierde: con filtro, el detalle se muestra igual.
      irA({ pagina: "sprints", filtros: siguiente, hoja: 1, desplegado: false });
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
  const cinta = useMemo(
    () => construirCinta(cat?.sprints ?? [], cat?.sprint_actual ?? ""),
    [cat],
  );
  const activo = useMemo(
    () =>
      filtros.sprint
        ? cat?.sprints.find((s) => s.ruta === filtros.sprint || s.nombre === filtros.sprint)
        : undefined,
    [cat, filtros.sprint],
  );

  const activos: FiltroActivo[] = [];
  for (const clave of Object.keys(ETIQUETAS) as (keyof FiltrosSprint)[]) {
    const valor = filtros[clave];
    if (valor !== undefined && valor !== "" && valor !== false) {
      activos.push({ clave, etiqueta: ETIQUETAS[clave](String(valor)) });
    }
  }

  const cargandoInicial = sprints.isPending && !cat;
  const errorSprints = sprints.error
    ? sprints.error instanceof Error
      ? sprints.error.message
      : String(sprints.error)
    : "";

  // Total del proyecto: el que dice el backend, no la suma de la cinta. Son
  // distintos porque hay ítems sin sprint asignable.
  const veredicto = activo
    ? veredictoSprint(
        activo,
        cinta.columnas.some((c) => c.actual && c.ruta === activo.ruta),
      )
    : veredictoFiltrado(
        cat ?? { sprints: [], total: 0, sprint_actual: "", total_items: 0, asignados_a_sprint: 0 },
        personas.data?.personas ?? [],
        filtros,
        hayFiltros ? (items.data?.total ?? 0) : (cat?.total_items ?? 0),
        nombresPersona,
      );

  return (
    <div className="pagina">
      <header className="cabecera-pagina">
        <div>
          <h1 tabIndex={-1}>Sprints y responsables</h1>
          <p className="texto-suave">
            Cada columna es un sprint: la altura es su volumen, el relleno su
            cierre y la marca naranja lo que dejó sin cerrar. Pulsa una columna
            para ver sus ítems.
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
          {/* ---------------- Nivel 1: veredicto ---------------- */}
          <LineaVeredicto veredicto={veredicto} />

          <section aria-label="Sprints en el tiempo">
            <CintaSprints
              columnas={cinta.columnas}
              rutaActual={filtros.sprint ?? ""}
              onElegir={(ruta) => cambiar({ sprint: ruta })}
            />
            <p className="texto-suave small">
              {cinta.columnas.length} sprints ·{" "}
              {cinta.columnas.find((c) => c.actual)?.nombre ?? "sin sprint actual"} es el
              más reciente · {cinta.sprintsConRezago} con trabajo sin cerrar
            </p>
          </section>

          {/* ---------------- Filtros ---------------- */}
          <section className="panel" aria-label="Filtros">
            <Embudo
              filtros={activos}
              onQuitar={(clave) => cambiar({ [clave]: undefined } as Partial<FiltrosSprint>)}
              onLimpiarTodo={() =>
                irA({ pagina: "sprints", filtros: {}, hoja: 1, desplegado: false })
              }
            />
            <div className="banda-filtros">
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
            </div>
            <p className="texto-suave small mb-0">
              {resumenFiltros(filtros, cat.sprints, nombresPersona)}
            </p>
          </section>

          {/* ---------------- Nivel 2: detalle ---------------- */}
          <section aria-label="Ítems filtrados">
            {!hayFiltros && !desplegado ? (
              <CajaVacia
                mensaje="Elige un sprint en la cinta, una persona o un tipo para ver sus ítems. Sin filtros no se descargan miles de filas que nadie ha pedido."
              />
            ) : items.isPending ? (
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
                  // Al paginar el detalle ya está desplegado: se conserva.
                  onCambiar={(nueva) =>
                    irA({ pagina: "sprints", filtros, hoja: nueva, desplegado })
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
