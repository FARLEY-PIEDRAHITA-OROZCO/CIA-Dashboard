import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EpicResumen } from "../api/tipos";
import { coincideEpica, filtrarEpicas, normalizar, resaltar } from "./busquedaEpicas";

const EPICAS: EpicResumen[] = [
  { azure_id: 5586, titulo: "Canal digital", estado: "In Progress", url: "" },
  { azure_id: 22408, titulo: "Inteligencia Artificial", estado: "Active", url: "" },
  { azure_id: 100, titulo: "Migración de información", estado: "Closed", url: "" },
];

describe("normalizar", () => {
  it("quita mayúsculas, acentos y espacios sobrantes", () => {
    expect(normalizar("  Intelegencia   ARTIFICIAL ")).toBe("intelegencia artificial");
  });

  it("tolera texto vacío o ausente", () => {
    expect(normalizar("")).toBe("");
    expect(normalizar(undefined as unknown as string)).toBe("");
  });
});

describe("coincideEpica", () => {
  it("encuentra por título ignorando mayúsculas y acentos", () => {
    expect(coincideEpica(EPICAS[0], "canal")).toBe(true);
    expect(coincideEpica(EPICAS[0], "CANAL")).toBe(true);
    expect(coincideEpica(EPICAS[1], "inteligencia")).toBe(true);
    expect(coincideEpica(EPICAS[1], "INTELIGENCIA")).toBe(true);
  });

  it("encuentra por acentos escritos sin tilde", () => {
    expect(coincideEpica(EPICAS[2], "migracion")).toBe(true);
    expect(coincideEpica(EPICAS[2], "informacion")).toBe(true);
  });

  it("encuentra por ID de Azure", () => {
    expect(coincideEpica(EPICAS[0], "5586")).toBe(true);
    expect(coincideEpica(EPICAS[1], "22408")).toBe(true);
  });

  it("encuentra por estado", () => {
    expect(coincideEpica(EPICAS[2], "closed")).toBe(true);
  });

  it("exige que TODOS los términos aparezcan", () => {
    expect(coincideEpica(EPICAS[1], "inteligencia artificial")).toBe(true);
    expect(coincideEpica(EPICAS[1], "inteligencia canal")).toBe(false);
  });

  it("devuelve true con la consulta vacía", () => {
    expect(coincideEpica(EPICAS[0], "")).toBe(true);
    expect(coincideEpica(EPICAS[0], "   ")).toBe(true);
  });
});

describe("filtrarEpicas", () => {
  it("devuelve la lista completa sin consulta", () => {
    expect(filtrarEpicas(EPICAS, "")).toEqual(EPICAS);
    expect(filtrarEpicas(EPICAS, "  ")).toEqual(EPICAS);
  });

  it("filtra conservando el orden original", () => {
    const resultado = filtrarEpicas(EPICAS, "a");
    expect(resultado.map((e) => e.azure_id)).toEqual([5586, 22408, 100]);
  });

  it("devuelve lista vacía sin coincidencias", () => {
    expect(filtrarEpicas(EPICAS, "proyecto inexistente")).toEqual([]);
  });

  it("no muta la lista original", () => {
    const copia = [...EPICAS];
    filtrarEpicas(EPICAS, "canal");
    expect(EPICAS).toEqual(copia);
  });
});

describe("resaltar", () => {
  it("devuelve el texto sin cambios con la consulta vacía", () => {
    expect(resaltar("Canal digital", "", 1)).toBe("Canal digital");
  });

  it("envuelve la coincidencia en <mark>", () => {
    render(<span>{resaltar("Canal digital", "digital", 1)}</span>);
    const marca = screen.getByText("digital");
    expect(marca.tagName).toBe("MARK");
  });

  it("no falla con metacaracteres de expresiones regulares", () => {
    expect(() => resaltar("Precio (50%)", "(50%)", 1)).not.toThrow();
    render(<span>{resaltar("Precio (50%)", "(50%)", 1)}</span>);
    expect(screen.getByText("(50%)").tagName).toBe("MARK");
  });

  it("respeta el caso del texto original", () => {
    render(<span>{resaltar("Inteligencia Artificial", "inteligencia", 1)}</span>);
    expect(screen.getByText("Inteligencia").tagName).toBe("MARK");
  });

  /**
   * React avisa por consola cuando dos hermanos comparten clave. Comprobar el
   * contenido dibujado no lo detecta: el resaltado se veía correcto y las claves
   * seguían repetidas, así que la suite entera quedó verde con el bug dentro.
   */
  describe("claves únicas", () => {
    /** Captura los avisos de React sin dejar que ensucien la salida. */
    function espiarConsola() {
      const errores: unknown[][] = [];
      const espia = vi
        .spyOn(console, "error")
        .mockImplementation((...argumentos: unknown[]) => {
          errores.push(argumentos);
        });
      return {
        errores,
        avisosDeClave: () =>
          errores.filter((e) => String(e[0]).includes("same key")),
        restaurar: () => espia.mockRestore(),
      };
    }

    it("no repite clave con una coincidencia", () => {
      const consola = espiarConsola();
      try {
        render(<span>{resaltar("Epic- IA Mundial Express", "IA", 2)}</span>);
        expect(consola.avisosDeClave()).toEqual([]);
      } finally {
        consola.restaurar();
      }
    });

    it("no repite clave con varias coincidencias en el mismo texto", () => {
      // Aquí el fallo era mayor: 5 fragmentos producían 3 nodos con la misma
      // clave, porque los índices 0, 1 y 3 caían todos en `clave`.
      const consola = espiarConsola();
      try {
        render(<span>{resaltar("IA de IA para IA", "IA", 2)}</span>);
        expect(consola.avisosDeClave()).toEqual([]);
      } finally {
        consola.restaurar();
      }
    });

    it("no repite clave entre las dos celdas de la misma fila", () => {
      // Es el caso real del aviso: la celda del ID usa clave 1 y la del título
      // usa 2, y ambas se renderizan como hijas del mismo <tr>.
      const consola = espiarConsola();
      try {
        render(
          <table>
            <tbody>
              <tr>
                <td>{resaltar("5586", "55", 1)}</td>
                <td>{resaltar("Epic- IA Mundial", "IA", 2)}</td>
              </tr>
            </tbody>
          </table>,
        );
        expect(consola.avisosDeClave()).toEqual([]);
      } finally {
        consola.restaurar();
      }
    });

    it("distingue el resultado de dos llamadas con la misma base", () => {
      const consola = espiarConsola();
      try {
        render(
          <div>
            <span>{resaltar("IA", "IA", 1)}</span>
            <span>{resaltar("IA", "IA", 1)}</span>
          </div>,
        );
        expect(consola.avisosDeClave()).toEqual([]);
      } finally {
        consola.restaurar();
      }
    });
  });
});
