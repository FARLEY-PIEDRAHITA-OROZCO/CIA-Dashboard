/** Rutas del frontend (navegación por hash, sin dependencias):
 * - `#/dashboard`              → lista de épicas (KPIs + tabla)
 * - `#/dashboard?qa=<guid>`    → solo las épicas asignadas a esa persona
 * - `#/qa`                     → quién prueba qué, y con qué rol
 * - `#/epicas/{id}`            → página dedicada a las historias de la épica
 * - `#/epicas/{id}/tareas`     → tareas de la épica
 * - `#/epicas/{id}/bugs`       → bugs y métricas de la épica
 * - `#/sprints`                → cinta de sprints, sin el detalle desplegado
 * - `#/sprints?sprint=…&persona=…&tipo=…&soloAbiertos=1` → sprint filtrado
 * - `#/sprints?pagina=3`        → tercera página del resultado
 * - `#/sprints?desplegado=1`    → ver los ítems aunque no haya filtros
 * - `#/pruebas`                → cobertura de pruebas por sprint
 * - `#/pruebas?sprint=.&persona=.&pagina=N`  → brecha filtrada, con paginación
 * - `#/analitica`              → señales de analítica QA
 *
 * Los filtros de la vista de sprint viajan **en el hash**, no en estado local:
 * así una URL filtrada se puede compartir o marcar en el navegador, sin
 * depender de las queries guardadas de Azure DevOps. La página y el estado de
 * «detalle desplegado» también viajan, para que una URL compartida abra en el
 * mismo punto y con el mismo nivel de detalle.
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

/** Tipos ofrecidos por el filtro; el primero es el que más abunda. */
export const TIPOS_INDICE = ["Task", "User Story", "Bug", "Issue"] as const;

export type Destino =
  | { pagina: "dashboard"; filtro: FiltrosDashboard }
  | { pagina: "epica"; azureId: number }
  | { pagina: "epicaTareas"; azureId: number }
  | { pagina: "epicaBugs"; azureId: number }
  // `hoja` (1-based) y `desplegado` van aparte de los filtros: ninguno cuenta
  // como filtro activo, y `hoja` se reinicia a 1 al cambiar cualquier filtro,
  // que es lo que espera quien acaba de escribir en el buscador. `desplegado`
  // controla el revelado progresivo de la tabla de ítems.
  | { pagina: "sprints"; filtros: FiltrosSprint; hoja: number; desplegado: boolean }
  | { pagina: "pruebas"; filtro: FiltrosPruebas; hoja: number }
  | { pagina: "analitica" }
  // Monitor de llamadas a Azure. Sin filtros: es un contador, no una vista con
  // parámetros.
  | { pagina: "monitor" }
  // La gestión del proceso de pruebas: quién prueba qué y con qué rol. Sin
  // filtros: la lista de personas son 35 filas, una sola lectura, y filtrarla
  // sería esconder 30 personas detrás de un desplegable sin ganar nada.
  | { pagina: "qa" };

/**
 * Filtros de la vista de pruebas.
 *
 * Reutiliza `FiltrosSprint` a propósito: los dos filtros posibles son sprint y
 * persona, con el mismo nombre y el mismo significado. Duplicarlos daría dos
 * definiciones que divergirían en cuanto cambiara una.
 *
 * `sprint` y `persona` no son obligatorios: sin ellos la vista abre con el
 * veredicto y la cinta, y la lista de historias sin caso no se pide. Igual que en
 * la vista de sprints, es revelado progresivo y no una tabla siempre visible.
 */
export type FiltrosPruebas = Pick<FiltrosSprint, "sprint" | "persona">;

/**
 * Filtros del dashboard de épicas.
 *
 * `qa` es un **GUID**, no un nombre: la asignación vive en el registro local y
 * una persona puede renombrarse sin que sus asignaciones cambien de sitio.
 * Opcional, y con él vacío el registro no se descarga: son ~264 asignaciones
 * que nadie consulta al abrir el backlog.
 */
export interface FiltrosDashboard {
  qa?: string;
}

/** Tamaño de página de la tabla de ítems (coincide con el tope del backend). */
export const ITEMS_POR_PAGINA = 200;

/**
 * Tamaño de página de la lista de historias sin caso de prueba.
 *
 * Smaller que `ITEMS_POR_PAGINA` a propósito: son 361 en este proyecto y la lista
 * es una **cola de trabajo**, no un volcado. Nadie avanza en 200 filas de golpe.
 * El backend acepta hasta 200, así que 50 no es un tope nuevo sino una elección
 * de lectura.
 */
export const PRUEBAS_POR_PAGINA = 50;

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

/**
 * Lee la página desde la query. Se parte de 1 y cualquier valor no numérico o
 * menor que 1 cae a 1, para que una URL manipulada a mano no deje la tabla en
 * un estado imposible.
 */
function leerHoja(busca: URLSearchParams): number {
  const crudo = Number(busca.get("pagina"));
  if (!Number.isSafeInteger(crudo) || crudo < 1) return 1;
  return crudo;
}

/** ¿El detalle está desplegado aunque no haya filtros? Igual que `soloAbiertos`. */
function leerDesplegado(busca: URLSearchParams): boolean {
  const valor = busca.get("desplegado");
  return valor === "1" || valor === "true";
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
  // El dashboard no tiene segmentos: `#/dashboard` y `#/dashboard?qa=…` son
  // ambos válidos, y los segmentos de más degradan al igual que en las demás
  // rutas. Ojo: aquí `partes.length` es 1, no 0 — 0 es el hash vacío, que se
  // resuelve más abajo.
  if (raiz === "dashboard" && partes.length === 1) {
    return { pagina: "dashboard", filtro: leerFiltrosDashboard(query) };
  }
  if (raiz === "qa" && partes.length === 1) {
    return { pagina: "qa" };
  }
  if (raiz === "monitor" && partes.length === 1) {
    return { pagina: "monitor" };
  }
  if (raiz === "sprints" && partes.length === 1) {
    const busca = new URLSearchParams(query);
    return {
      pagina: "sprints",
      filtros: leerFiltros(query),
      hoja: leerHoja(busca),
      desplegado: leerDesplegado(busca),
    };
  }
  if (raiz === "pruebas" && partes.length === 1) {
    const busca = new URLSearchParams(query);
    return {
      pagina: "pruebas",
      filtro: leerFiltrosPruebas(query),
      hoja: leerHoja(busca),
    };
  }
  if (partes.length === 0) {
    return { pagina: "dashboard", filtro: {} };
  }
  if (partes[0]?.toLowerCase() === "epicas" && partes[1]) {
    const idTexto = partes[1];
    if (!/^\d+$/.test(idTexto)) {
      return { pagina: "dashboard", filtro: {} };
    }
    const azureId = Number(idTexto);
    if (!Number.isSafeInteger(azureId) || azureId <= 0) {
      return { pagina: "dashboard", filtro: {} };
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
  return { pagina: "dashboard", filtro: {} };
}

/**
 * Normaliza los filtros de pruebas leídos del hash.
 *
 * Igual que `leerFiltros`: solo se incluyen las claves activas, porque un
 * `undefined` explícito generaría una clave de caché de React Query distinta de
 * la equivalente sin filtro, y con ella una petición de más.
 */
function leerFiltrosPruebas(query: string): FiltrosPruebas {
  const busca = new URLSearchParams(query);
  const filtros: FiltrosPruebas = {};
  const sprint = parametro(busca, "sprint");
  const persona = parametro(busca, "persona");
  if (sprint) filtros.sprint = sprint;
  if (persona) filtros.persona = persona;
  return filtros;
}

/** Normaliza los filtros del dashboard leídos del hash. */
function leerFiltrosDashboard(query: string): FiltrosDashboard {
  const busca = new URLSearchParams(query);
  const filtros: FiltrosDashboard = {};
  const qa = parametro(busca, "qa");
  if (qa) filtros.qa = qa;
  return filtros;
}

/** Serializa el filtro del dashboard. Vacío → cadena vacía, como las demás. */
export function filtrosDashboardAQuery(filtros: FiltrosDashboard): string {
  const busca = new URLSearchParams();
  if (filtros.qa) busca.set("qa", filtros.qa);
  return busca.toString();
}

/** Cuántos filtros hay activos, para el badge «N filtros». La página no cuenta. */
export function contarFiltros(filtros: FiltrosSprint): number {
  return Object.values(filtros).filter((v) => v !== undefined && v !== "" && v !== false)
    .length;
}

/** Índice de desplazamiento de una hoja (1-based) al parámetro `offset`. */
export function hojaAOffset(hoja: number): number {
  return (Math.max(1, Math.floor(hoja)) - 1) * ITEMS_POR_PAGINA;
}

/**
 * Desplazamiento de la hoja de la lista de historias sin caso.
 *
 * Función aparte de `hojaAOffset` y no un parámetro: mezclar los dos tamaños de
 * página en una sola regla es la forma más fácil de que una paginación calcule
 * un `offset` que no corresponde con su `hoja` y salte o repita filas.
 */
export function hojaPruebasAOffset(hoja: number): number {
  return (Math.max(1, Math.floor(hoja)) - 1) * PRUEBAS_POR_PAGINA;
}

/** Cuántas hojas hacen falta para la lista de historias sin caso. */
export function totalHojasPruebas(total: number): number {
  if (total <= 0) return 1;
  return Math.max(1, Math.ceil(total / PRUEBAS_POR_PAGINA));
}

/** Cuántas hojas hacen falta para `total` ítems. */
export function totalHojas(total: number): number {
  if (total <= 0) return 1;
  return Math.max(1, Math.ceil(total / ITEMS_POR_PAGINA));
}

/**
 * Serializa filtros, página y revelado a la query del hash, omitiendo lo vacío.
 *
 * `hoja` 1 y `desplegado` falso se omiten: son los valores por defecto y
 * escribirlos llenaría el historial de entradas que no cambian nada.
 */
export function filtrosAQuery(
  filtros: FiltrosSprint,
  hoja = 1,
  desplegado = false,
): string {
  const busca = new URLSearchParams();
  if (filtros.sprint) busca.set("sprint", filtros.sprint);
  if (filtros.persona) busca.set("persona", filtros.persona);
  if (filtros.tipo) busca.set("tipo", filtros.tipo);
  if (filtros.etiqueta) busca.set("etiqueta", filtros.etiqueta);
  if (filtros.soloAbiertos) busca.set("soloAbiertos", "1");
  if (hoja > 1) busca.set("pagina", String(hoja));
  if (desplegado) busca.set("desplegado", "1");
  return busca.toString();
}

/**
 * Serializa los filtros de pruebas a la query del hash.
 *
 * `hoja` 1 se omite por ser el valor por defecto. No hay `desplegado` aquí: en
 * esta vista la lista de historias sin caso **es** el tercer nivel, y se pide con
 * un filtro, no con un interruptor aparte.
 */
export function filtrosPruebasAQuery(filtros: FiltrosPruebas, hoja = 1): string {
  const busca = new URLSearchParams();
  if (filtros.sprint) busca.set("sprint", filtros.sprint);
  if (filtros.persona) busca.set("persona", filtros.persona);
  if (hoja > 1) busca.set("pagina", String(hoja));
  return busca.toString();
}

function aRuta(destino: Destino): string {
  switch (destino.pagina) {
    case "qa":
      return "#/qa";
    case "monitor":
      return "#/monitor";
    case "dashboard": {
      const query = filtrosDashboardAQuery(destino.filtro);
      return query === "" ? "#/dashboard" : `#/dashboard?${query}`;
    }
    case "epica":
      return `#/epicas/${destino.azureId}`;
    case "epicaTareas":
      return `#/epicas/${destino.azureId}/tareas`;
    case "epicaBugs":
      return `#/epicas/${destino.azureId}/bugs`;
    case "sprints": {
      const query = filtrosAQuery(destino.filtros, destino.hoja, destino.desplegado);
      return query === "" ? "#/sprints" : `#/sprints?${query}`;
    }
    case "pruebas": {
      const query = filtrosPruebasAQuery(destino.filtro, destino.hoja);
      return query === "" ? "#/pruebas" : `#/pruebas?${query}`;
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
