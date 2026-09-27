import { render, screen } from "@testing-library/react";

import { describe, expect, it } from "vitest";

import {
  columnasDesdeOrden,
  EstadoTrabajo,
  ORDEN_TONOS,
  tonoEstado,
  type TonoEstado,
} from "./EstadoTrabajo";
import { ORDEN_COLUMNA, TITULOS_COLUMNA } from "../epicas/TableroTareas";

describe("tonoEstado", () => {
  it("mapea estados conocidos de Azure normalizando el texto", () => {
    expect(tonoEstado("In Progress")).toBe("progreso");
    expect(tonoEstado("  iN pRoGrEsS ")).toBe("progreso");
    expect(tonoEstado("Done")).toBe("terminado");
    expect(tonoEstado("New")).toBe("nuevo");
    expect(tonoEstado("Removed")).toBe("removido");
    expect(tonoEstado("Committed")).toBe("pendiente");
  });

  it("degenera a neutro para estados desconocidos", () => {
    expect(tonoEstado("Custom State XYZ")).toBe("neutro");
    expect(tonoEstado("")).toBe("neutro");
  });

  it("distingue bloqueado de pendiente y de en curso", () => {
    // Los tres caían en el mismo tono: un ítem atascado pasaba por trabajo
    // normal. Ahora «bloqueado» es rojo y propio.
    expect(tonoEstado("Bloqueado")).toBe("bloqueado");
    expect(tonoEstado("Blocked")).toBe("bloqueado");
    expect(tonoEstado("On Hold")).toBe("bloqueado");
    expect(tonoEstado("Pendiente")).toBe("pendiente");
    expect(tonoEstado("Doing")).toBe("progreso");
  });

  it("distingue en pruebas de en curso y de terminada", () => {
    // En una herramienta de QA, «en pruebas» es una cola con dueño, no
    // «siguiendo». 17 ítems del proyecto real están en este estado.
    expect(tonoEstado("Testing")).toBe("verificacion");
    expect(tonoEstado("In Testing")).toBe("verificacion");
    expect(tonoEstado("En pruebas")).toBe("verificacion");
    expect(tonoEstado("Doing")).toBe("progreso");
    expect(tonoEstado("Closed")).toBe("terminado");
  });

  it("el orden de las comprobaciones no confunde bloqueado con backlog", () => {
    // `BLOQUEADO` se comprueba antes que `NUEVO` y `PROGRESO` a propósito: un
    // estado puede aparecer en varias listas y el orden decide.
    expect(tonoEstado("Bloqueado")).not.toBe("nuevo");
    expect(tonoEstado("On Hold")).not.toBe("pendiente");
  });
});

describe("orden de columnas", () => {
  it("el recorrido va de lo que no empezó a lo que está fuera de flujo", () => {
    expect(ORDEN_TONOS).toEqual([
      "nuevo",
      "pendiente",
      "progreso",
      "verificacion",
      "terminado",
      "bloqueado",
      "removido",
      "neutro",
    ]);
  });

  it("coloca bloqueado junto a lo que requiere atención, no en medio del flujo", () => {
    const iTerminado = ORDEN_TONOS.indexOf("terminado");
    const iBloqueado = ORDEN_TONOS.indexOf("bloqueado");
    const iRemovido = ORDEN_TONOS.indexOf("removido");
    expect(iBloqueado).toBeGreaterThan(iTerminado);
    expect(iBloqueado).toBeLessThan(iRemovido);
  });

  it("construye las columnas en el orden canónico y con todos los títulos", () => {
    const columnas = columnasDesdeOrden(TITULOS_COLUMNA);
    expect(columnas.map((c) => c.tono)).toEqual([...ORDEN_TONOS]);
    expect(columnas.map((c) => c.titulo)).toEqual(ORDEN_TONOS.map((t) => TITULOS_COLUMNA[t]));
  });

  it("el tablero de tareas usa el mismo orden", () => {
    // Si divergieran, un tono aparecería en un tablero y en otro no.
    expect(ORDEN_COLUMNA).toEqual([...ORDEN_TONOS]);
  });

  it("cubrir un tono nuevo obliga a tocar un solo sitio", () => {
    // `Record<TonoEstado, string>` obliga en tiempo de compilación a que
    // existan todos los títulos: añadir un tono sin título es un error de
    // build, no una columna sin rótulo.
    const titulos = Object.keys(TITULOS_COLUMNA).sort();
    const tonos = [...ORDEN_TONOS].sort();
    expect(titulos).toEqual(tonos);
  });
});

describe("EstadoTrabajo", () => {
  it("dibuja la etiqueta con la clase de tono correcta", () => {
    render(<EstadoTrabajo estado="In Progress" />);
    const badge = screen.getByText("In Progress");
    expect(badge).toHaveClass("estado-progreso");
  });

  it("dibuja bloqueado y en pruebas con sus propias clases", () => {
    const { unmount } = render(<EstadoTrabajo estado="Bloqueado" />);
    expect(screen.getByText("Bloqueado")).toHaveClass("estado-bloqueado");
    unmount();

    render(<EstadoTrabajo estado="Testing" />);
    expect(screen.getByText("Testing")).toHaveClass("estado-verificacion");
  });

  it("tolera estados vacíos", () => {
    render(<EstadoTrabajo estado="  " />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("cada tono tiene una clase de badge propia", () => {
    // Un tono sin regla CSS se dibujaría sin color, que es como un bug pasa
    // desapercibido hasta que alguien mira la pantalla.
    for (const tono of ORDEN_TONOS as readonly TonoEstado[]) {
      const { unmount } = render(<EstadoTrabajo estado={etiquetaDe(tono)} />);
      expect(screen.getByText(etiquetaDe(tono)).className).toContain(`estado-${tono}`);
      unmount();
    }
  });
});

/** Un estado de ejemplo por tono, para probar la clase del badge. */
function etiquetaDe(tono: TonoEstado): string {
  return {
    nuevo: "New",
    pendiente: "To do",
    progreso: "Doing",
    verificacion: "Testing",
    terminado: "Closed",
    bloqueado: "Blocked",
    removido: "Removed",
    neutro: "Algo raro",
  }[tono];
}
