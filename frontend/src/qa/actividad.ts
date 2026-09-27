/** Lógica presentacional de la actividad de una épica, sin React.
 *
 * Vive aparte del componente por la misma razón que `sprints/cinta.ts` y
 * `sprints/veredicto.ts`: es lógica que se puede probar sin montar nada, y
 * meterla en el `.tsx` la deja en el único sitio donde no se puede leer con
 * calma.
 */

import type { ActividadEpica } from "../api/tipos";

const MESES = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];

/**
 * Rango de fechas de la actividad, listo para pintar.
 *
 * Tres casos, no dos: hay ítems sin ninguna fecha válida, no solo épicas con
 * dos. Un rango vacío se dice con palabras («sin fechas registradas») porque una
 * raya entre dos celdas vacías parece un dato, no una ausencia.
 */
export function rangoFechas(primera: string, ultima: string): string {
  if (!primera && !ultima) return "sin fechas registradas";
  if (!primera || !ultima) {
    // Una sola de las dos: se dice la que hay, sin inventar la otra.
    return `solo consta ${fechaCorta(primera || ultima)}`;
  }
  return `${fechaCorta(primera)} → ${fechaCorta(ultima)}`;
}

function fechaCorta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "fecha ilegible";
  return `${d.getUTCDate()} ${MESES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * Aviso cuando la lectura quedó incompleta, o `null` si no hace falta.
 *
 * Dice explícitamente que el número es una **cota inferior**. Es lo contrario
 * que la cobertura de pruebas, donde un fallo produce sobrestimación y aquí
 * produce subestimación: quien lea los dos paneles tiene que saber cuál es cuál
 * sin tener que acordarse.
 */
export function avisoParcial(actividad: ActividadEpica): string | null {
  if (!actividad.parcial) return null;
  const faltan = actividad.items_totales - actividad.items_analizados;
  if (faltan <= 0) {
    return "El historial de algún ítem no se pudo leer: el recuento es una cota inferior.";
  }
  return (
    `No se pudo leer el historial de ${faltan} de ${actividad.items_totales} ítems: ` +
    "el recuento es una cota inferior."
  );
}

/** Tipos del árbol ordenados por volumen, con su porcentaje. */
export function repartoPorTipo(
  porTipo: Record<string, number>,
): Array<{ tipo: string; n: number; tanto: number }> {
  const total = Object.values(porTipo).reduce((s, n) => s + n, 0);
  return Object.entries(porTipo)
    .map(([tipo, n]) => ({ tipo, n, tanto: total > 0 ? n / total : 0 }))
    .sort((a, b) => b.n - a.n || a.tipo.localeCompare(b.tipo));
}

/** Cuántas personas se muestran antes de plegar el resto. */
export const PERSONAS_VISIBLES = 8;
