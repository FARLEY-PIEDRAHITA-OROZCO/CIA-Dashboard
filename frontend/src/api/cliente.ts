/** Cliente HTTP tipado hacia el backend (única costura de red del frontend). */

import type {
  Epic,
  EpicResumen,
  EstadoAzure,
  Feature,
  ListaEpicas,
  RespuestaAccion,
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

function validarTarea(valor: unknown): Tarea {
  const item = objeto(valor, "tarea");
  return {
    azure_id: numero(item.azure_id, "tarea.azure_id"),
    titulo: texto(item.titulo, "tarea.titulo"),
    estado: texto(item.estado, "tarea.estado"),
    descripcion: texto(item.descripcion, "tarea.descripcion"),
    ...urlOpcional(item.url, "tarea.url"),
  };
}

function validarHistoria(valor: unknown): UserStory {
  const item = objeto(valor, "historia");
  return {
    azure_id: numero(item.azure_id, "historia.azure_id"),
    titulo: texto(item.titulo, "historia.titulo"),
    estado: texto(item.estado, "historia.estado"),
    descripcion: texto(item.descripcion, "historia.descripcion"),
    ...urlOpcional(item.url, "historia.url"),
    tareas: lista(item.tareas ?? [], "historia.tareas", validarTarea),
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
  arbolEpica: async (azureId: number, signal?: AbortSignal) =>
    validarEpic(await peticion<unknown>(`/epics/${azureId}/arbol`, { signal })),
  refrescar: async () =>
    validarAccion(await peticion<unknown>("/epics/refresh", { method: "POST" })),
};
