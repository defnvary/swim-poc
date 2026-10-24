// server/src/db/migrations/20260101000000-init.ts — the only migration at release
import type { Migration } from '../migrate.js';

export const up: Migration = async ({ context }) => {
  await context.query(`
  CREATE TYPE "enum_Users_role" AS ENUM ('admin', 'member', 'viewer');
  CREATE TYPE "enum_Apps_buildType" AS ENUM ('auto', 'dockerfile', 'node', 'static');
  CREATE TYPE "enum_Apps_status" AS ENUM ('created', 'building', 'live', 'failed', 'stopped');
  CREATE TYPE "enum_Deployments_status" AS ENUM ('queued', 'fetching', 'building', 'deploying', 'live', 'failed');
  CREATE TYPE "enum_Deployments_trigger" AS ENUM ('webhook', 'manual');
  CREATE TYPE "enum_Domains_certStatus" AS ENUM ('pending', 'issued', 'failed');

  CREATE TABLE "Users" (
    "id" UUID PRIMARY KEY,
    "username" VARCHAR(255) NOT NULL UNIQUE,
    "passwordHash" VARCHAR(255) NOT NULL,
    "role" "enum_Users_role" NOT NULL DEFAULT 'member',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL
  );

  CREATE TABLE "RefreshTokens" (
    "id" UUID PRIMARY KEY,
    "familyId" UUID NOT NULL,
    "userId" UUID NOT NULL REFERENCES "Users"("id") ON DELETE CASCADE,
    "tokenHash" VARCHAR(255) NOT NULL UNIQUE,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "revokedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL
  );
  CREATE INDEX "RefreshTokens_familyId" ON "RefreshTokens" ("familyId");

  CREATE TABLE "Apps" (
    "id" UUID PRIMARY KEY,
    "name" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(255) NOT NULL UNIQUE,
    "repoOwner" VARCHAR(255) NOT NULL,
    "repoName" VARCHAR(255) NOT NULL,
    "branch" VARCHAR(255) NOT NULL DEFAULT 'main',
    "port" INTEGER NOT NULL DEFAULT 3000,
    "healthcheckPath" VARCHAR(255) NOT NULL DEFAULT '/',
    "buildType" "enum_Apps_buildType" NOT NULL DEFAULT 'auto',
    "autoDeploy" BOOLEAN NOT NULL DEFAULT true,
    "accessTokenEnc" VARCHAR(255),
    "webhookSecretEnc" VARCHAR(255) NOT NULL,
    "hookId" UUID NOT NULL UNIQUE,
    "status" "enum_Apps_status" NOT NULL DEFAULT 'created',
    "currentDeploymentId" UUID,
    "createdById" UUID NOT NULL REFERENCES "Users"("id"),
    "createdAt" TIMESTAMPTZ NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL
  );
  CREATE INDEX "Apps_createdById" ON "Apps" ("createdById");

  CREATE TABLE "Deployments" (
    "id" UUID PRIMARY KEY,
    "appId" UUID NOT NULL REFERENCES "Apps"("id") ON DELETE CASCADE,
    "commitSha" CHAR(40) NOT NULL,
    "commitMessage" VARCHAR(255),
    "author" VARCHAR(255),
    "branch" VARCHAR(255) NOT NULL,
    "status" "enum_Deployments_status" NOT NULL DEFAULT 'queued',
    "trigger" "enum_Deployments_trigger" NOT NULL,
    "userId" UUID REFERENCES "Users"("id"),
    "error" TEXT,
    "startedAt" TIMESTAMPTZ,
    "finishedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL
  );
  CREATE INDEX "Deployments_appId_createdAt" ON "Deployments" ("appId", "createdAt");
  CREATE INDEX "Deployments_status" ON "Deployments" ("status");

  -- Apps.currentDeploymentId → Deployments: added after Deployments exists (circular reference, no cascade)
  ALTER TABLE "Apps" ADD CONSTRAINT "Apps_currentDeploymentId"
    FOREIGN KEY ("currentDeploymentId") REFERENCES "Deployments"("id");

  CREATE TABLE "Domains" (
    "id" UUID PRIMARY KEY,
    "appId" UUID NOT NULL REFERENCES "Apps"("id") ON DELETE CASCADE,
    "host" VARCHAR(255) NOT NULL UNIQUE,
    "certStatus" "enum_Domains_certStatus" NOT NULL DEFAULT 'pending',
    "certIssuedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL
  );
  CREATE INDEX "Domains_appId" ON "Domains" ("appId");

  CREATE TABLE "EnvVars" (
    "appId" UUID NOT NULL REFERENCES "Apps"("id") ON DELETE CASCADE,
    "key" VARCHAR(255) NOT NULL,
    "valueEnc" VARCHAR(255) NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    PRIMARY KEY ("appId", "key")
  );

  CREATE TABLE "Events" (
    "id" UUID PRIMARY KEY,
    "userId" UUID REFERENCES "Users"("id") ON DELETE SET NULL,
    "action" VARCHAR(255) NOT NULL,
    "targetType" VARCHAR(255),
    "targetId" VARCHAR(255),
    "details" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL
  );
  CREATE INDEX "Events_createdAt" ON "Events" ("createdAt");
  CREATE INDEX "Events_action" ON "Events" ("action");
  `);
};

export const down: Migration = async ({ context }) => {
  await context.query(`
  DROP TABLE IF EXISTS "Events", "EnvVars", "Domains", "Deployments", "Apps", "RefreshTokens", "Users" CASCADE;
  DROP TYPE IF EXISTS "enum_Users_role";
  DROP TYPE IF EXISTS "enum_Apps_buildType";
  DROP TYPE IF EXISTS "enum_Apps_status";
  DROP TYPE IF EXISTS "enum_Deployments_status";
  DROP TYPE IF EXISTS "enum_Deployments_trigger";
  DROP TYPE IF EXISTS "enum_Domains_certStatus";
  `);
};
