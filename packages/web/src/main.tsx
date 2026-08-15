import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App.tsx';
import './i18n/index.ts';
import './index.css';

/**
 * Configuración de las consultas.
 *
 * Los datos de agenda cambian por debajo constantemente, así que se refrescan
 * al volver a la pestaña. El tiempo de frescura es corto pero no cero: evita
 * ráfagas de peticiones al navegar entre pantallas sin llegar a mostrar huecos
 * que ya no existen.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        const status = (error as { status?: number }).status;
        // No tiene sentido reintentar un 401, un 403 o un 404.
        if (status && status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: true,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
