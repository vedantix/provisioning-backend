# Analytics Provisioning

Vedantix provisions analytics as part of the customer deployment pipeline. The goal is one operational flow from the admin panel: create or approve a customer, publish the website, and let the backend create the analytics resources, verify DNS and inject tracking tags into the deployed site.

## Deployment Flow

The create deployment stages are:

1. `DOMAIN_CHECK`
2. `GITHUB_PROVISION`
3. `S3_BUCKET`
4. `ACM_REQUEST`
5. `ACM_VALIDATION_RECORDS`
6. `ACM_DNS_PROPAGATION`
7. `ACM_WAIT`
8. `CLOUDFRONT`
9. `ROUTE53_ALIAS`
10. `GOOGLE_ANALYTICS`
11. `SEARCH_CONSOLE`
12. `CLARITY`
13. `GITHUB_DISPATCH`
14. `DYNAMODB`
15. `SQS`

Analytics runs after DNS and CloudFront aliases are ready, but before GitHub Actions deploys the site. That gives the workflow the final tracking values:

- `VITE_GA_MEASUREMENT_ID`
- `NEXT_PUBLIC_GA_MEASUREMENT_ID`
- `VITE_CLARITY_PROJECT_ID`
- `NEXT_PUBLIC_CLARITY_PROJECT_ID`

The deploy workflow also injects Google Analytics and Clarity tags into `dist/index.html` when those IDs are available, so static exports are covered even when the source application does not consume environment variables.

## Storage

DynamoDB table: `analytics_integrations`

Partition key: `customerId`

Record shape:

```json
{
  "customerId": "cust_jitan",
  "deploymentId": "dep_123",
  "domain": "jitan-sports.nl",
  "googleAnalytics": {
    "propertyId": "123456",
    "measurementId": "G-XXXXXXXXXX",
    "status": "PROVISIONED"
  },
  "searchConsole": {
    "propertyId": "sc-domain:jitan-sports.nl",
    "verificationToken": "google-site-verification=...",
    "verified": true,
    "status": "VERIFIED"
  },
  "clarity": {
    "projectId": "abcd1234",
    "status": "PROVISIONED"
  },
  "trackingEnvironment": {
    "VITE_GA_MEASUREMENT_ID": "G-XXXXXXXXXX",
    "NEXT_PUBLIC_GA_MEASUREMENT_ID": "G-XXXXXXXXXX",
    "VITE_CLARITY_PROJECT_ID": "abcd1234",
    "NEXT_PUBLIC_CLARITY_PROJECT_ID": "abcd1234"
  }
}
```

## Google Setup

Create a Google Cloud service account and grant it access to the Google Analytics account and Search Console/Site Verification APIs.

Required APIs and scopes:

- Google Analytics Admin API: `https://www.googleapis.com/auth/analytics.edit`
- Search Console API: `https://www.googleapis.com/auth/webmasters`
- Site Verification API: `https://www.googleapis.com/auth/siteverification`

Official references:

- Google Analytics Admin API: https://developers.google.com/analytics/devguides/config/admin/v1
- Google Search Console Sites API: https://developers.google.com/webmaster-tools/v1/sites
- Google Site Verification API: https://developers.google.com/site-verification/v1

Environment variables:

```bash
GOOGLE_CLIENT_EMAIL=vedantix-analytics@project-id.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_ANALYTICS_ACCOUNT_ID=123456789
GOOGLE_ANALYTICS_TIMEZONE=Europe/Amsterdam
GOOGLE_ANALYTICS_CURRENCY=EUR
GOOGLE_SEARCH_CONSOLE_DNS_MAX_ATTEMPTS=12
GOOGLE_SEARCH_CONSOLE_DNS_DELAY_MS=10000
```

Search Console domain verification uses Site Verification DNS TXT tokens. The backend writes the TXT record to Route53 and waits until public DNS resolves before calling verification.

## Microsoft Clarity

Microsoft publishes the browser tracking snippet and analytics APIs, but a stable official public API for creating Clarity projects is not exposed in the same way as Google Analytics/Search Console.

Official reference: https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-setup

The Vedantix backend therefore has a Clarity adapter with two modes:

- If `CLARITY_API_BASE_URL` and `CLARITY_API_TOKEN` are configured, it calls that configured project endpoint and stores the returned project ID.
- If they are not configured and `CLARITY_REQUIRED=false`, the stage is marked `SKIPPED` so the rest of deployment can continue.
- If `CLARITY_REQUIRED=true`, deployment fails clearly with `CLARITY_API_NOT_CONFIGURED`.

Environment variables:

```bash
CLARITY_REQUIRED=false
CLARITY_API_BASE_URL=
CLARITY_API_TOKEN=
CLARITY_PROJECTS_PATH=/projects
```

## API

Routes are mounted under both `/api/analytics` and `/analytics`.

- `POST /api/analytics/provision`
- `POST /api/analytics/repair`
- `DELETE /api/analytics`
- `GET /api/analytics/:customerId`
- `GET /api/analytics/:customerId/status`

All routes use the existing admin auth and request context:

- `X-Api-Key`
- `X-Source`
- `X-Actor-Id`
- `X-Tenant-Id`

## Repair And Delete

`repairAnalytics()` re-runs the same idempotent reconcile logic:

- Missing GA property or stream is recreated.
- Missing Search Console verification is reissued and verified through Route53 TXT.
- Existing Clarity project IDs are reused; otherwise the configured provider is called.

`deleteAnalytics()` soft-deletes/deprovisions provider resources where APIs are available and marks the DynamoDB record as `DELETED`. Customer deletion calls this cleanup flow so analytics resources are not orphaned.

## Future Dashboard

The integration record includes dashboard metric definitions for later customer dashboards:

- visitors
- sessions
- top pages
- search queries
- conversions

Metrics should be fetched through provider-specific readers later, not stored directly in the integration record.
