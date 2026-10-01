/** Página de configuración del sistema.
 *
 * Aquí se gestionan las rutas y configuraciones que no son secretas pero que
 * pueden cambiar entre entornos o máquinas.
 */

import { useState } from "react";

import { Cargando, ErrorAlerta } from "../componentes/retroalimentacion";
import { api } from "../api/cliente";
import type { EstadoRutaOnedrive } from "../api/tipos";

export default function PaginaConfiguracion() {
  const [estado, setEstado] = useState<EstadoRutaOnedrive | null>(null);
  const [nuevaRuta, setNuevaRuta] = useState("");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  // Cargar estado inicial
  useState(() => {
    api
      .obtenerRutaOnedrive()
      .then((data) => {
        setEstado(data);
        setNuevaRuta(data.ruta);
        setCargando(false);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        setCargando(false);
      });
  });

  async function guardarRuta() {
    setGuardando(true);
    setError(null);
    try {
      const resultado = await api.actualizarRutaOnedrive(nuevaRuta);
      setEstado(resultado);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGuardando(false);
    }
  }

  if (cargando) return <Cargando texto="Cargando configuración…" />;
  if (error) return <ErrorAlerta mensaje={error} />;
  if (!estado) return null;

  return (
    <div className="pagina">
      <div className="cabecera-pagina">
        <div>
          <h1>Configuración</h1>
          <p className="texto-suave">
            Rutas y ajustes que no son secretos pero que pueden cambiar entre
            entornos.
          </p>
        </div>
      </div>

      <section className="panel-monitor">
        <h2 className="actividad-subtitulo">Ruta de OneDrive</h2>
        <p className="texto-suave small">
          Carpeta raíz donde se crean las carpetas de iniciativas. Debe ser una
          carpeta sincronizada con OneDrive.
        </p>

        <div style={{ marginTop: 12 }}>
          <label
            htmlFor="ruta-onedrive"
            className="texto-suave small"
            style={{ display: "block", marginBottom: 4 }}
          >
            Ruta base
          </label>
          <input
            id="ruta-onedrive"
            type="text"
            value={nuevaRuta}
            onChange={(e) => setNuevaRuta(e.target.value)}
            style={{
              width: "100%",
              padding: "8px 10px",
              border: "1px solid var(--borde)",
              borderRadius: 4,
              fontSize: 13,
            }}
          />
        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
          <button
            type="button"
            className="btn primario small"
            onClick={guardarRuta}
            disabled={guardando}
          >
            {guardando ? "Guardando…" : "Guardar"}
          </button>
          <button
            type="button"
            className="btn secundario small"
            onClick={() => setNuevaRuta(estado.ruta)}
          >
            Restablecer
          </button>
        </div>

        <div style={{ marginTop: 12 }}>
          {estado.existe ? (
            <p className="texto-suave small" style={{ color: "#16a34a" }}>
              ✓ La ruta existe y es accesible
            </p>
          ) : (
            <p className="texto-suave small" style={{ color: "#dc2626" }}>
              ✗ La ruta no existe o no es accesible
            </p>
          )}
          <p className="texto-suave small">
            Iniciativas con carpeta: {estado.total_iniciativas}
          </p>
        </div>
      </section>
    </div>
  );
}
