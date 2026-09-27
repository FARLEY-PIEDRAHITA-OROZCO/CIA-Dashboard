/** Cliente HTTP tipado hacia el backend (única costura de red del frontend). */

import type {
  ActualizacionQA,
  BrechaVerificacion,
  Bug,
  DetalleBugs,
  Epic,
  EpicResumen,
  EstadoAzure,
  Feature,
  ItemIndice,
  ListaEpicas,
  ListaItems,
  ListaPersonas,
  ListaSprints,
  MetricasBug,
  MuestraItem,
  Persona,
  PersonaCarga,
  RezagoEntreSprints,
  RespuestaAccion,
  ResultadoEscritura,
  Sprint,
  Tarea,
  TrabajoEstancado,
  UserStory,
} from "./tipos";

const BASE = "/api";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function objeto(valor: unknown, nombre: string): Record<string, unknown> {
  if (typeof valor !== "object" || valor === null || Array.isArray(valor)) {
    throw new ApiError(`Respuesta inválida: ${nombre} no es un objeto`);
  }
  return valor as Record<string, unknown>;
}

function texto(valor: unknown, nombre: string): string {
  if (typeof valor !== "string") {
    throw new ApiError(`Respuesta inválida: ${nombre} no es texto`);
  }
  return valor;
}

function numero(valor: unknown, nombre: string): number {
  if (typeof valor !== "number" || !Number.isFinite(valor)) {
    throw new ApiError(`Respuesta inválida: ${nombre} no es numérico`);
  }
  return valor;
}

function booleano(valor: unknown, nombre: string): boolean {
  if (typeof valor !== "boolean") {
    throw new ApiError(`Respuesta inválida: ${nombre} no es booleano`);
  }
  return valor;
}

function lista<T>(valor: unknown, nombre: string, validar: (item: unknown) => T): T[] {
  if (!Array.isArray(valor)) {
    throw new ApiError(`Respuesta inválida: ${nombre} no es una lista`);
  }
  return valor.map(validar);
}

function opcionalTexto(valor: unknown, nombre: string): string | undefined {
  if (valor === undefined || valor === null) return undefined;
  return texto(valor, nombre);
}

function tagsOpcionales(valor: unknown, nombre: string): { tags?: string } {
  if (valor === undefined || valor === null) return {};
  return { tags: texto(valor, nombre) };
}

/** Valida una `Persona` (IdentityRef). `null`/`undefined` → sin responsable. */
function personaOpcional(valor: unknown, nombre: string): Persona | null {
  if (valor === undefined || valor === null) return null;
  const item = objeto(valor, nombre);
  return {
    guid: texto(item.guid, `${nombre}.guid`),
    nombre: texto(item.nombre ?? "", `${nombre}.nombre`),
    ...urlOpcional(item.url, `${nombre}.url`),
  };
}

/** Campos comunes (sprint, persona y fechas) presentes en todo work item. */
function comunesWorkItem(item: Record<string, unknown>, prefijo: string) {
  return {
    ...tagsOpcionales(item.tags, `${prefijo}.tags`),
    ...(item.sprint === undefined
      ? {}
      : { sprint: texto(item.sprint, `${prefijo}.sprint`) }),
    asignado_a: personaOpcional(item.asignado_a, `${prefijo}.asignado_a`),
    ...(item.creado === undefined
      ? {}
      : { creado: item.creado === null ? null : texto(item.creado, `${prefijo}.creado`) }),
    ...(item.modificado === undefined
      ? {}
      : {
          modificado:
            item.modificado === null ? null : texto(item.modificado, `${prefijo}.modificado`),
        }),
  };
}

function urlOpcional(valor: unknown, nombre: string): { url?: string } {
  const url = opcionalTexto(valor, nombre);
  return url === undefined ? {} : { url };
}

function mapaNumeros(valor: unknown, nombre: string): Record<string, number> {
  const item = objeto(valor, nombre);
  return Object.fromEntries(
    Object.entries(item).map(([clave, cantidad]) => [clave, numero(cantidad, `${nombre}.${clave}`)]),
  );
}

function validarTarea(valor: unknown): Tarea {
  const item = objeto(valor, "tarea");
  const bugs =
    item.bugs === undefined
      ? undefined
      : lista(item.bugs, "tarea.bugs", validarBug);
  return {
    azure_id: numero(item.azure_id, "tarea.azure_id"),
    titulo: texto(item.titulo, "tarea.titulo"),
    estado: texto(item.estado, "tarea.estado"),
    descripcion: texto(item.descripcion, "tarea.descripcion"),
    ...urlOpcional(item.url, "tarea.url"),
    ...comunesWorkItem(item, "tarea"),
    ...(bugs !== undefined ? { bugs } : {}),
  };
}

function validarBug(valor: unknown): Bug {
  const item = objeto(valor, "bug");
  return {
    azure_id: numero(item.azure_id, "bug.azure_id"),
    titulo: texto(item.titulo, "bug.titulo"),
    estado: texto(item.estado, "bug.estado"),
    descripcion: texto(item.descripcion, "bug.descripcion"),
    ...urlOpcional(item.url, "bug.url"),
    ...comunesWorkItem(item, "bug"),
    prioridad: texto(item.prioridad ?? "", "bug.prioridad"),
    severidad: texto(item.severidad ?? "", "bug.severidad"),
    relacion: texto(item.relacion ?? "hierarchy", "bug.relacion"),
    tareas: lista(item.tareas ?? [], "bug.tareas", validarTarea),
  };
}

function validarHistoria(valor: unknown): UserStory {
  const item = objeto(valor, "historia");
  const bugs =
    item.bugs === undefined
      ? undefined
      : lista(item.bugs, "historia.bugs", validarBug);
  return {
    azure_id: numero(item.azure_id, "historia.azure_id"),
    titulo: texto(item.titulo, "historia.titulo"),
    estado: texto(item.estado, "historia.estado"),
    descripcion: texto(item.descripcion, "historia.descripcion"),
    ...urlOpcional(item.url, "historia.url"),
    ...comunesWorkItem(item, "historia"),
    tareas: lista(item.tareas ?? [], "historia.tareas", validarTarea),
    ...(bugs !== undefined ? { bugs } : {}),
  };
}

function validarFeature(valor: unknown): Feature {
  const item = objeto(valor, "feature");
  return {
    azure_id: numero(item.azure_id, "feature.azure_id"),
    titulo: texto(item.titulo, "feature.titulo"),
    estado: texto(item.estado, "feature.estado"),
    descripcion: texto(item.descripcion, "feature.descripcion"),
    url: texto(item.url ?? "", "feature.url"),
    ...comunesWorkItem(item, "feature"),
    hus: lista(item.hus, "feature.hus", validarHistoria),
  };
}

function validarEpic(valor: unknown): Epic {
  const item = objeto(valor, "épica");
  return {
    azure_id: numero(item.azure_id, "epica.azure_id"),
    titulo: texto(item.titulo, "epica.titulo"),
    estado: texto(item.estado, "epica.estado"),
    descripcion: texto(item.descripcion, "epica.descripcion"),
    url: texto(item.url, "epica.url"),
    features: lista(item.features, "epica.features", validarFeature),
    hus: lista(item.hus, "epica.hus", validarHistoria),
  };
}

function validarResumen(valor: unknown): EpicResumen {
  const item = objeto(valor, "épica resumida");
  return {
    azure_id: numero(item.azure_id, "epica.azure_id"),
    titulo: texto(item.titulo, "epica.titulo"),
    estado: texto(item.estado, "epica.estado"),
    url: texto(item.url ?? "", "epica.url"),
    ...comunesWorkItem(item, "epica"),
  };
}

function validarEstadoAzure(valor: unknown): EstadoAzure {
  const item = objeto(valor, "estado de Azure");
  return {
    configurada: booleano(item.configurada, "azure.configurada"),
    organizacion: texto(item.organizacion ?? "", "azure.organizacion"),
    proyecto: texto(item.proyecto ?? "", "azure.proyecto"),
    area_path: texto(item.area_path ?? "", "azure.area_path"),
    verificado: booleano(item.verificado, "azure.verificado"),
    error: texto(item.error ?? "", "azure.error"),
  };
}

function validarMetricas(valor: unknown): MetricasBug {
  const item = objeto(valor, "métricas de bugs");
  return {
    total: numero(item.total, "metricas.total"),
    abiertos: numero(item.abiertos, "metricas.abiertos"),
    cerrados: numero(item.cerrados, "metricas.cerrados"),
    por_estado: mapaNumeros(item.por_estado, "metricas.por_estado"),
    por_prioridad: mapaNumeros(item.por_prioridad, "metricas.por_prioridad"),
    por_severidad: mapaNumeros(item.por_severidad, "metricas.por_severidad"),
    por_relacion: mapaNumeros(item.por_relacion, "metricas.por_relacion"),
  };
}

function validarDetalleBugs(valor: unknown): DetalleBugs {
  const item = objeto(valor, "detalle de bugs");
  return {
    bugs: lista(item.bugs, "detalle.bugs", validarBug),
    metricas: validarMetricas(item.metricas),
  };
}

function validarSprint(valor: unknown): Sprint {
  const item = objeto(valor, "sprint");
  return {
    nombre: texto(item.nombre, "sprint.nombre"),
    ruta: texto(item.ruta ?? "", "sprint.ruta"),
    total: numero(item.total, "sprint.total"),
    abiertos: numero(item.abiertos, "sprint.abiertos"),
    cerrados: numero(item.cerrados, "sprint.cerrados"),
    personas: numero(item.personas, "sprint.personas"),
    ultimo_cambio: texto(item.ultimo_cambio ?? "", "sprint.ultimo_cambio"),
  };
}

function validarListaSprints(valor: unknown): ListaSprints {
  const item = objeto(valor, "lista de sprints");
  return {
    sprints: lista(item.sprints, "sprints", validarSprint),
    total: numero(item.total, "sprints.total"),
    sprint_actual: texto(item.sprint_actual ?? "", "sprints.sprint_actual"),
    total_items: numero(item.total_items ?? 0, "sprints.total_items"),
    asignados_a_sprint: numero(
      item.asignados_a_sprint ?? 0,
      "sprints.asignados_a_sprint",
    ),
  };
}

function validarPersonaCarga(valor: unknown): PersonaCarga {
  const item = objeto(valor, "persona");
  return {
    guid: texto(item.guid, "persona.guid"),
    nombre: texto(item.nombre, "persona.nombre"),
    total: numero(item.total, "persona.total"),
    abiertos: numero(item.abiertos, "persona.abiertos"),
    bugs: numero(item.bugs, "persona.bugs"),
    bugs_abiertos: numero(item.bugs_abiertos, "persona.bugs_abiertos"),
    verificados: numero(item.verificados, "persona.verificados"),
  };
}

function validarListaPersonas(valor: unknown): ListaPersonas {
  const item = objeto(valor, "lista de personas");
  return {
    personas: lista(item.personas, "personas", validarPersonaCarga),
    total: numero(item.total, "personas.total"),
  };
}

function validarItemIndice(valor: unknown): ItemIndice {
  const item = objeto(valor, "item del índice");
  const cerrado = item.cerrado === undefined ? false : booleano(item.cerrado, "item.cerrado");
  return {
    azure_id: numero(item.azure_id, "item.azure_id"),
    tipo: texto(item.tipo ?? "", "item.tipo"),
    titulo: texto(item.titulo ?? "", "item.titulo"),
    estado: texto(item.estado ?? "", "item.estado"),
    tags: texto(item.tags ?? "", "item.tags"),
    sprint: texto(item.sprint ?? "", "item.sprint"),
    persona: personaOpcional(item.persona, "item.persona"),
    creado: item.creado === undefined || item.creado === null ? null : texto(item.creado, "item.creado"),
    modificado:
      item.modificado === undefined || item.modificado === null
        ? null
        : texto(item.modificado, "item.modificado"),
    cerrado,
  };
}

function validarListaItems(valor: unknown): ListaItems {
  const item = objeto(valor, "lista de items");
  return {
    items: lista(item.items, "items", validarItemIndice),
    total: numero(item.total, "items.total"),
    offset: item.offset === undefined ? 0 : numero(item.offset, "items.offset"),
    limite: item.limite === undefined ? 200 : numero(item.limite, "items.limite"),
    hay_mas: item.hay_mas === undefined ? false : booleano(item.hay_mas, "items.hay_mas"),
    sprint_actual: texto(item.sprint_actual ?? "", "items.sprint_actual"),
  };
}

function validarMuestraItem(valor: unknown): MuestraItem {
  const item = objeto(valor, "muestra");
  return {
    azure_id: numero(item.azure_id, "muestra.azure_id"),
    tipo: texto(item.tipo ?? "", "muestra.tipo"),
    titulo: texto(item.titulo ?? "", "muestra.titulo"),
    estado: texto(item.estado ?? "", "muestra.estado"),
    sprint: texto(item.sprint ?? "", "muestra.sprint"),
    persona: texto(item.persona ?? "", "muestra.persona"),
    modificado: texto(item.modificado ?? "", "muestra.modificado"),
  };
}

function validarBrechaVerificacion(valor: unknown): BrechaVerificacion {
  const item = objeto(valor, "brecha de verificación");
  const resumen = objeto(item.resumen, "brecha.resumen");
  return {
    resumen: {
      bugs: numero(resumen.bugs, "brecha.bugs"),
      bugs_cerrados_sin_verificar: numero(
        resumen.bugs_cerrados_sin_verificar,
        "brecha.bugs_cerrados_sin_verificar",
      ),
      bugs_verificados_sin_cerrar: numero(
        resumen.bugs_verificados_sin_cerrar,
        "brecha.bugs_verificados_sin_cerrar",
      ),
      historias: numero(resumen.historias, "brecha.historias"),
      historias_sin_evidencia: numero(
        resumen.historias_sin_evidencia,
        "brecha.historias_sin_evidencia",
      ),
      verificados: numero(resumen.verificados, "brecha.verificados"),
      generado: texto(resumen.generado ?? "", "brecha.generado"),
    },
    cerrados_sin_verificar: lista(
      item.cerrados_sin_verificar,
      "brecha.cerrados_sin_verificar",
      validarMuestraItem,
    ),
    verificados_sin_cerrar: lista(
      item.verificados_sin_cerrar,
      "brecha.verificados_sin_cerrar",
      validarMuestraItem,
    ),
    historias_sin_evidencia: lista(
      item.historias_sin_evidencia,
      "brecha.historias_sin_evidencia",
      validarMuestraItem,
    ),
  };
}

function validarTrabajoEstancado(valor: unknown): TrabajoEstancado {
  const item = objeto(valor, "trabajo estancado");
  const resumen = objeto(item.resumen, "aging.resumen");
  return {
    resumen: {
      inactivos: numero(resumen.inactivos, "aging.inactivos"),
      en_curso: numero(resumen.en_curso, "aging.en_curso"),
      dias_inactivo: numero(resumen.dias_inactivo, "aging.dias_inactivo"),
      dias_en_curso: numero(resumen.dias_en_curso, "aging.dias_en_curso"),
      generado: texto(resumen.generado ?? "", "aging.generado"),
    },
    inactivos: lista(item.inactivos, "aging.inactivos", validarMuestraItem),
    en_curso: lista(item.en_curso, "aging.en_curso", validarMuestraItem),
  };
}

function validarRezagoEntreSprints(valor: unknown): RezagoEntreSprints {
  const item = objeto(valor, "rezago entre sprints");
  const resumen = objeto(item.resumen, "rezago.resumen");
  return {
    resumen: {
      sprints: numero(resumen.sprints, "rezago.sprints"),
      sprint_referencia: texto(resumen.sprint_referencia ?? "", "rezago.sprint_referencia"),
      sprints_con_rezago: numero(resumen.sprints_con_rezago, "rezago.sprints_con_rezago"),
      rezagados: numero(resumen.rezagados, "rezago.rezagados"),
      generado: texto(resumen.generado ?? "", "rezago.generado"),
    },
    sprints: lista(item.sprints, "rezago.sprints", (v) => {
      const fila = objeto(v, "rezago.sprint");
      return {
        sprint: texto(fila.sprint, "rezago.sprint.nombre"),
        abiertos: numero(fila.abiertos, "rezago.sprint.abiertos"),
        items: lista(fila.items ?? [], "rezago.sprint.items", validarMuestraItem),
      };
    }),
  };
}

function validarResultadoEscritura(valor: unknown): ResultadoEscritura {
  const item = objeto(valor, "resultado de escritura");
  return {
    work_item_id: numero(item.work_item_id, "escritura.work_item_id"),
    rev: numero(item.rev, "escritura.rev"),
    campos: lista(item.campos, "escritura.campos", (v) => texto(v, "escritura.campo")),
    validado: booleano(item.validado, "escritura.validado"),
    detalle: texto(item.detalle ?? "", "escritura.detalle"),
  };
}

/** Valida la actualización: solo se admiten los campos de la lista blanca. */
function validarActualizacion(valor: unknown): ActualizacionQA {
  const item = objeto(valor, "actualización de QA");
  const salida: ActualizacionQA = {};
  for (const campo of ["estado", "prioridad", "severidad", "tags", "notas_qa"] as const) {
    if (item[campo] === undefined || item[campo] === null) continue;
    salida[campo] = texto(item[campo], `actualizacion.${campo}`);
  }
  if (Object.keys(salida).length === 0) {
    throw new ApiError("Respuesta inválida: la actualización no incluye campos");
  }
  return salida;
}

function validarAccion(valor: unknown): RespuestaAccion {
  const item = objeto(valor, "respuesta de acción");
  const detalle = opcionalTexto(item.detalle, "accion.detalle");
  return {
    ok: booleano(item.ok, "accion.ok"),
    ...(detalle !== undefined ? { detalle } : {}),
  };
}

async function peticion<T>(ruta: string, opciones: RequestInit = {}): Promise<T> {
  const respuesta = await fetch(`${BASE}${ruta}`, {
    headers: { "Content-Type": "application/json" },
    ...opciones,
  });

  if (!respuesta.ok) {
    let detalle = `Error HTTP ${respuesta.status}`;
    try {
      const cuerpo = (await respuesta.json()) as { detail?: unknown };
      if (typeof cuerpo.detail === "string" && cuerpo.detail) {
        detalle = cuerpo.detail;
      }
    } catch {
      // cuerpo no JSON: se conserva el mensaje por defecto
    }
    throw new ApiError(detalle, respuesta.status);
  }
  try {
    return (await respuesta.json()) as T;
  } catch {
    throw new ApiError("La respuesta del backend no es JSON válido", respuesta.status);
  }
}

export const api = {
  estadoAzure: async (signal?: AbortSignal) =>
    validarEstadoAzure(await peticion<unknown>("/azure/estado", { signal })),
  epicas: async (incluirCerradas = false, signal?: AbortSignal) => {
    const respuesta = objeto(
      await peticion<unknown>(`/epics?incluir_cerradas=${incluirCerradas}`, { signal }),
      "lista de épicas",
    );
    return {
      epicas: lista(respuesta.epicas, "lista.epicas", validarResumen),
    } satisfies ListaEpicas;
  },
  arbolEpica: async (azureId: number, incluirBugs = false, signal?: AbortSignal) =>
    validarEpic(
      await peticion<unknown>(`/epics/${azureId}/arbol?incluir_bugs=${incluirBugs}`, {
        signal,
      }),
    ),
  bugsEpica: async (azureId: number, incluirCerradas = false, signal?: AbortSignal) =>
    validarDetalleBugs(
      await peticion<unknown>(
        `/epics/${azureId}/bugs?incluir_cerradas=${incluirCerradas}`,
        { signal },
      ),
    ),
  refrescar: async () =>
    validarAccion(await peticion<unknown>("/epics/refresh", { method: "POST" })),

  /** Catálogo de sprints con conteos y cuál se considera actual. */
  sprints: async (signal?: AbortSignal) =>
    validarListaSprints(await peticion<unknown>("/sprints", { signal })),

  /** Personas con su carga actual, ordenadas por volumen. */
  personas: async (signal?: AbortSignal) =>
    validarListaPersonas(await peticion<unknown>("/personas", { signal })),

  /** Ítems del índice local, filtrados y paginados (no llama a Azure). */
  items: async (
    filtros: {
      sprint?: string;
      persona?: string;
      tipo?: string;
      etiqueta?: string;
      soloAbiertos?: boolean;
      offset?: number;
      limite?: number;
    } = {},
    signal?: AbortSignal,
  ) => {
    const query = new URLSearchParams();
    if (filtros.sprint) query.set("sprint", filtros.sprint);
    if (filtros.persona) query.set("persona", filtros.persona);
    if (filtros.tipo) query.set("tipo", filtros.tipo);
    if (filtros.etiqueta) query.set("etiqueta", filtros.etiqueta);
    if (filtros.soloAbiertos) query.set("solo_abiertos", "true");
    if (filtros.offset) query.set("offset", String(filtros.offset));
    if (filtros.limite) query.set("limite", String(filtros.limite));
    const sufijo = query.toString() ? `?${query.toString()}` : "";
    return validarListaItems(await peticion<unknown>(`/items${sufijo}`, { signal }));
  },

  /** Señal ①: brechas de verificación QA. */
  brechaVerificacion: async (signal?: AbortSignal) =>
    validarBrechaVerificacion(
      await peticion<unknown>("/analitica/verificacion", { signal }),
    ),

  /** Señal ②: trabajo estancado. */
  trabajoEstancado: async (signal?: AbortSignal) =>
    validarTrabajoEstancado(await peticion<unknown>("/analitica/aging", { signal })),

  /** Señal ③: rezago entre sprints. */
  rezagoSprints: async (signal?: AbortSignal) =>
    validarRezagoEntreSprints(await peticion<unknown>("/analitica/rezago", { signal })),

  /**
   * Aplica (o valida en seco) una actualización de QA sobre un work item.
   *
   * `validar=true` no escribe nada: Azure comprueba las reglas del proyecto y
   * responde si el cambio sería válido. `revEsperada` evita sobrescribir la
   * edición de otro QA si el work item cambió desde que se abrió el formulario.
   */
  actualizarWorkItem: async (
    workItemId: number,
    cambios: ActualizacionQA,
    opciones: { validar?: boolean; revEsperada?: number } = {},
  ) => {
    const validar = opciones.validar ?? false;
    const query = new URLSearchParams({ validar: String(validar) });
    if (opciones.revEsperada !== undefined) {
      query.set("rev_esperada", String(opciones.revEsperada));
    }
    return validarResultadoEscritura(
      await peticion<unknown>(`/workitems/${workItemId}?${query.toString()}`, {
        method: "PATCH",
        body: JSON.stringify(validarActualizacion(cambios)),
      }),
    );
  },
};
