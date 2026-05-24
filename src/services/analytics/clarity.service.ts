import { env } from '../../config/env';
import { AppError } from '../../errors/app-error';
import { logger } from '../../lib/logger';
import type { ClarityProvisionResult } from './analytics.types';

type ClarityCreateProjectResponse = {
  id?: string;
  projectId?: string;
  project_id?: string;
  trackingCode?: string;
  tracking_code?: string;
};

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function normalizePath(value: string): string {
  return value.startsWith('/') ? value : `/${value}`;
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

export function buildClarityTrackingCode(projectId: string): string {
  return `(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","${projectId}");`;
}

export class ClarityService {
  constructor(
    private readonly baseUrl = env.clarityApiBaseUrl
      ? trimSlash(env.clarityApiBaseUrl)
      : undefined,
    private readonly apiToken = env.clarityApiToken,
    private readonly projectsPath = normalizePath(env.clarityProjectsPath),
    private readonly required = env.clarityRequired,
  ) {}

  async createProject(input: {
    displayName: string;
    domain: string;
    customerId?: string;
    deploymentId?: string;
  }): Promise<ClarityProvisionResult> {
    if (!this.baseUrl || !this.apiToken) {
      const reason =
        'Microsoft Clarity does not expose a stable public project-provisioning API in the configured environment. Set CLARITY_API_BASE_URL and CLARITY_API_TOKEN when a supported internal/partner endpoint is available.';

      if (this.required) {
        throw new AppError(reason, 501, 'CLARITY_API_NOT_CONFIGURED');
      }

      logger.warn('Clarity project provisioning skipped', {
        provider: 'CLARITY',
        customerId: input.customerId,
        deploymentId: input.deploymentId,
        domain: normalizeDomain(input.domain),
        status: 'SKIPPED',
        reason,
      });

      return {
        skipped: true,
        reason,
      };
    }

    const response = await fetch(`${this.baseUrl}${this.projectsPath}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: input.displayName,
        siteUrl: `https://${normalizeDomain(input.domain)}`,
        domain: normalizeDomain(input.domain),
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as ClarityCreateProjectResponse & {
      message?: string;
      error?: string;
    };

    if (!response.ok) {
      throw new AppError(
        payload.message || payload.error || 'Microsoft Clarity project request failed',
        response.status,
        'CLARITY_API_ERROR',
        {
          status: response.status,
          payload,
        },
      );
    }

    const projectId = payload.projectId || payload.project_id || payload.id;

    if (!projectId) {
      throw new AppError(
        'Microsoft Clarity project response did not include a project ID',
        502,
        'CLARITY_INVALID_RESPONSE',
        { payload },
      );
    }

    const trackingCode =
      payload.trackingCode || payload.tracking_code || buildClarityTrackingCode(projectId);

    logger.info('Clarity project created or reused', {
      provider: 'CLARITY',
      customerId: input.customerId,
      deploymentId: input.deploymentId,
      domain: normalizeDomain(input.domain),
      resourceId: projectId,
      status: 'PROVISIONED',
    });

    return {
      projectId,
      trackingCode,
    };
  }

  getTrackingCode(projectId: string): string {
    return buildClarityTrackingCode(projectId);
  }

  async deleteProject(projectId: string): Promise<void> {
    if (!this.baseUrl || !this.apiToken) {
      logger.warn('Clarity delete skipped because no API endpoint is configured', {
        provider: 'CLARITY',
        resourceId: projectId,
        status: 'SKIPPED',
      });
      return;
    }

    await fetch(`${this.baseUrl}${this.projectsPath}/${encodeURIComponent(projectId)}`, {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${this.apiToken}`,
      },
    });
  }

  async reconcileProject(input: {
    displayName: string;
    domain: string;
    existingProjectId?: string;
    customerId?: string;
    deploymentId?: string;
  }): Promise<ClarityProvisionResult> {
    if (input.existingProjectId) {
      return {
        projectId: input.existingProjectId,
        trackingCode: this.getTrackingCode(input.existingProjectId),
      };
    }

    return this.createProject(input);
  }
}
