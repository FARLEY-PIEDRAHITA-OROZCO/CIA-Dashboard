import { useMemo, useState } from "react";
import type { Feature, Tarea, UserStory } from "../api/tipos";
import { ContenidoRico } from "../componentes/ContenidoRico";
import { EstadoTrabajo, tonoEstado, type TonoEstado } from "../componentes/EstadoTrabajo";

/** Tarea del árbol de Azure con el contexto (HU y Feature) del que proviene. */
export interface TareaConContexto {
  tarea: Tarea;
  /** Título de la Historia de Usuario de origen (directa de la épica o dentro de una Feature). */
  hu: string;
  /** Título de la Feature de origen; vacío para HU directas de la épica. */
  contexto: string;
  /** URL de la HU de origen. */
  huUrl?: string;
  /** ID de la HU de origen. */
  huAzureId: number;
  /** ID de la Feature de origen (ausente para HU directas de la épica). */
  featureId?: number;
}

/** Aplana el árbol de la épica en la lista de tareas con contexto (sin red extra);
 * las tareas de HU directas primero y luego las de HU dentro de Features. */
export function aplanarTareas(epica: {
  hus: UserStory[];
  features: Feature[];
}): TareaConContexto[] {
  const directas = epica.hus.flatMap((hu) =>
    (hu.tareas ?? []).map((t) => ({
      tarea: t,
      hu: hu.titulo,
      contexto: "",
      huUrl: hu.url,
      huAzureId: hu.azure_id,
    })),
  );
  const porFeature = epica.features.flatMap((f) =>
    f.hus.flatMap((hu) =>
      (hu.tareas ?? []).map((t) => ({
        tarea: t,
        hu: hu.titulo,
        contexto: f.titulo,
        huUrl: hu.url,
        huAzureId: hu.azure_id,
        featureId: f.azure_id,
      })),
    ),
  );
  return [...directas, ...porFeature].sort((a, b) => a.tarea.azure_id - b.tarea.azure_id);
}

/** Tonos de estado que forman las columnas del tablero, en orden. */
export const ORDEN_COLUMNA: TonoEstado[] = [
  "nuevo",
  "pendiente",
  "progreso",
  "terminado",
  "removido",
  "neutro",
];

/** Título de cada columna del tablero de tareas. */
export const TITULOS_COLUMNA: Record<TonoEstado, string> = {
  nuevo: "Nueva",
  pendiente: "Pendiente",
  progreso: "En curso",
  terminado: "Terminada",
  removido: "Removida",
  neutro: "Sin clasificar",
};

/** Agrupa las tareas por tono de estado, ordenadas por ID dentro de cada columna. */
export function agruparTareasPorEstado(
  tareas: TareaConContexto[],
): Map<TonoEstado, TareaConContexto[]> {
  const grupos = new Map<TonoEstado, TareaConContexto[]>();
  for (const t of tareas) {
    const tono = tonoEstado(t.tarea.estado);
    const lista = grupos.get(tono) ?? [];
    lista.push(t);
    grupos.set(tono, lista);
  }
  for (const lista of grupos.values()) {
    lista.sort((a, b) => a.tarea.azure_id - b.tarea.azure_id);
  }
  for (const tono of ORDEN_COLUMNA) {
    if (!grupos.has(tono)) grupos.set(tono, []);
  }
  return grupos;
}

/** Features presentes en las tareas (para el filtro), ordenadas por ID. */
export function opcionesFeature(tareas: TareaConContexto[]): { id: number; titulo: string }[] {
  const mapa = new Map<number, string>();
  for (const t of tareas) {
    if (t.featureId !== undefined) {
      mapa.set(t.featureId, t.contexto || `Feature #${t.featureId}`);
    }
  }
  return [...mapa.entries()]
    .map(([id, titulo]) => ({ id, titulo }))
    .sort((a, b) => a.id - b.id);
}

/** Historias de usuario presentes en las tareas (para el filtro encadenado),
 * que pertenecen a la Feature seleccionada (todas si no hay Feature activa). */
export function opcionesHu(
  tareas: TareaConContexto[],
  featureId: number | null,
): { azureId: number; titulo: string }[] {
  const mapa = new Map<number, string>();
  for (const t of tareas) {
    if (featureId !== null && t.featureId !== featureId) continue;
    mapa.set(t.huAzureId, t.hu || `HU #${t.huAzureId}`);
  }
  return [...mapa.entries()]
    .map(([azureId, titulo]) => ({ azureId, titulo }))
    .sort((a, b) => a.azureId - b.azureId);
}

/** Tareas que pasan los tres filtros (Feature + HU + buscador), sin red. */
export function usarTareasFiltradas(
  tareas: TareaConContexto[],
  termino: string,
  featureId: number | null,
  huAzureId: number | null,
): TareaConContexto[] {
  return useMemo(() => {
    const q = termino.trim().toLowerCase();
    if (featureId === null && huAzureId === null && !q) return tareas;
    return tareas.filter((t) => {
      if (featureId !== null && t.featureId !== featureId) return false;
      if (huAzureId !== null && t.huAzureId !== huAzureId) return false;
      if (q) {
        const texto =
          `${t.tarea.titulo} ${t.tarea.azure_id} ${t.hu} ${t.contexto}`.toLowerCase();
        if (!texto.includes(q)) return false;
      }
      return true;
    });
  }, [tareas, termino, featureId, huAzureId]);
}

/** Tarjeta de tarea del tablero (mismo lenguaje visual que las de historias). */
function TarjetaTarea({
  t,
  abierta,
  onAlternar,
}: {
  t: TareaConContexto;
  abierta: boolean;
  onAlternar: () => void;
}) {
  const conDescripcion = Boolean(t.tarea.descripcion?.trim());
  const tieneDetalle = conDescripcion || Boolean(t.tarea.url);

  return (
    <article className="hu-card" data-tono={tonoEstado(t.tarea.estado)}>
      <header className="hu-card-cabecera">
        <span className="monospace hu-id">#{t.tarea.azure_id}</span>
        <div className="hu-card-derecha">
          <EstadoTrabajo estado={t.tarea.estado} />
          {tieneDetalle && (
            <button
              type="button"
              className="btn-icono"
              aria-expanded={abierta}
              aria-label={`${abierta ? "Ocultar" : "Ampliar"} detalle de la tarea #${t.tarea.azure_id}`}
              onClick={onAlternar}
            >
              {abierta ? "−" : "+"}
            </button>
          )}
        </div>
      </header>

      <h4>{t.tarea.titulo || "—"}</h4>
      <p className="hu-contexto small">
        <span className="monospace">HU #{t.huAzureId}</span> {t.hu || "—"}
      </p>
      {t.contexto && <p className="texto-suave small">Feature: {t.contexto}</p>}

      {abierta && conDescripcion && (
        <div className="hu-card-descripcion">
          <ContenidoRico html={t.tarea.descripcion} />
        </div>
      )}

      {abierta && t.tarea.url && (
        <a
          className="enlace-externo small"
          href={t.tarea.url}
          target="_blank"
          rel="noreferrer"
        >
          Abrir en Azure ↗
        </a>
      )}
    </article>
  );
}

/** Tablero de tareas de una épica: tres filtros combinables (Feature ▸ HU ▸
 * buscador), columnas por estado colapsables y tarjetas expandibles. */
export function TableroTareas({ tareas }: { tareas: TareaConContexto[] }) {
  const [termino, setTermino] = useState("");
  const [featureId, setFeatureId] = useState<number | null>(null);
  const [huAzureId, setHuAzureId] = useState<number | null>(null);
  const [abiertas, setAbiertas] = useState<ReadonlySet<number>>(new Set());
  const [colapsadas, setColapsadas] = useState<ReadonlySet<TonoEstado>>(new Set());

  const visibles = usarTareasFiltradas(tareas, termino, featureId, huAzureId);
  const grupos = agruparTareasPorEstado(visibles);
  const features = opcionesFeature(tareas);
  const hus = opcionesHu(tareas, featureId);

  const hayFiltros =
    termino.trim() !== "" || featureId !== null || huAzureId !== null;
  const totalVisibles = visibles.length;

  const alternarTarea = (id: number) => {
    setAbiertas((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  };

  const alternarColumna = (tono: TonoEstado) => {
    setColapsadas((prev) => {
      const s = new Set(prev);
      if (s.has(tono)) s.delete(tono);
      else s.add(tono);
      return s;
    });
  };

  return (
    <div className="tablero-historias">
      <div className="banda-filtros">
        <input
          type="search"
          className="buscador"
          aria-label="Buscar tarea por título, id, HU o Feature"
          placeholder="Buscar tarea…"
          value={termino}
          onChange={(e) => setTermino(e.target.value)}
        />

        {features.length > 0 && (
          <select
            className="select small"
            aria-label="Filtrar por feature"
            value={featureId ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              setFeatureId(v === "" ? null : Number(v));
              setHuAzureId(null);
            }}
          >
            <option value="">Todas las features</option>
            {features.map((f) => (
              <option key={f.id} value={f.id}>
                #{f.id} · {f.titulo}
              </option>
            ))}
          </select>
        )}

        {hus.length > 0 && (
          <select
            className="select small"
            aria-label="Filtrar por historia de usuario"
            value={huAzureId ?? ""}
            onChange={(e) => setHuAzureId(e.target.value === "" ? null : Number(e.target.value))}
          >
            <option value="">Todas las historias</option>
            {hus.map((h) => (
              <option key={h.azureId} value={h.azureId}>
                #{h.azureId} · {h.titulo}
              </option>
            ))}
          </select>
        )}

        {hayFiltros && (
          <button
            type="button"
            className="chip small"
            onClick={() => {
              setTermino("");
              setFeatureId(null);
              setHuAzureId(null);
            }}
          >
            Limpiar ({totalVisibles})
          </button>
        )}
      </div>

      {tareas.length === 0 ? (
        <div className="aviso aviso-vacio" role="status">
          Esta épica no tiene tareas todavía.
        </div>
      ) : visibles.length === 0 ? (
        <div className="aviso aviso-vacio" role="status">
          No hay tareas que coincidan con el filtro.
        </div>
      ) : (
        <div className="tablero-columnas" aria-label="Tareas por estado">
          {ORDEN_COLUMNA.map((tono) => {
            const items = grupos.get(tono) ?? [];
            const titulo = TITULOS_COLUMNA[tono];
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
                    {items.map((t) => (
                      <TarjetaTarea
                        key={t.tarea.azure_id}
                        t={t}
                        abierta={abiertas.has(t.tarea.azure_id)}
                        onAlternar={() => alternarTarea(t.tarea.azure_id)}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
