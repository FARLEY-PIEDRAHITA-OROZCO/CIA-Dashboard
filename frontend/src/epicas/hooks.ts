/** Hooks de datos del backlog (React Query): estado, listado, árbol y bugs. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../api/cliente";

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
