import { Duration, Stack, type StackProps } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import type { StageConfig } from './config.js';

export interface DataStackProps extends StackProps {
  config: StageConfig;
  /** Browser origins allowed to PUT and GET presigned URLs (the site and local dev). */
  allowedOrigins: string[];
}

/**
 * DataStack (blueprint 15.2): the single DynamoDB table and the documents bucket. Key names must
 * match apps/api/src/data/table.ts; see docs/architecture/track1-handoff.md.
 */
export class DataStack extends Stack {
  readonly table: dynamodb.TableV2;
  readonly docs: s3.Bucket;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);
    const { config } = props;

    this.table = new dynamodb.TableV2(this, 'Table', {
      tableName: `${config.prefix}-main`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      encryption: dynamodb.TableEncryptionV2.awsManagedKey(),
      timeToLiveAttribute: 'ttl', // cleanup only; correctness never depends on TTL
      deletionProtection: config.stage === 'prod',
      removalPolicy: config.removalPolicy,
      globalSecondaryIndexes: [
        {
          indexName: 'GSI1',
          partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
          sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
          projectionType: dynamodb.ProjectionType.ALL,
        },
      ],
    });

    this.docs = new s3.Bucket(this, 'Docs', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: false,
      removalPolicy: config.removalPolicy,
      autoDeleteObjects: config.stage === 'dev',
      // The browser uploads imports and downloads exports with presigned URLs.
      cors: [
        {
          allowedOrigins: props.allowedOrigins,
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
          allowedHeaders: ['content-type'],
          maxAge: 600,
        },
      ],
      lifecycleRules: [
        { prefix: 'imports/', expiration: Duration.days(30) },
        { prefix: 'exports/', expiration: Duration.days(7) },
        { prefix: 'reports/', expiration: Duration.days(90) },
        { abortIncompleteMultipartUploadAfter: Duration.days(1) },
      ],
    });
  }
}
