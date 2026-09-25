/** Cliente HTTP tipado hacia el backend (única costura de red del frontend). */

import type {
  ActualizacionQA,
  Bug,
  DetalleBugs,
  Epic,
  EpicResumen,
  EstadoAzure,
  Feature,
  ListaEpicas,
  MetricasBug,
  RespuestaAccion,
  ResultadoEscritura,
  Tarea,
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
    prioridad: texto(item.prioridad ?? "", "bug.prioridad"),
    severidad: texto(item.severidad ?? "", "bug.severidad"),
    asignado_a: texto(item.asignado_a ?? "", "bug.asignado_a"),
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
