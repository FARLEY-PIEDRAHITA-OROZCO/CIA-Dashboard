import { useState } from "react";

import type { ActualizacionQA, CampoEditable } from "../api/tipos";

/** Tags sugeridos para el flujo de QA (vocalabulario inicial, ADR-11). */
export const TAGS_QA = [
  "verificado-qa",
  "no-reproducible",
  "reproducible",
  "bloqueado",
  "necesita-info",
] as const;

const PRIORIDADES = ["1", "2", "3", "4"] as const;
const SEVERIDADES = ["1 - Critical", "2 - High", "3 - Medium", "4 - Low"] as const;

export interface PropsEdicion {
  /** Work item a editar. */
  workItemId: number;
  /** Estado actual (opcional: si no se conoce, no se ofrece el selector). */
  estadoActual?: string;
  /** Estados disponibles; si se omite, se usa un texto libre. */
  estadosDisponibles?: readonly string[];
  prioridadActual?: string;
  severidadActual?: string;
  tagsActuales?: string;
  /**
   * Campos a mostrar. `Microsoft.VSTS.Common.Priority` y `Severity` **no
   * existen** en historias ni tareas: escribirlos en Azure produce error, así
   * que esos tipos los desactivan en lugar de ofrecer un control que va a fallar.
   */
  mostrarPrioridad?: boolean;
  mostrarSeveridad?: boolean;
  mostrarTags?: boolean;
  mostrarNotas?: boolean;
  /**
   * Campos que admite el tipo, tal y como los declara el backend. **Si viene
   * informado, manda sobre los `mostrar*`**: es la lista blanca del adaptador de
   * escritura, y por eso no puede haber dos copias que se contradigan.
   *
   * Hace falta porque Azure **no** avisa cuando se escribe un campo que el tipo
   * no tiene: lo acepta en silencio (comprobado con `validateOnly`). Un `Test
   * Plan` de este proyecto no tiene ni tags ni descripción, así que ofrecerlos
   * crearía campos huérfanos que nadie lee.
   */
  camposEditables?: readonly CampoEditable[];
  /** `false` deshabilita la escritura (aviso visible, sin botón de guardar). */
  habilitado?: boolean;
  /** Texto legible del elemento, para el `aria-label` del formulario. */
  titulo: string;
  onGuardar: (cambios: ActualizacionQA) => void;
  onValidar?: (cambios: ActualizacionQA) => void;
  guardando?: boolean;
  error?: string;
  onCerrar?: () => void;
}

/**
 * Formulario inline de edición de QA (tags, estado, prioridad/severidad, notas).
 *
 * Es **presentacional**: recibe los valores actuales y emite los cambios
 * através de `onGuardar` / `onValidar`. La escritura real la orchestran los
 * hooks (`useActualizarWorkItem`), que además invalidan la caché.
 *
 * El componente solo envía los campos que el usuario tocó, porque el backend
 * aplica exactamente el JSON Patch recibido (un campo ausente = "no tocar").
 */
export function EdicionInline({
  workItemId,
  estadoActual = "",
  estadosDisponibles,
  prioridadActual = "",
  severidadActual = "",
  tagsActuales = "",
  mostrarPrioridad = true,
  mostrarSeveridad = true,
  mostrarTags = true,
  mostrarNotas = true,
  camposEditables,
  habilitado = true,
  titulo,
  onGuardar,
  onValidar,
  guardando = false,
  error = "",
  onCerrar,
}: PropsEdicion) {
  // La lista del backend, si viene, es la autoridad; los `mostrar*` son el
  // respaldo para las pantallas antiguas que no la reciben.
  const admite = (campo: CampoEditable, porDefecto: boolean): boolean =>
    camposEditables ? camposEditables.includes(campo) : porDefecto;
  const conPrioridad = admite("prioridad", mostrarPrioridad);
  const conSeveridad = admite("severidad", mostrarSeveridad);
  const conTags = admite("tags", mostrarTags);
  const conNotas = admite("notas_qa", mostrarNotas);
  const conEstado = admite("estado", true);

  const [estado, setEstado] = useState(estadoActual);
  const [prioridad, setPrioridad] = useState(prioridadActual);
  const [severidad, setSeveridad] = useState(severidadActual);
  const [tags, setTags] = useState(tagsActuales);
  const [notas, setNotas] = useState("");

  /** Devuelve solo los campos distintos de su valor original y admitidos. */
  const cambios = (): ActualizacionQA => {
    const salida: ActualizacionQA = {};
    if (conEstado && estado.trim() && estado.trim() !== estadoActual.trim()) {
      salida.estado = estado.trim();
    }
    if (conPrioridad && prioridad && prioridad !== prioridadActual) {
      salida.prioridad = prioridad;
    }
    if (conSeveridad && severidad && severidad !== severidadActual) {
      salida.severidad = severidad;
    }
    if (conTags && tags.trim() !== tagsActuales.trim()) salida.tags = tags.trim();
    if (conNotas && notas.trim()) salida.notas_qa = notas.trim();
    return salida;
  };

  const pendientes = cambios();
  const hayCambios = Object.keys(pendientes).length > 0;

  /** Añade el tag si no está, o lo quita si ya estaba (comparación sin distinguir mayúsculas). */
  const alternarTag = (tag: string) => {
    const actuales = tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const existe = actuales.some((t) => t.toLowerCase() === tag.toLowerCase());
    const siguiente = existe
      ? actuales.filter((t) => t.toLowerCase() !== tag.toLowerCase())
      : [...actuales, tag];
    setTags(siguiente.join(", "));
  };

  if (!habilitado) {
    return (
      <div className="edicion" role="note">
        <p className="texto-suave small">
          La escritura QA está deshabilitada en este servidor (solo lectura). Un
          administrador puede habilitarla con <code>ESCRITURA_HABILITADA=true</code> y
          un PAT dedicado.
        </p>
      </div>
    );
  }

  return (
    <form
      className="edicion"
      aria-label={`Editar ${titulo} (work item ${workItemId})`}
      onSubmit={(evento) => {
        evento.preventDefault();
        if (hayCambios) onGuardar(pendientes);
      }}
    >
      <div className="edicion-cabecera">
        <strong>Editar #{workItemId}</strong>
        {onCerrar && (
          <button type="button" className="btn-icono" aria-label="Cerrar edición" onClick={onCerrar}>
            ×
          </button>
        )}
      </div>

      {!conEstado && (
        <p className="texto-suave small">
          Este tipo no tiene estado editable: no hay nada que cambiar aquí.
        </p>
      )}

      {conEstado &&
        (estadosDisponibles && estadosDisponibles.length > 0 ? (
          <label className="campo">
            <span>Estado</span>
            <select value={estado} onChange={(e) => setEstado(e.target.value)}>
              <option value="">— sin cambios —</option>
              {estadosDisponibles.map((valor) => (
                <option key={valor} value={valor}>
                  {valor}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="campo">
            <span>Estado</span>
            <input
              type="text"
              value={estado}
              placeholder="Sin cambios"
              onChange={(e) => setEstado(e.target.value)}
            />
          </label>
        ))}

      {(conPrioridad || conSeveridad) && (
        <div className="edicion-par">
          {conPrioridad && (
            <label className="campo">
              <span>Prioridad</span>
              <select value={prioridad} onChange={(e) => setPrioridad(e.target.value)}>
                <option value="">— sin cambios —</option>
                {PRIORIDADES.map((valor) => (
                  <option key={valor} value={valor}>
                    {valor}
                  </option>
                ))}
              </select>
            </label>
          )}
          {conSeveridad && (
            <label className="campo">
              <span>Severidad</span>
              <select value={severidad} onChange={(e) => setSeveridad(e.target.value)}>
                <option value="">— sin cambios —</option>
                {SEVERIDADES.map((valor) => (
                  <option key={valor} value={valor}>
                    {valor}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      {conTags && (
        <>
          <label className="campo">
            <span>Tags</span>
            <input
              type="text"
              value={tags}
              placeholder="verificado-qa, reproducible"
              onChange={(e) => setTags(e.target.value)}
            />
          </label>
          <div className="edicion-tags" role="group" aria-label="Tags QA sugeridos">
            {TAGS_QA.map((tag) => {
              const activo = tags
                .split(",")
                .some((t) => t.trim().toLowerCase() === tag.toLowerCase());
              return (
                <button
                  key={tag}
                  type="button"
                  className="chip"
                  aria-pressed={activo}
                  onClick={() => alternarTag(tag)}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </>
      )}

      {conNotas && (
        <label className="campo">
          <span>Notas QA (se agregan al final; no reemplazan la descripción)</span>
          <textarea
            value={notas}
            rows={3}
            maxLength={2000}
            placeholder="Reproducido en Chrome 141 / Windows 11…"
            onChange={(e) => setNotas(e.target.value)}
          />
        </label>
      )}

      {error && (
        <p className="aviso aviso-error small" role="alert">
          {error}
        </p>
      )}

      <div className="edicion-acciones">
        <button type="submit" className="btn primario" disabled={!hayCambios || guardando}>
          {guardando ? "Guardando…" : "Guardar en Azure"}
        </button>
        {onValidar && (
          <button
            type="button"
            className="btn secundario"
            disabled={!hayCambios || guardando}
            onClick={() => onValidar(pendientes)}
          >
            Validar sin guardar
          </button>
        )}
      </div>
    </form>
  );
}
