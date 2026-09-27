/** Pruebas de la lógica presentacional de la actividad.
 *
 * Sin React a propósito: son funciones puras y probarlas montando el panel
 * costaría un `QueryClientProvider` para no ganar nada.
 */

import { describe, expect, it } from "vitest";

import type { ActividadEpica } from "../api/tipos";
import {
  PERSONAS_VISIBLES,
  avisoParcial,
  rangoFechas,
  repartoPorTipo,
} from "./actividad";

const BASE: ActividadEpica = {
  epica: 1,
  titulo: "É",
  items_analizados: 10,
  items_totales: 10,
  parcial: false,
  items_sin_actividad: 0,
  revisiones: 100,
  personas: 3,
  primera: "2024-10-21T20:01:41Z",
  ultima: "2026-08-05T19:59:29Z",
  por_persona: [],
  por_tipo: {},
  nota: "n",
};

describe("rangoFechas", () => {
  it("muestra el rango completo", () => {
    expect(rangoFechas("2024-10-21T20:01:41Z", "2026-08-05T19:59:29Z")).toBe(
      "21 oct 2024 → 5 ago 2026",
    );
  });

  it("sin ninguna fecha lo dice con palabras", () => {
    // Una raya entre dos celdas vacías parece un dato, no una ausencia.
    expect(rangoFechas("", "")).toBe("sin fechas registradas");
  });

  it("con una sola fecha no inventa la otra", () => {
    expect(rangoFechas("", "2026-08-05T19:59:29Z")).toBe("solo consta 5 ago 2026");
    expect(rangoFechas("2024-10-21T20:01:41Z", "")).toBe("solo consta 21 oct 2024");
  });

  it("una fecha ilegible no rompe el panel", () => {
    expect(rangoFechas("no-es-fecha", "2026-08-05T00:00:00Z")).toBe(
      "fecha ilegible → 5 ago 2026",
    );
  });

  it("el centinela 9999 de Azure se vería como fecha, no como error", () => {
    // Por eso el backend lo filtra: aquí solo se vería raro, y en una columna de
    // «último cambio» parecería el dato más reciente del mundo.
    expect(rangoFechas("2024-01-01T00:00:00Z", "9999-01-01T00:00:00Z")).toContain("9999");
  });
});

describe("avisoParcial", () => {
  it("no dice nada cuando la lectura fue completa", () => {
    expect(avisoParcial(BASE)).toBeNull();
  });

  it("nombra cuántos ítems faltan, no solo que faltan", () => {
    const aviso = avisoParcial({
      ...BASE,
      parcial: true,
      items_analizados: 6,
      items_totales: 7,
    });
    expect(aviso).toContain("1 de 7");
  });

  it("dice que es una cota INFERIOR, no superior", () => {
    // Es lo contrario que la cobertura de pruebas, donde un fallo sobrestima la
    // brecha. Confundir los dos sentidos haría leer el número al revés.
    const aviso = avisoParcial({ ...BASE, parcial: true, items_analizados: 6 });
    expect(aviso).toContain("cota inferior");
  });

  it("si no puede restar, lo dice sin inventar una cantidad", () => {
    const aviso = avisoParcial({
      ...BASE,
      parcial: true,
      items_analizados: 7,
      items_totales: 7,
    });
    expect(aviso).not.toContain("0 de 7");
    expect(aviso).toContain("cota inferior");
  });
});

describe("repartoPorTipo", () => {
  it("ordena por volumen y calcula el porcentaje", () => {
    const filas = repartoPorTipo({ Task: 191, "User Story": 35, Epic: 1, Feature: 5 });
    expect(filas.map((f) => f.tipo)).toEqual(["Task", "User Story", "Feature", "Epic"]);
    expect(filas[0].tanto).toBeCloseTo(191 / 232, 3);
  });

  it("un mapa vacío no divide por cero", () => {
    // NaN en un `width` es un ancho inválido: la barra desaparece sin error.
    expect(repartoPorTipo({})).toEqual([]);
  });

  it("empate por volumen se desempata por nombre, para que sea estable", () => {
    const filas = repartoPorTipo({ Bug: 2, Task: 2 });
    expect(filas.map((f) => f.tipo)).toEqual(["Bug", "Task"]);
  });
});

describe("limite de personas mostradas", () => {
  it("es un tope razonable y positivo", () => {
    // 12 en el proyecto real: mostrar 35 filas convertiría el panel en una tabla
    // más, que es justo lo que el panel no es.
    expect(PERSONAS_VISIBLES).toBeGreaterThan(0);
    expect(PERSONAS_VISIBLES).toBeLessThanOrEqual(12);
  });
});
