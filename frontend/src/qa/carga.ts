/** Lógica de la vista de equipo QA, sin React.
 *
 * Vive aparte del componente por la misma razón que `sprints/cinta.ts` y
 * `qa/actividad.ts`: son reglas de presentación —qué se ordena, qué se dice— y
 * probarlas montando la página costaría un `QueryClientProvider` para no ganar
 * nada.
 */

import type { PersonaQA, SugerenciaQA } from "../api/tipos";

/** Filtros de la lista de personas. `""` es «todas». */
export type FiltroPersonas = "todas" | "qa" | "dev" | "sin_rol" | "con_epicas";

export const FILTROS: Array<{ clave: FiltroPersonas; etiqueta: string }> = [
  { clave: "todas", etiqueta: "Todas" },
  { clave: "qa", etiqueta: "QA" },
  { clave: "dev", etiqueta: "Desarrollo" },
  { clave: "sin_rol", etiqueta: "Sin rol" },
  { clave: "con_epicas", etiqueta: "Con épicas" },
];

/**
 * Aplica el filtro y ordena.
 *
 * El orden es por **épicas asignadas y después días laborables**, no alfabético:
 * la pregunta de esta vista es «quién está carrying más trabajo de pruebas», y
 * una lista alfabética de 35 personas obliga a recorrerla entera para
 * contestarla. El desempate por nombre hace el orden estable entre dos personas
 * con la misma carga, que si no cambiaría al refiltrar.
 */
export function personasOrdenadas(
  personas: PersonaQA[],
  filtro: FiltroPersonas,
): PersonaQA[] {
  const filtradas = personas.filter((p) => {
    if (filtro === "qa") return p.es_qa;
    if (filtro === "dev") return p.es_dev;
    if (filtro === "sin_rol") return !p.es_qa && !p.es_dev;
    if (filtro === "con_epicas") return p.epicas > 0;
    return true;
  });
  return [...filtradas].sort(
    (a, b) =>
      b.epicas - a.epicas ||
      b.dias_laborables - a.dias_laborables ||
      a.nombre.localeCompare(b.nombre, "es"),
  );
}

/** Cuántas personas hay en cada categoría, para las etiquetas de los filtros. */
export function conteoPorCategoria(personas: PersonaQA[]): Record<FiltroPersonas, number> {
  return {
    todas: personas.length,
    qa: personas.filter((p) => p.es_qa).length,
    dev: personas.filter((p) => p.es_dev).length,
    sin_rol: personas.filter((p) => !p.es_qa && !p.es_dev).length,
    con_epicas: personas.filter((p) => p.epicas > 0).length,
  };
}

/**
 * Texto del papel, o `null` si no tiene ninguno.
 *
 * `null` y no «—»: quien no tiene rol asignado no es un dato vacío, es una
 * decisión que no se ha tomado todavía, y la vista tiene que poder decirlo.
 */
export function textoRol(p: PersonaQA): string | null {
  if (p.es_qa && p.es_dev) return "QA y desarrollo";
  if (p.es_qa) return "QA";
  if (p.es_dev) return "Desarrollo";
  return null;
}

/**
 * Sugerencias que aún no están marcadas como QA.
 *
 * Se filtran aquí y no solo en la API porque el usuario puede haber marcado a
 * alguien en otra pestaña: volver a ofrecer a alguien que ya es QA como
 * «sugerencia» es ruido que hace dudar de la pantalla entera.
 */
export function sugerenciasPendientes(sugerencias: SugerenciaQA[]): SugerenciaQA[] {
  return sugerencias
    .filter((s) => !s.ya_es_qa)
    .sort((a, b) => b.activos - a.activos || a.nombre.localeCompare(b.nombre, "es"));
}

/**
 * Si una lista de sugerencias merece mostrarse.
 *
 * El corte está en 3, no en 1: con una sola persona la «sugerencia» no sugiere
 * nada, es un dato. Y hay un techo de 10 para que la heurística no se lea como
 * un veredicto sobre el equipo entero.
 */
export function resumenSugerencias(sugerencias: SugerenciaQA[]): {
  visibles: SugerenciaQA[];
  total: number;
} {
  const pendientes = sugerenciasPendientes(sugerencias);
  return { visibles: pendientes.slice(0, 10), total: pendientes.length };
}

/**
 * «7 épicas · 142 d. laborables», o el texto de «nada» si no tiene.
 *
 * Los días **no son horas**: el registro de tiempos de Azure responde 401 con el
 * PAT de lectura, así que no hay horas en ninguna parte de este sistema. El
 * nombre del campo lo dice, y el resumen lo repite.
 */
export function resumenCarga(p: PersonaQA): string {
  if (p.epicas === 0) return "sin épicas asignadas";
  const epicas = `${p.epicas} épica${p.epicas === 1 ? "" : "s"}`;
  if (p.dias_laborables === 0) return `${epicas} · desde hoy`;
  return `${epicas} · ${p.dias_laborables} d. laborables`;
}

/**
 * Una asignación cuya épica ya no está en Azure.
 *
 * Se marca en vez de ocultarse: la asignación sigue existiendo y es lo único
 * que dice qué épica había. Esconderla sería perderla de la vista sin aviso, y
 * lo único que se puede hacer con ella es borrarla.
 */
export function tituloObsoleto(asignacion: { titulo_conocido: boolean; titulo: string }): string {
  if (asignacion.titulo_conocido) return asignacion.titulo || "—";
  return asignacion.titulo || `Épica #desconocida (ya no está en Azure)`;
}
