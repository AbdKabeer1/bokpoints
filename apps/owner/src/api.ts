import {
  adjustmentRequestSchema,
  adjustmentResponseSchema,
  apiErrorSchema,
  auditResponseSchema,
  earningRuleCreateRequestSchema,
  earningRuleEditRequestSchema,
  earningRuleRowSchema,
  earningRuleStatusRequestSchema,
  earningRulesResponseSchema,
  meResponseSchema,
  registeredCustomerSchema,
  ruleSimulateRequestSchema,
  ruleSimulateResponseSchema,
  rewardCreateRequestSchema,
  rewardEditRequestSchema,
  discountRuleResponseSchema,
  discountRuleRowSchema,
  discountRuleSetRequestSchema,
  storeCustomersResponseSchema,
  storeRewardsResponseSchema,
  storeRewardRowSchema,
  storeStaffResponseSchema,
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
  method: 'GET' | 'POST' | 'PATCH';
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
    const parsedError = apiErrorSchema.safeParse(json);
    if (parsedError.success) {
      throw new ApiError(
        response.status,
        parsedError.data.error.code,
        parsedError.data.error.message,
      );
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

/* ── Rules (WP2): the point configuration the portal exists for ─────────── */

export const listRules = (token: string, storeId: string) =>
  request(earningRulesResponseSchema, {
    method: 'GET',
    path: `/v1/stores/${storeId}/rules`,
    token,
  });

export const createRule = (token: string, storeId: string, body: unknown) =>
  request(earningRuleRowSchema, {
    method: 'POST',
    path: `/v1/stores/${storeId}/rules`,
    token,
    body,
  });

export const editRuleVersion = (token: string, storeId: string, ruleId: string, body: unknown) =>
  request(earningRuleRowSchema, {
    method: 'POST',
    path: `/v1/stores/${storeId}/rules/${ruleId}/version`,
    token,
    body,
  });

export const setRuleStatus = (token: string, storeId: string, ruleId: string, status: string) =>
  request(earningRuleRowSchema, {
    method: 'POST',
    path: `/v1/stores/${storeId}/rules/${ruleId}/status`,
    token,
    body: earningRuleStatusRequestSchema.parse({ status }),
  });

export const simulateRules = (token: string, storeId: string, body: unknown) =>
  request(ruleSimulateResponseSchema, {
    method: 'POST',
    path: `/v1/stores/${storeId}/rules/simulate`,
    token,
    body: ruleSimulateRequestSchema.parse(body),
  });

export const createRuleRequestFor = (definition: unknown, effectiveFrom?: string) =>
  earningRuleCreateRequestSchema.parse({ definition, ...(effectiveFrom === undefined ? {} : { effectiveFrom }) });

export const editRuleRequestFor = (definition: unknown, ruleId?: string) =>
  earningRuleEditRequestSchema.parse({ definition, ruleId });

/* ── Customers ─────────────────────────────────────────────────────────── */

export const listCustomers = (token: string, storeId: string, query?: string) =>
  request(storeCustomersResponseSchema, {
    method: 'GET',
    path: `/v1/stores/${storeId}/customers`,
    token,
    query: { query },
  });

export const adjustPoints = (
  token: string,
  storeId: string,
  customerId: string,
  body: unknown,
) =>
  request(adjustmentResponseSchema, {
    method: 'POST',
    path: `/v1/stores/${storeId}/customers/${customerId}/adjustments`,
    token,
    body: adjustmentRequestSchema.parse(body),
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

/* ── People ────────────────────────────────────────────────────────────── */

export const listStaff = (token: string, storeId: string) =>
  request(storeStaffResponseSchema, {
    method: 'GET',
    path: `/v1/stores/${storeId}/staff`,
    token,
  });

/* ── Rewards (D-138): the catalog a customer spends points on ──────────── */

export const listRewards = (token: string, storeId: string) =>
  request(storeRewardsResponseSchema, {
    method: 'GET',
    path: `/v1/stores/${storeId}/rewards`,
    token,
  });

export const createReward = (
  token: string,
  storeId: string,
  body: { name: string; pointsCost: number; perCustomerPerDayLimit?: number | null },
) =>
  request(storeRewardRowSchema, {
    method: 'POST',
    path: `/v1/stores/${storeId}/rewards`,
    token,
    body: rewardCreateRequestSchema.parse(body),
  });

export const editReward = (
  token: string,
  storeId: string,
  rewardId: string,
  body: { name?: string; pointsCost?: number; perCustomerPerDayLimit?: number | null; active?: boolean },
) =>
  request(storeRewardRowSchema, {
    method: 'PATCH',
    path: `/v1/stores/${storeId}/rewards/${rewardId}`,
    token,
    body: rewardEditRequestSchema.parse(body),
  });

/* ── Discount (D-115, D-133): the one basket discount behind the QR ────── */

export const getDiscountRule = (token: string, storeId: string) =>
  request(discountRuleResponseSchema, {
    method: 'GET',
    path: `/v1/stores/${storeId}/discount-rule`,
    token,
  });

export const setDiscountRule = (
  token: string,
  storeId: string,
  body: { thresholdCents: number; kind: 'fixed_cents' | 'percent'; value: number; active: boolean },
) =>
  request(discountRuleRowSchema, {
    method: 'POST',
    path: `/v1/stores/${storeId}/discount-rule`,
    token,
    body: discountRuleSetRequestSchema.parse(body),
  });

/* ── Audit ─────────────────────────────────────────────────────────────── */

export const listAudit = (token: string, storeId: string, limit = '50', action?: string) =>
  request(auditResponseSchema, {
    method: 'GET',
    path: `/v1/stores/${storeId}/audit`,
    token,
    query: { limit, action },
  });

export type Me = Awaited<ReturnType<typeof getMe>>;
export type Membership = Me['memberships'][number];
export type RuleRow = Awaited<ReturnType<typeof listRules>>['rules'][number];
export type RuleCustomer = Awaited<ReturnType<typeof listCustomers>>['customers'][number];
export type StaffMember = Awaited<ReturnType<typeof listStaff>>['members'][number];
export type AuditEntry = Awaited<ReturnType<typeof listAudit>>['entries'][number];
export type Reward = Awaited<ReturnType<typeof listRewards>>['rewards'][number];
export type DiscountRule = NonNullable<Awaited<ReturnType<typeof getDiscountRule>>['rule']>;
export type Simulation = Awaited<ReturnType<typeof simulateRules>>;
