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
}

export interface UserStory {
  azure_id: number;
  titulo: string;
  estado: string;
  descripcion: string;
  url?: string;
  tareas?: Tarea[];
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

export interface EstadoAzure {
  configurada: boolean;
  organizacion: string;
  proyecto: string;
  area_path: string;
  verificado: boolean;
  error: string;
}

export interface ListaEpicas {
  epicas: EpicResumen[];
}

export interface RespuestaAccion {
  ok: boolean;
  detalle?: string;
}