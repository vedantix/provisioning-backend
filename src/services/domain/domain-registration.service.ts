import {
  CheckDomainAvailabilityCommand,
  GetOperationDetailCommand,
  ListOperationsCommand,
  RegisterDomainCommand,
  Route53DomainsClient,
  type ContactDetail,
  type OperationSummary,
} from '@aws-sdk/client-route-53-domains';
import { env } from '../../config/env';
import { normalizePostalCodeForCountry } from '../../utils/contact.util';

type RegistrationAvailability =
  | 'AVAILABLE'
  | 'AVAILABLE_PREORDER'
  | 'AVAILABLE_RESERVED'
  | 'DONT_KNOW'
  | 'INVALID_NAME_FOR_TLD'
  | 'PENDING'
  | 'RESERVED'
  | 'UNAVAILABLE'
  | 'UNAVAILABLE_PREMIUM'
  | 'UNAVAILABLE_RESTRICTED'
  | 'CHECK_FAILED';

type RegistrationOperationStatus =
  | 'SUBMITTED'
  | 'IN_PROGRESS'
  | 'SUCCESSFUL'
  | 'FAILED'
  | 'ERROR'
  | 'UNKNOWN';

export type DomainRegistrationResult = {
  enabled: boolean;
  availability: RegistrationAvailability;
  submitted: boolean;
  operationId?: string;
  operationStatus?: RegistrationOperationStatus;
  operationMessage?: string;
  errorMessage?: string;
};

const client = new Route53DomainsClient({
  region: env.awsRoute53DomainsRegion,
});

function requireRegistrationConfig(name: string, value?: string): string {
  if (!value || !value.trim()) {
    throw new Error(
      `[DOMAIN_REGISTRATION_CONFIG] Missing required environment variable: ${name}`,
    );
  }

  return value.trim();
}

function buildDomainContact(): ContactDetail {
  const contactType = env.domainContactType as ContactDetail['ContactType'];
  const organizationName = env.domainContactOrganizationName?.trim();
  const countryCode = env.domainContactCountryCode as ContactDetail['CountryCode'];
  const postalCode = normalizePostalCodeForCountry(
    env.domainContactCountryCode,
    requireRegistrationConfig(
      'DOMAIN_CONTACT_POSTAL_CODE',
      env.domainContactPostalCode,
    ),
  );

  if (contactType !== 'PERSON' && !organizationName) {
    throw new Error(
      '[DOMAIN_REGISTRATION_CONFIG] DOMAIN_CONTACT_ORGANIZATION_NAME is required when DOMAIN_CONTACT_TYPE is not PERSON',
    );
  }

  return {
    FirstName: requireRegistrationConfig(
      'DOMAIN_CONTACT_FIRST_NAME',
      env.domainContactFirstName,
    ),
    LastName: requireRegistrationConfig(
      'DOMAIN_CONTACT_LAST_NAME',
      env.domainContactLastName,
    ),
    ContactType: contactType,
    OrganizationName: contactType === 'PERSON' ? undefined : organizationName,
    AddressLine1: requireRegistrationConfig(
      'DOMAIN_CONTACT_ADDRESS_LINE1',
      env.domainContactAddressLine1,
    ),
    AddressLine2: env.domainContactAddressLine2,
    City: requireRegistrationConfig('DOMAIN_CONTACT_CITY', env.domainContactCity),
    State: env.domainContactState,
    CountryCode: countryCode,
    ZipCode: postalCode,
    PhoneNumber: requireRegistrationConfig(
      'DOMAIN_CONTACT_PHONE',
      env.domainContactPhone,
    ),
    Email: requireRegistrationConfig(
      'DOMAIN_CONTACT_EMAIL',
      env.domainContactEmail,
    ),
  };
}

function normalizeOperationStatus(input?: string): RegistrationOperationStatus {
  if (
    input === 'SUBMITTED' ||
    input === 'IN_PROGRESS' ||
    input === 'SUCCESSFUL' ||
    input === 'FAILED' ||
    input === 'ERROR'
  ) {
    return input;
  }

  return 'UNKNOWN';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function getRegistrationAvailability(
  domain: string,
): Promise<{
  availability: RegistrationAvailability;
  errorMessage?: string;
}> {
  try {
    const result = await client.send(
      new CheckDomainAvailabilityCommand({
        DomainName: domain,
      }),
    );

    return {
      availability: (result.Availability ?? 'DONT_KNOW') as RegistrationAvailability,
    };
  } catch (error) {
    return {
      availability: 'CHECK_FAILED',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function findLatestRegistrationOperation(
  domain: string,
): Promise<OperationSummary | undefined> {
  const result = await client.send(
    new ListOperationsCommand({
      MaxItems: 20,
      SortBy: 'SubmittedDate',
      SortOrder: 'DESC',
      Type: ['REGISTER_DOMAIN'],
    }),
  );

  const normalizedDomain = domain.toLowerCase();

  return result.Operations?.find(
    (operation) =>
      operation.Type === 'REGISTER_DOMAIN' &&
      operation.DomainName?.toLowerCase() === normalizedDomain,
  );
}

async function waitForRegistrationOperation(
  operationId: string,
): Promise<{
  operationStatus: RegistrationOperationStatus;
  operationMessage?: string;
}> {
  const timeoutMs = Math.max(0, env.domainRegistrationWaitSeconds) * 1000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    const operation = await client.send(
      new GetOperationDetailCommand({
        OperationId: operationId,
      }),
    );

    const operationStatus = normalizeOperationStatus(operation.Status);
    const operationMessage = operation.Message;

    if (
      operationStatus === 'SUCCESSFUL' ||
      operationStatus === 'FAILED' ||
      operationStatus === 'ERROR'
    ) {
      return {
        operationStatus,
        operationMessage,
      };
    }

    await sleep(5_000);
  }

  return {
    operationStatus: 'IN_PROGRESS',
    operationMessage:
      'Domain registration is still in progress. Retry DOMAIN_CHECK after AWS finishes the registration operation.',
  };
}

export async function registerDomainIfAvailable(
  domain: string,
): Promise<DomainRegistrationResult> {
  const availability = await getRegistrationAvailability(domain);

  if (availability.availability !== 'AVAILABLE') {
    const existingOperation = await findLatestRegistrationOperation(domain);
    const existingOperationId = existingOperation?.OperationId;

    if (existingOperationId) {
      const existingStatus = normalizeOperationStatus(existingOperation.Status);

      if (existingStatus === 'SUBMITTED' || existingStatus === 'IN_PROGRESS') {
        const operation = await waitForRegistrationOperation(existingOperationId);

        return {
          enabled: env.domainRegistrationEnabled,
          availability: availability.availability,
          submitted: true,
          operationId: existingOperationId,
          ...operation,
        };
      }

      return {
        enabled: env.domainRegistrationEnabled,
        availability: availability.availability,
        submitted: true,
        operationId: existingOperationId,
        operationStatus: existingStatus,
        operationMessage: existingOperation.Message,
      };
    }

    return {
      enabled: env.domainRegistrationEnabled,
      availability: availability.availability,
      submitted: false,
      errorMessage: availability.errorMessage,
    };
  }

  if (!env.domainRegistrationEnabled) {
    return {
      enabled: false,
      availability: availability.availability,
      submitted: false,
    };
  }

  const contact = buildDomainContact();

  try {
    const result = await client.send(
      new RegisterDomainCommand({
        DomainName: domain,
        DurationInYears: env.domainRegistrationDurationYears,
        AutoRenew: env.domainRegistrationAutoRenew,
        AdminContact: contact,
        RegistrantContact: contact,
        TechContact: contact,
        BillingContact: contact,
        PrivacyProtectAdminContact: env.domainRegistrationPrivacyProtect,
        PrivacyProtectRegistrantContact: env.domainRegistrationPrivacyProtect,
        PrivacyProtectTechContact: env.domainRegistrationPrivacyProtect,
        PrivacyProtectBillingContact: env.domainRegistrationPrivacyProtect,
      }),
    );

    const operationId = result.OperationId;

    if (!operationId) {
      return {
        enabled: true,
        availability: availability.availability,
        submitted: true,
        operationStatus: 'UNKNOWN',
        operationMessage: 'Route53 Domains did not return an operation id.',
      };
    }

    const operation = await waitForRegistrationOperation(operationId);

    return {
      enabled: true,
      availability: availability.availability,
      submitted: true,
      operationId,
      ...operation,
    };
  } catch (error) {
    const errorName = error instanceof Error ? error.name : '';

    if (errorName === 'DuplicateRequest') {
      return {
        enabled: true,
        availability: availability.availability,
        submitted: true,
        operationStatus: 'IN_PROGRESS',
        operationMessage:
          'A Route53 Domains registration request is already in progress for this domain.',
      };
    }

    return {
      enabled: true,
      availability: availability.availability,
      submitted: false,
      operationStatus: 'ERROR',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
