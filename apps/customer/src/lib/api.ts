/**
 * The customer API client. Roughly 40 lines of shapes, so the app does not
 * need to bundle the zod schemas the API validates with.
 */

export interface CustomerProfile {
  id: string;
  email: string;
  name: string;
  language: string;
  notificationsEnabled: boolean;
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
  /** The store's own colour; null means OmaPointii green. */
  brandColor: string | null;
  /** The owner's uploaded logo, or null for initials. */
  logoUrl: string | null;
  /** Store news is off until the customer turns it on (FR-PRV-2). */
  marketingConsent: boolean;
  /** The cheapest active reward the balance has not reached yet. */
  nextReward: { name: string; pointsCost: number } | null;
}

export interface DirectoryStore {
  storeId: string;
  name: string;
  address: string | null;
  category?: string | null;
  brandColor: string | null;
  logoUrl: string | null;
  visited: boolean;
  balance: number;
  visitCount: number;
  distanceKm?: number | null;
}

/** A business discovered from OpenStreetMap that may not be on OmaPointii. */
export interface NearbyPlace {
  osmId: string;
  name: string;
  category: string;
  address: string | null;
  distanceKm: number;
  latitude: number;
  longitude: number;
  website: string | null;
  phone: string | null;
  openingHours: string | null;
}

export interface NearbyResponse {
  places: NearbyPlace[];
  available: boolean;
  attribution: string;
  provider?: string;
  providerError?: string;
}

export interface StoreOffer {
  storeId: string;
  storeName: string;
  brandColor: string | null;
  logoUrl: string | null;
  thresholdCents: number;
  kind: 'fixed_cents' | 'percent';
  value: number;
}

export interface Notification {
  id: string;
  storeId: string;
  storeName: string;
  storeBrandColor: string | null;
  storeLogoUrl: string | null;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
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
  method: 'GET' | 'POST' | 'PATCH' = 'GET',
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

export const updateMe = (
  token: string,
  patch: { name?: string; language?: 'fi' | 'en'; notificationsEnabled?: boolean },
) => request<Me>('/v1/customer/me', token, 'PATCH', patch);

export const getStores = (token: string) =>
  request<{ stores: StoreSummary[] }>('/v1/customer/me/stores', token);

/** Every active store on the platform, with this customer's visit state. */
export const getDirectory = (token: string, lat?: number, lon?: number) =>
  request<{ stores: DirectoryStore[] }>(
    `/v1/customer/stores${lat != null && lon != null ? `?lat=${lat}&lon=${lon}` : ''}`,
    token
  );

/** Named businesses near a point, including places not on OmaPointii. */
export const getNearby = (
  token: string,
  lat: number,
  lon: number,
  radiusKm = 10,
  q?: string
) =>
  request<NearbyResponse>(
    `/v1/customer/discover?lat=${lat}&lon=${lon}&radiusKm=${radiusKm}${
      q === undefined || q.trim() === '' ? '' : `&q=${encodeURIComponent(q.trim())}`
    }`,
    token
  );

export const getHistory = (token: string, storeId: string) =>
  request<History>(`/v1/customer/me/stores/${storeId}/history`, token);

export interface StoreReward {
  rewardId: string;
  name: string;
  pointsCost: number;
}

/** The store's active rewards, cheapest first (D-138). */
export const getStoreRewards = (token: string, storeId: string) =>
  request<{ rewards: StoreReward[] }>(`/v1/customer/stores/${storeId}/rewards`, token);

export interface DiscountProof {
  proof: string;
  /** UTC instant after which the till refuses the code. */
  expiresAt: string;
  /** False when the store has no discount running — hide the code. */
  active: boolean;
}

/** A fresh rotating discount code for this store (D-133). Online only. */
export const getDiscountProof = (token: string, storeId: string) =>
  request<DiscountProof>(`/v1/customer/stores/${storeId}/discount-proof`, token, 'POST');

export const getExpiring = (token: string) =>
  request<{ windowDays: number; items: ExpiringItem[] }>('/v1/customer/me/expiring', token);

/** Active basket discounts at the stores this customer has joined. */
export const getOffers = (token: string) =>
  request<{ offers: StoreOffer[] }>('/v1/customer/me/offers', token);

/** The customer's inbox: campaign messages from their stores (D-148). */
export const getNotifications = (token: string) =>
  request<{ unread: number; notifications: Notification[] }>(
    '/v1/customer/me/notifications',
    token,
  );

export const markNotificationRead = (token: string, notificationId: string) =>
  request<{ id: string; readAt: string }>(
    `/v1/customer/me/notifications/${notificationId}/read`,
    token,
    'POST',
  );

/** Store news consent, per store (FR-PRV-2). */
export const setStoreConsent = (token: string, storeId: string, marketingConsent: boolean) =>
  request<{ storeId: string; marketingConsent: boolean }>(
    `/v1/customer/me/stores/${storeId}/consent`,
    token,
    'PATCH',
    { marketingConsent },
  );

/* ── Privacy (A5) ───────────────────────────────────────────────────────── */

export interface CustomerExport {
  exportedAt: string;
  profile: {
    id: string;
    email: string;
    name: string;
    phone: string | null;
    language: string;
    status: string;
    createdAt: string;
  };
  consents: {
    storeId: string;
    storeName: string;
    joinedAt: string;
    marketingConsent: boolean;
  }[];
  credentials: {
    type: string;
    identifier: string;
    status: string;
    createdAt: string;
  }[];
  balances: { storeId: string; storeName: string; points: number }[];
  ledger: {
    id: string;
    storeId: string;
    storeName: string;
    type: string;
    points: number;
    amountCents: number | null;
    reason: string | null;
    createdAt: string;
  }[];
}

/** Everything the customer is entitled to receive, and nothing else. */
export const exportMyData = (token: string) =>
  request<CustomerExport>('/v1/customer/me/export', token);

/** Irreversible. The caller must have requested a fresh email code first. */
export const deleteMyAccount = (token: string, code: string) =>
  request<{ deleted: true }>('/v1/customer/me/delete', token, 'POST', { code });


/** In-app feedback; stored for the platform support queue. */
export const sendFeedback = (
  token: string,
  body: { category: 'bug' | 'idea' | 'other'; message: string; page?: string },
) =>
  request<{ id: string; createdAt: string }>('/v1/customer/me/feedback', token, 'POST', body);
