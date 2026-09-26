/** Rutas del frontend (navegación por hash, sin dependencias):
 * - `#/dashboard`              → lista de épicas (KPIs + tabla)
 * - `#/epicas/{id}`            → página dedicada a las historias de la épica
 * - `#/epicas/{id}/tareas`     → tareas de la épica
 * - `#/epicas/{id}/bugs`       → bugs y métricas de la épica
 * - `#/sprints`                → catálogo de sprints
 * - `#/sprints?sprint=…&persona=…&tipo=…&soloAbiertos=1` → sprint filtrado
 * - `#/analitica`              → señales de analítica QA
 *
 * Los filtros de la vista de sprint viajan **en el hash**, no en estado local:
 * así una URL filtrada se puede compartir o marcar en el navegador, sin
 * depender de las queries guardadas de Azure DevOps.
 */

import { useEffect, useReducer } from "react";

/** Filtros combinables de la vista de sprint. Todos opcionales. */
export interface FiltrosSprint {
  /** Ruta completa de iteración, p. ej. `Proyecto\Sprint 45`. */
  sprint?: string;
  /** GUID de la persona (estable) o fragmento de su nombre. */
  persona?: string;
  tipo?: string;
  etiqueta?: string;
  soloAbiertos?: boolean;
}

export const FILTROS_VACIOS: FiltrosSprint = {};

/** Tipos offered por los filtros; el primero es el que más abunda. */
export const TIPOS_INDICE = ["Task", "User Story", "Bug", "Issue"] as const;

export type Destino =
  | { pagina: "dashboard" }
  | { pagina: "epica"; azureId: number }
  | { pagina: "epicaTareas"; azureId: number }
  | { pagina: "epicaBugs"; azureId: number }
  | { pagina: "sprints"; filtros: FiltrosSprint }
  | { pagina: "analitica" };

/** Lee un parámetro de la query del hash, ignorando los vacíos. */
function parametro(busca: URLSearchParams, nombre: string): string | undefined {
  const valor = (busca.get(nombre) ?? "").trim();
  return valor === "" ? undefined : valor;
}

/**
 * Normaliza los filtros leídos del hash.
 *
 * Solo se incluyen las claves **activas**. No basta con devolver
 * `{sprint: undefined, soloAbiertos: false}`: la clave de React Query
 * `["items", filtros]` compara por valor, así que un `false` explícito
 * generaría una entrada de caché distinta —y una petición extra— para un filtro
 * que en realidad es el mismo.
 */
function leerFiltros(query: string): FiltrosSprint {
  const busca = new URLSearchParams(query);
  const filtros: FiltrosSprint = {};
  const sprint = parametro(busca, "sprint");
  const persona = parametro(busca, "persona");
  const tipo = parametro(busca, "tipo");
  const etiqueta = parametro(busca, "etiqueta");
  if (sprint) filtros.sprint = sprint;
  if (persona) filtros.persona = persona;
  if (tipo) filtros.tipo = tipo;
  if (etiqueta) filtros.etiqueta = etiqueta;
  const solo = busca.get("soloAbiertos");
  if (solo === "1" || solo === "true") filtros.soloAbiertos = true;
  return filtros;
}

export function parsearHash(hash: string): Destino {
  // La query del hash va tras «?»; se separa antes de trocear los segmentos
  // para que `sprint=Sprint 1` no se confunda con un segmento de ruta.
  const [ruta, query = ""] = hash.replace(/^#\/?/, "").split("?", 2);
  const partes = ruta.split("/").filter(Boolean);
  const raiz = partes[0]?.toLowerCase();

  if (raiz === "analitica" && partes.length === 1) {
    return { pagina: "analitica" };
  }
  if (raiz === "sprints" && partes.length === 1) {
    return { pagina: "sprints", filtros: leerFiltros(query) };
  }
  if (partes[0]?.toLowerCase() === "epicas" && partes[1]) {
    const idTexto = partes[1];
    if (!/^\d+$/.test(idTexto)) {
      return { pagina: "dashboard" };
    }
    const azureId = Number(idTexto);
    if (!Number.isSafeInteger(azureId) || azureId <= 0) {
      return { pagina: "dashboard" };
    }
    if (partes.length === 3 && partes[2].toLowerCase() === "tareas") {
      return { pagina: "epicaTareas", azureId };
    }
    if (partes.length === 3 && partes[2].toLowerCase() === "bugs") {
      return { pagina: "epicaBugs", azureId };
    }
    if (partes.length === 2) {
      return { pagina: "epica", azureId };
    }
  }
  return { pagina: "dashboard" };
}

/** Serializa filtros a query del hash, omitiendo los vacíos. */
export function filtrosAQuery(filtros: FiltrosSprint): string {
  const busca = new URLSearchParams();
  if (filtros.sprint) busca.set("sprint", filtros.sprint);
  if (filtros.persona) busca.set("persona", filtros.persona);
  if (filtros.tipo) busca.set("tipo", filtros.tipo);
  if (filtros.etiqueta) busca.set("etiqueta", filtros.etiqueta);
  if (filtros.soloAbiertos) busca.set("soloAbiertos", "1");
  return busca.toString();
}

/** Cuántos filtros hay activos, para el badge «N filtros». */
export function contarFiltros(filtros: FiltrosSprint): number {
  return Object.values(filtros).filter((v) => v !== undefined && v !== "" && v !== false)
    .length;
}

function aRuta(destino: Destino): string {
  switch (destino.pagina) {
    case "epica":
      return `#/epicas/${destino.azureId}`;
    case "epicaTareas":
      return `#/epicas/${destino.azureId}/tareas`;
    case "epicaBugs":
      return `#/epicas/${destino.azureId}/bugs`;
    case "sprints": {
      const query = filtrosAQuery(destino.filtros);
      return query === "" ? "#/sprints" : `#/sprints?${query}`;
    }
    case "analitica":
      return "#/analitica";
    default:
      return "#/dashboard";
  }
}

/** Navega programáticamente (asigna el hash → dispara `hashchange`). */
export function irA(destino: Destino): void {
  const ruta = aRuta(destino);
  if (window.location.hash !== ruta) {
    window.location.hash = ruta;
  }
}

/** Ruta como `href` para enlaces normales (funcionan con el botón atrás). */
export function enlaceA(destino: Destino): string {
  return aRuta(destino);
}

/** Observa el hash actual de forma reactiva. */
export function useVista(): Destino {
  const [, forzarRender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    window.addEventListener("hashchange", forzarRender);
    return () => window.removeEventListener("hashchange", forzarRender);
  }, []);
  return parsearHash(window.location.hash);
}
