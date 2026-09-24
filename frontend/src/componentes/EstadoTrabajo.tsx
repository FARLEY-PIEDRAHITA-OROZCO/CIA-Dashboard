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
const PENDIENTE = new Set([
  "approved",
  "aprobado",
  "committed",
  "comprometido",
  "to do",
  "pending",
  "pendiente",
  "design",
  "planeación",
  "planeacion",
]);

export type TonoEstado = "nuevo" | "progreso" | "terminado" | "removido" | "pendiente" | "neutro";

export function tonoEstado(estado: string): TonoEstado {
  const clave = (estado ?? "").toLowerCase().trim().replace(/\s+/g, " ");
  if (NUEVO.has(clave)) return "nuevo";
  if (PROGRESO.has(clave)) return "progreso";
  if (TERMINADO.has(clave)) return "terminado";
  if (REMOVIDO.has(clave)) return "removido";
  if (PENDIENTE.has(clave)) return "pendiente";
  return "neutro";
}

export function EstadoTrabajo({ estado }: { estado: string }) {
  const etiqueta = estado && estado.trim() ? estado : "—";
  return <span className={`badge-estado estado-${tonoEstado(estado)}`}>{etiqueta}</span>;
}