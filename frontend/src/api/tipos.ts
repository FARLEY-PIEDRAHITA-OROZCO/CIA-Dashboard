/** Tipos de dominio compartidos con el backend (contrato de la API REST). */

/**
 * Persona asignada a un work item (`IdentityRef` de Azure).
 *
 * `guid` es el identificador estable: el nombre puede cambiar si alguien se
 * renombra o cambia de cuenta. Se filtra por GUID y se muestra el nombre.
 */
export interface Persona {
  guid: string;
  nombre: string;
  url?: string;
}

/** Campos comunes a todo work item del backlog. */
export interface WorkItemBase {
  azure_id: number;
  titulo: string;
  estado: string;
  descripcion: string;
  url?: string;
  tags?: string;
  /** Ruta completa de iteración, p. ej. `Proyecto\\Sprint 35`. */
  sprint?: string;
  asignado_a?: Persona | null;
  creado?: string | null;
  modificado?: string | null;
}

export interface EpicResumen {
  azure_id: number;
  titulo: string;
  estado: string;
  url: string;
  sprint?: string;
  asignado_a?: Persona | null;
  creado?: string | null;
  modificado?: string | null;
}

export interface Tarea extends WorkItemBase {
  bugs?: Bug[];
}

export interface Bug extends WorkItemBase {
  prioridad: string;
  severidad: string;
  relacion: string;
  tareas?: Tarea[];
}

export interface UserStory extends WorkItemBase {
  tareas?: Tarea[];
  bugs?: Bug[];
}

export interface Feature extends WorkItemBase {
  hus: UserStory[];
}

export interface Epic extends WorkItemBase {
  features: Feature[];
  hus: UserStory[];
}

export interface MetricasBug {
  total: number;
  abiertos: number;
  cerrados: number;
  por_estado: Record<string, number>;
  por_prioridad: Record<string, number>;
  por_severidad: Record<string, number>;
  por_relacion: Record<string, number>;
}

export interface DetalleBugs {
  bugs: Bug[];
  metricas: MetricasBug;
}

export interface EstadoAzure {
  configurada: boolean;
  organizacion: string;
  proyecto: string;
  area_path: string;
  verificado: boolean;
  error: string;
}

/** Campos de QA que el backend acepta en una escritura (lista blanca). */
export interface ActualizacionQA {
  estado?: string;
  prioridad?: string;
  severidad?: string;
  tags?: string;
  notas_qa?: string;
}

export interface ResultadoEscritura {
  work_item_id: number;
  rev: number;
  campos: string[];
  validado: boolean;
  detalle: string;
}

export interface ListaEpicas {
  epicas: EpicResumen[];
}

export interface RespuestaAccion {
  ok: boolean;
  detalle?: string;
}
