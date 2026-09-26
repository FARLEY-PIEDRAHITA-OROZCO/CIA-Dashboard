/** Lógica pura de la vista de sprints y de la analítica QA.
 *
 * Se separa de los componentes para poder probarla sin React ni red, igual que
 * `busquedaEpicas.tsx`. Aquí vive lo que es fácil de equivocar: el formato de
 * fechas, la antigüedad en días y la elección del «sprint actual».
 */

import type { MuestraItem, Sprint } from "../api/tipos";
import type { FiltrosSprint } from "../navegacion";
import { contarFiltros } from "../navegacion";

/** Días transcurridos entre `fecha` y `ahora`; `null` si no hay fecha válida. */
export function diasDesde(fecha: string | null | undefined, ahora: Date = new Date()): number | null {
  if (!fecha) return null;
  const momento = new Date(fecha);
  const valor = momento.getTime();
  if (Number.isNaN(valor)) return null;
  return Math.floor((ahora.getTime() - valor) / 86_400_000);
}

/** Antigüedad legible: «hoy», «hace 3 d», «hace 2 meses». */
export function antiguedadLegible(
  fecha: string | null | undefined,
  ahora: Date = new Date(),
): string {
  const dias = diasDesde(fecha, ahora);
  if (dias === null) return "—";
  if (dias <= 0) return "hoy";
  if (dias === 1) return "hace 1 día";
  if (dias < 14) return `hace ${dias} días`;
  if (dias < 60) return `hace ${Math.floor(dias / 7)} semanas`;
  if (dias < 365) return `hace ${Math.floor(dias / 30)} meses`;
  return `hace ${Math.floor(dias / 365)} años`;
}

/** Fecha corta: `2026-09-26` → `26/09/2026`. `—` si no hay fecha. */
export function fechaCorta(fecha: string | null | undefined): string {
  const dias = diasDesde(fecha);
  if (dias === null) return "—";
  const d = new Date(fecha as string);
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  return `${dia}/${mes}/${d.getFullYear()}`;
}

/** Etiqueta legible de un filtro para el resumen «Estás viendo…». */
export function resumenFiltros(
  filtros: FiltrosSprint,
  sprints: Sprint[],
  nombresPersona: Record<string, string> = {},
): string {
  const partes: string[] = [];
  if (filtros.sprint) {
    const nombre = sprints.find((s) => s.ruta === filtros.sprint)?.nombre ?? filtros.sprint;
    partes.push(`sprint ${nombre}`);
  }
  if (filtros.persona) {
    partes.push(`persona ${nombresPersona[filtros.persona] ?? filtros.persona}`);
  }
  if (filtros.tipo) partes.push(`tipo ${filtros.tipo}`);
  if (filtros.etiqueta) partes.push(`etiqueta ${filtros.etiqueta}`);
  if (filtros.soloAbiertos) partes.push("solo abiertos");
  if (partes.length === 0) return "Sin filtros";
  return partes.join(" · ");
}

export { contarFiltros };

/** Porcentaje redondeado, para las barras de progreso de los KPIs. */
export function porcentaje(parte: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((parte / total) * 100);
}

/** Compara dos muestras por fecha descendente, con desempate por id. */
export function porMasReciente(
  a: MuestraItem,
  b: MuestraItem,
): number {
  const fa = a.modificado ? new Date(a.modificado).getTime() : 0;
  const fb = b.modificado ? new Date(b.modificado).getTime() : 0;
  if (fa !== fb) return fb - fa;
  return b.azure_id - a.azure_id;
}
