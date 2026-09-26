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
  sprints: ["sprints"] as const,
  personas: ["personas"] as const,
  items: (filtros: FiltrosItems) => ["items", filtros] as const,
  analitica: (señal: string) => ["analitica", señal] as const,
};

/** Filtros del índice local. Vacíos o `undefined` se ignoran (AND). */
export interface FiltrosItems {
  sprint?: string;
  persona?: string;
  tipo?: string;
  etiqueta?: string;
  soloAbiertos?: boolean;
}

export function useSprints() {
  return useQuery({
    queryKey: CLAVES_QUERY.sprints,
    queryFn: ({ signal }) => api.sprints(signal),
    staleTime: 300_000,
  });
}

export function usePersonas() {
  return useQuery({
    queryKey: CLAVES_QUERY.personas,
    queryFn: ({ signal }) => api.personas(signal),
    staleTime: 300_000,
  });
}

export function useItems(filtros: FiltrosItems) {
  return useQuery({
    queryKey: CLAVES_QUERY.items(filtros),
    queryFn: ({ signal }) => api.items(filtros, signal),
    staleTime: 300_000,
  });
}

/** Señales de analítica QA. Una query por señal para que una falla no tumbe las demás. */
export function useBrechaVerificacion(activo = true) {
  return useQuery({
    queryKey: CLAVES_QUERY.analitica("verificacion"),
    queryFn: ({ signal }) => api.brechaVerificacion(signal),
    enabled: activo,
    staleTime: 300_000,
  });
}

export function useTrabajoEstancado(activo = true) {
  return useQuery({
    queryKey: CLAVES_QUERY.analitica("aging"),
    queryFn: ({ signal }) => api.trabajoEstancado(signal),
    enabled: activo,
    staleTime: 300_000,
  });
}

export function useRezagoSprints(activo = true) {
  return useQuery({
    queryKey: CLAVES_QUERY.analitica("rezago"),
    queryFn: ({ signal }) => api.rezagoSprints(signal),
    enabled: activo,
    staleTime: 300_000,
  });
}

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
        // El índice local también quedó obsoleto tras escribir.
        void queryClient.invalidateQueries({ queryKey: ["items"] });
        void queryClient.invalidateQueries({ queryKey: ["sprints"] });
        void queryClient.invalidateQueries({ queryKey: ["personas"] });
        void queryClient.invalidateQueries({ queryKey: ["analitica"] });
      }
    },
  });
}
