import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';

export interface GitHubOidcStackProps extends StackProps {
  /** owner/name of the repository allowed to deploy. */
  githubRepo: string;
}

/**
 * GitHub Actions deploy role (blueprint 12.2, T3-01): CI gets short-lived credentials through
 * OIDC, so no AWS keys are stored in GitHub. Only the main branch and the approved prod
 * environment of this repository can assume it, and it can only assume the CDK bootstrap roles
 * (which do the actual deployment) and read stack outputs.
 */
export class GitHubOidcStack extends Stack {
  readonly role: iam.Role;

  constructor(scope: Construct, id: string, props: GitHubOidcStackProps) {
    super(scope, id, props);

    const provider = new iam.OpenIdConnectProvider(this, 'GitHub', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });

    this.role = new iam.Role(this, 'DeployRole', {
      roleName: 'c32-github-deploy',
      description: `GitHub Actions deploys for ${props.githubRepo}`,
      maxSessionDuration: Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com' },
        StringLike: {
          'token.actions.githubusercontent.com:sub': [
            `repo:${props.githubRepo}:ref:refs/heads/main`,
            `repo:${props.githubRepo}:environment:prod`,
          ],
        },
      }),
    });
    this.role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'AssumeCdkBootstrapRoles',
        actions: ['sts:AssumeRole'],
        resources: [
          `arn:aws:iam::${this.account}:role/cdk-hnb659fds-*-${this.account}-${this.region}`,
        ],
      }),
    );
    this.role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ReadStackOutputs',
        actions: ['cloudformation:DescribeStacks'],
        resources: [`arn:aws:cloudformation:${this.region}:${this.account}:stack/c32-*/*`],
      }),
    );

    new CfnOutput(this, 'DeployRoleArn', { value: this.role.roleArn });
  }
}
