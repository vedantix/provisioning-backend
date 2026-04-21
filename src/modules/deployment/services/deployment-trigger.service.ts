import axios from 'axios';

export class DeploymentTriggerService {
  private readonly githubToken = process.env.GITHUB_TOKEN!;
  private readonly owner = process.env.GITHUB_OWNER!;
  private readonly repo = process.env.GITHUB_WEBSITE_REPO!;

  async triggerWebsiteBuild(params: {
    bucket: string;
    distributionId: string;
  }) {
    const url = `https://api.github.com/repos/${this.owner}/${this.repo}/actions/workflows/deploy.yml/dispatches`;

    await axios.post(
      url,
      {
        ref: 'main',
        inputs: {
          bucket: params.bucket,
          distribution_id: params.distributionId,
          mode: 'deploy',
        },
      },
      {
        headers: {
          Authorization: `Bearer ${this.githubToken}`,
          Accept: 'application/vnd.github+json',
        },
      },
    );
  }
}