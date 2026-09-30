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
  /** Ítems del índice local, incluidos los que no tienen sprint asignable. */
  total_items: number;
  /** Ítems que sí están en algún sprint. */
  asignados_a_sprint: number;
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
  /** Total que cumple los filtros, **antes** de paginar. */
  total: number;
  /** Desplazamiento de la ventana devuelta. */
  offset: number;
  /** Tamaño de la ventana devuelta (≤ 200). */
  limite: number;
  /** Quedan ítems después de esta ventana. */
  hay_mas: boolean;
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

// ------------------------------------------------------------------ //
// Gestión del proceso de pruebas (contrato de /api/pruebas/*)
//
// Los tres tipos de test (plan, suite, caso) viven en su propio índice, no en
// el de sprints: son 3.932 ítems que nadie consulta al abrir `#/sprints`, y
// cargarlos ahí duplicaría el tiempo en frío de esa vista.
// ------------------------------------------------------------------ //

export interface InventarioPruebas {
  planes: number;
  suites: number;
  casos: number;
  total: number;
}

/**
 * Automatización de los casos.
 *
 * Eje **independiente** del estado: un caso `Closed` puede no estar automatizado
 * y uno `Design` puede estarlo. Por eso no es un tono de estado ni una barra de
 * un tablero. `planificados` son casos que alguien重现 automatizar; hoy siguen
 * siendo manuales y no cuentan como automatizados.
 */
export interface AutomatizacionPruebas {
  casos: number;
  automatizados: number;
  planificados: number;
  manuales: number;
  pct_automatizado: number;
}

/**
 * Casos en `Design`, separados entre trabajo reciente y caso abandonado.
 *
 * 1.577 casos en diseño no son todos deuda: los que no se tocan desde hace más
 * de `dias` no son trabajo en curso.
 */
export interface DisenoPruebas {
  en_diseno: number;
  sin_mover: number;
  dias: number;
}

/** Brecha de cobertura: cuántas historias no tienen ningún caso que las pruebe. */
export interface BrechaCobertura {
  historias: number;
  cubiertas: number;
  sin_cubrir: number;
  pct_cubiertas: number;
  /**
   * `true` si algún lote de relaciones no se pudo leer. Entonces `sin_cubrir` es
   * una **cota superior**: puede haber más historias sin caso de las que se
   * indican, nunca menos. La UI lo dice en vez de presentar la cifra completa.
   */
  parcial: boolean;
  /** Requisitos cubiertos de cualquier tipo, no solo historias. */
  requisitos_cubiertos_total: number;
}

export interface ResumenPruebas {
  inventario: InventarioPruebas;
  /** Estados por tipo: `{ "Test Case": { Design: 1577, … } }`. */
  estados: Record<string, Record<string, number>>;
  automatizacion: AutomatizacionPruebas;
  diseno: DisenoPruebas;
  brecha: BrechaCobertura;
  parcial: boolean;
  generado: string;
}

export interface CoberturaDeSprint {
  nombre: string;
  ruta: string;
  historias: number;
  cubiertas: number;
  sin_cubrir: number;
  pct_cubiertas: number;
}

/**
 * Cobertura global y por sprint.
 *
 * `resumen` es la **misma forma** que `ResumenPruebas.brecha`: es el mismo dato
 * en dos endpoints. Los dos nombres (`resumen` aquí, `brecha` en el resumen) son
 * por contexto, pero los campos son los mismos a propósito.
 */
export interface CoberturaPruebas {
  resumen: BrechaCobertura & {
    lotes_con_error: number;
    generado: string;
  };
  sprints: CoberturaDeSprint[];
}

/** Plan de pruebas como contexto: quién lleva las pruebas de qué sprint. */
export interface PlanDePrueba {
  azure_id: number;
  titulo: string;
  estado: string;
  /** Hoja de la iteración. Vacío si el plan no está en un sprint real. */
  sprint: string;
  persona: string;
  modificado: string;
}

/** Historia sin ningún caso que la pruebe: la lista de trabajo de QA. */
export interface HistoriaSinCubrir {
  azure_id: number;
  titulo: string;
  estado: string;
  /** Vacío si la historia no está en un sprint real. */
  sprint: string;
  persona: string;
  modificado: string;
}

export interface SinCubrir {
  resumen: {
    total: number;
    offset: number;
    limite: number;
    hay_mas: boolean;
    parcial: boolean;
    lotes_con_error: number;
  };
  items: HistoriaSinCubrir[];
}

// ------------------------------------------------------------------ //
// Registro local de pruebas (API /api/qa/*)
//
// Azure no tiene dónde anotar a quién le corresponde probar una épica: las
// épicas no las crea el equipo de QA. Esta información solo existe en el
// registro local, así que es irrecuperable si se pierde.
// ------------------------------------------------------------------ //

/** Persona del proyecto con su papel en el proceso de pruebas. */
export interface PersonaQA {
  guid: string;
  nombre: string;
  es_qa: boolean;
  es_dev: boolean;
  /** `true` si la decisión fue humana y no el valor por defecto. */
  forzado: boolean | null;
  epicas: number;
  epicas_qa: number;
  epicas_dev: number;
  mas_antigua: string;
  /**
   * Días laborables desde la asignación más antigua.
   *
   * **No son horas.** El registro de tiempos de Azure responde 401 y no hay
   * ninguna fuente de horas; un campo llamado `horas` sería un número que el
   * sistema no tiene.
   */
  dias_laborables: number;
  /** Carga real del backlog, para contrastar con lo declarado en el registro. */
  items_backlog: number;
  bugs: number;
}

export interface ListaPersonasQA {
  personas: PersonaQA[];
  total: number;
  qa: number;
  dev: number;
  sin_rol: number;
}

export interface SugerenciaQA {
  guid: string;
  nombre: string;
  activos: number;
  /** `true` si ya está marcada como QA: la UI no debe repetir la sugerencia. */
  ya_es_qa: boolean;
}

export interface SugerenciasQA {
  sugerencias: SugerenciaQA[];
  minimo: number;
  nota: string;
}

/** Rol que se puede marcar. `null` = no lo toques, `false` = quítaselo. */
export interface RolActualizable {
  es_qa?: boolean | null;
  es_dev?: boolean | null;
  forzado?: boolean | null;
}

export interface AsignacionQA {
  epica: number;
  titulo: string;
  /**
   * `false` si la épica ya no está en Azure. La asignación sigue existiendo, así
   * que se muestra: ocultarla sería perderla de la vista sin aviso.
   */
  titulo_conocido: boolean;
  persona: string;
  nombre_persona: string;
  rol: "qa" | "dev";
  desde: string;
  dias_laborables: number;
  nota: string;
}

export interface FiltrosAsignaciones {
  epica?: number;
  persona?: string;
  rol?: "qa" | "dev";
}

export interface ListaAsignaciones {
  asignaciones: AsignacionQA[];
  total: number;
  /** Asignaciones cuya épica ya no existe en Azure. Se declaran para limpiarlas. */
  epicas_desconocidas: number;
}

export interface CargaQA {
  guid: string;
  nombre: string;
  es_qa: boolean;
  es_dev: boolean;
  epicas: number;
  dias_laborables: number;
  desde: string;
  items_backlog: number;
  asignaciones: AsignacionQA[];
}

/** Dónde vive el registro local y si su copia de seguridad funciona.
 *
 * Existe para una sola cosa: que la interfaz **no se invente** el mensaje.
 * `copia_activa` es `true` solo si hay destino configurado **y** la última copia
 * se pudo escribir; con el destino puesto pero inaccesible es `false` y `aviso`
 * viene informado.
 */
export interface EstadoRegistro {
  ruta: string;
  copia_configurada: boolean;
  copia_ruta: string;
  copia_activa: boolean;
  ultima_copia: string;
  /** Texto listo para mostrar. Vacío cuando todo va bien: la copia no molesta. */
  aviso: string;
}

/** Una llamada a Azure, tal como se ve en el monitor.
 *
 * No lleva la URL completa a propósito: lleva la **categoría**, que es lo que
 * permite comparar. La URL tiene el id del ítem y no dice nada que no sepa
 * quien la está mirando.
 */
export interface LlamadaAzure {
  hora: string;
  metodo: string;
  categoria: string;
  estado: number;
  duracionMs: number;
  /** Mensaje de error si lo hubo. Vacío = sin error. */
  error: string;
}

/** Estado del monitor de llamadas a Azure.
 *
 * `avisos` es la pieza que convierte números en decisiones: sin ella, la página
 * sería una colección de contadores que cada uno interpretaría como pudiera.
 */
export interface EstadoMonitor {
  activa: boolean;
  total: number;
  porCategoria: Record<string, number>;
  porEstado: Record<string, number>;
  errores: number;
  /** Entre 0 y 1. */
  tasaError: number;
  latenciaP50Ms: number;
  latenciaP95Ms: number;
  latenciaMaxMs: number;
  concurrentes: number;
  concurrentesPico: number;
  limiteConcurrentes: number;
  llamadasRecientes: LlamadaAzure[];
  /** Texto listo para mostrar. Vacío cuando todo va bien. */
  avisos: string[];
}

// ------------------------------------------------------------------ //
// Actividad por épica
//
// **No son horas.** El registro de tiempos de Azure responde 401 con el PAT de
// lectura, así que no hay ninguna fuente de horas en este sistema. El nombre
// del campo (`revisiones`) es la defensa: un `horas` aquí sería un número que
// nadie ha medido, con nombre de medida.
// ------------------------------------------------------------------ //

export interface RevisionPorPersona {
  /** GUID estable; es lo que enlaza con `#/dashboard?qa=<guid>`. */
  guid: string;
  nombre: string;
  revisiones: number;
}

export interface ActividadEpica {
  epica: number;
  titulo: string;
  /** Ítems del árbol a los que sí se les leyó el historial. */
  items_analizados: number;
  /** Ítems del árbol en total. Si no coinciden con `items_analizados`, falta lectura. */
  items_totales: number;
  /**
   * `true` si algún historial no se pudo leer. El recuento es entonces una
   * **cota inferior** —pierde actividad—, al revés que la cobertura de pruebas,
   * donde perder relaciones produce una cota superior de la brecha.
   */
  parcial: boolean;
  /** Ítems con la revisión de creación y nada más: abiertos y nunca tocados. */
  items_sin_actividad: number;
  revisiones: number;
  personas: number;
  /** Vacío si no hay ninguna fecha válida. Nunca el centinela `9999` de Azure. */
  primera: string;
  ultima: string;
  por_persona: RevisionPorPersona[];
  por_tipo: Record<string, number>;
  /** El aviso de límites viaja con el dato, no solo en la documentación. */
  nota: string;
}

/** Campos de QA que admite un tipo de work item. */
export type CampoEditable = "estado" | "prioridad" | "severidad" | "tags" | "notas_qa";

/**
 * Activo de prueba en la lista editable.
 *
 * `campos_editables` lo envía el backend desde su tabla de lista blanca, que es
 * la misma que aplica el adaptador de escritura. El frontend **no** decide qué
 * controles ofrecer: si lo hiciera, bastaría con que las dos copias se
 * equivocaran para ofrecer un campo que el tipo no tiene, y Azure lo aceptaría
 * en silencio (comprobado con `validateOnly`).
 */
export interface ActivoDePrueba {
  azure_id: number;
  tipo: string;
  titulo: string;
  estado: string;
  sprint: string;
  persona: string;
  tags: string;
  prioridad: string;
  automatizacion: string;
  modificado: string;
  campos_editables: CampoEditable[];
}

export interface ActivosPrueba {
  resumen: {
    total: number;
    offset: number;
    limite: number;
    hay_mas: boolean;
    parcial: boolean;
    lotes_con_error: number;
  };
  items: ActivoDePrueba[];
  /**
   * Estados observados por tipo, no el catálogo de la plantilla: Azure rechaza
   * con HTTP 400 un estado que no existe en el tipo, así que ofrecer el
   * catálogo completo sería ofrecer transiciones que siempre fallan.
   */
  estados: Record<string, string[]>;
}
