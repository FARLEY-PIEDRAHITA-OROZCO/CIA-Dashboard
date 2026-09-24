import { useEffect, useReducer } from "react";

/** Rutas del frontend (navegación por hash, sin dependencias):
 * - `#/dashboard`           → lista de épicas (KPIs + tabla)
 * - `#/epicas/{id}`         → página dedicada a las historias de la épica
 */
export type Destino =
  | { pagina: "dashboard" }
  | { pagina: "epica"; azureId: number }
  | { pagina: "epicaTareas"; azureId: number };

export function parsearHash(hash: string): Destino {
  const partes = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (partes[0]?.toLowerCase() === "epicas" && partes[1]) {
    const idTexto = partes[1];
    if (!/^\d+$/.test(idTexto)) {
      return { pagina: "dashboard" };
    }
    const azureId = Number(idTexto);
    if (!Number.isSafeInteger(azureId) || azureId <= 0) {
      return { pagina: "dashboard" };
    }
    if (partes.length === 3 && partes[2].toLowerCase() === "tareas") {
      return { pagina: "epicaTareas", azureId };
    }
    if (partes.length === 2) {
      return { pagina: "epica", azureId };
    }
  }
  return { pagina: "dashboard" };
}

function aRuta(destino: Destino): string {
  switch (destino.pagina) {
    case "epica":
      return `#/epicas/${destino.azureId}`;
    case "epicaTareas":
      return `#/epicas/${destino.azureId}/tareas`;
    default:
      return "#/dashboard";
  }
}

/** Navega programáticamente (asigna el hash → dispara `hashchange`). */
export function irA(destino: Destino): void {
  const ruta = aRuta(destino);
  if (window.location.hash !== ruta) {
    window.location.hash = ruta;
  }
}

/** Ruta como `href` para enlaces normales (funcionan con el botón atrás). */
export function enlaceA(destino: Destino): string {
  return aRuta(destino);
}

/** Observa el hash actual de forma reactiva. */
export function useVista(): Destino {
  const [, forzarRender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    window.addEventListener("hashchange", forzarRender);
    return () => window.removeEventListener("hashchange", forzarRender);
  }, []);
  return parsearHash(window.location.hash);
}