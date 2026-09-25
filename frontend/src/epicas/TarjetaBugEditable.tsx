import { useState } from "react";

import { ContenidoRico } from "../componentes/ContenidoRico";
import { EstadoTrabajo, tonoEstado } from "../componentes/EstadoTrabajo";
import type { ActualizacionQA, Bug } from "../api/tipos";
import { EdicionInline } from "./EdicionInline";
import { useActualizarWorkItem } from "./hooks";

/**
 * Tarjeta de bug con edición QA opcional.
 *
 * Es data-connected a propósito: el botón de editar solo aparece cuando hay un
 * work item real, y el guardado usa `useActualizarWorkItem`, que ya invalida la
 * caché de React Query. El presentacional puro es `EdicionInline`.
 */
export function TarjetaBugEditable({
  bug,
  habilitado = true,
}: {
  bug: Bug;
  habilitado?: boolean;
}) {
  const [abierta, setAbierta] = useState(false);
  const [editando, setEditando] = useState(false);
  const [aviso, setAviso] = useState("");
  const mutacion = useActualizarWorkItem();

  const error = mutacion.isError
    ? mutacion.error instanceof Error
      ? mutacion.error.message
      : String(mutacion.error)
    : "";

  const guardar = (cambios: ActualizacionQA) => {
    setAviso("");
    mutacion.mutate(
      { workItemId: bug.azure_id, cambios },
      {
        onSuccess: (resultado) => {
          setEditando(false);
          setAviso(resultado.detalle);
        },
      },
    );
  };

  const validar = (cambios: ActualizacionQA) => {
    setAviso("");
    mutacion.mutate(
      { workItemId: bug.azure_id, cambios, opciones: { validar: true } },
      { onSuccess: (resultado) => setAviso(resultado.detalle) },
    );
  };

  return (
    <article className="hu-card" data-tono={tonoEstado(bug.estado)}>
      <header className="hu-card-cabecera">
        <span className="monospace hu-id">#{bug.azure_id}</span>
        <div className="hu-card-derecha">
          <EstadoTrabajo estado={bug.estado} />
          <button
            type="button"
            className="btn-icono"
            aria-expanded={abierta}
            aria-label={`${abierta ? "Ocultar" : "Ampliar"} detalle del bug #${bug.azure_id}`}
            onClick={() => setAbierta((v) => !v)}
          >
            {abierta ? "−" : "+"}
          </button>
          <button
            type="button"
            className="btn-icono"
            aria-expanded={editando}
            aria-label={`${editando ? "Cerrar" : "Editar"} bug #${bug.azure_id} (QA)`}
            onClick={() => setEditando((v) => !v)}
          >
            ✎
          </button>
        </div>
      </header>

      <h4>{bug.titulo || "—"}</h4>
      <p className="hu-contexto small">
        {bug.relacion === "related" ? "Relacionado" : "Jerárquico"}
        {bug.prioridad && ` · Prioridad ${bug.prioridad}`}
        {bug.severidad && ` · ${bug.severidad}`}
      </p>
      {bug.asignado_a && <p className="texto-suave small">Asignado a: {bug.asignado_a}</p>}

      {abierta && bug.descripcion && (
        <div className="hu-card-descripcion">
          <ContenidoRico html={bug.descripcion} />
        </div>
      )}
      {abierta && bug.url && (
        <a className="enlace-externo small" href={bug.url} target="_blank" rel="noreferrer">
          Abrir en Azure ↗
        </a>
      )}

      {editando && (
        <EdicionInline
          workItemId={bug.azure_id}
          titulo={bug.titulo || `bug ${bug.azure_id}`}
          estadoActual={bug.estado}
          prioridadActual={bug.prioridad}
          severidadActual={bug.severidad}
          habilitado={habilitado}
          guardando={mutacion.isPending}
          error={error}
          onGuardar={guardar}
          onValidar={validar}
          onCerrar={() => setEditando(false)}
        />
      )}

      {aviso && !error && (
        <p className="texto-suave small" role="status">
          {aviso}
        </p>
      )}
    </article>
  );
}
