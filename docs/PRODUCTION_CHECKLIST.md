# Production Checklist

- Configure ADMIN_SESSION_SECRET
- Configure CORS_ALLOWED_ORIGINS with only deployed frontend/admin origins
- Configure AWS credentials
- Configure GitHub token or secret ARN
- Configure Migadu credentials
- Configure Route53 hosted zone
- Configure SQS queue
- Configure DynamoDB tables
- Configure Base44 webhook settings
- Validate /health endpoint
- Validate /ready endpoint
- Run npm audit, npm run typecheck, npm test before deployment
- Bootstrap the first admin user with /api/admin/auth/bootstrap and then remove access to the bootstrap API key from browser-visible contexts
