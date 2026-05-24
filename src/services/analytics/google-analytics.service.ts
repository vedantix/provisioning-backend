import { env } from '../../config/env';
import { AppError } from '../../errors/app-error';
import { logger } from '../../lib/logger';
import { GoogleServiceAccountAuth } from './google-auth.service';
import type {
  GoogleAnalyticsDataStreamResult,
  GoogleAnalyticsPropertyResult,
} from './analytics.types';

const ANALYTICS_SCOPE = 'https://www.googleapis.com/auth/analytics.edit';

type GoogleProperty = {
  name?: string;
  parent?: string;
  displayName?: string;
  propertyType?: string;
  deleteTime?: string;
  createTime?: string;
  updateTime?: string;
};

type GoogleDataStream = {
  name?: string;
  displayName?: string;
  type?: string;
  webStreamData?: {
    measurementId?: string;
    defaultUri?: string;
  };
};

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

function toPropertyId(nameOrId: string): string {
  return nameOrId.replace(/^properties\//, '').trim();
}

function toPropertyName(nameOrId: string): string {
  const id = toPropertyId(nameOrId);
  return `properties/${id}`;
}

function toDataStreamId(nameOrId: string): string {
  return nameOrId.split('/').pop()?.trim() || nameOrId.trim();
}

function accountParent(): string {
  const raw = env.googleAnalyticsAccountId?.trim();

  if (!raw) {
    throw new AppError(
      'GOOGLE_ANALYTICS_ACCOUNT_ID is not configured',
      500,
      'GOOGLE_ANALYTICS_CONFIG',
    );
  }

  return raw.startsWith('accounts/') ? raw : `accounts/${raw}`;
}

async function parseJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

export class GoogleAnalyticsService {
  constructor(
    private readonly auth = new GoogleServiceAccountAuth(),
    private readonly baseUrl = trimSlash(env.googleAnalyticsAdminApiBaseUrl),
  ) {}

  async createProperty(input: {
    displayName: string;
    domain: string;
    customerId?: string;
    deploymentId?: string;
  }): Promise<GoogleAnalyticsPropertyResult> {
    const existing = await this.findPropertyByDisplayName(input.displayName);

    if (existing?.name) {
      logger.info('Google Analytics property already exists', {
        provider: 'GOOGLE_ANALYTICS',
        customerId: input.customerId,
        deploymentId: input.deploymentId,
        resourceId: existing.name,
        status: 'REUSED',
      });

      return {
        propertyId: toPropertyId(existing.name),
        propertyName: existing.name,
      };
    }

    const property = await this.request<GoogleProperty>('/properties', {
      method: 'POST',
      body: {
        parent: accountParent(),
        displayName: input.displayName,
        timeZone: env.googleAnalyticsTimezone,
        currencyCode: env.googleAnalyticsCurrency,
        industryCategory: 'OTHER',
      },
    });

    if (!property.name) {
      throw new AppError(
        'Google Analytics property response did not include a property name',
        502,
        'GOOGLE_ANALYTICS_INVALID_RESPONSE',
      );
    }

    logger.info('Google Analytics property created', {
      provider: 'GOOGLE_ANALYTICS',
      customerId: input.customerId,
      deploymentId: input.deploymentId,
      domain: normalizeDomain(input.domain),
      resourceId: property.name,
      status: 'PROVISIONED',
    });

    return {
      propertyId: toPropertyId(property.name),
      propertyName: property.name,
    };
  }

  async createWebDataStream(input: {
    propertyId: string;
    displayName: string;
    domain: string;
    customerId?: string;
    deploymentId?: string;
  }): Promise<GoogleAnalyticsDataStreamResult> {
    const propertyName = toPropertyName(input.propertyId);
    const defaultUri = `https://${normalizeDomain(input.domain)}`;
    const existing = await this.findWebDataStream(propertyName, defaultUri);

    if (existing?.name && existing.webStreamData?.measurementId) {
      return {
        dataStreamId: toDataStreamId(existing.name),
        dataStreamName: existing.name,
        measurementId: existing.webStreamData.measurementId,
      };
    }

    const stream = await this.request<GoogleDataStream>(
      `/${propertyName}/dataStreams`,
      {
        method: 'POST',
        body: {
          displayName: input.displayName,
          type: 'WEB_DATA_STREAM',
          webStreamData: {
            defaultUri,
          },
        },
      },
    );

    if (!stream.name || !stream.webStreamData?.measurementId) {
      throw new AppError(
        'Google Analytics data stream response did not include a Measurement ID',
        502,
        'GOOGLE_ANALYTICS_INVALID_RESPONSE',
      );
    }

    logger.info('Google Analytics web stream created', {
      provider: 'GOOGLE_ANALYTICS',
      customerId: input.customerId,
      deploymentId: input.deploymentId,
      domain: normalizeDomain(input.domain),
      resourceId: stream.name,
      measurementId: stream.webStreamData.measurementId,
      status: 'PROVISIONED',
    });

    return {
      dataStreamId: toDataStreamId(stream.name),
      dataStreamName: stream.name,
      measurementId: stream.webStreamData.measurementId,
    };
  }

  async getMeasurementId(propertyId: string, domain?: string): Promise<string | null> {
    const propertyName = toPropertyName(propertyId);
    const expectedUri = domain ? `https://${normalizeDomain(domain)}` : undefined;
    const stream = await this.findWebDataStream(propertyName, expectedUri);
    return stream?.webStreamData?.measurementId ?? null;
  }

  async getProperty(propertyId: string): Promise<GoogleProperty | null> {
    try {
      return await this.request<GoogleProperty>(`/${toPropertyName(propertyId)}`);
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 404) {
        return null;
      }

      throw error;
    }
  }

  async deleteProperty(propertyId: string): Promise<void> {
    await this.request(`/${toPropertyName(propertyId)}`, {
      method: 'DELETE',
    });
  }

  async reconcileProperty(input: {
    displayName: string;
    domain: string;
    propertyId?: string;
    customerId?: string;
    deploymentId?: string;
  }): Promise<GoogleAnalyticsPropertyResult & GoogleAnalyticsDataStreamResult> {
    let property: GoogleAnalyticsPropertyResult | null = null;

    if (input.propertyId) {
      const existing = await this.getProperty(input.propertyId);
      if (existing?.name) {
        property = {
          propertyId: toPropertyId(existing.name),
          propertyName: existing.name,
        };
      }
    }

    if (!property) {
      property = await this.createProperty(input);
    }

    const stream = await this.createWebDataStream({
      propertyId: property.propertyId,
      displayName: input.displayName,
      domain: input.domain,
      customerId: input.customerId,
      deploymentId: input.deploymentId,
    });

    return {
      ...property,
      ...stream,
    };
  }

  private async findPropertyByDisplayName(displayName: string): Promise<GoogleProperty | null> {
    const response = await this.request<{ properties?: GoogleProperty[] }>(
      `/properties?filter=${encodeURIComponent(`parent:${accountParent()}`)}`,
    );

    return (
      response.properties?.find(
        (property) =>
          property.displayName === displayName && !property.deleteTime,
      ) ?? null
    );
  }

  private async findWebDataStream(
    propertyName: string,
    expectedUri?: string,
  ): Promise<GoogleDataStream | null> {
    const response = await this.request<{ dataStreams?: GoogleDataStream[] }>(
      `/${propertyName}/dataStreams`,
    );

    const webStreams =
      response.dataStreams?.filter((stream) => stream.type === 'WEB_DATA_STREAM') ?? [];

    if (!expectedUri) {
      return webStreams[0] ?? null;
    }

    return (
      webStreams.find(
        (stream) =>
          stream.webStreamData?.defaultUri?.replace(/\/+$/, '').toLowerCase() ===
          expectedUri.replace(/\/+$/, '').toLowerCase(),
      ) ??
      webStreams[0] ??
      null
    );
  }

  private async request<T = Record<string, unknown>>(
    path: string,
    options?: {
      method?: string;
      body?: Record<string, unknown>;
    },
  ): Promise<T> {
    const token = await this.auth.getAccessToken([ANALYTICS_SCOPE]);
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options?.method ?? 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      const payload = await parseJson(response);
      throw new AppError(
        String(
          (payload.error as { message?: string } | undefined)?.message ||
            payload.message ||
            'Google Analytics API request failed',
        ),
        response.status,
        'GOOGLE_ANALYTICS_API_ERROR',
        {
          path,
          status: response.status,
          payload,
        },
      );
    }

    return (await response.json().catch(() => ({}))) as T;
  }
}
