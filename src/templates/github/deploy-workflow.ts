export function buildDeployWorkflow(): string {
    return `name: Deploy website
  
  on:
    workflow_dispatch:
      inputs:
        bucket:
          description: "S3 bucket"
          required: true
          type: string
        distribution_id:
          description: "CloudFront distribution id"
          required: true
          type: string
        mode:
          description: "deploy or rollback"
          required: false
          default: "deploy"
          type: string
        target_ref:
          description: "rollback git ref"
          required: false
          default: ""
          type: string
  
  jobs:
    deploy:
      runs-on: ubuntu-latest
  
      permissions:
        contents: read
        id-token: write
  
      steps:
        - name: Checkout
          uses: actions/checkout@v4
  
        - name: Configure AWS credentials
          uses: aws-actions/configure-aws-credentials@v4
          with:
            aws-access-key-id: \${{ secrets.AWS_ACCESS_KEY_ID }}
            aws-secret-access-key: \${{ secrets.AWS_SECRET_ACCESS_KEY }}
            aws-region: eu-west-1
  
        - name: Use rollback ref if requested
          if: \${{ inputs.mode == 'rollback' && inputs.target_ref != '' }}
          run: |
            git fetch --all --tags
            git checkout "\${{ inputs.target_ref }}"
  
        - name: Prepare dist
          run: |
            mkdir -p dist
            cp index.html dist/index.html
  
        - name: Upload to S3
          run: |
            aws s3 sync dist/ s3://\${{ inputs.bucket }}/ --delete
  
        - name: Invalidate CloudFront
          run: |
            aws cloudfront create-invalidation \
              --distribution-id "\${{ inputs.distribution_id }}" \
              --paths "/*"
  `;
  }