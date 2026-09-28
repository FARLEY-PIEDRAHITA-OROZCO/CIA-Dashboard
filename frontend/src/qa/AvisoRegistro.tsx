/** Dónde viven las asignaciones y si tienen respaldo.
 *
 * Reemplaza a un aviso que decía «haz `git commit`». Ese texto era cierto
 * cuando el registro estaba versionado y dejó de serlo al sacarlo de git, así
 * que mantenerlo habría sido **mentirle al usuario desde su propia pantalla**:
 * alguien leería que el dato está a salvo y no lo comprobaría.
 *
 * Por eso el texto viene del backend (`GET /api/qa/registro`) y aquí no se
 * inventa nada. El backend es quien sabe si hay destino configurado y si la
 * última copia se pudo escribir.
 *
 * Comportamiento, según lo pedido: **silencioso si funciona, ruidoso si falla**.
 * Cuando todo va bien solo se muestra una línea discreta con la ruta — «¿dónde
 * está mi dato?» es información legítima y no es ruido—, y si la copia está
 * rota aparece un aviso de verdad.
 */

import type { EstadoRegistro } from "../api/tipos";
import { useEstadoRegistro } from "./hooks";

export function AvisoRegistro({ activo = true }: { activo?: boolean }) {
  const estado = useEstadoRegistro(activo);
  const datos: EstadoRegistro | undefined = estado.data;

  if (!datos) {
    // Mientras no se sepa, no se afirma nada. Un panel vacío sería peor que
    // esperar, pero inventar un texto aquí sería peor que los dos.
    return null;
  }

  const roto = datos.copia_configurada && !datos.copia_activa;

  return (
    <>
      {roto && (
        <div className="aviso aviso-error" role="alert">
          <strong>La copia de seguridad no está funcionando.</strong>{" "}
          {datos.aviso}
          <br />
          El registro principal sí se guardó, en <code>{datos.ruta}</code>. Sin la
          copia, perder ese fichero pierde las asignaciones.
        </div>
      )}

      {!datos.copia_configurada && (
        <div className="aviso aviso-alerta" role="status">
          <strong>Estas asignaciones no tienen copia de seguridad.</strong>{" "}
          {datos.aviso}
        </div>
      )}

      {datos.copia_activa && (
        <p className="texto-suave small nota-actividad" title={datos.copia_ruta}>
          Registro en <code>{datos.ruta}</code> · copia de seguridad activa
          {datos.ultima_copia && ` (última: ${datos.ultima_copia})`}
        </p>
      )}
    </>
  );
}
