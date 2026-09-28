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
  registro: ["qa", "registro"] as const,
  actividad: (epica: number) => ["qa", "actividad", epica] as const,
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
 *
 * `staleTime` de 900 s, **igual al TTL del índice de pruebas**
 * (`INDEX_PRUEBAS_TTL_SEG`). Antes era de 300 s: el frontend renunciaba a la
 * caché tres veces antes de que el backend la diera por vieja, y como esta
 * consulta necesita el índice de pruebas entero (3.932 activos, 18 lotes), cada
 * recarga era un trabajo que el backend ya tenía hecho.
 */
export function useSugerenciasQA(activo = true, minimo = 3) {
  return useQuery({
    queryKey: CLAVES_QA.sugerencias(minimo),
    queryFn: ({ signal }) => api.qaSugerencias(minimo, signal),
    enabled: activo,
    staleTime: 900_000,
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
 * Dónde vive el registro y si su copia funciona.
 *
 * TTL largo a propósito: el estado del almacenamiento cambia muy rare vez (solo
 * al reiniciar el backend o al tocar la configuración), así que no tiene
 * sentido repreguntarlo. Cuando cambia, «Actualizar» en la barra lo invalida
 * junto con lo demás.
 */
export function useEstadoRegistro(activo = true) {
  return useQuery({
    queryKey: CLAVES_QA.registro,
    queryFn: ({ signal }) => api.qaEstadoRegistro(signal),
    enabled: activo,
    staleTime: 900_000,
  });
}

/**
 * Actividad registrada de una épica.
 *
 * **`activo` es `false` por defecto y no es un descuido**: es la petición más
 * cara de la aplicación, una llamada a Azure por ítem del árbol (hasta 254 en una
 * épica grande; mediana medida 1,2 s, máximo 5,8 s). Se pide solo cuando alguien
 * despliega el panel, y se cachea 15 min porque el historial no cambia de forma
 * útil de un minuto a otro.
 *
 * Devuelve `null` para «sin épica» en vez de adivinar: quien llame tiene que
 * decidir si pide 0 o pide otra cosa, y ese `0` sería una petición de 254
 * llamadas por un ID que ya está en la URL.
 */
export function useActividadEpica(epica: number | null) {
  return useQuery({
    queryKey: CLAVES_QA.actividad(epica ?? 0),
    queryFn: ({ signal }) => api.qaActividadEpica(epica as number, signal),
    enabled: epica !== null,
    staleTime: 900_000,
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
