/** Búsqueda de épicas del dashboard: coincidencia tolerante y resaltado.
 *
 * El filtrado es **local**: la lista de épicas ya está en memoria, así que no
 * se generan peticiones extra a Azure. La normalización ignora mayúsculas,
 * acentos y espacios sobrantes, de modo que «informacion» encuentra
 * «Información» y «  canal  » encuentra «Canal digital».
 */

import type { ReactNode } from "react";

import type { EpicResumen } from "../api/tipos";

/** Minúsculas sin acentos y con espacios colapsados, para comparar textos. */
export function normalizar(texto: string): string {
  return (texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Coincidencia por **términos**: todos deben aparecer (AND).
 *
 * «canal digital» encuentra «Canal digital» pero no «Canal móvil»: varios
 * términos acortan la búsqueda en lugar de ampliarla.
 */
export function coincideEpica(epica: EpicResumen, consulta: string): boolean {
  const terminos = normalizar(consulta).split(/\s+/).filter(Boolean);
  if (terminos.length === 0) return true;

  const objetivo = normalizar(`${epica.titulo} ${epica.azure_id} ${epica.estado}`);
  return terminos.every((termino) => objetivo.includes(termino));
}

/** Filtra la lista de épicas conservando el orden original. */
export function filtrarEpicas(epicas: EpicResumen[], consulta: string): EpicResumen[] {
  if (consulta.trim() === "") return epicas;
  return epicas.filter((epica) => coincideEpica(epica, consulta));
}

/** Escapa los metacaracteres de una expresión regular. */
function escaparRegExp(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Divide el texto en fragmentos, marcando la coincidencia con `<mark>`.
 *
 * El resaltado es literal y sin distinguir mayúsculas, mientras que el
 * filtrado sí tolera acentos. Se mantiene así a propósito: resaltar sobre el
 * texto normalizado rompería los índices al cambiar la longitud de la cadena.
 *
 * `clave` es una base que distingue el resultado de esta llamada de otra que se
 * dibuje en el mismo padre. **Cada elemento lleva además su índice**: con
 * `split` y un grupo de captura los índices impares son las coincidencias y los
 * pares el texto normal, así que usar solo `clave` para los impares y
 * `clave + indice` para los pares colisionaba en el índice 0, que daba
 * `clave + 0 === clave`. React avisaba de claves duplicadas y podía reutilizar
 * el nodo equivocado al cambiar la búsqueda, dejando el resaltado pegado donde ya
 * no correspondía.
 */
export function resaltar(texto: string, consulta: string, clave: number): ReactNode {
  const limpio = consulta.trim();
  if (limpio === "" || texto === "") return texto;

  const patron = new RegExp(`(${escaparRegExp(limpio)})`, "ig");
  return texto.split(patron).map((parte, indice) =>
    indice % 2 === 1 ? (
      <mark key={`${clave}-${indice}`}>{parte}</mark>
    ) : (
      <span key={`${clave}-${indice}`}>{parte}</span>
    ),
  );
}
