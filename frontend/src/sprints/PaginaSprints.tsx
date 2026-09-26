/** Vista de sprints (`#/sprints`): catálogo + filtros combinables.
 *
 * Los filtros viven en el hash (ver `navegacion.ts`), no en estado local: una
 * URL filtrada se puede compartir sin recurrir a las queries guardadas de
 * Azure DevOps. Cada cambio reescribe el hash, así que el botón atrás del
 * navegador recorre los filtros.
 *
 * Todos los datos salen del índice local del backend: cambiar un filtro **no**
 * genera peticiones a Azure DevOps.
 */

import { useEffect, useState } from "react";

import { Kpi } from "../componentes/Kpi";
import { CajaVacia, Cargando, ErrorAlerta } from "../componentes/retroalimentacion";
import { useItems, usePersonas, useSprints } from "../epicas/hooks";
import { contarFiltros, irA, TIPOS_INDICE } from "../navegacion";
import type { FiltrosSprint } from "../navegacion";
import { TablaItems } from "./TablaItems";
import { TablaSprints } from "./TablaSprints";
import { antiguedadLegible, resumenFiltros } from "./fechas";

export function PaginaSprints({ filtros }: { filtros: FiltrosSprint }) {
  const sprints = useSprints();
  const personas = usePersonas();
  const items = useItems(filtros);

  const [textoPersona, setTextoPersona] = useState(filtros.persona ?? "");
  // El texto libre se sincroniza con la URL: al escribir cambia el hash, el
  // hash vuelve a renderizar y el campo queda coherente con lo compartido.
  useEffect(() => setTextoPersona(filtros.persona ?? ""), [filtros.persona]);

  const cambiar = (parcial: Partial<FiltrosSprint>) => {
    const siguiente: FiltrosSprint = { ...filtros };
    for (const [clave, valor] of Object.entries(parcial)) {
      if (valor === "" || valor === undefined || valor === false) {
        delete siguiente[clave as keyof FiltrosSprint];
      } else {
        (siguiente as Record<string, unknown>)[clave] = valor;
      }
    }
    irA({ pagina: "sprints", filtros: siguiente });
  };

  const nombresPersona: Record<string, string> = {};
  for (const persona of personas.data?.personas ?? []) {
    nombresPersona[persona.guid] = persona.nombre;
  }

  const cat = sprints.data;
  const activo = filtros.sprint
    ? cat?.sprints.find((s) => s.ruta === filtros.sprint)
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
                  onChange={(e) => {
                    setTextoPersona(e.target.value);
                    cambiar({ persona: e.target.value });
                  }}
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
                  onClick={() => irA({ pagina: "sprints", filtros: {} })}
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
              <CajaVacia mensaje="Ningún ítem cumple los filtros indicados." />
            ) : (
              <TablaItems items={items.data.items} total={items.data.total} />
            )}
          </section>
        </>
      )}
    </div>
  );
}
