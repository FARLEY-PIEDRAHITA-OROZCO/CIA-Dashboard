/** Pruebas de la cinta de cobertura: geometría y contrato presentacional.
 *
 * El reparto de la barra se comprueba sobre los estilos en línea, no sobre el
 * píxel: jsdom no aplica la hoja de estilos. La invariante que importa es que
 * **las dos partes se tiles sin solaparse ni dejar hueco**, y eso se puede
 * afirmar sin renderizar de verdad.
 */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CintaCobertura } from "./CintaCobertura";
import { construirColumnas, describirColumna } from "./cobertura";
import type { CoberturaDeSprint } from "../api/tipos";

// Sin `cleanup` el DOM de cada prueba se acumula y las búsquedas encuentran la
// columna de la prueba anterior.
afterEach(() => {
  cleanup();
});

function columna(datos: CoberturaDeSprint) {
  return construirColumnas([datos]).columnas[0];
}

function pintar(datos: CoberturaDeSprint, extra: { rutaActual?: string; onElegir?: (r: string) => void } = {}) {
  const c = columna(datos);
  render(
    <CintaCobertura
      columnas={[c]}
      rutaActual={extra.rutaActual}
      onElegir={extra.onElegir ?? (() => {})}
    />,
  );
  return c;
}

/** La barra se localiza por su nombre accesible, que es el `title`. */
function barra() {
  return screen.getByRole("button", { name: /historias sin caso/ });
}

const SPRINT: CoberturaDeSprint = {
  nombre: "Sprint 45",
  ruta: "Proyecto\\Sprint 45",
  historias: 39,
  cubiertas: 5,
  sin_cubrir: 34,
  pct_cubiertas: 12.8,
};

describe("CintaCobertura", () => {
  it("las dos partes se reparten la barra sin solaparse", () => {
    pintar(SPRINT);

    const cubierta = barra().querySelector<HTMLElement>(".cinta-cubierta");
    const hueco = barra().querySelector<HTMLElement>(".cinta-hueco");
    expect(cubierta).not.toBeNull();
    expect(hueco).not.toBeNull();

    const altoCubierta = Number.parseFloat(cubierta!.style.height);
    const bordeHueco = Number.parseFloat(hueco!.style.bottom);
    // El hueco arranca exactamente donde acaba la parte cubierta. Si el borde
    // inferior del hueco no coincide con la altura de la cubierta, o sobra una
    // franja o queda un hueco: las dos partes tienen que sumar la barra entera.
    expect(bordeHueco).toBe(altoCubierta);
    expect(altoCubierta).toBeCloseTo((5 / 39) * 100, 5);
  });

  it("un sprint sin historias no pinta ninguna parte", () => {
    pintar({ ...SPRINT, historias: 0, cubiertas: 0, sin_cubrir: 0, pct_cubiertas: 0 });
    const cubierta = barra().querySelector<HTMLElement>(".cinta-cubierta");
    expect(Number.parseFloat(cubierta!.style.height)).toBe(0);
  });

  it("la etiqueta accesible dice las dos mitades, y hay copia oculta", () => {
    const c = columna(SPRINT);
    expect(describirColumna(c)).toBe(
      "Sprint 45, 5 historias con caso, 34 historias sin caso",
    );
    pintar(SPRINT);
    // El `title` no lo lee un lector de pantalla: por eso la columna lleva además
    // un texto oculto con la misma descripción.
    const lista = screen.getByRole("list", { name: /Cobertura de pruebas por sprint/ });
    expect(within(lista).getByText(describirColumna(c))).toBeTruthy();
  });

  it("la columna elegida queda marcada y no se puede volver a pulsar", () => {
    pintar(SPRINT, { rutaActual: SPRINT.ruta });
    expect(barra()).toHaveAttribute("data-activo", "true");
    expect(barra()).toBeDisabled();
  });

  it("avisa al elegir una columna y lleva su ruta completa", () => {
    const elegidas: string[] = [];
    pintar(SPRINT, { onElegir: (ruta) => elegidas.push(ruta) });
    fireEvent.click(barra());
    // La ruta completa, no el nombre corto: es lo que acepta el filtro.
    expect(elegidas).toEqual(["Proyecto\\Sprint 45"]);
  });
});
