import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { env } from "../../config/env";
import type {
  AddOnInput,
  PackageCode,
  ResolvedPlan,
} from "../../types/package.types";

const client = new DynamoDBClient({ region: env.awsRegion });
const docClient = DynamoDBDocumentClient.from(client);

export type LifecycleStatus =
  | "QUEUED"
  | "RUNNING"
  | "FAILED"
  | "SUCCEEDED"
  | "DELETED";

export type DeploymentType =
  | "INITIAL_DEPLOY"
  | "ADD_DOMAIN"
  | "PACKAGE_UPGRADE"
  | "REDEPLOY"
  | "ROLLBACK"
  | "DELETE_EVERYTHING"
  | "ADD_MAILBOX";

export type JobType =
  | "DEPLOYMENT"
  | "ADD_DOMAIN"
  | "PACKAGE_UPGRADE"
  | "REDEPLOY"
  | "ROLLBACK"
  | "DELETE_EVERYTHING"
  | "ADD_MAILBOX";

export type DeploymentRecord = {
  id: string;
  customerId: string;

  deploymentType?: DeploymentType;
  status?: LifecycleStatus;
  currentStage?: string;
  failedStage?: string;

  projectName?: string;
  primaryDomain?: string;
  domains?: string[];

  packageCode?: PackageCode;
  currentPackageCode?: PackageCode;
  addOns?: AddOnInput[];
  planSnapshot?: ResolvedPlan | Record<string, unknown>;
  pendingPlanSnapshot?: ResolvedPlan | Record<string, unknown>;

  repo?: string;
  repoUrl?: string;
  defaultBranch?: string;

  bucketName?: string;
  bucketRegion?: string;
  bucketRegionalDomainName?: string;

  cloudfrontDistributionId?: string;
  cloudfrontDistributionArn?: string;
  cloudfrontDomainName?: string;
  cloudfrontAliases?: string[];
  oacId?: string;

  certificateArn?: string;
  pendingCertificateArn?: string;
  certificateDomains?: string[];
  certificateStatus?: string;

  rollbackTargetRef?: string;
  queuedMessageId?: string;

  deployedAt?: string;
  deletedAt?: string;

  lastError?: string;
  lastErrorDetails?: unknown;

  metadata?: Record<string, unknown>;

  domainEvents?: unknown[];
  packageEvents?: unknown[];
  mailboxRequests?: unknown[];
  deletionEvents?: unknown[];
  deploymentEvents?: unknown[];

  createdAt?: string;
  updatedAt?: string;

  [key: string]: unknown;
};

export type JobRecord = {
  id: string;
  customerId: string;

  deploymentId?: string;
  jobType?: JobType;
  status?: LifecycleStatus;
  currentStage?: string;
  failedStage?: string;

  payload?: unknown;
  queuedMessageId?: string;
  initiatedBy?: string;

  stages?: unknown[];

  completedAt?: string;
  lastError?: string;
  lastErrorDetails?: unknown;

  createdAt?: string;
  updatedAt?: string;

  [key: string]: unknown;
};

type UpdateItemParams = {
  tableName: string;
  key: Record<string, unknown>;
  set?: Record<string, unknown | undefined>;
  remove?: string[];
  appendToLists?: Record<string, unknown[] | undefined>;
};

function nowIso(): string {
  return new Date().toISOString();
}

function compactUndefined(
  input: Record<string, unknown | undefined>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  );
}

export async function putDeployment(item: Record<string, unknown>): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: env.deploymentsTable,
      Item: item,
    })
  );
}

export async function getDeploymentById(
  deploymentId: string
): Promise<DeploymentRecord | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: env.deploymentsTable,
      Key: {
        id: deploymentId,
      },
    })
  );

  return (result.Item as DeploymentRecord | undefined) ?? null;
}

export async function putJob(item: Record<string, unknown>): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: env.jobsTable,
      Item: item,
    })
  );
}

export async function getJobById(jobId: string): Promise<JobRecord | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: env.jobsTable,
      Key: {
        id: jobId,
      },
    })
  );

  return (result.Item as JobRecord | undefined) ?? null;
}

async function updateItem(params: UpdateItemParams): Promise<void> {
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const setParts: string[] = [];
  const removeParts: string[] = [];
  const appendParts: string[] = [];

  let nameIndex = 0;
  let valueIndex = 0;

  for (const [field, value] of Object.entries(params.set ?? {})) {
    if (value === undefined) {
      continue;
    }

    const nameKey = `#n${nameIndex++}`;
    const valueKey = `:v${valueIndex++}`;

    names[nameKey] = field;
    values[valueKey] = value;
    setParts.push(`${nameKey} = ${valueKey}`);
  }

  for (const field of params.remove ?? []) {
    const nameKey = `#n${nameIndex++}`;
    names[nameKey] = field;
    removeParts.push(nameKey);
  }

  for (const [field, listValues] of Object.entries(params.appendToLists ?? {})) {
    if (!listValues || listValues.length === 0) {
      continue;
    }

    const nameKey = `#n${nameIndex++}`;
    const valueKey = `:v${valueIndex++}`;
    const emptyListKey = `:v${valueIndex++}`;

    names[nameKey] = field;
    values[valueKey] = listValues;
    values[emptyListKey] = [];

    appendParts.push(
      `${nameKey} = list_append(if_not_exists(${nameKey}, ${emptyListKey}), ${valueKey})`
    );
  }

  const updateExpressions: string[] = [];

  if (setParts.length || appendParts.length) {
    updateExpressions.push(`SET ${[...setParts, ...appendParts].join(", ")}`);
  }

  if (removeParts.length) {
    updateExpressions.push(`REMOVE ${removeParts.join(", ")}`);
  }

  if (!updateExpressions.length) {
    return;
  }

  await docClient.send(
    new UpdateCommand({
      TableName: params.tableName,
      Key: params.key,
      UpdateExpression: updateExpressions.join(" "),
      ...(Object.keys(names).length > 0
        ? { ExpressionAttributeNames: names }
        : {}),
      ...(Object.keys(values).length > 0
        ? { ExpressionAttributeValues: values }
        : {}),
    })
  );
}

export async function updateDeployment(params: {
  deploymentId: string;
  set?: Record<string, unknown | undefined>;
  remove?: string[];
  appendToLists?: Record<string, unknown[] | undefined>;
}): Promise<void> {
  await updateItem({
    tableName: env.deploymentsTable,
    key: { id: params.deploymentId },
    set: compactUndefined({
      ...(params.set ?? {}),
      updatedAt: params.set?.updatedAt ?? nowIso(),
    }),
    remove: params.remove,
    appendToLists: params.appendToLists,
  });
}

export async function updateJob(params: {
  jobId: string;
  set?: Record<string, unknown | undefined>;
  remove?: string[];
  appendToLists?: Record<string, unknown[] | undefined>;
}): Promise<void> {
  await updateItem({
    tableName: env.jobsTable,
    key: { id: params.jobId },
    set: compactUndefined({
      ...(params.set ?? {}),
      updatedAt: params.set?.updatedAt ?? nowIso(),
    }),
    remove: params.remove,
    appendToLists: params.appendToLists,
  });
}