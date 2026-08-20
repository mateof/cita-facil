import { useEffect } from 'react';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.ts';
import type { PublicOrganization } from '../lib/types.ts';
import { useOrganizationTheme } from '../components/theme.tsx';
import Book from './Book.tsx';

/**
 * La reserva empotrada en la web del negocio.
 *
 * Es la misma pantalla de siempre sin cabecera, sin menú y sin pie: dentro de
 * un marco, la navegación de la aplicación sobra y despista. Escribir otra
 * pantalla habría sido peor: se quedaría atrás en cada cambio de la reserva.
 *
 * El alto se le comunica a la página que la empotra, porque una reserva cambia
 * de tamaño en cada paso y un marco de alto fijo acaba con scroll dentro de la
 * página, que es justo lo que delata a un widget.
 */
export default function Embed() {
  const { slug = '' } = useParams();

  const organizacion = useQuery({
    queryKey: ['public-org', slug],
    queryFn: () => api.get<PublicOrganization>(`/public/organizations/${slug}`),
  });

  useOrganizationTheme(organizacion.data?.theme);

  useEffect(() => {
    if (window.parent === window) return;

    const enviarAlto = () => {
      const alto = Math.ceil(document.documentElement.scrollHeight);
      window.parent.postMessage({ type: 'citafacil:height', height: alto }, '*');
    };

    // Se observa el documento entero: el alto cambia al pasar de paso, al
    // desplegar el calendario y al aparecer un error, y ninguno de esos
    // momentos es un evento al que se pueda uno enganchar.
    const observador = new ResizeObserver(enviarAlto);
    observador.observe(document.documentElement);
    enviarAlto();

    return () => observador.disconnect();
  }, []);

  return (
    <div className="mx-auto max-w-2xl px-4 py-5">
      <Book />
    </div>
  );
}
