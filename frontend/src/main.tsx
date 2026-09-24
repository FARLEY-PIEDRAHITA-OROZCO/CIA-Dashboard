import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { ApiError } from "./api/cliente";

import App from "./App";
import "./styles.css";

const clienteConsulta = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (error instanceof ApiError) {
          return error.status === 429 || (error.status !== null && error.status >= 500);
        }
        return failureCount < 1;
      },
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={clienteConsulta}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);