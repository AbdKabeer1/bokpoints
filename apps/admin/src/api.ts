import {
  adminAnalyticsResponseSchema,
  adminFeedbackResponseSchema,
  adminAnonymiseCustomerRequestSchema,
  adminAnonymiseCustomerResponseSchema,
  adminSafetySignalsResponseSchema,
  adminStoresQuerySchema,
  adminStoreDetailSchema,
  adminStoreStatusRequestSchema,
  adminStoreStatusResponseSchema,
  adminStoresResponseSchema,
  adminSubscriptionsResponseSchema,
  adminSupportQuerySchema,
  adminSupportResponseSchema,
  apiErrorSchema,
  businessLeadSchema,
  leadsResponseSchema,
  clawbackRequestSchema,
  createdStoreResponseSchema,
  createStoreRequestSchema,
  customerParamsSchema,
  storeIdParamsSchema,
  auditResponseSchema,
  meResponseSchema,
  feedbackRequestSchema,
  feedbackResponseSchema,
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

interface ResponseSchema<T> {
  safeParse: (value: unknown) => { success: true; data: T } | { success: false };
}

const base = (import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '');

interface RequestOptions {
  method: 'GET' | 'POST';
  path: string;
  token: string;
  body?: unknown;
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

  const response = await fetch(`${base}${options.path}${suffix}`, {
    method: options.method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });

  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(json);
    if (parsed.success) {
      throw new ApiError(response.status, parsed.data.error.code, parsed.data.error.message);
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

export const listStores = (
  token: string,
  filters: { status?: string | undefined; query?: string | undefined } = {},
) =>
  request(adminStoresResponseSchema, {
    method: 'GET',
    path: '/v1/admin/stores',
    token,
    query: filters,
  });

export const getStoreDetail = (token: string, storeId: string) =>
  request(adminStoreDetailSchema, {
    method: 'GET',
    path: `/v1/admin/stores/${storeId}`,
    token,
  });

export const setStoreStatus = (
  token: string,
  storeId: string,
  body: { status: 'active' | 'paused' | 'suspended'; reason: string },
) =>
  request(adminStoreStatusResponseSchema, {
    method: 'POST',
    path: `/v1/admin/stores/${storeId}/status`,
    token,
    body: adminStoreStatusRequestSchema.parse(body),
  });

export const anonymiseCustomerAsAdmin = (
  token: string,
  customerId: string,
  body: { reason: string; confirmation: 'ANONYMISE' },
) =>
  request(adminAnonymiseCustomerResponseSchema, {
    method: 'POST',
    path: `/v1/admin/customers/${customerId}/anonymise`,
    token,
    body: adminAnonymiseCustomerRequestSchema.parse(body),
  });

export const searchSupport = (token: string, query: string) =>
  request(adminSupportResponseSchema, {
    method: 'GET',
    path: '/v1/admin/support',
    token,
    query: { query },
  });

export const getSafetySignals = (token: string) =>
  request(adminSafetySignalsResponseSchema, {
    method: 'GET',
    path: '/v1/admin/safety/signals',
    token,
  });

export const getAnalytics = (token: string) =>
  request(adminAnalyticsResponseSchema, { method: 'GET', path: '/v1/admin/analytics', token });

export const listSubscriptions = (token: string) =>
  request(adminSubscriptionsResponseSchema, {
    method: 'GET',
    path: '/v1/admin/subscriptions',
    token,
  });

export const listAudit = (
  token: string,
  filters: { storeId?: string | undefined; action?: string | undefined; limit?: string | undefined } = {},
) =>
  request(auditResponseSchema, {
    method: 'GET',
    path: '/v1/admin/audit',
    token,
    query: filters,
  });

export const listLeads = (
  token: string,
  query?: string,
) =>
  request(leadsResponseSchema, {
    method: 'GET',
    path: '/v1/admin/leads',
    token,
    query: { query },
  });

export const sendFeedback = (
  token: string,
  body: { category: 'bug' | 'idea' | 'other'; message: string; page?: string },
) =>
  request(feedbackResponseSchema, {
    method: 'POST',
    path: '/v1/admin/feedback',
    token,
    body: feedbackRequestSchema.parse(body),
  });

export const listFeedback = (token: string) =>
  request(adminFeedbackResponseSchema, {
    method: 'GET',
    path: '/v1/admin/feedback',
    token,
  });

export type Me = Awaited<ReturnType<typeof getMe>>;
export type StoreRow = Awaited<ReturnType<typeof listStores>>['stores'][number];
export type StoreDetail = Awaited<ReturnType<typeof getStoreDetail>>;
export type SupportResults = Awaited<ReturnType<typeof searchSupport>>;
export type Analytics = Awaited<ReturnType<typeof getAnalytics>>;
export type Subscription = Awaited<ReturnType<typeof listSubscriptions>>['subscriptions'][number];
export type AuditEntry = Awaited<ReturnType<typeof listAudit>>['entries'][number];
export type BusinessLead = Awaited<ReturnType<typeof listLeads>>['leads'][number];