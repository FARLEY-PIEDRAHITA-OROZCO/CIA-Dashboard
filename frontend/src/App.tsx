import { useEffect } from "react";

import { useVista } from "./navegacion";
import Dashboard from "./pages/Dashboard";
import { PaginaBugs } from "./epicas/PaginaBugs";
import { PaginaEpica } from "./epicas/PaginaEpica";
import { PaginaTareas } from "./epicas/PaginaTareas";

function Navegacion() {
  return (
    <header className="barra-superior">
      <div className="marca">▶ CIA · Dashboard de Épicas</div>
      <nav className="enlaces-barra">
        <a className="enlace-barra" href="/api/health">
          Salud
        </a>
        <a className="enlace-barra" href="/docs" target="_blank" rel="noreferrer">
          API docs
        </a>
      </nav>
    </header>
  );
}

export default function App() {
  const vista = useVista();
  const azureId = "azureId" in vista ? vista.azureId : null;

  useEffect(() => {
    document.querySelector<HTMLElement>("main h1")?.focus();
  }, [vista.pagina, azureId]);

  return (
    <>
      <Navegacion />
      <main className="contenido">
        {vista.pagina === "epica" ? (
          <PaginaEpica key={vista.azureId} azureId={vista.azureId} />
        ) : vista.pagina === "epicaTareas" ? (
          <PaginaTareas key={vista.azureId} azureId={vista.azureId} />
        ) : vista.pagina === "epicaBugs" ? (
          <PaginaBugs key={vista.azureId} azureId={vista.azureId} />
        ) : (
          <Dashboard />
        )}
      </main>
    </>
  );
}
