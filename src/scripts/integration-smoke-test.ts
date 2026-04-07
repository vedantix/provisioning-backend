// src/scripts/integration-smoke-test.ts

type JsonObject = Record<string, unknown>;

type ApiEnvelope<T = JsonObject> = {
  data?: T;
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, unknown> | null;
  };
  requestId?: string;
};

type CreateDeploymentResponse = {
  deploymentId: string;
  operationId: string;
  status: string;
  currentStage: string | null;
};

type OperationResponse = {
  operation: {
    operationId: string;
    deploymentId: string;
    status: 'ACCEPTED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
    type: string;
    errorCode?: string;
    errorMessage?: string;
    requestedStage?: string;
    createdAt: string;
    updatedAt: string;
    startedAt?: string;
    completedAt?: string;
  };
  deployment: {
    deploymentId: string;
    status: string;
    currentStage: string | null;
    lastSuccessfulStage: string | null;
    failureStage: string | null;
    updatedAt: string;
  } | null;
};

type DeploymentResponse = {
  deploymentId: string;
  tenantId: string;
  customerId: string;
  status: string;
  currentStage?: string;
  lastSuccessfulStage?: string;
  failureStage?: string;
  managedResources?: Record<string, unknown>;
  stageStates?: Record<string, unknown>;
  updatedAt?: string;
};

type AuditListResponse = {
  deploymentId: string;
  events: Array<{
    auditEventId: string;
    eventType: string;
    createdAt: string;
    metadata?: Record<string, unknown>;
  }>;
};

type OperationListResponse = {
  deploymentId: string;
  operations: Array<{
    operationId: string;
    type: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  }>;
};

const BASE_URL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
const TENANT_ID = process.env.TEST_TENANT_ID ?? 'tenant_test_001';
const ACTOR_ID = process.env.TEST_ACTOR_ID ?? 'actor_test_001';
const SOURCE = process.env.TEST_SOURCE ?? 'API';
const PACKAGE_CODE = process.env.TEST_PACKAGE_CODE ?? 'STARTER';
const CUSTOMER_ID = process.env.TEST_CUSTOMER_ID ?? 'cust_test_001';
const DOMAIN =
  process.env.TEST_DOMAIN ??
  `test-${Date.now()}.jouwdomein.nl`;
const PROJECT_NAME =
  process.env.TEST_PROJECT_NAME ?? `vedantix-test-${Date.now()}`;
const POLL_INTERVAL_MS = Number(process.env.TEST_POLL_INTERVAL_MS ?? 5000);
const POLL_TIMEOUT_MS = Number(process.env.TEST_POLL_TIMEOUT_MS ?? 15 * 60 * 1000);
const RUN_REDEPLOY = (process.env.TEST_RUN_REDEPLOY ?? 'false').toLowerCase() === 'true';
const RUN_DELETE = (process.env.TEST_RUN_DELETE ?? 'false').toLowerCase() === 'true';
const RUN_RESUME = (process.env.TEST_RUN_RESUME ?? 'false').toLowerCase() === 'true';
const RUN_RETRY_STAGE = (process.env.TEST_RUN_RETRY_STAGE ?? '').trim();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function headers(extra?: Record<string, string>): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'X-Tenant-Id': TENANT_ID,
    'X-Actor-Id': ACTOR_ID,
    'X-Source': SOURCE,
    ...extra,
  };
}

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: ApiEnvelope<T> | JsonObject | null }> {
  const res = await fetch(`${BASE_URL}${path}`, init);

  const text = await res.text();
  let body: ApiEnvelope<T> | JsonObject | null = null;

  if (text) {
    try {
      body = JSON.parse(text) as ApiEnvelope<T> | JsonObject;
    } catch {
      body = { raw: text };
    }
  }

  return {
    status: res.status,
    body,
  };
}

function isApiEnvelope<T>(value: unknown): value is ApiEnvelope<T> {
  return typeof value === 'object' && value !== null;
}

function ensure2xx(
  label: string,
  status: number,
  body: unknown,
): void {
  if (status < 200 || status >= 300) {
    throw new Error(
      `${label} failed with status ${status}: ${JSON.stringify(body, null, 2)}`,
    );
  }
}

function logStep(title: string): void {
  console.log(`\n=== ${title} ===`);
}

async function getHealth(): Promise<void> {
  logStep('Health');
  const { status, body } = await request('/health');
  ensure2xx('GET /health', status, body);
  console.log(JSON.stringify(body, null, 2));
}

async function getReady(): Promise<void> {
  logStep('Readiness');
  const { status, body } = await request('/ready');
  ensure2xx('GET /ready', status, body);
  console.log(JSON.stringify(body, null, 2));
}

async function createDeployment(): Promise<CreateDeploymentResponse> {
  logStep('Create deployment');

  const idempotencyKey = `integration-${CUSTOMER_ID}-${DOMAIN}`;

  const { status, body } = await request<CreateDeploymentResponse>(
    '/api/deployments',
    {
      method: 'POST',
      headers: headers({
        'Idempotency-Key': idempotencyKey,
      }),
      body: JSON.stringify({
        customerId: CUSTOMER_ID,
        projectName: PROJECT_NAME,
        domain: DOMAIN,
        packageCode: PACKAGE_CODE,
        addOns: [],
      }),
    },
  );

  ensure2xx('POST /api/deployments', status, body);

  if (!isApiEnvelope<CreateDeploymentResponse>(body) || !body.data) {
    throw new Error(`Unexpected create deployment response: ${JSON.stringify(body, null, 2)}`);
  }

  console.log(JSON.stringify(body, null, 2));
  return body.data;
}

async function getOperation(operationId: string): Promise<OperationResponse> {
  const { status, body } = await request<OperationResponse>(
    `/api/operations/${operationId}`,
    {
      method: 'GET',
      headers: headers(),
    },
  );

  ensure2xx(`GET /api/operations/${operationId}`, status, body);

  if (!isApiEnvelope<OperationResponse>(body) || !body.data) {
    throw new Error(`Unexpected operation response: ${JSON.stringify(body, null, 2)}`);
  }

  return body.data;
}

async function getDeployment(deploymentId: string): Promise<DeploymentResponse> {
  const { status, body } = await request<DeploymentResponse>(
    `/api/deployments/${deploymentId}`,
    {
      method: 'GET',
      headers: headers(),
    },
  );

  ensure2xx(`GET /api/deployments/${deploymentId}`, status, body);

  if (!isApiEnvelope<DeploymentResponse>(body) || !body.data) {
    throw new Error(`Unexpected deployment response: ${JSON.stringify(body, null, 2)}`);
  }

  return body.data;
}

async function getDeploymentOperations(
  deploymentId: string,
): Promise<OperationListResponse> {
  const { status, body } = await request<OperationListResponse>(
    `/api/deployments/${deploymentId}/operations`,
    {
      method: 'GET',
      headers: headers(),
    },
  );

  ensure2xx(`GET /api/deployments/${deploymentId}/operations`, status, body);

  if (!isApiEnvelope<OperationListResponse>(body) || !body.data) {
    throw new Error(`Unexpected operations list response: ${JSON.stringify(body, null, 2)}`);
  }

  return body.data;
}

async function getDeploymentAudit(
  deploymentId: string,
): Promise<AuditListResponse> {
  const { status, body } = await request<AuditListResponse>(
    `/api/deployments/${deploymentId}/audit`,
    {
      method: 'GET',
      headers: headers(),
    },
  );

  ensure2xx(`GET /api/deployments/${deploymentId}/audit`, status, body);

  if (!isApiEnvelope<AuditListResponse>(body) || !body.data) {
    throw new Error(`Unexpected audit response: ${JSON.stringify(body, null, 2)}`);
  }

  return body.data;
}

async function waitForOperationTerminal(operationId: string): Promise<OperationResponse> {
  logStep(`Poll operation ${operationId}`);

  const started = Date.now();

  while (Date.now() - started < POLL_TIMEOUT_MS) {
    const op = await getOperation(operationId);

    console.log(
      JSON.stringify(
        {
          operationId: op.operation.operationId,
          type: op.operation.type,
          status: op.operation.status,
          deploymentStatus: op.deployment?.status ?? null,
          currentStage: op.deployment?.currentStage ?? null,
          lastSuccessfulStage: op.deployment?.lastSuccessfulStage ?? null,
          failureStage: op.deployment?.failureStage ?? null,
          updatedAt: op.deployment?.updatedAt ?? null,
        },
        null,
        2,
      ),
    );

    if (
      op.operation.status === 'SUCCEEDED' ||
      op.operation.status === 'FAILED' ||
      op.operation.status === 'CANCELLED'
    ) {
      return op;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`Operation ${operationId} did not reach terminal state within timeout`);
}

async function resumeDeployment(deploymentId: string): Promise<string> {
  logStep('Resume deployment');

  const { status, body } = await request<{ operationId: string; deploymentId: string; status: string }>(
    `/api/deployments/${deploymentId}/resume`,
    {
      method: 'POST',
      headers: headers(),
    },
  );

  ensure2xx(`POST /api/deployments/${deploymentId}/resume`, status, body);

  if (!isApiEnvelope<{ operationId: string }>(body) || !body.data?.operationId) {
    throw new Error(`Unexpected resume response: ${JSON.stringify(body, null, 2)}`);
  }

  console.log(JSON.stringify(body, null, 2));
  return body.data.operationId;
}

async function retryStage(deploymentId: string, stage: string): Promise<string> {
  logStep(`Retry stage ${stage}`);

  const { status, body } = await request<{ operationId: string; deploymentId: string; status: string }>(
    `/api/deployments/${deploymentId}/retry/${stage}`,
    {
      method: 'POST',
      headers: headers(),
    },
  );

  ensure2xx(`POST /api/deployments/${deploymentId}/retry/${stage}`, status, body);

  if (!isApiEnvelope<{ operationId: string }>(body) || !body.data?.operationId) {
    throw new Error(`Unexpected retry response: ${JSON.stringify(body, null, 2)}`);
  }

  console.log(JSON.stringify(body, null, 2));
  return body.data.operationId;
}

async function redeploy(deploymentId: string): Promise<string> {
  logStep('Redeploy');

  const { status, body } = await request<{ operationId: string; deploymentId: string; status: string }>(
    `/api/deployments/${deploymentId}/redeploy`,
    {
      method: 'POST',
      headers: headers(),
    },
  );

  ensure2xx(`POST /api/deployments/${deploymentId}/redeploy`, status, body);

  if (!isApiEnvelope<{ operationId: string }>(body) || !body.data?.operationId) {
    throw new Error(`Unexpected redeploy response: ${JSON.stringify(body, null, 2)}`);
  }

  console.log(JSON.stringify(body, null, 2));
  return body.data.operationId;
}

async function deleteDeployment(deploymentId: string): Promise<string> {
  logStep('Delete deployment');

  const { status, body } = await request<{ operationId: string; deploymentId: string; status: string }>(
    `/api/deployments/${deploymentId}/delete`,
    {
      method: 'POST',
      headers: headers(),
    },
  );

  ensure2xx(`POST /api/deployments/${deploymentId}/delete`, status, body);

  if (!isApiEnvelope<{ operationId: string }>(body) || !body.data?.operationId) {
    throw new Error(`Unexpected delete response: ${JSON.stringify(body, null, 2)}`);
  }

  console.log(JSON.stringify(body, null, 2));
  return body.data.operationId;
}

async function printDeploymentArtifacts(deploymentId: string): Promise<void> {
  logStep('Deployment details');
  const deployment = await getDeployment(deploymentId);
  console.log(JSON.stringify(deployment, null, 2));

  logStep('Deployment operations');
  const operations = await getDeploymentOperations(deploymentId);
  console.log(JSON.stringify(operations, null, 2));

  logStep('Deployment audit');
  const audit = await getDeploymentAudit(deploymentId);
  console.log(JSON.stringify(audit, null, 2));
}

async function main(): Promise<void> {
  console.log(
    JSON.stringify(
      {
        baseUrl: BASE_URL,
        tenantId: TENANT_ID,
        actorId: ACTOR_ID,
        customerId: CUSTOMER_ID,
        domain: DOMAIN,
        packageCode: PACKAGE_CODE,
        runRedeploy: RUN_REDEPLOY,
        runDelete: RUN_DELETE,
        runResume: RUN_RESUME,
        runRetryStage: RUN_RETRY_STAGE || null,
      },
      null,
      2,
    ),
  );

  await getHealth();
  await getReady();

  const created = await createDeployment();
  const deploymentId = created.deploymentId;
  let operationId = created.operationId;

  const createResult = await waitForOperationTerminal(operationId);
  await printDeploymentArtifacts(deploymentId);

  if (createResult.operation.status === 'FAILED' && RUN_RESUME) {
    operationId = await resumeDeployment(deploymentId);
    await waitForOperationTerminal(operationId);
    await printDeploymentArtifacts(deploymentId);
  }

  if (RUN_RETRY_STAGE) {
    operationId = await retryStage(deploymentId, RUN_RETRY_STAGE);
    await waitForOperationTerminal(operationId);
    await printDeploymentArtifacts(deploymentId);
  }

  if (RUN_REDEPLOY) {
    operationId = await redeploy(deploymentId);
    await waitForOperationTerminal(operationId);
    await printDeploymentArtifacts(deploymentId);
  }

  if (RUN_DELETE) {
    operationId = await deleteDeployment(deploymentId);
    await waitForOperationTerminal(operationId);
    await printDeploymentArtifacts(deploymentId);
  }

  console.log('\n=== DONE ===');
  console.log(
    JSON.stringify(
      {
        deploymentId,
        lastOperationId: operationId,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error('\n=== TEST FAILED ===');
  console.error(error);
  process.exit(1);
});