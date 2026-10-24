// Mirrors the 06 response shapes (as emitted by server/src/routes/*).

export type Role = 'viewer' | 'member' | 'admin';
export type AppStatus = 'created' | 'building' | 'live' | 'failed' | 'stopped';
export type DeploymentStatus = 'queued' | 'fetching' | 'building' | 'deploying' | 'live' | 'failed';
export type CertStatus = 'pending' | 'issued' | 'failed';
export type BuildType = 'auto' | 'dockerfile' | 'node' | 'static';

export interface User {
  id: string;
  username: string;
  role: Role;
  active?: boolean; // only in GET /api/users rows (06 §4)
  createdAt: string;
}

export interface Domain {
  id: string;
  host: string;
  certStatus: CertStatus;
  certIssuedAt: string | null;
  createdAt: string;
}

export interface DeploymentSummary {
  id: string;
  commitSha: string;
  commitMessage: string | null;
  author: string | null;
  status: DeploymentStatus;
  createdAt: string;
}

export interface AppSummary {
  id: string;
  name: string;
  slug: string;
  repoOwner: string;
  repoName: string;
  branch: string;
  port: number;
  healthcheckPath: string;
  buildType: BuildType;
  autoDeploy: boolean;
  status: AppStatus;
  hasToken: boolean;
  tokenLast4: string | null;
  currentDeploymentId: string | null;
  createdAt: string;
}

// GET/POST/PATCH /api/apps/:id — full app JSON; POST additionally returns webhook (06 §5)
export interface AppFull extends AppSummary {
  domains: Domain[];
  currentDeployment: DeploymentSummary | null;
}

export interface Webhook {
  url: string;
  secret: string;
}

export interface Deployment {
  id: string;
  appId: string;
  commitSha: string;
  commitMessage: string | null;
  author: string | null;
  branch: string;
  status: DeploymentStatus;
  trigger: 'webhook' | 'manual';
  triggeredBy: string | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

// viewers receive { key, masked }, member/admin { key, value } (06 §9)
export type EnvRow = { key: string; masked: true; value?: undefined } | { key: string; value: string; masked?: undefined };

export interface EventRow {
  id: string;
  action: string;
  user: { username: string } | null;
  targetType: string | null;
  targetId: string | null;
  details: unknown;
  createdAt: string;
}

export interface Meta {
  page: number;
  limit: number;
  total: number;
}

export type Paginated<T> = { data: T[]; meta: Meta };

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export const isPaginated = (v: unknown): v is Paginated<unknown> =>
  typeof v === 'object' && v !== null && 'data' in v && 'meta' in v;
