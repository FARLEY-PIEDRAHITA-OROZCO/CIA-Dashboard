/** Hooks de datos del backlog (React Query): estado, listado y árbol. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../api/cliente";

export const CLAVES_QUERY = {
  estado: ["azure", "estado"] as const,
  epicas: ["epicas"] as const,
  arbol: (azureId: number) => ["epicas", "arbol", azureId] as const,
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

export function useArbolEpica(azureId: number | null) {
  return useQuery({
    queryKey: CLAVES_QUERY.arbol(azureId ?? 0),
    queryFn: ({ signal }) => api.arbolEpica(azureId as number, signal),
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