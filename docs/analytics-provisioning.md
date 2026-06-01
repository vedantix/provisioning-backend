# Analytics Provisioning

This document covers website tracking that is provisioned during customer deployment.

## Scope

The deployment analytics stack contains:

- Google Analytics 4
- Google Search Console
- Microsoft Clarity
- Tracking environment generation
- Static `dist/index.html` injection through the generated GitHub Actions workflow

Paid advertising management is handled separately by the internal Meta Marketing module in `docs/meta-internal-marketing.md`.

## Deployment Stages

Analytics runs after AWS DNS/CDN resources are ready and before the GitHub deployment dispatch:

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
11. `GOOGLE_SEARCH_CONSOLE`
12. `CLARITY`
13. `TRACKING_INJECTION`
14. `GITHUB_DISPATCH`
15. `DYNAMODB`
16. `SQS`

## Tracking Environment

The generated environment supports Vite and Next-style public variable names:

```json
{
  "VITE_GA_MEASUREMENT_ID": "G-XXXXXXXXXX",
  "NEXT_PUBLIC_GA_MEASUREMENT_ID": "G-XXXXXXXXXX",
  "VITE_GOOGLE_SITE_VERIFICATION": "verification-token",
  "NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION": "verification-token",
  "VITE_CLARITY_PROJECT_ID": "clarity-project-id",
  "NEXT_PUBLIC_CLARITY_PROJECT_ID": "clarity-project-id"
}
```

## Required Environment

```bash
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
GOOGLE_OAUTH_SECRET_ARN=
GOOGLE_ANALYTICS_ACCOUNT_ID=
GOOGLE_ANALYTICS_TIMEZONE=Europe/Amsterdam
GOOGLE_ANALYTICS_CURRENCY=EUR
GOOGLE_SEARCH_CONSOLE_DNS_MAX_ATTEMPTS=12
GOOGLE_SEARCH_CONSOLE_DNS_DELAY_MS=10000

CLARITY_REQUIRED=false
CLARITY_API_BASE_URL=
CLARITY_API_TOKEN=
CLARITY_PROJECTS_PATH=/projects
```

When `MARKETING_STACK_STRICT_STARTUP=true`, the API refuses to start if required Google settings are missing. By default the API stays online and returns actionable configuration errors from the analytics endpoints.

## Data Model

Analytics records are stored in `analytics_integrations` with `customerId` as the partition key:

```json
{
  "customerId": "cust_jitansports",
  "tenantId": "default",
  "deploymentId": "dep_123",
  "domain": "jitan-sports.nl",
  "googleAnalytics": {
    "propertyId": "properties/123",
    "dataStreamId": "456",
    "measurementId": "G-XXXXXXXXXX",
    "status": "SUCCEEDED"
  },
  "searchConsole": {
    "propertyId": "sc-domain:jitan-sports.nl",
    "verificationToken": "google-site-verification=...",
    "verified": true,
    "status": "SUCCEEDED"
  },
  "clarity": {
    "projectId": "abc123",
    "status": "SUCCEEDED"
  },
  "trackingEnvironment": {},
  "provisioningStatus": "SUCCEEDED",
  "timeline": []
}
```

Older records may still contain historical advertising fields. The current application ignores those fields and no longer exports advertising tracking variables from this deployment stack.

## Recovery

Analytics provisioning is protected by distributed locks, retry metadata, dead-letter records and timeline events. Failed provisioning can be retried through `/api/analytics/repair` or replayed from the analytics dead-letter endpoint.
