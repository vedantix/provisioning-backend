import { env } from '../../config/env';
import { AppError } from '../../errors/app-error';
import { logger } from '../../lib/logger';
import { GoogleServiceAccountAuth } from './google-auth.service';
import type {
  GoogleAdsConversionEvent,
  GoogleAdsConversionState,
  GoogleAdsProvisionResult,
} from './analytics.types';

const GOOGLE_ADS_SCOPE = 'https://www.googleapis.com/auth/adwords';

const CONVERSION_EVENTS: Array<{
  event: GoogleAdsConversionEvent;
  suffix: string;
  category: string;
  enhancedConversionsForLeads: boolean;
}> = [
  { event: 'LEAD', suffix: 'Lead', category: 'SUBMIT_LEAD_FORM', enhancedConversionsForLeads: true },
  { event: 'WHATSAPP_CLICK', suffix: 'WhatsApp click', category: 'CONTACT', enhancedConversionsForLeads: true },
  { event: 'CONTACT_FORM', suffix: 'Contact form', category: 'SUBMIT_LEAD_FORM', enhancedConversionsForLeads: true },
  { event: 'BOOKING', suffix: 'Booking', category: 'BOOK_APPOINTMENT', enhancedConversionsForLeads: true },
  { event: 'PURCHASE', suffix: 'Purchase', category: 'PURCHASE', enhancedConversionsForLeads: false },
];

type GoogleAdsMutateResponse = {
  results?: Array<{ resourceName?: string }>;
};

type GoogleAdsSearchStreamResponse = Array<{
  results?: Array<{
    conversionAction?: {
      id?: string;
      name?: string;
      resourceName?: string;
      tagSnippets?: Array<{
        type?: string;
        globalSiteTag?: string;
        eventSnippet?: string;
      }>;
    };
  }>;
}>;

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function normalizeCustomerId(value: string): string {
  return value.replace(/-/g, '').trim();
}

function requireConfig(name: string, value?: string): string {
  if (!value?.trim()) {
    throw new AppError(
      `${name} is not configured`,
      500,
      'GOOGLE_ADS_CONFIG',
      { required: [name] },
    );
  }

  return value.trim();
}

function parseConversionActionId(resourceName?: string): string | undefined {
  return resourceName?.split('/').pop();
}

function parseConversionId(globalSiteTag?: string, eventSnippet?: string): string | undefined {
  const source = `${globalSiteTag || ''}\n${eventSnippet || ''}`;
  return source.match(/AW-([0-9]+)/)?.[1];
}

function parseConversionLabel(eventSnippet?: string): string | undefined {
  const match = eventSnippet?.match(/AW-[0-9]+\/([A-Za-z0-9_-]+)/);
  return match?.[1];
}

function nowIso(): string {
  return new Date().toISOString();
}

export class GoogleAdsService {
  constructor(
    private readonly auth = new GoogleServiceAccountAuth(),
    private readonly baseUrl = trimSlash(env.googleAdsApiBaseUrl),
    private readonly version = env.googleAdsApiVersion,
  ) {}

  async reconcileConversions(input: {
    displayName: string;
    domain: string;
    customerId?: string;
    deploymentId?: string;
    existingConversions?: GoogleAdsConversionState[];
  }): Promise<GoogleAdsProvisionResult> {
    const googleAdsCustomerId = normalizeCustomerId(
      requireConfig('GOOGLE_ADS_CUSTOMER_ID', env.googleAdsCustomerId),
    );
    requireConfig('GOOGLE_ADS_DEVELOPER_TOKEN', env.googleAdsDeveloperToken);

    const conversions: GoogleAdsConversionState[] = [];

    for (const definition of CONVERSION_EVENTS) {
      const conversionName = `${input.displayName} - ${definition.suffix}`;
      const existing = input.existingConversions?.find(
        (conversion) => conversion.event === definition.event,
      );

      const conversion = await this.reconcileConversionAction({
        googleAdsCustomerId,
        conversionName,
        event: definition.event,
        category: definition.category,
        enhancedConversionsForLeads: definition.enhancedConversionsForLeads,
        existing,
        customerId: input.customerId,
        deploymentId: input.deploymentId,
        domain: input.domain,
      });

      conversions.push(conversion);
    }

    return {
      customerId: googleAdsCustomerId,
      conversionId: conversions.find((conversion) => conversion.conversionId)?.conversionId,
      conversions,
    };
  }

  buildTrackingEnvironment(input: GoogleAdsProvisionResult): Record<string, string> {
    const labels: Record<string, string> = {};

    for (const conversion of input.conversions) {
      if (conversion.conversionLabel) {
        labels[conversion.event] = conversion.conversionLabel;
      }
    }

    const envVars: Record<string, string> = {
      VITE_GOOGLE_ADS_CUSTOMER_ID: input.customerId,
      NEXT_PUBLIC_GOOGLE_ADS_CUSTOMER_ID: input.customerId,
    };

    if (input.conversionId) {
      envVars.VITE_GOOGLE_ADS_CONVERSION_ID = input.conversionId;
      envVars.NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_ID = input.conversionId;
    }

    if (Object.keys(labels).length > 0) {
      envVars.VITE_GOOGLE_ADS_CONVERSION_LABELS = JSON.stringify(labels);
      envVars.NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_LABELS = JSON.stringify(labels);
    }

    return envVars;
  }

  private async reconcileConversionAction(input: {
    googleAdsCustomerId: string;
    conversionName: string;
    event: GoogleAdsConversionEvent;
    category: string;
    enhancedConversionsForLeads: boolean;
    existing?: GoogleAdsConversionState;
    customerId?: string;
    deploymentId?: string;
    domain: string;
  }): Promise<GoogleAdsConversionState> {
    const existingResourceName =
      input.existing?.conversionActionResourceName ||
      (input.existing?.conversionActionId
        ? `customers/${input.googleAdsCustomerId}/conversionActions/${input.existing.conversionActionId}`
        : undefined);

    const resourceName =
      existingResourceName ||
      (await this.findConversionActionByName(
        input.googleAdsCustomerId,
        input.conversionName,
      )) ||
      (await this.createConversionAction(input));

    const hydrated = await this.getConversionAction(
      input.googleAdsCustomerId,
      resourceName,
    );

    const tagSnippet = hydrated.tagSnippets?.find((snippet) => snippet.eventSnippet) ||
      hydrated.tagSnippets?.[0];
    const conversionId = parseConversionId(
      tagSnippet?.globalSiteTag,
      tagSnippet?.eventSnippet,
    );

    logger.info('Google Ads conversion action provisioned', {
      provider: 'GOOGLE_ADS',
      customerId: input.customerId,
      deploymentId: input.deploymentId,
      domain: input.domain,
      resourceId: resourceName,
      event: input.event,
      status: 'SUCCEEDED',
    });

    return {
      event: input.event,
      conversionActionId: parseConversionActionId(resourceName),
      conversionActionResourceName: resourceName,
      conversionId,
      conversionLabel: parseConversionLabel(tagSnippet?.eventSnippet),
      conversionName: hydrated.name || input.conversionName,
      enhancedConversionsForLeadsEnabled: input.enhancedConversionsForLeads,
      globalSiteTag: tagSnippet?.globalSiteTag,
      eventSnippet: tagSnippet?.eventSnippet,
      status: 'SUCCEEDED',
      updatedAt: nowIso(),
    };
  }

  private async createConversionAction(input: {
    googleAdsCustomerId: string;
    conversionName: string;
    category: string;
    enhancedConversionsForLeads: boolean;
  }): Promise<string> {
    const response = await this.googleAdsRequest<GoogleAdsMutateResponse>(
      input.googleAdsCustomerId,
      `/customers/${input.googleAdsCustomerId}/conversionActions:mutate`,
      {
        method: 'POST',
        body: {
          operations: [
            {
              create: {
                name: input.conversionName,
                category: input.category,
                type: 'WEBPAGE',
                status: 'ENABLED',
                enhancedConversionsForLeadsEnabled: input.enhancedConversionsForLeads,
                valueSettings: {
                  defaultValue: 0,
                  alwaysUseDefaultValue: true,
                },
                clickThroughLookbackWindowDays: 30,
                viewThroughLookbackWindowDays: 1,
              },
            },
          ],
          partialFailure: false,
          validateOnly: false,
        },
      },
    );

    const resourceName = response.results?.[0]?.resourceName;

    if (!resourceName) {
      throw new AppError(
        'Google Ads conversion action response did not include a resourceName',
        502,
        'GOOGLE_ADS_INVALID_RESPONSE',
      );
    }

    return resourceName;
  }

  private async findConversionActionByName(
    googleAdsCustomerId: string,
    conversionName: string,
  ): Promise<string | null> {
    const escapedName = conversionName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const query = [
      'SELECT conversion_action.resource_name, conversion_action.name',
      'FROM conversion_action',
      `WHERE conversion_action.name = '${escapedName}'`,
      'LIMIT 1',
    ].join(' ');

    const response = await this.search(googleAdsCustomerId, query);
    return response[0]?.results?.[0]?.conversionAction?.resourceName ?? null;
  }

  private async getConversionAction(
    googleAdsCustomerId: string,
    resourceName: string,
  ): Promise<{
    id?: string;
    name?: string;
    resourceName?: string;
    tagSnippets?: Array<{
      type?: string;
      globalSiteTag?: string;
      eventSnippet?: string;
    }>;
  }> {
    const escapedResourceName = resourceName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const query = [
      'SELECT',
      'conversion_action.id,',
      'conversion_action.name,',
      'conversion_action.resource_name,',
      'conversion_action.tag_snippets',
      'FROM conversion_action',
      `WHERE conversion_action.resource_name = '${escapedResourceName}'`,
      'LIMIT 1',
    ].join(' ');

    const response = await this.search(googleAdsCustomerId, query);
    const conversionAction = response[0]?.results?.[0]?.conversionAction;

    if (!conversionAction) {
      throw new AppError(
        'Google Ads conversion action could not be loaded after provisioning',
        502,
        'GOOGLE_ADS_INVALID_RESPONSE',
        { resourceName },
      );
    }

    return conversionAction;
  }

  private async search(
    googleAdsCustomerId: string,
    query: string,
  ): Promise<GoogleAdsSearchStreamResponse> {
    return this.googleAdsRequest<GoogleAdsSearchStreamResponse>(
      googleAdsCustomerId,
      `/customers/${googleAdsCustomerId}/googleAds:searchStream`,
      {
        method: 'POST',
        body: { query },
      },
    );
  }

  private async googleAdsRequest<T>(
    googleAdsCustomerId: string,
    path: string,
    options: {
      method?: string;
      body?: Record<string, unknown>;
    },
  ): Promise<T> {
    const token = await this.auth.getAccessToken([GOOGLE_ADS_SCOPE]);
    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'developer-token': requireConfig(
        'GOOGLE_ADS_DEVELOPER_TOKEN',
        env.googleAdsDeveloperToken,
      ),
    };

    const loginCustomerId = env.googleAdsLoginCustomerId?.trim();
    if (loginCustomerId) {
      headers['login-customer-id'] = normalizeCustomerId(loginCustomerId);
    }

    const response = await fetch(`${this.baseUrl}/${this.version}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const payload = (await response.json().catch(() => ({}))) as T & {
      error?: { message?: string };
      message?: string;
    };

    if (!response.ok) {
      throw new AppError(
        payload.error?.message || payload.message || 'Google Ads API request failed',
        response.status,
        'GOOGLE_ADS_API_ERROR',
        {
          path,
          status: response.status,
          payload,
          customerId: googleAdsCustomerId,
        },
      );
    }

    return payload;
  }
}
