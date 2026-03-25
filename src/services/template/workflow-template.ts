export function generateDeployWorkflow() {
  return `name: Deploy website

on:
  workflow_dispatch:
    inputs:
      bucket:
        description: S3 bucket name
        required: true
        type: string
      distribution_id:
        description: CloudFront distribution ID
        required: true
        type: string
  push:
    branches:
      - main

permissions:
  id-token: write
  contents: read

env:
  AWS_REGION: eu-west-1

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v6

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install dependencies
        run: npm ci || npm install

      - name: Build
        run: npm run build

      - name: Configure AWS credentials with OIDC
        uses: aws-actions/configure-aws-credentials@v6.0.0
        with:
          role-to-assume: \${{ secrets.AWS_GITHUB_ACTIONS_ROLE_ARN }}
          aws-region: \${{ env.AWS_REGION }}

      - name: Validate dist folder
        run: |
          test -d dist || (echo "dist folder not found" && exit 1)
          test -f dist/index.html || (echo "dist/index.html not found" && exit 1)

      - name: Upload site to S3
        run: |
          aws s3 sync dist "s3://\${{ inputs.bucket }}" --delete

      - name: Invalidate CloudFront
        run: |
          aws cloudfront create-invalidation \\
            --distribution-id "\${{ inputs.distribution_id }}" \\
            --paths "/*"
`;
}