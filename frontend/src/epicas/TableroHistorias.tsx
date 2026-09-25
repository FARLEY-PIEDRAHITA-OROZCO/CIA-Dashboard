import { useState } from "react";

import type { Feature, UserStory } from "../api/tipos";
import { ContenidoRico } from "../componentes/ContenidoRico";
import { EstadoTrabajo, tonoEstado, type TonoEstado } from "../componentes/EstadoTrabajo";
import { EdicionInline } from "./EdicionInline";
import { useEdicionQA } from "./useEdicionQA";

/** Historia acompañada del contexto (Feature o épica) del que proviene. */
export interface HistoriaConContexto {
  hu: UserStory;
  /** Título de la Feature de origen (vacío si es historia directa de la épica). */
  contexto: string;
  /** ID de la Feature de origen; ausente para historias directas de la épica. */
  featureId?: number;
}

/** Aplana el árbol de la épica en una lista con contexto, sin red extra. */
export function aplanarHistorias(epica: {
  hus: UserStory[];
  features: Feature[];
}): HistoriaConContexto[] {
  return [
    ...epica.hus.map((hu) => ({ hu, contexto: "" })),
    ...epica.features.flatMap((f) =>
      f.hus.map((hu) => ({ hu, contexto: f.titulo, featureId: f.azure_id })),
    ),
  ];
}

const COLUMNAS: ReadonlyArray<{ tono: TonoEstado; titulo: string }> = [
  { tono: "nuevo", titulo: "Nueva" },
  { tono: "pendiente", titulo: "Pendiente" },
  { tono: "progreso", titulo: "En curso" },
  { tono: "terminado", titulo: "Terminada" },
  { tono: "removido", titulo: "Removida" },
  { tono: "neutro", titulo: "Sin clasificar" },
];

const CLAVE_DIRECTAS = "directas";
type Densidad = "detallada" | "compacta";

/** Agrupa las historias por tono de estado, ordenadas por ID dentro de cada columna. */
export function agruparPorEstado(
  historias: HistoriaConContexto[],
): Map<TonoEstado, HistoriaConContexto[]> {
  const grupos = new Map<TonoEstado, HistoriaConContexto[]>();
  for (const h of historias) {
    const tono = tonoEstado(h.hu.estado);
    const lista = grupos.get(tono) ?? [];
    lista.push(h);
    grupos.set(tono, lista);
  }
  for (const lista of grupos.values()) {
    lista.sort((a, b) => a.hu.azure_id - b.hu.azure_id);
  }
  return grupos;
}

function claveFeature(h: HistoriaConContexto): string {
  return h.featureId === undefined ? CLAVE_DIRECTAS : `f${h.featureId}`;
}

interface TarjetaProps {
  historia: HistoriaConContexto;
  densidad: Densidad;
  abierta: boolean;
  onAlternar: () => void;
  edicionHabilitada?: boolean;
}

/** Transiciones de estado ofrecidas a historias y tareas.
 *
 * Azure valida contra las reglas del proyecto; esta lista cubre los estados
 * habituales de Scrum/Basic. Para bugs se deja texto libre porque sus estados
 * suelen ser propios de cada proceso. */
const ESTADOS_DISPONIBLES = [
  "New",
  "Active",
  "Committed",
  "Approved",
  "Removed",
  "Done",
  "Closed",
] as const;

/** Formulario QA embebido en la tarjeta de historia, con su aviso de éxito.
 *
 * Las historias no tienen `Priority` ni `Severity` en Azure, así que esos
 * selectores se ocultan en lugar de ofrecer un control que Azure rechazaría. */
function EdicionHistoria({ hu, habilitado }: { hu: UserStory; habilitado: boolean }) {
  const edicion = useEdicionQA(hu.azure_id);
  return (
    <>
      <EdicionInline
        workItemId={hu.azure_id}
        titulo={hu.titulo || `historia ${hu.azure_id}`}
        estadoActual={hu.estado}
        estadosDisponibles={ESTADOS_DISPONIBLES}
        tagsActuales={hu.tags}
        habilitado={habilitado}
        mostrarPrioridad={false}
        mostrarSeveridad={false}
        guardando={edicion.guardando}
        error={edicion.error}
        onGuardar={(cambios) => edicion.guardar(cambios)}
        onValidar={edicion.validar}
      />
      {edicion.nodoAviso()}
    </>
  );
}

function TarjetaHistoria({
  historia,
  densidad,
  abierta,
  onAlternar,
  edicionHabilitada = true,
}: TarjetaProps) {
  const { hu, contexto } = historia;
  const [editando, setEditando] = useState(false);
  const conDescripcion = Boolean(hu.descripcion?.trim());
  const tieneDetalle = conDescripcion || Boolean(hu.url);

  return (
    <article className="hu-card" data-tono={tonoEstado(hu.estado)}>
      <header className="hu-card-cabecera">
        <span className="monospace hu-id">#{hu.azure_id}</span>
        <div className="hu-card-derecha">
          <EstadoTrabajo estado={hu.estado} />
          {(densidad === "detallada" || tieneDetalle) && (
            <button
              type="button"
              className="btn-icono"
              aria-expanded={abierta}
              aria-label={`${abierta ? "Ocultar" : "Ampliar"} detalle de la historia #${hu.azure_id}`}
              onClick={onAlternar}
            >
              {abierta ? "−" : "+"}
            </button>
          )}
          <button
            type="button"
            className="btn-icono"
            aria-expanded={editando}
            aria-label={`${editando ? "Cerrar" : "Editar"} historia #${hu.azure_id} (QA)`}
            onClick={() => setEditando((v) => !v)}
          >
            ✎
          </button>
        </div>
      </header>

      <h4>{hu.titulo || "—"}</h4>

      {contexto && <p className="hu-contexto">{contexto}</p>}

      {densidad === "detallada" && conDescripcion && !abierta && (
        <div className="hu-card-descripcion" data-recortada="true">
          <ContenidoRico html={hu.descripcion} />
        </div>
      )}

      {abierta && conDescripcion && (
        <div className="hu-card-descripcion">
          <ContenidoRico html={hu.descripcion} />
        </div>
      )}

      {abierta && hu.url && (
        <a className="enlace-externo small" href={hu.url} target="_blank" rel="noreferrer">
          Abrir en Azure ↗
        </a>
      )}

      {editando && <EdicionHistoria hu={hu} habilitado={edicionHabilitada} />}
    </article>
  );
}

function limpiarTermino(termino: string): string {
  return termino.trim().toLowerCase();
}

/** Tablero de historias de usuario: cinturón de estados, filtros por
 * feature/búsqueda, densidad ajustable y columnas colapsables. */
export function TableroHistorias({
  historias,
  features,
  edicionHabilitada = true,
}: {
  historias: HistoriaConContexto[];
  features: Feature[];
  /** Muestra el botón de edición QA en cada tarjeta. */
  edicionHabilitada?: boolean;
}) {
  const [busqueda, setBusqueda] = useState("");
  const [featureSeleccionadas, setFeatureSeleccionadas] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [estadoFoco, setEstadoFoco] = useState<TonoEstado | null>(null);
  const [densidad, setDensidad] = useState<Densidad>("detallada");
  const [colapsadas, setColapsadas] = useState<ReadonlySet<TonoEstado>>(new Set());
  const [abiertas, setAbiertas] = useState<ReadonlySet<number>>(new Set());

  const termino = limpiarTermino(busqueda);

  const visibles = historias.filter((h) => {
    if (featureSeleccionadas.size > 0 && !featureSeleccionadas.has(claveFeature(h))) {
      return false;
    }
    if (termino) {
      const texto = `${h.hu.titulo ?? ""} ${h.hu.azure_id}`.toLowerCase();
      if (!texto.includes(termino)) return false;
    }
    return true;
  });

  const grupos = agruparPorEstado(visibles);
  const totales = agruparPorEstado(historias);
  const hayFiltros =
    termino !== "" || featureSeleccionadas.size > 0 || estadoFoco !== null;

  const cantDirectas = historias.filter((h) => h.featureId === undefined).length;

  const limpiarTodo = () => {
    setBusqueda("");
    setFeatureSeleccionadas(new Set());
    setEstadoFoco(null);
  };

  const alternarFeature = (clave: string) => {
    setFeatureSeleccionadas((prev) => {
      const siguiente = new Set(prev);
      if (siguiente.has(clave)) {
        siguiente.delete(clave);
      } else {
        siguiente.add(clave);
      }
      return siguiente;
    });
  };

  const alternarColumna = (tono: TonoEstado) => {
    setColapsadas((prev) => {
      const siguiente = new Set(prev);
      if (siguiente.has(tono)) {
        siguiente.delete(tono);
      } else {
        siguiente.add(tono);
      }
      return siguiente;
    });
  };

  const alternarTarjeta = (id: number) => {
    setAbiertas((prev) => {
      const siguiente = new Set(prev);
      if (siguiente.has(id)) {
        siguiente.delete(id);
      } else {
        siguiente.add(id);
      }
      return siguiente;
    });
  };

  const columnas: Array<{ tono: TonoEstado; titulo: string; items: HistoriaConContexto[] }> =
    COLUMNAS.flatMap(({ tono, titulo }) => {
      const items = grupos.get(tono) ?? [];
      if (estadoFoco !== null && tono !== estadoFoco) return [];
      return items.length ? [{ tono, titulo, items }] : [];
    });

  return (
    <div className="tablero-historias">
      <div className="cinturon-estados" role="group" aria-label="Ir a una columna por estado">
        {COLUMNAS.map(({ tono, titulo }) => {
          const cant = totales.get(tono)?.length ?? 0;
          const activo = estadoFoco === tono;
          return (
            <button
              type="button"
              key={tono}
              className="cinturon-chip"
              data-tono={tono}
              data-activo={activo}
              aria-pressed={activo}
              disabled={cant === 0}
              title={cant === 0 ? `Sin historias en «${titulo}»` : `Solo columna «${titulo}»`}
              onClick={() => setEstadoFoco(activo ? null : tono)}
            >
              <span className="punto-tono" aria-hidden="true" />
              <span>{titulo}</span>
              <b className="monospace">{cant}</b>
            </button>
          );
        })}
      </div>

      <div className="banda-filtros">
        <input
          type="search"
          className="buscador"
          aria-label="Buscar historia por título o id"
          placeholder="Buscar historia…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />

        <div className="cinta-chips" role="group" aria-label="Filtrar historias por feature">
          <span className="etiqueta-filtro">Feature:</span>
          <button
            type="button"
            className="chip"
            aria-pressed={featureSeleccionadas.size === 0}
            onClick={() => setFeatureSeleccionadas(new Set())}
          >
            Todas
          </button>
          {cantDirectas > 0 && (
            <button
              type="button"
              className="chip"
              aria-pressed={featureSeleccionadas.has(CLAVE_DIRECTAS)}
              onClick={() => alternarFeature(CLAVE_DIRECTAS)}
            >
              Directas de la épica
            </button>
          )}
          {features.map((f) => {
            const clave = `f${f.azure_id}`;
            const cant = historias.filter((h) => h.featureId === f.azure_id).length;
            if (!cant) return null;
            return (
              <button
                type="button"
                className="chip"
                key={f.azure_id}
                aria-pressed={featureSeleccionadas.has(clave)}
                onClick={() => alternarFeature(clave)}
              >
                {f.titulo || `#${f.azure_id}`}
              </button>
            );
          })}
        </div>

        <div className="selector-segmentado" role="group" aria-label="Densidad de las tarjetas">
          <button
            type="button"
            aria-pressed={densidad === "detallada"}
            onClick={() => setDensidad("detallada")}
          >
            Detalles
          </button>
          <button
            type="button"
            aria-pressed={densidad === "compacta"}
            onClick={() => setDensidad("compacta")}
          >
            Compacta
          </button>
        </div>

        {hayFiltros && (
          <button type="button" className="chip chip-limpiar" onClick={limpiarTodo}>
            Limpiar filtros
          </button>
        )}
      </div>

      {columnas.length > 0 ? (
        <div className="tablero-columnas" aria-label="Historias de usuario por estado">
          {columnas.map(({ tono, titulo, items }) => {
            const colapsada = colapsadas.has(tono);
            return (
              <section
                className="hu-columna"
                data-tono={tono}
                aria-label={`Columna ${titulo}`}
                key={tono}
              >
                <header className="hu-columna-cabecera">
                  <span className="punto-tono" aria-hidden="true" />
                  <span className="hu-columna-titulo">{titulo}</span>
                  <span className="monospace hu-conteo">{items.length}</span>
                  <button
                    type="button"
                    className="btn-icono"
                    aria-expanded={!colapsada}
                    aria-label={`${colapsada ? "Expandir" : "Contraer"} columna ${titulo}`}
                    onClick={() => alternarColumna(tono)}
                  >
                    {colapsada ? "+" : "−"}
                  </button>
                </header>
                {!colapsada && (
                  <div className="hu-columna-cuerpo">
                    {items.map((h) => (
                      <TarjetaHistoria
                        key={h.hu.azure_id}
                        historia={h}
                        densidad={densidad}
                        abierta={abiertas.has(h.hu.azure_id)}
                        onAlternar={() => alternarTarjeta(h.hu.azure_id)}
                        edicionHabilitada={edicionHabilitada}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      ) : historias.length > 0 ? (
        <div className="aviso aviso-vacio" role="status">
          No hay historias que coincidan con los filtros.
          <button type="button" className="btn secundario small" onClick={limpiarTodo}>
            Limpiar filtros
          </button>
        </div>
      ) : (
        <div className="aviso aviso-vacio" role="status">
          Esta épica no tiene historias de usuario todavía.
        </div>
      )}
    </div>
  );
}