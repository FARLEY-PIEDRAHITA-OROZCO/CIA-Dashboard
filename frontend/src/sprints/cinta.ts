/** Lógica pura de la cinta de sprints y de la línea de veredicto.
 *
 * Se separa de los componentes para poder probarla sin React ni red, igual que
 * `fechas.ts`. Aquí vive la decisión de diseño central de la vista: **los sprints
 * son una secuencia, no un conjunto**. Una tabla de 37 filas obliga a leer una
 * por una para comparar; 37 barras se leen de un vistazo.
 *
 * Todos los datos salen de `/api/sprints`, que ya trae `total`, `abiertos`,
 * `cerrados`, `personas` y `ultimo_cambio` por sprint. No hace falta ninguna
 * llamada extra: el rezago de un sprint histórico es exactamente `abiertos`, que
 * es la misma definición que usa `/api/analitica/rezago`.
 */

import type { Sprint } from "../api/tipos";

/** Una columna de la cinta. */
export interface ColumnaCinta {
  nombre: string;
  ruta: string;
  total: number;
  cerrados: number;
  abiertos: number;
  /** Fracción cerrada, 0–1. Un sprint sin ítems da 0, no NaN. */
  cierre: number;
  /** Altura relativa 0–1 frente al sprint más grande. */
  magnitud: number;
  /** Anterior al sprint actual: su trabajo sigue abierto. */
  historico: boolean;
  /** El sprint con el cambio más reciente. */
  actual: boolean;
  /**
   * Ítems que este sprint dejó sin cerrar (0 si es el actual o posterior). Es
   * lo que la señal ③ reporta como rezago.
   */
  rezago: number;
}

/**
 * Construye las columnas de la cinta, en el orden del catálogo.
 *
 * `sprintActual` marca dónde acaba el histórico. Todo lo que queda por detrás
 * arrastra deuda; lo que está por delante (sprints planificados) no.
 *
 * Si el sprint actual no aparece en el catálogo, se asume que **todos** son
 * históricos: es la lectura conservadora, porque marcar como rezago lo que aún
 * no ha ocurrido daría un número inflado, mientras que omitirlo lo rebajaría.
 */
export function construirColumnas(
  catalogo: Sprint[],
  sprintActual: string,
): ColumnaCinta[] {
  const indiceActual = sprintActual
    ? catalogo.findIndex((s) => s.nombre === sprintActual)
    : -1;
  const maximo = catalogo.reduce((mayor, s) => Math.max(mayor, s.total), 0);

  return catalogo.map((sprint, i) => {
    const total = Math.max(0, sprint.total);
    const cerrados = Math.min(Math.max(0, sprint.cerrados), total);
    const historico = indiceActual >= 0 ? i < indiceActual : true;
    return {
      nombre: sprint.nombre,
      ruta: sprint.ruta,
      total,
      cerrados,
      abiertos: Math.max(0, total - cerrados),
      // Se usa `cerrados` y no `sprint.cerrados`: un total de 0 daría NaN.
      cierre: total > 0 ? cerrados / total : 0,
      magnitud: maximo > 0 ? total / maximo : 0,
      historico,
      actual: sprint.nombre === sprintActual,
      rezago: historico ? Math.max(0, total - cerrados) : 0,
    };
  });
}

/** Totales de la cinta, para el resumen y la línea de veredicto. */
export interface ResumenCinta {
  columnas: ColumnaCinta[];
  maximo: number;
  rezagoTotal: number;
  sprintsConRezago: number;
  historicos: number;
}

/** Calcula la cinta y sus agregados de una vez. */
export function construirCinta(catalogo: Sprint[], sprintActual = ""): ResumenCinta {
  const columnas = construirColumnas(catalogo, sprintActual);
  const conRezago = columnas.filter((c) => c.rezago > 0);
  return {
    columnas,
    maximo: columnas.reduce((mayor, c) => Math.max(mayor, c.total), 0),
    rezagoTotal: conRezago.reduce((suma, c) => suma + c.rezago, 0),
    sprintsConRezago: conRezago.length,
    historicos: columnas.filter((c) => c.historico).length,
  };
}

/** Colores de tono ya existentes en la hoja de estilos (`.kpi-valor[data-tono]`). */
export type TonoCinta = "ok" | "alerta" | "acento" | "neutro";

/**
 * Tono de una columna.
 *
 * El criterio es la salud del sprint, no su tamaño: un sprint grande con poco
 * cerrado es una alerta aunque ocupe media pantalla. Se usa «alerta» por debajo
 * del 50 % cerrado en un sprint histórico, donde además hay deuda.
 */
export function tonoColumna(columna: ColumnaCinta): TonoCinta {
  if (columna.actual) return "acento";
  if (columna.total === 0) return "neutro";
  if (columna.historico) return columna.rezago > 0 ? "alerta" : "ok";
  return columna.cierre >= 0.5 ? "ok" : "neutro";
}

/** Descripción corta de una columna, para su etiqueta accesible. */
export function describirColumna(columna: ColumnaCinta): string {
  const partes = [
    columna.nombre,
    `${columna.total} ítems`,
    `${columna.cerrados} cerrados`,
  ];
  if (columna.actual) partes.push("sprint actual");
  else if (columna.rezago > 0) partes.push(`${columna.rezago} sin cerrar`);
  return partes.join(", ");
}
