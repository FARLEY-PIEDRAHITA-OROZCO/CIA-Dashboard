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

// ------------------------------------------------------------------ //
// Sprints, personas e índice (contrato de /api/sprints, /api/personas,
// /api/items)
// ------------------------------------------------------------------ //
export interface Sprint {
  /** Hoja de la ruta de iteración: «Sprint 45». */
  nombre: string;
  /** Ruta completa: «Proyecto\Sprint 45». Es lo que acepta el filtro. */
  ruta: string;
  total: number;
  abiertos: number;
  cerrados: number;
  personas: number;
  ultimo_cambio: string;
}

export interface ListaSprints {
  sprints: Sprint[];
  total: number;
  /** Sprint con el cambio más reciente (heurística D9). */
  sprint_actual: string;
}

export interface PersonaCarga {
  guid: string;
  nombre: string;
  total: number;
  abiertos: number;
  bugs: number;
  bugs_abiertos: number;
  verificados: number;
}

export interface ListaPersonas {
  personas: PersonaCarga[];
  total: number;
}

export interface ItemIndice {
  azure_id: number;
  tipo: string;
  titulo: string;
  estado: string;
  tags: string;
  sprint: string;
  persona: Persona | null;
  creado: string | null;
  modificado: string | null;
  cerrado: boolean;
}

export interface ListaItems {
  items: ItemIndice[];
  /** Total **antes** de aplicar el tope de 200. */
  total: number;
  sprint_actual: string;
}

// ------------------------------------------------------------------ //
// Señales de analítica QA
// ------------------------------------------------------------------ //
export interface MuestraItem {
  azure_id: number;
  tipo: string;
  titulo: string;
  estado: string;
  sprint: string;
  persona: string;
  modificado: string;
}

export interface ResumenVerificacion {
  bugs: number;
  bugs_cerrados_sin_verificar: number;
  bugs_verificados_sin_cerrar: number;
  historias: number;
  historias_sin_evidencia: number;
  verificados: number;
  generado: string;
}

export interface BrechaVerificacion {
  resumen: ResumenVerificacion;
  cerrados_sin_verificar: MuestraItem[];
  verificados_sin_cerrar: MuestraItem[];
  historias_sin_evidencia: MuestraItem[];
}

export interface ResumenAging {
  inactivos: number;
  en_curso: number;
  dias_inactivo: number;
  dias_en_curso: number;
  generado: string;
}

export interface TrabajoEstancado {
  resumen: ResumenAging;
  inactivos: MuestraItem[];
  en_curso: MuestraItem[];
}

export interface RezagoDeSprint {
  sprint: string;
  abiertos: number;
  items: MuestraItem[];
}

export interface RezagoEntreSprints {
  resumen: {
    sprints: number;
    sprint_referencia: string;
    sprints_con_rezago: number;
    rezagados: number;
    generado: string;
  };
  sprints: RezagoDeSprint[];
}

export interface RespuestaAccion {
  ok: boolean;
  detalle?: string;
}
