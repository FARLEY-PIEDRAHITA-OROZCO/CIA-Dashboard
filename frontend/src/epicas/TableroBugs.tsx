import { useMemo, useState } from "react";

import type { Bug } from "../api/tipos";
import { ContenidoRico } from "../componentes/ContenidoRico";
import { EstadoTrabajo, tonoEstado, type TonoEstado } from "../componentes/EstadoTrabajo";

const COLUMNAS: ReadonlyArray<{ tono: TonoEstado; titulo: string }> = [
  { tono: "nuevo", titulo: "Nuevo" },
  { tono: "pendiente", titulo: "Pendiente" },
  { tono: "progreso", titulo: "En curso" },
  { tono: "terminado", titulo: "Terminado" },
  { tono: "removido", titulo: "Removido" },
  { tono: "neutro", titulo: "Sin clasificar" },
];

function opciones(campos: Array<[string, string]>): Array<[string, string]> {
  return [...new Map(campos.map(([valor, etiqueta]) => [valor, etiqueta])).entries()].sort(
    (a, b) => a[0].localeCompare(b[0]),
  );
}

function TarjetaBug({ bug }: { bug: Bug }) {
  const [abierta, setAbierta] = useState(false);
  const conDescripcion = Boolean(bug.descripcion?.trim());
  const tieneDetalle = conDescripcion || Boolean(bug.url);

  return (
    <article className="hu-card" data-tono={tonoEstado(bug.estado)}>
      <header className="hu-card-cabecera">
        <span className="monospace hu-id">#{bug.azure_id}</span>
        <div className="hu-card-derecha">
          <EstadoTrabajo estado={bug.estado} />
          {tieneDetalle && (
            <button
              type="button"
              className="btn-icono"
              aria-expanded={abierta}
              aria-label={`${abierta ? "Ocultar" : "Ampliar"} detalle del bug #${bug.azure_id}`}
              onClick={() => setAbierta((valor) => !valor)}
            >
              {abierta ? "−" : "+"}
            </button>
          )}
        </div>
      </header>
      <h4>{bug.titulo || "—"}</h4>
      <p className="hu-contexto small">
        {bug.relacion === "related" ? "Relacionado" : "Jerárquico"}
        {bug.prioridad && ` · Prioridad ${bug.prioridad}`}
        {bug.severidad && ` · ${bug.severidad}`}
      </p>
      {bug.asignado_a && <p className="texto-suave small">Asignado a: {bug.asignado_a}</p>}
      {abierta && conDescripcion && (
        <div className="hu-card-descripcion">
          <ContenidoRico html={bug.descripcion} />
        </div>
      )}
      {abierta && bug.url && (
        <a className="enlace-externo small" href={bug.url} target="_blank" rel="noreferrer">
          Abrir en Azure ↗
        </a>
      )}
    </article>
  );
}

export function TableroBugs({ bugs }: { bugs: Bug[] }) {
  const [termino, setTermino] = useState("");
  const [prioridad, setPrioridad] = useState("");
  const [severidad, setSeveridad] = useState("");
  const [relacion, setRelacion] = useState("");

  const prioridades = useMemo(
    () => opciones(bugs.map((bug) => [bug.prioridad || "sin prioridad", "sin prioridad"])),
    [bugs],
  );
  const severidades = useMemo(
    () => opciones(bugs.map((bug) => [bug.severidad || "sin severidad", "sin severidad"])),
    [bugs],
  );
  const relaciones = useMemo(
    () => opciones(bugs.map((bug) => [bug.relacion || "hierarchy", bug.relacion || "hierarchy"])),
    [bugs],
  );

  const visibles = useMemo(() => {
    const query = termino.trim().toLowerCase();
    return bugs.filter((bug) => {
      if (prioridad && (bug.prioridad || "sin prioridad") !== prioridad) return false;
      if (severidad && (bug.severidad || "sin severidad") !== severidad) return false;
      if (relacion && (bug.relacion || "hierarchy") !== relacion) return false;
      if (query) {
        const texto = `${bug.titulo} ${bug.azure_id} ${bug.asignado_a}`.toLowerCase();
        if (!texto.includes(query)) return false;
      }
      return true;
    });
  }, [bugs, termino, prioridad, severidad, relacion]);

  const grupos = useMemo(() => {
    const mapa = new Map<TonoEstado, Bug[]>();
    for (const bug of visibles) {
      const tono = tonoEstado(bug.estado);
      const lista = mapa.get(tono) ?? [];
      lista.push(bug);
      mapa.set(tono, lista);
    }
    for (const lista of mapa.values()) lista.sort((a, b) => a.azure_id - b.azure_id);
    return mapa;
  }, [visibles]);

  const limpiar = () => {
    setTermino("");
    setPrioridad("");
    setSeveridad("");
    setRelacion("");
  };

  return (
    <div className="tablero-historias">
      <div className="banda-filtros">
        <input
          type="search"
          className="buscador"
          aria-label="Buscar bug por título, id o asignado"
          placeholder="Buscar bug…"
          value={termino}
          onChange={(evento) => setTermino(evento.target.value)}
        />
        <select
          className="select small"
          aria-label="Filtrar por prioridad"
          value={prioridad}
          onChange={(evento) => setPrioridad(evento.target.value)}
        >
          <option value="">Prioridad: todas</option>
          {prioridades.map(([valor, etiqueta]) => (
            <option key={valor} value={valor}>{etiqueta}</option>
          ))}
        </select>
        <select
          className="select small"
          aria-label="Filtrar por severidad"
          value={severidad}
          onChange={(evento) => setSeveridad(evento.target.value)}
        >
          <option value="">Severidad: todas</option>
          {severidades.map(([valor, etiqueta]) => (
            <option key={valor} value={valor}>{etiqueta}</option>
          ))}
        </select>
        <select
          className="select small"
          aria-label="Filtrar por relación"
          value={relacion}
          onChange={(evento) => setRelacion(evento.target.value)}
        >
          <option value="">Relación: todas</option>
          {relaciones.map(([valor, etiqueta]) => (
            <option key={valor} value={valor}>{etiqueta}</option>
          ))}
        </select>
        {(termino || prioridad || severidad || relacion) && (
          <button type="button" className="btn secundario" onClick={limpiar}>
            Limpiar
          </button>
        )}
      </div>

      <div className="cinturon-estados" role="group" aria-label="Resumen de bugs por estado">
        {COLUMNAS.map(({ tono, titulo }) => (
          <span key={tono} className="cinturon-chip">
            {titulo}: {grupos.get(tono)?.length ?? 0}
          </span>
        ))}
      </div>

      {visibles.length === 0 ? (
        <p className="texto-suave">No hay bugs que coincidan con los filtros.</p>
      ) : (
        <div className="tablero-columnas">
          {COLUMNAS.map(({ tono, titulo }) => {
            const items = grupos.get(tono) ?? [];
            if (items.length === 0) return null;
            return (
              <section className="hu-columna" key={tono} data-tono={tono}>
                <h3 className="hu-columna-titulo">{titulo} <span>{items.length}</span></h3>
                {items.map((bug) => <TarjetaBug key={bug.azure_id} bug={bug} />)}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
