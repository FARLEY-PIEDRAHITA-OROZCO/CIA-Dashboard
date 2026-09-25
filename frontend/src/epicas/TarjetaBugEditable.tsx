import { useState } from "react";

import type { Bug } from "../api/tipos";
import { ContenidoRico } from "../componentes/ContenidoRico";
import { EstadoTrabajo, tonoEstado } from "../componentes/EstadoTrabajo";
import { EdicionInline } from "./EdicionInline";
import { useEdicionQA } from "./useEdicionQA";

/**
 * Tarjeta de bug con edición QA opcional.
 *
 * Es data-connected a propósito: el botón de editar solo aparece cuando hay un
 * work item real. Toda la lógica de la mutación vive en `useEdicionQA`; aquí
 * solo se presenta. El presentacional puro es `EdicionInline`.
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
  const edicion = useEdicionQA(bug.azure_id);

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
          tagsActuales={bug.tags}
          habilitado={habilitado}
          guardando={edicion.guardando}
          error={edicion.error}
          onGuardar={(cambios) => edicion.guardar(cambios, () => setEditando(false))}
          onValidar={edicion.validar}
          onCerrar={() => setEditando(false)}
        />
      )}

      {edicion.nodoAviso()}
    </article>
  );
}
