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
  /**
   * Gestión del proceso de pruebas.
   *
   * Prefijo propio y separado de `items`: el índice de pruebas es otro, con
   * otro TTL, y no tiene nada que ver con el de sprints. Invalidar uno no puede
   * tirar el otro.
   */
  pruebas: (parte: string) => ["pruebas", parte] as const,
};

/** Filtros del índice local. Vacíos o `undefined` se ignoran (AND). */
export interface FiltrosItems {
  sprint?: string;
  persona?: string;
  tipo?: string;
  etiqueta?: string;
  soloAbiertos?: boolean;
  /** Desplazamiento de la ventana; lo fija la hoja de la vista de sprints. */
  offset?: number;
  limite?: number;
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

/**
 * Ítems del índice local, filtrados y paginados.
 *
 * `activo=false` no lanza la petición. Existe para el revelado progresivo de la
 * vista de sprints: sin filtros son miles de filas y no se piden hasta que el
 * usuario elige un sprint, una persona o un tipo.
 */
export function useItems(filtros: FiltrosItems, activo = true) {
  return useQuery({
    queryKey: CLAVES_QUERY.items(filtros),
    queryFn: ({ signal }) => api.items(filtros, signal),
    enabled: activo,
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

// ------------------------------------------------------------------ //
// Gestión del proceso de pruebas
// ------------------------------------------------------------------ //

/**
 * Filtros de la lista de historias sin caso.
 *
 * Sin `sprint` ni `persona` no hay filtro activo y la lista **no se pide**: son
 * 361 historias en este proyecto y la vista abre con el veredicto y la cinta,
 * que es lo que responde «¿cómo vamos de pruebas?». La lista es el tercer nivel
 * de revelado, igual que la tabla de ítems de la vista de sprints.
 */
export interface FiltrosSinCubrir {
  sprint?: string;
  persona?: string;
  offset?: number;
  limite?: number;
}

/** Resumen de pruebas: inventario, brecha, automatización y diseño. */
export function usePruebasResumen(activo = true) {
  return useQuery({
    queryKey: CLAVES_QUERY.pruebas("resumen"),
    queryFn: ({ signal }) => api.pruebasResumen(signal),
    enabled: activo,
    staleTime: 300_000,
  });
}

/** Cobertura por sprint. Se pide siempre que se abre la vista: es la cinta. */
export function usePruebasCobertura(activo = true) {
  return useQuery({
    queryKey: CLAVES_QUERY.pruebas("cobertura"),
    queryFn: ({ signal }) => api.pruebasCobertura(signal),
    enabled: activo,
    staleTime: 300_000,
  });
}

/** Historias sin caso, filtradas y paginadas. */
export function usePruebasSinCubrir(filtros: FiltrosSinCubrir, activo = true) {
  return useQuery({
    queryKey: [...CLAVES_QUERY.pruebas("sin-cubrir"), filtros],
    queryFn: ({ signal }) => api.pruebasSinCubrir(filtros, signal),
    enabled: activo,
    staleTime: 300_000,
  });
}

/** Planes de pruebas como contexto. Pide 44 filas, no un inventario. */
export function usePruebasPlanes(activo = true) {
  return useQuery({
    queryKey: CLAVES_QUERY.pruebas("planes"),
    queryFn: ({ signal }) => api.pruebasPlanes(signal),
    enabled: activo,
    staleTime: 300_000,
  });
}

/** Filtros de la lista de activos de prueba editables. */
export interface FiltrosActivos {
  tipo?: string;
  estado?: string;
  persona?: string;
  sprint?: string;
  offset?: number;
  limite?: number;
}

/**
 * Activos de prueba para editar, con los campos que su tipo admite.
 *
 * `activo=false` es el valor por defecto a propósito: son 3.931 activos y la
 * lista no se pide hasta que alguien elige un tipo. El índice de pruebas ya
 * está cargado para el veredicto, así que no cuesta una lectura nueva.
 */
export function usePruebasActivos(filtros: FiltrosActivos, activo = false) {
  return useQuery({
    queryKey: [...CLAVES_QUERY.pruebas("activos"), filtros],
    queryFn: ({ signal }) => api.pruebasActivos(filtros, signal),
    enabled: activo,
    staleTime: 300_000,
  });
}

/**
 * Estado de la integración con Azure.
 *
 * `staleTime` de 300 s y no de 60 s: la configuración de Azure (organización,
 * proyecto, PAT) no cambia durante una sesión, así que pedirlo cada minuto es
 * pedir la misma respuesta. Y se monta en **cuatro** páginas (dashboard, épica,
 * tareas, bugs), así que cada navegación sumaba una llamada a Azure que no
 * aportaba nada.
 *
 * Sigue sin guard de `enabled` a propósito: todas las páginas lo necesitan para
 * saber si pueden mostrar datos o el aviso de «configura Azure».
 */
export function useEstadoAzure() {
  return useQuery({
    queryKey: CLAVES_QUERY.estado,
    queryFn: ({ signal }) => api.estadoAzure(signal),
    staleTime: 300_000,
  });
}

/**
 * Épicas del backlog.
 *
 * `staleTime` de 120 s, **igual al TTL del backend** (`CACHE_TTL_SEG`). Antes era
 * de 30 s: el frontend declaraba los datos caducados cuatro veces antes de que el
 * backend los tuviera por viejos, así que cada vuelta al dashboard generaba una
 * petición que el backend respondía desde su caché. No era una llamada a Azure,
 * pero era una ida y vuelta inútil.
 *
 * El backend cachea la lista **completa** y filtra en memoria, así que alternar
 * `incluirCerradas` no vuelve a leer de Azure mientras el TTL esté vigente.
 */
export function useEpicas(activo: boolean, incluirCerradas: boolean) {
  return useQuery({
    queryKey: [...CLAVES_QUERY.epicas, incluirCerradas],
    queryFn: ({ signal }) => api.epicas(incluirCerradas, signal),
    enabled: activo,
    staleTime: 120_000,
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
        // También el índice de pruebas: el backend invalida los dos al escribir,
        // y la Fase 5 ampliará la escritura a los tres tipos de test. Si no se
        // invalidara aquí, la cobertura mostraría números previos a la edición.
        void queryClient.invalidateQueries({ queryKey: ["pruebas"] });
      }
    },
  });
}
