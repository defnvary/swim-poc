import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config.js";
import { run, type RunResult } from "../lib/exec.js";

// Thin wrappers around docker CLI (04 §2, 07 §5, 09 §6). Fixed argument arrays only.

// Volume names come from the platform compose project name `swim` (09 §6)
export const CERTS_VOLUME = "swim_swim-certs";
export const WEBROOT_VOLUME = "swim_swim-webroot";
export const EDGE_NETWORK = "swim-edge";

export const appDir = (slug: string): string =>
  join(config.dataDir, "apps", slug);
export const srcDir = (slug: string): string => join(appDir(slug), "src");
const composeFile = (slug: string): string =>
  join(appDir(slug), "compose.yaml");
const projectName = (slug: string): string => `swim-app-${slug}`;

// 06 §13 — one plain-text log file per deployment, appended across all steps (07 §8)
export const deploymentLogFile = (deploymentId: string): string =>
  join(config.dataDir, "logs/deployments", `${deploymentId}.log`);

export interface ComposeOptions {
  noBuild?: boolean;
  rmi?: boolean;
  onLine?: (line: string) => void;
  redact?: string[];
  signal?: AbortSignal;
}

// docker compose -p swim-app-<slug> -f /data/apps/<slug>/compose.yaml <args> (07 §5)
export const compose = async (
  slug: string,
  args: string[],
  opts: ComposeOptions = {},
): Promise<RunResult> => {
  const full = ["-p", projectName(slug), "-f", composeFile(slug), ...args];
  if (opts.noBuild) full.push("--no-build");
  if (opts.rmi) full.push("--rmi", "local");
  return run("docker", ["compose", ...full], {
    onLine: opts.onLine,
    redact: opts.redact,
    signal: opts.signal,
  });
};

// 07 §6 — docker inspect --format {{.State.Health.Status}} swim-app-<slug>
export const appHealth = async (slug: string): Promise<string> => {
  const res = await run("docker", [
    "inspect",
    "--format",
    "{{.State.Health.Status}}",
    `swim-app-${slug}`,
  ]);
  return res.code === 0 ? res.output.trim() : "missing";
};

export interface AppLogsOptions {
  tail?: number;
  since?: string;
  follow?: boolean;
  onLine?: (line: string) => void;
  signal?: AbortSignal;
}

export const appLogs = async (
  slug: string,
  opts: AppLogsOptions = {},
): Promise<RunResult> => {
  const args = ["logs"];
  if (opts.tail !== undefined) args.push("--tail", String(opts.tail));
  if (opts.since) args.push("--since", opts.since);
  if (opts.follow) args.push("-f");
  args.push(`swim-app-${slug}`);
  return run("docker", args, { onLine: opts.onLine, signal: opts.signal });
};

// 07 §10 step 2: inspect, create when missing — idempotent. A failing CREATE is an
// error (daemon unreachable) — reconciliation must report the truth, not "present".
export const ensureEdgeNetwork = async (): Promise<void> => {
  const inspect = await run("docker", ["network", "inspect", EDGE_NETWORK]);
  if (inspect.code !== 0) {
    const create = await run("docker", ["network", "create", EDGE_NETWORK]);
    if (create.code !== 0)
      throw new Error(
        `docker network create ${EDGE_NETWORK} exited ${create.code}: ${create.output.trim()}`,
      );
  }
};

// 07 §4.3 — image tag swim/<slug>:<sha8>; 08 §6 prunes all but the 5 newest per app
export const appImageTag = (slug: string, sha8: string): string =>
  `swim/${slug}:${sha8}`;

// `docker images swim/<slug>` lists that repo's tags, newest first (the default sort)
export const listAppImages = async (slug: string): Promise<string[]> => {
  const res = await run("docker", [
    "images",
    `swim/${slug}`,
    "--format",
    "{{.Repository}}:{{.Tag}}",
  ]);
  return res.code === 0 ? res.output.split("\n").filter(Boolean) : [];
};

export const removeImage = async (tag: string): Promise<void> => {
  await run("docker", ["rmi", tag]).catch(() => undefined); // tags in use error out — ignore (08 §6)
};

// 07 §10 step 5: crash recovery for live apps — best effort
export const upDetachedNoBuild = (slug: string): Promise<RunResult> =>
  compose(slug, ["up", "-d"], { noBuild: true });

// 09 §6 — exact certbot invocations, issued via docker run (no certbot on the host)
const certbotRun = (certbotArgs: string[]): Promise<RunResult> =>
  run("docker", [
    "run",
    "--rm",
    "-v",
    `${CERTS_VOLUME}:/etc/letsencrypt`,
    "-v",
    `${WEBROOT_VOLUME}:/var/www/certbot`,
    "certbot/certbot:latest",
    ...certbotArgs,
  ]);

export const runCertbot = (
  args: string[],
  onLine?: (line: string) => void,
): Promise<RunResult> =>
  certbotRun(args).then((res) => {
    onLine?.(res.output);
    return res;
  });

export const issueCertArgs = (host: string): string[] => [
  "certonly",
  "--webroot",
  "-w",
  "/var/www/certbot",
  "-d",
  host,
  "--email",
  config.acmeEmail ?? "admin@localhost",
  "--agree-tos",
  "--no-eff-email",
  "--non-interactive",
  "--keep-until-expiring",
];

export const renewCertArgs = (): string[] => [
  "renew",
  "--webroot",
  "-w",
  "/var/www/certbot",
];

// 09 §4 — docker exec swim-nginx nginx -t / nginx -s reload
// 09 §4 — docker exec swim-nginx nginx -t / nginx -s reload
export const reloadNginx = async (args: string[]): Promise<RunResult> =>
  run("docker", ["exec", "swim-nginx", ...args]);

// 05 §4 — app deletion removes the <dataDir>/apps/<slug> tree and that app's deployment log files
export const removeAppData = async (
  slug: string,
  deploymentIds: string[],
): Promise<void> => {
  await rm(appDir(slug), { recursive: true, force: true });
  await Promise.all(
    deploymentIds.map((id) =>
      rm(deploymentLogFile(id), { force: true }).catch(() => undefined),
    ),
  );
};

// compose.yaml template — 07 §4.3 verbatim, deterministic in (slug, sha, port, path, buildType)
export interface ComposeParams {
  slug: string;
  sha8: string;
  port: number;
  healthcheckPath: string;
  buildType: "auto" | "dockerfile" | "node" | "static";
}

export const renderCompose = (p: ComposeParams): string => {
  const repoDockerfile = p.buildType === "dockerfile";
  const build = repoDockerfile
    ? "      context: ./src\n      dockerfile: Dockerfile"
    : "      context: .\n      dockerfile: Dockerfile.swim";
  const url = `http://127.0.0.1:${p.port}${p.healthcheckPath}`;
  return `# generated by Swim — do not edit
services:
  app:
    image: swim/${p.slug}:${p.sha8}
    build:
${build}
    container_name: swim-app-${p.slug}
    restart: unless-stopped
    env_file: .env
    networks:
      - swim-edge
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS ${url} >/dev/null 2>&1 || wget -q --spider ${url} || exit 1"]
      interval: 5s
      timeout: 3s
      retries: 3
      start_period: 10s

networks:
  swim-edge:
    external: true
`;
};

// Generated files live outside the cloned source (07 §4.2) — the service owns /data writes (04 §5)
export const writeCompose = async (p: ComposeParams): Promise<void> => {
  await mkdir(appDir(p.slug), { recursive: true });
  await writeFile(composeFile(p.slug), renderCompose(p), "utf8");
};
