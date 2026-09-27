/** Badge de estado de trabajo normalizado (estados abiertos de Azure). */

const NUEVO = new Set([
  "new",
  "nuevo",
  "proposed",
  "propuesta",
  "todo",
  "backlog",
  "por hacer",
]);
const PROGRESO = new Set([
  "in progress",
  "in-progress",
  "active",
  "activo",
  "doing",
  "en curso",
  "en revisión",
  "in review",
  "desarrollo",
  "development",
  "ejecución",
  "ejecucion",
]);
const TERMINADO = new Set([
  "done",
  "resolved",
  "closed",
  "completed",
  "entregada",
  "entregado",
  "completada",
  "completado",
  "certificada",
  "certificado",
  "cerrada",
  "cerrado",
]);
const REMOVIDO = new Set(["removed", "removido", "cancelado", "cancelled", "cut", "eliminado"]);

/**
 * En pruebas: lo que espera verificación.
 *
 * Va aparte de `progreso` porque en una herramienta de QA «en pruebas» es una
 * cola de trabajo con dueño, no simplemente «siguiendo»: 17 ítems del proyecto
 * real están en este estado y se perdían dentro de la columna «En curso».
 */
const VERIFICACION = new Set([
  "testing",
  "in testing",
  "en pruebas",
  "en testing",
  "pruebas",
  "prueba",
  "verificando",
  "verificacion",
  "qa",
  "pr",
  "review",
  "code review",
]);

/**
 * Bloqueado: necesita que alguien lo desbloquee.
 *
 * Rojo, no naranja: `pendiente` significa «en cola, esperando su turno» y
 * `bloqueado` significa «parado y sin avanzar». Mezclarlos hacía que un ítem
 * atascado pasara por trabajo normal.
 */
const BLOQUEADO = new Set([
  "blocked",
  "bloqueado",
  "bloqueada",
  "on hold",
  "en espera",
  "impedido",
  "stuck",
  "atascado",
]);
/**
 * En cola, esperando su turno.
 *
 * `ready` comparte tono con `design` a propósito: los dos significan «todavía no
 * se puede ejecutar», que es lo que un tablero de pruebas necesita distinguir
 * del gris de «no sé qué estado es este». `Ready` caía en `neutro` porque no
 * estaba en ninguna lista, y un caso listo para ejecutar se dibujaba como si no
 * significara nada. Merece un tono propio cuando separe el que está listo del
 * que aún se escribe, y ese tono necesita su CSS en `ORDEN_TONOS` y en los tres
 * títulos de tablero.
 */
const PENDIENTE = new Set([
  "approved",
  "aprobado",
  "committed",
  "comprometido",
  "to do",
  "pending",
  "pendiente",
  "design",
  "ready",
  "listo",
  "lista",
  "planeación",
  "planeacion",
]);

/** Una columna del tablero: el tono que agrupa y su título. */
export interface ColumnaEstado {
  tono: TonoEstado;
  titulo: string;
}

export type TonoEstado =
  | "nuevo"
  | "progreso"
  | "verificacion"
  | "terminado"
  | "bloqueado"
  | "removido"
  | "pendiente"
  | "neutro";

/**
 * Orden de las columnas del tablero: el recorrido del trabajo, con los estados
 * que requieren atención al final.
 *
 * `bloqueado` va justo después de `terminado` y antes de `removido`: forma
 * grupo con lo que está «fuera del flujo» y necesita a alguien, en lugar de
 * interrumpir la ruta nuevo → pendiente → curso → pruebas → terminada.
 */
export const ORDEN_TONOS: readonly TonoEstado[] = [
  "nuevo",
  "pendiente",
  "progreso",
  "verificacion",
  "terminado",
  "bloqueado",
  "removido",
  "neutro",
] as const;

/**
 * Construye las columnas de un tablero a partir de un único orden.
 *
 * Los tres tableros (historias, tareas y bugs) comparten orden y solo cambian
 * los títulos por género. Derivar las columnas de `ORDEN_TONOS` evita que un
 * tono nuevo se añada a un tablero y se olvide en otro, que era el riesgo real
 * de tener tres listas literales.
 */
export function columnasDesdeOrden(titulos: Record<TonoEstado, string>): ColumnaEstado[] {
  return ORDEN_TONOS.map((tono) => ({ tono, titulo: titulos[tono] }));
}

export function tonoEstado(estado: string): TonoEstado {
  const clave = (estado ?? "").toLowerCase().trim().replace(/\s+/g, " ");
  if (NUEVO.has(clave)) return "nuevo";
  if (BLOQUEADO.has(clave)) return "bloqueado";
  if (PROGRESO.has(clave)) return "progreso";
  if (VERIFICACION.has(clave)) return "verificacion";
  if (TERMINADO.has(clave)) return "terminado";
  if (REMOVIDO.has(clave)) return "removido";
  if (PENDIENTE.has(clave)) return "pendiente";
  return "neutro";
}

export function EstadoTrabajo({ estado }: { estado: string }) {
  const etiqueta = estado && estado.trim() ? estado : "—";
  return <span className={`badge-estado estado-${tonoEstado(estado)}`}>{etiqueta}</span>;
}