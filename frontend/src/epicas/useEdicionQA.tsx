import { useState, type ReactNode } from "react";

import type { ActualizacionQA } from "../api/tipos";
import { useActualizarWorkItem } from "./hooks";

/**
 * Estado de la edición QA para un work item concreto.
 *
 * Concentra en un solo sitio lo que las tarjetas de bug, historia y tarea
 * necesitan: guardar, validar en seco, el estado pendiente, el error de Azure
 * y el aviso de éxito. Evita tres copias de la misma mutación.
 */
export function useEdicionQA(workItemId: number) {
  const [aviso, setAviso] = useState("");
  const mutacion = useActualizarWorkItem();

  const error = mutacion.isError
    ? mutacion.error instanceof Error
      ? mutacion.error.message
      : String(mutacion.error)
    : "";

  /** Guarda de verdad: al terminar cierra el formulario y avisa. */
  const guardar = (
    cambios: ActualizacionQA,
    alTerminar?: () => void,
  ) => {
    setAviso("");
    mutacion.mutate(
      { workItemId, cambios },
      {
        onSuccess: (resultado) => {
          alTerminar?.();
          setAviso(resultado.detalle);
        },
      },
    );
  };

  /** Dry-run: Azure comprueba las reglas sin escribir nada. */
  const validar = (cambios: ActualizacionQA) => {
    setAviso("");
    mutacion.mutate(
      { workItemId, cambios, opciones: { validar: true } },
      { onSuccess: (resultado) => setAviso(resultado.detalle) },
    );
  };

  return {
    guardar,
    validar,
    guardando: mutacion.isPending,
    error,
    aviso,
    limpiarAviso: () => setAviso(""),
    /** Nodo accesible del aviso, reutilizable por cualquier tarjeta. */
    nodoAviso: (clase = "texto-suave small"): ReactNode =>
      aviso && !error ? (
        <p className={clase} role="status">
          {aviso}
        </p>
      ) : null,
  };
}
