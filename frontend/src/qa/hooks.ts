/** Hooks del registro local de pruebas (API `/api/qa/*`).
 *
 * Viven en su propia carpeta y no en `epicas/hooks.ts` porque son de otra
 * cosa: los de `epicas/` hablan con el backlog de Azure, estos con un fichero
 * local. Mezclarlos haría que una lista de 35 personas pareciera un seventh
 * índice de Azure.
 *
 * Todos aceptan `activo` para no pedir nada hasta que la vista lo necesita: el
 * registro tiene ~264 asignaciones que nadie consulta al abrir el backlog.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../api/cliente";
import type { FiltrosAsignaciones } from "../api/tipos";

/** Cuerpo de `qaAsignar`. El `rol` es cerrado: la lista blanca no admite más. */
export interface NuevaAsignacion {
  epica: number;
  persona: string;
  rol: "qa" | "dev";
  desde?: string;
  nota?: string;
}

export const CLAVES_QA = {
  personas: ["qa", "personas"] as const,
  sugerencias: (minimo: number) => ["qa", "sugerencias", minimo] as const,
  asignaciones: (filtros: FiltrosAsignaciones) => ["qa", "asignaciones", filtros] as const,
  carga: ["qa", "carga"] as const,
};

/** Personas del proyecto con su papel en pruebas y su carga. */
export function usePersonasQA(activo = true) {
  return useQuery({
    queryKey: CLAVES_QA.personas,
    queryFn: ({ signal }) => api.qaPersonas(signal),
    enabled: activo,
    staleTime: 300_000,
  });
}

/**
 * Quién parece hacer QA, por volumen de activos de prueba tocados.
 *
 * No se guarda nada: es una heurística y la decisión es de quien la ve.
 */
export function useSugerenciasQA(activo = true, minimo = 3) {
  return useQuery({
    queryKey: CLAVES_QA.sugerencias(minimo),
    queryFn: ({ signal }) => api.qaSugerencias(minimo, signal),
    enabled: activo,
    staleTime: 300_000,
  });
}

/**
 * Asignaciones filtradas.
 *
 * `activo=false` por defecto a propósito: sin filtro no se descargan. La ficha de
 * una épica y el filtro del dashboard son los que la piden.
 */
export function useAsignaciones(
  filtros: FiltrosAsignaciones = {},
  activo = false,
) {
  return useQuery({
    queryKey: CLAVES_QA.asignaciones(filtros),
    queryFn: ({ signal }) => api.qaAsignaciones(filtros, signal),
    enabled: activo,
    staleTime: 300_000,
  });
}

/** Quién lleva qué épicas, agrupado y ordenado por volumen. */
export function useCargaQA(activo = true) {
  return useQuery({
    queryKey: CLAVES_QA.carga,
    queryFn: ({ signal }) => api.qaCarga(signal),
    enabled: activo,
    staleTime: 300_000,
  });
}

/**
 * Fija el papel de una persona (QA / dev).
 *
 * Tras guardar invalida **todas** las consultas de `qa`, no solo la de la
 * persona: un cambio de rol altera los contadores de `qa`, `dev` y `sin_rol` de
 * la lista completa.
 */
export function useMarcarRolQA() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      guid,
      cambios,
    }: {
      guid: string;
      cambios: { es_qa?: boolean; es_dev?: boolean; forzado?: boolean };
    }) => api.qaMarcarRol(guid, cambios),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["qa"] }),
  });
}

/** Asigna una épica a una persona. Idempotente. */
export function useAsignar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (cambios: NuevaAsignacion) => api.qaAsignar(cambios),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["qa"] }),
  });
}

/** Quita una asignación. Idempotente. */
export function useQuitarAsignacion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ epica, persona, rol }: { epica: number; persona: string; rol: string }) =>
      api.qaQuitarAsignacion(epica, persona, rol),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["qa"] }),
  });
}
