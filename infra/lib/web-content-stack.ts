import { Stack, type StackProps } from 'aws-cdk-lib';
import type * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import * as deploy from 'aws-cdk-lib/aws-s3-deployment';
import type { Construct } from 'constructs';

export interface WebContentStackProps extends StackProps {
  site: s3.IBucket;
  distribution: cloudfront.IDistribution;
  /** apps/web/dist, built with the API URL and Cognito ids from the other stacks. */
  distDir: string;
}

/** Uploads the built React app and invalidates CloudFront so users get the new version. */
export class WebContentStack extends Stack {
  constructor(scope: Construct, id: string, props: WebContentStackProps) {
    super(scope, id, props);
    new deploy.BucketDeployment(this, 'Deploy', {
      sources: [deploy.Source.asset(props.distDir)],
      destinationBucket: props.site,
      distribution: props.distribution,
      distributionPaths: ['/*'],
      prune: true,
      memoryLimit: 512,
    });
  }
}
