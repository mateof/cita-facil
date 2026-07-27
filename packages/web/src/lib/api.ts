/**
 * Cliente del API.
 *
 * Guarda el token de acceso en memoria, no en `localStorage`: un XSS no puede
 * leerlo de una variable de módulo tan fácilmente como de un almacén
 * persistente, y la sesión de larga duración vive en una cookie `httpOnly` que
 * el JavaScript de la página no ve. Al recargar, `refresh()` recupera la sesión
 * a partir de esa cookie.
 */

let accessToken: string | null = null;
let refreshPromise: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

export function setAccessToken(token: string | null): void {
  accessToken = token;
  for (const listener of listeners) listener();
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function onTokenChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null | string[]>;
  /** Evita el reintento tras renovar el token (se usa en el propio refresh). */
  skipRefresh?: boolean;
  /** Devuelve la respuesta cruda en lugar de intentar interpretar JSON. */
  raw?: boolean;
}

const BASE = '/api/v1';

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = `${BASE}${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return url;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, String(item));
    } else {
      params.append(key, String(value));
    }
  }
  const queryString = params.toString();
  return queryString ? `${url}?${queryString}` : url;
}

async function rawRequest(path: string, options: RequestOptions = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  if (options.body !== undefined && !(options.body instanceof FormData)) {
    headers.set('content-type', 'application/json');
  }
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);

  return fetch(buildUrl(path, options.query), {
    ...options,
    headers,
    credentials: 'include',
    body:
      options.body === undefined
        ? undefined
        : options.body instanceof FormData
          ? options.body
          : JSON.stringify(options.body),
  });
}

/**
 * Renueva el token de acceso. Las peticiones concurrentes comparten la misma
 * promesa: si tres consultas fallan a la vez con 401, solo se hace un refresh.
 */
export async function refresh(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const response = await rawRequest('/auth/refresh', { method: 'POST', skipRefresh: true });
      if (!response.ok) {
        setAccessToken(null);
        return false;
      }
      const data = (await response.json()) as { tokens: { accessToken: string } };
      setAccessToken(data.tokens.accessToken);
      return true;
    } catch {
      setAccessToken(null);
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response = await rawRequest(path, options);

  if (response.status === 401 && !options.skipRefresh) {
    const renewed = await refresh();
    if (renewed) response = await rawRequest(path, options);
  }

  if (options.raw) return response as unknown as T;

  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    if (!response.ok) {
      throw new ApiError(response.status, 'http_error', await response.text());
    }
    return (await response.blob()) as unknown as T;
  }

  const data = await response.json();

  if (!response.ok) {
    const body = data as ApiErrorBody;
    throw new ApiError(
      response.status,
      body?.error?.code ?? 'unknown_error',
      body?.error?.message ?? 'Error desconocido',
      body?.error?.details,
    );
  }

  return data as T;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'DELETE' }),
  /**
   * Sube un fichero. El cuerpo va como `FormData`, así que el navegador pone
   * el `content-type` con su separador y aquí no se toca.
   */
  upload: <T>(path: string, body: FormData) => request<T>(path, { method: 'POST', body }),
  /** Descarga un fichero respetando la sesión actual. */
  download: async (path: string, filename: string): Promise<void> => {
    const response = await rawRequest(path);
    if (!response.ok) throw new ApiError(response.status, 'download_failed', 'No se pudo descargar');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  },
  /** URL absoluta de un recurso del API, para `<img src>` y similares. */
  url: (path: string) => `${BASE}${path.startsWith('/') ? path : `/${path}`}`,
};
