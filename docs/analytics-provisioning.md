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
12. `GOOGLE_ADS`
13. `CLARITY`
14. `TRACKING_INJECTION`
15. `GITHUB_DISPATCH`
16. `DYNAMODB`
17. `SQS`

Analytics runs after DNS and CloudFront aliases are ready, but before GitHub Actions deploys the site. That gives the workflow the final tracking values:

- `VITE_GA_MEASUREMENT_ID`
- `NEXT_PUBLIC_GA_MEASUREMENT_ID`
- `VITE_CLARITY_PROJECT_ID`
- `NEXT_PUBLIC_CLARITY_PROJECT_ID`
- `VITE_GOOGLE_ADS_CONVERSION_ID`
- `NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_ID`
- `VITE_GOOGLE_ADS_CONVERSION_LABELS`
- `NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_LABELS`

The deploy workflow also injects Google Analytics, Google Ads conversion tracking and Clarity tags into `dist/index.html` when those IDs are available, so static exports are covered even when the source application does not consume environment variables.

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
    "status": "SUCCEEDED"
  },
  "searchConsole": {
    "propertyId": "sc-domain:jitan-sports.nl",
    "verificationToken": "google-site-verification=...",
    "verified": true,
    "status": "SUCCEEDED"
  },
  "googleAds": {
    "customerId": "1234567890",
    "conversionId": "1234567890",
    "status": "SUCCEEDED",
    "conversions": [
      {
        "conversionName": "Vedantix Jitan Sports Lead",
        "conversionLabel": "abc123",
        "status": "SUCCEEDED"
      }
    ]
  },
  "clarity": {
    "projectId": "abcd1234",
    "status": "SUCCEEDED"
  },
  "provisioningStatus": "SUCCEEDED",
  "provisioningErrors": [],
  "timeline": [],
  "trackingEnvironment": {
    "VITE_GA_MEASUREMENT_ID": "G-XXXXXXXXXX",
    "NEXT_PUBLIC_GA_MEASUREMENT_ID": "G-XXXXXXXXXX",
    "VITE_GOOGLE_ADS_CONVERSION_ID": "1234567890",
    "NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_ID": "1234567890",
    "VITE_GOOGLE_ADS_CONVERSION_LABELS": "{\"LEAD\":\"abc123\"}",
    "NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_LABELS": "{\"LEAD\":\"abc123\"}",
    "VITE_CLARITY_PROJECT_ID": "abcd1234",
    "NEXT_PUBLIC_CLARITY_PROJECT_ID": "abcd1234"
  }
}
```

## Google Setup

Create a Google Cloud OAuth client and store a long-lived refresh token for the Vedantix admin Google account. The refresh-token flow is preferred because it can access Google Analytics Admin, Search Console, Site Verification and Google Ads with one shared authentication service. The existing service-account variables remain supported as a legacy fallback for Google Analytics/Search Console only.

Required APIs and scopes:

- Google Analytics Admin API: `https://www.googleapis.com/auth/analytics.edit`
- Search Console API: `https://www.googleapis.com/auth/webmasters`
- Site Verification API: `https://www.googleapis.com/auth/siteverification`
- Google Ads API: `https://www.googleapis.com/auth/adwords`

Official references:

- Google Analytics Admin API: https://developers.google.com/analytics/devguides/config/admin/v1
- Google Search Console Sites API: https://developers.google.com/webmaster-tools/v1/sites
- Google Site Verification API: https://developers.google.com/site-verification/v1
- Google Ads API versioning: https://developers.google.com/google-ads/api/docs/upgrade
- Google Ads conversion actions: https://developers.google.com/google-ads/api/rest/reference/rest/v24/customers.conversionActions/mutate

Environment variables:

```bash
GOOGLE_CLIENT_ID=replace-with-google-oauth-client-id
GOOGLE_CLIENT_SECRET=replace-with-google-oauth-client-secret
GOOGLE_REFRESH_TOKEN=replace-with-google-oauth-refresh-token

GOOGLE_CLIENT_EMAIL=vedantix-analytics@project-id.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_ANALYTICS_ACCOUNT_ID=123456789
GOOGLE_ANALYTICS_TIMEZONE=Europe/Amsterdam
GOOGLE_ANALYTICS_CURRENCY=EUR
GOOGLE_SEARCH_CONSOLE_DNS_MAX_ATTEMPTS=12
GOOGLE_SEARCH_CONSOLE_DNS_DELAY_MS=10000
GOOGLE_MARKETING_STACK_REQUIRED=false

GOOGLE_ADS_API_BASE_URL=https://googleads.googleapis.com
GOOGLE_ADS_API_VERSION=v24
GOOGLE_ADS_DEVELOPER_TOKEN=replace-with-google-ads-developer-token
GOOGLE_ADS_CUSTOMER_ID=1234567890
GOOGLE_ADS_LOGIN_CUSTOMER_ID=1234567890
```

Search Console domain verification uses Site Verification DNS TXT tokens. The backend writes the TXT record to Route53 and waits until public DNS resolves before calling verification.

`GOOGLE_MARKETING_STACK_REQUIRED=false` lets the backend boot while credentials are being installed. Provisioning itself still fails fast when required Google/Ads variables are missing. Set it to `true` after production credentials are configured if startup should hard-fail on missing marketing stack configuration.

## Google Ads

The Google Ads service reconciles conversion actions per customer and event:

- `LEAD`
- `WHATSAPP_CLICK`
- `CONTACT_FORM`
- `BOOKING`
- `PURCHASE`

The service first searches existing conversion actions by deterministic name, then creates missing actions through the Google Ads API. The resulting conversion ID and labels are stored in DynamoDB and exported as environment variables. The deploy workflow injects a global Google Ads tag and a small event bridge that tracks form submits, WhatsApp clicks and explicit `data-vedantix-conversion` events.

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
- Missing Google Ads conversion actions are recreated and exported again.
- Existing Clarity project IDs are reused; otherwise the configured provider is called.

`deleteAnalytics()` soft-deletes/deprovisions provider resources where APIs are available and marks the DynamoDB record as `DELETED`. Customer deletion calls this cleanup flow so analytics resources are not orphaned. Google Ads conversion actions are marked `DELETED` in the integration record so future repair can intentionally reconcile or reconnect them.

## Future Dashboard

The integration record includes dashboard metric definitions for later customer dashboards:

- visitors
- sessions
- top pages
- search queries
- conversions

Metrics should be fetched through provider-specific readers later, not stored directly in the integration record.
