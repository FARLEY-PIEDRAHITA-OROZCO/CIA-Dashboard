/** Hooks de datos del backlog (React Query): estado, listado, árbol, bugs y escritura. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../api/cliente";
import type { ActualizacionQA } from "../api/tipos";

export const CLAVES_QUERY = {
  estado: ["azure", "estado"] as const,
  epicas: ["epicas"] as const,
  arbol: (azureId: number, incluirBugs = false) =>
    ["epicas", "arbol", azureId, incluirBugs] as const,
  bugs: (azureId: number, incluirCerradas = false) =>
    ["epicas", "bugs", azureId, incluirCerradas] as const,
};

export function useEstadoAzure() {
  return useQuery({
    queryKey: CLAVES_QUERY.estado,
    queryFn: ({ signal }) => api.estadoAzure(signal),
    staleTime: 60_000,
  });
}

export function useEpicas(activo: boolean, incluirCerradas: boolean) {
  return useQuery({
    queryKey: [...CLAVES_QUERY.epicas, incluirCerradas],
    queryFn: ({ signal }) => api.epicas(incluirCerradas, signal),
    enabled: activo,
    staleTime: 30_000,
  });
}

export function useArbolEpica(azureId: number | null, incluirBugs = false) {
  return useQuery({
    queryKey: CLAVES_QUERY.arbol(azureId ?? 0, incluirBugs),
    queryFn: ({ signal }) =>
      api.arbolEpica(azureId as number, incluirBugs, signal),
    enabled: azureId !== null,
    staleTime: 120_000,
    gcTime: 300_000,
  });
}

export function useBugsEpica(azureId: number | null, incluirCerradas = false) {
  return useQuery({
    queryKey: CLAVES_QUERY.bugs(azureId ?? 0, incluirCerradas),
    queryFn: ({ signal }) =>
      api.bugsEpica(azureId as number, incluirCerradas, signal),
    enabled: azureId !== null,
    staleTime: 120_000,
    gcTime: 300_000,
  });
}

export function useRefrescar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.refrescar,
    onSuccess: () => void queryClient.invalidateQueries(),
  });
}

export interface OpcionesActualizacion {
  /** `true` valida contra las reglas de Azure sin escribir nada. */
  validar?: boolean;
  /** Revisión conocida; si Azure tiene otra, se aborta el guardado. */
  revEsperada?: number;
}

/**
 * Escritura de QA sobre un work item.
 *
 * Tras guardar invalida las queries de épicas/árbol/bugs porque el backend
 * también invalida su caché de forma dirigida. El error de la mutación expone
 * el mensaje de regla de Azure para poder mostrarlo al usuario.
 */
export function useActualizarWorkItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      workItemId,
      cambios,
      opciones,
    }: {
      workItemId: number;
      cambios: ActualizacionQA;
      opciones?: OpcionesActualizacion;
    }) => api.actualizarWorkItem(workItemId, cambios, opciones),
    onSuccess: (resultado) => {
      if (!resultado.validado) {
        void queryClient.invalidateQueries({ queryKey: ["epicas"] });
      }
    },
  });
}
