/**
 * The customer API client. Roughly 40 lines of shapes, so the app does not
 * need to bundle the zod schemas the API validates with.
 */

export interface CustomerProfile {
  id: string;
  email: string;
  name: string;
  language: string;
  createdAt: string;
}

export interface Me {
  customer: CustomerProfile;
  credential: { type: 'app_qr'; identifier: string };
  onboardingComplete: boolean;
}

export interface StoreSummary {
  storeId: string;
  name: string;
  balance: number;
  lastActivityAt: string;
}

export interface HistoryEntry {
  id: string;
  createdAt: string;
  type: string;
  points: number;
  balanceAfter: number;
}

export interface History {
  storeName: string;
  balance: number;
  entries: HistoryEntry[];
}

export interface ExpiringItem {
  storeId: string;
  storeName: string;
  points: number;
  expiresAt: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

const apiBase = (process.env.EXPO_PUBLIC_API_BASE ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');

async function request<T>(
  path: string,
  token: string,
  method: 'GET' | 'PATCH' = 'GET',
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (body !== undefined) headers['content-type'] = 'application/json';

  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const json: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const parsed = json as { error?: { code?: string; message?: string } } | null;
    throw new ApiError(
      response.status,
      parsed?.error?.code ?? `HTTP_${response.status}`,
      parsed?.error?.message ?? 'The request failed',
    );
  }

  return json as T;
}

export const getMe = (token: string) => request<Me>('/v1/customer/me', token);

export const updateMe = (token: string, patch: { name?: string; language?: 'fi' | 'en' }) =>
  request<Me>('/v1/customer/me', token, 'PATCH', patch);

export const getStores = (token: string) =>
  request<{ stores: StoreSummary[] }>('/v1/customer/me/stores', token);

export const getHistory = (token: string, storeId: string) =>
  request<History>(`/v1/customer/me/stores/${storeId}/history`, token);

export const getExpiring = (token: string) =>
  request<{ windowDays: number; items: ExpiringItem[] }>('/v1/customer/me/expiring', token);
