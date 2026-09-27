/** Lógica pura de la línea de veredicto.
 *
 * Sustituye a la fila de KPIs. Motivo medido: en el estado por defecto los cuatro
 * KPIs de la vista de sprints mostraban 37 · 5.651 · 35 · «Sprint 45», las
 * mismas constantes haya lo que se seleccionara. No informaban de nada; solo
 * ocupaban sitio. Una frase responde en cambio a la pregunta real («¿cómo va
 * mi sprint y qué se me está quedando atrás?») y se escanea más rápido.
 */

import type { ListaSprints, PersonaCarga, Sprint } from "../api/tipos";
import { porcentaje, resumenFiltros } from "./fechas";
import { construirCinta } from "./cinta";
import type { FiltrosSprint } from "../navegacion";

/** Partes del veredicto, ya calculadas y con tono. */
export interface Veredicto {
  titular: string;
  /** Frase secundaria: el contexto que da significance a los números. */
  detalle: string;
  tono: "ok" | "alerta" | "neutro";
}

/**
 * Plural sin librería.
 *
 * `plural(1, 'abierto', 'abiertos')` → «1 abierto»; `plural(3, …)` → «3 abiertos».
 * Se pasan las dos formas porque en español no basta con añadir «s»: «abierto» →
 * «abiertos», pero «ítem» → «ítems».
 */
export function plural(
  cantidad: number,
  singular: string,
  pluralForma = `${singular}s`,
): string {
  return `${cantidad} ${cantidad === 1 ? singular : pluralForma}`;
}

/**
 * Veredicto de un sprint concreto.
 *
 * El tono sigue a la salud del sprint: cerrado por debajo del 50 % es alerta,
 * porque un sprint que dejó la mitad de su trabajo sin cerrar es el problema
 * que esta vista existe para señalar.
 */
export function veredictoSprint(sprint: Sprint, esActual: boolean): Veredicto {
  const cerrados = Math.min(sprint.cerrados, sprint.total);
  const abiertos = Math.max(0, sprint.total - sprint.cerrados);
  const cierre = sprint.total > 0 ? porcentaje(cerrados, sprint.total) : 0;
  const titular = `${sprint.nombre}${esActual ? " · sprint actual" : ""}`;
  const detalle =
    sprint.total === 0
      ? "sin ítems"
      : `${plural(abiertos, "abierto", "abiertos")} de ${plural(sprint.total, "ítem")} · ${cierre}% cerrado · ${plural(sprint.personas, "persona")}`;
  return {
    titular,
    detalle,
    tono: cierre >= 50 ? "ok" : "alerta",
  };
}

/** Veredicto con filtros pero sin sprint elegido. */
export function veredictoFiltrado(
  cat: ListaSprints,
  personas: PersonaCarga[],
  filtros: FiltrosSprint,
  totalItems: number,
  nombresPersona: Record<string, string> = {},
): Veredicto {
  const cinta = construirCinta(cat.sprints, cat.sprint_actual);
  const etiqueta = resumenFiltros(filtros, cat.sprints, nombresPersona);
  const hayFiltro = etiqueta !== "Sin filtros";

  // La cifra grande es el total filtrado, que es lo único que el usuario puede
  // cambiar desde aquí. Sin filtros se usa el total real del índice, no la suma
  // de las columnas: hay ítems sin sprint asignable y decirlo evita que la
  // cinta parezca cubrir el proyecto entero cuando no lo hace.
  const titular = hayFiltro
    ? `${plural(totalItems, "ítem")} · ${etiqueta}`
    : plural(totalItems, "ítem") + " en el proyecto";

  const partes: string[] = [];
  if (cinta.rezagoTotal > 0) {
    partes.push(
      `${plural(cinta.rezagoTotal, "ítem")} rezagado${cinta.rezagoTotal === 1 ? "" : "s"} de ` +
        `${plural(cinta.sprintsConRezago, "sprint")}`,
    );
  }
  const sinSprint = cat.total_items - cat.asignados_a_sprint;
  if (!hayFiltro && sinSprint > 0) {
    partes.push(`${plural(sinSprint, "ítem")} sin sprint asignado`);
  }
  if (hayFiltro && totalItems === 0) {
    partes.push("ninguno cumple los filtros");
  } else if (personas.length > 0) {
    partes.push(`${plural(personas.length, "persona")} en el índice`);
  }
  if (partes.length === 0) partes.push("sin deuda acumulada");

  return {
    titular,
    detalle: partes.join(" · "),
    tono: totalItems === 0 && hayFiltro ? "alerta" : "neutro",
  };
}
