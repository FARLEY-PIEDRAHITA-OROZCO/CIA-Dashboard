/** Tipos de dominio compartidos con el backend (contrato de la API REST). */

export interface EpicResumen {
  azure_id: number;
  titulo: string;
  estado: string;
  url: string;
}

export interface Tarea {
  azure_id: number;
  titulo: string;
  estado: string;
  descripcion: string;
  url?: string;
  tags?: string;
  bugs?: Bug[];
}

export interface Bug {
  azure_id: number;
  titulo: string;
  estado: string;
  descripcion: string;
  url?: string;
  tags?: string;
  prioridad: string;
  severidad: string;
  asignado_a: string;
  relacion: string;
  tareas?: Tarea[];
}

export interface UserStory {
  azure_id: number;
  titulo: string;
  estado: string;
  descripcion: string;
  url?: string;
  tags?: string;
  tareas?: Tarea[];
  bugs?: Bug[];
}

export interface Feature {
  azure_id: number;
  titulo: string;
  estado: string;
  descripcion: string;
  url?: string;
  hus: UserStory[];
}

export interface Epic {
  azure_id: number;
  titulo: string;
  estado: string;
  descripcion: string;
  features: Feature[];
  hus: UserStory[];
  url: string;
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
