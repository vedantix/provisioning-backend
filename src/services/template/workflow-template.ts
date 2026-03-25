export function generateDeployWorkflow() {
    return `name: Deploy website
  
  on:
    push:
      branches: [ main ]
  
  jobs:
    deploy:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
  
        - name: Upload to S3
          run: |
            echo "Deploy placeholder"
  `;
  }