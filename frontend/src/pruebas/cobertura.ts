/** Lógica pura de la vista de pruebas: cinta de cobertura y veredicto.
 *
 * Se separa de los componentes para poder probarla sin React ni red, igual que
 * `sprints/cinta.ts` y `sprints/veredicto.ts`.
 *
 * Aquí vive la decisión de diseño central: **la cobertura se lee como una
 * secuencia, no como una tabla de 36 filas**. Y la barra es apilada, no rellena
 * como la de sprints, porque aquí la parte buena y la parte que falta ocupan el
 * mismo espacio: una barra con el 13 % de arriba en verde y el resto en rojo se
 * lee de un vistazo, mientras que «5 cubiertas de 39» obliga a hacer la división.
 *
 * Todos los datos salen de `/api/pruebas/cobertura`: no hace falta ninguna
 * llamada extra para dibujar la cinta.
 */

import type { CoberturaDeSprint, CoberturaPruebas, ResumenPruebas } from "../api/tipos";
import { plural } from "../sprints/veredicto";
import { porcentaje } from "../sprints/fechas";

/** Una columna de la cinta de cobertura. */
export interface ColumnaCobertura {
  nombre: string;
  ruta: string;
  historias: number;
  cubiertas: number;
  sinCubrir: number;
  /** Fracción cubierta, 0–1. Un sprint sin historias da 0, no NaN. */
  cobertura: number;
  /** Altura relativa 0–1 frente al sprint con más historias. */
  magnitud: number;
}

/** Agregados de la cinta, para el pie y el veredicto. */
export interface ResumenCobertura {
  columnas: ColumnaCobertura[];
  maximo: number;
  /** Sprints con al menos una historia sin caso. */
  sprintsConHueco: number;
  /** El sprint con menos cobertura, entre los que tienen historias. */
  peorSprint: ColumnaCobertura | null;
}

/**
 * Construye las columnas de cobertura en el orden que da el backend.
 *
 * El backend ya las entrega ordenadas por el criterio numérico tolerante de los
 * sprints (`Sprint 2` antes que `Sprint 10`); aquí no se reordena nada. Reordenar
 * en el frontend con un `localeCompare` volvería a poner `Sprint 10` antes que
 * `Sprint 2`.
 */
export function construirColumnas(sprints: CoberturaDeSprint[]): ResumenCobertura {
  const columnas = sprints.map((s) => {
    const historias = Math.max(0, s.historias);
    const cubiertas = Math.min(Math.max(0, s.cubiertas), historias);
    return {
      nombre: s.nombre,
      ruta: s.ruta,
      historias,
      cubiertas,
      sinCubrir: Math.max(0, historias - cubiertas),
      // Se usa `cubiertas` y no `s.cubiertas`: con `historias === 0` daría NaN.
      cobertura: historias > 0 ? cubiertas / historias : 0,
      magnitud: 0,
    };
  });
  const maximo = columnas.reduce((mayor, c) => Math.max(mayor, c.historias), 0);
  // La magnitud se rellena en un segundo paso: depende del máximo, que solo se
  // conoce cuando ya están todas las columnas.
  for (const columna of columnas) {
    columna.magnitud = maximo > 0 ? columna.historias / maximo : 0;
  }
  const conHistorias = columnas.filter((c) => c.historias > 0);
  return {
    columnas,
    maximo,
    sprintsConHueco: columnas.filter((c) => c.sinCubrir > 0).length,
    peorSprint:
      conHistorias.length > 0
        ? conHistorias.reduce((peor, c) => (c.cobertura < peor.cobertura ? c : peor))
        : null,
  };
}

/** Tonos de la hoja de estilos (`.cinta-barra[data-tono]`). */
export type TonoCobertura = "ok" | "alerta" | "acento" | "neutro";

/**
 * Tono de una columna.
 *
 * El criterio es la brecha, no el volumen: un sprint de 39 historias con cinco
 * casos es una alerta aunque ocupe la columna más alta. Por debajo del 50 %
 * cubierto es alerta; al 100 % es correcto.
 *
 * `neutro` queda para los sprints sin historias, que no se pueden calificar.
 */
export function tonoColumna(columna: ColumnaCobertura): TonoCobertura {
  if (columna.historias === 0) return "neutro";
  if (columna.sinCubrir === 0) return "ok";
  if (columna.cobertura < 0.5) return "alerta";
  return "acento";
}

/** Descripción corta de una columna, para su etiqueta accesible. */
export function describirColumna(columna: ColumnaCobertura): string {
  const partes = [
    columna.nombre,
    plural(columna.cubiertas, "historia") + " con caso",
    plural(columna.sinCubrir, "historia") + " sin caso",
  ];
  return partes.join(", ");
}

/** Partes del veredicto de la vista de pruebas. */
export interface VeredictoPruebas {
  titular: string;
  detalle: string;
  tono: "ok" | "alerta" | "neutro";
  /**
   * `true` si algún lote de relaciones falló al leer. Entonces el número de
   * historias sin caso es una **cota superior**, no un total: hay que decirlo en
   * la propia línea, no en un aviso aparte que se pasa por alto.
   */
  parcial: boolean;
}

/**
 * Veredicto de la brecha de cobertura, con el contexto que le da sentido.
 *
 * El titular es el número accionable. Los casos sin automatizar y los que siguen
 * en diseño van en el detalle, no como tarjetas propias: son datos que explican el
 * titular, no cifras que compitan con él.
 */
export function veredictoBrecha(
  resumen: ResumenPruebas | undefined,
  cinta: ResumenCobertura,
): VeredictoPruebas {
  if (!resumen) {
    return { titular: "Midiendo la cobertura de pruebas…", detalle: "", tono: "neutro", parcial: false };
  }
  const brecha = resumen.brecha;
  const pct = brecha.pct_cubiertas;
  const titular = `${plural(brecha.sin_cubrir, "historia")} sin caso de prueba · ${pct}% cubierto`;

  const partes: string[] = [];
  partes.push(
    `${plural(brecha.historias, "historia")} en total · ${plural(brecha.cubiertas, "cubierta")}`,
  );
  if (cinta.sprintsConHueco > 0) {
    partes.push(
      `${plural(cinta.sprintsConHueco, "sprint")} con alguna historia sin probar`,
    );
  }
  if (cinta.peorSprint && cinta.peorSprint.sinCubrir > 0) {
    partes.push(
      `el peor es ${cinta.peorSprint.nombre} (${porcentaje(
        cinta.peorSprint.cubiertas,
        cinta.peorSprint.historias,
      )}%)`,
    );
  }
  if (resumen.automatizacion.automatizados === 0) {
    partes.push(
      `${plural(resumen.automatizacion.manuales, "caso")} sin automatizar`,
    );
  }

  return {
    titular,
    detalle: partes.join(" · "),
    // El tono sigue a la brecha: más de la mitad de las historias sin caso es el
    // problema que esta vista existe para señalar.
    tono: pct >= 75 ? "ok" : pct >= 50 ? "neutro" : "alerta",
    parcial: brecha.parcial,
  };
}

/** Veredicto cuando ya hay un sprint elegido: su brecha, no la del proyecto. */
export function veredictoSprint(columna: ColumnaCobertura): VeredictoPruebas {
  const pct = porcentaje(columna.cubiertas, columna.historias);
  return {
    titular: `${columna.nombre} · ${pct}% cubierto`,
    detalle:
      columna.historias === 0
        ? "sin historias en este sprint"
        : `${plural(columna.cubiertas, "historia")} con caso · ${plural(
            columna.sinCubrir,
            "historia",
          )} sin caso`,
    tono: columna.sinCubrir === 0 ? "ok" : pct >= 50 ? "neutro" : "alerta",
    parcial: false,
  };
}

/** ¿Hay suficiente con lo que se sabe para dibujar la cinta? */
export function hayCobertura(datos: CoberturaPruebas | undefined): boolean {
  return (datos?.sprints.length ?? 0) > 0;
}
