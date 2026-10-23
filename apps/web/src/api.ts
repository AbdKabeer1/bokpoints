import {
  apiErrorSchema,
  awardPreviewResponseSchema,
  awardResponseSchema,
  balanceResponseSchema,
  identifyResponseSchema,
  meResponseSchema,
  recentAwardsResponseSchema,
  registeredCustomerSchema,
  tillRewardsResponseSchema,
} from '@bokpoints/shared';

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

/** The shape any response schema of ours satisfies; keeps zod types local. */
interface ResponseSchema<T> {
  safeParse: (value: unknown) => { success: true; data: T } | { success: false };
}

const base = (import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '');

interface RequestOptions {
  method: 'GET' | 'POST';
  path: string;
  token: string;
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string | undefined>;
}

async function request<T>(schema: ResponseSchema<T>, options: RequestOptions): Promise<T> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== '') search.set(key, value);
  }
  const suffix = search.size === 0 ? '' : `?${search.toString()}`;
  const headers: Record<string, string> = { authorization: `Bearer ${options.token}` };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  Object.assign(headers, options.headers ?? {});

  const response = await fetch(`${base}${options.path}${suffix}`, {
    method: options.method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });

  const json: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const parsedError = apiErrorSchema.safeParse(json);
    if (parsedError.success) {
      throw new ApiError(response.status, parsedError.data.error.code, parsedError.data.error.message);
    }
    throw new ApiError(response.status, `HTTP_${response.status}`, 'The request failed');
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError(response.status, 'INVALID_RESPONSE', 'The API sent an unexpected answer');
  }
  return parsed.data;
}

export const getMe = (token: string) =>
  request(meResponseSchema, { method: 'GET', path: '/v1/me', token });

export async function identify(token: string, storeId: string, code: string) {
  try {
    return await request(identifyResponseSchema, {
      method: 'POST',
      path: `/v1/stores/${storeId}/identify`,
      token,
      body: { credentialIdentifier: code },
    });
  } catch (error) {
    // A physical card carries the same kind of opaque identifier, so one
    // retry as nfc_card covers it without asking the cashier to choose.
    if (error instanceof ApiError && error.code === 'CREDENTIAL_NOT_FOUND') {
      return await request(identifyResponseSchema, {
        method: 'POST',
        path: `/v1/stores/${storeId}/identify`,
        token,
        body: { credentialIdentifier: code, credentialType: 'nfc_card' },
      });
    }
    throw error;
  }
}

export interface AwardBody {
  customerId: string;
  amountCents: number;
  /** What the customer actually paid (D-129); points follow this. */
  amountPaidCents?: number;
  /** A catalog reward to pay for in the same confirm (D-138). */
  redeemRewardId?: string;
  locationId?: string;
}

export const previewAward = (token: string, storeId: string, body: AwardBody) =>
  request(awardPreviewResponseSchema, {
    method: 'POST',
    path: `/v1/stores/${storeId}/awards/preview`,
    token,
    body,
  });

export const award = (token: string, storeId: string, body: AwardBody) =>
  request(awardResponseSchema, {
    method: 'POST',
    path: `/v1/stores/${storeId}/awards`,
    token,
    body,
    // A fresh key per award attempt: a retry after a failure is a new
    // attempt, while a double tap on one attempt stays one award (AC-2).
    headers: { 'idempotency-key': crypto.randomUUID() },
  });

export const registerCustomer = (
  token: string,
  storeId: string,
  body: { email: string; name?: string },
) =>
  request(registeredCustomerSchema, {
    method: 'POST',
    path: `/v1/stores/${storeId}/customers`,
    token,
    body,
  });

export const getBalance = (token: string, storeId: string, customerId: string) =>
  request(balanceResponseSchema, {
    method: 'GET',
    path: `/v1/stores/${storeId}/customers/${customerId}/balance`,
    token,
  });

/** The till's own recent awards (FR-STO-9), newest first. */
export const recentAwards = (token: string, storeId: string) =>
  request(recentAwardsResponseSchema, {
    method: 'GET',
    path: `/v1/stores/${storeId}/awards/recent`,
    token,
  });

/**
 * What this customer can take right now (D-138): every active reward with
 * its cost, whether their balance covers it, and today's per-customer limit.
 */
export const availableRewards = (
  token: string,
  storeId: string,
  customerId: string,
  paidCents?: number,
) =>
  request(tillRewardsResponseSchema, {
    method: 'GET',
    path: `/v1/stores/${storeId}/rewards/available`,
    token,
    query: {
      customerId,
      // D-145: the purchase being confirmed earns points that may pay for
      // the reward, so the picker prices what will actually be paid.
      paidCents: paidCents === undefined ? undefined : String(paidCents),
    },
  });

export type Me = Awaited<ReturnType<typeof getMe>>;
export type Membership = Me['memberships'][number];
export type Identified = Awaited<ReturnType<typeof identify>>;
export type AwardPreview = Awaited<ReturnType<typeof previewAward>>;
export type RecentAwards = Awaited<ReturnType<typeof recentAwards>>;
export type TillRewards = Awaited<ReturnType<typeof availableRewards>>;
export type TillReward = TillRewards['rewards'][number];
export type RecentAwardEntry = RecentAwards['entries'][number];
export type RegisteredCustomer = Awaited<ReturnType<typeof registerCustomer>>;
