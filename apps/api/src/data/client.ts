import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { TABLE } from './table.js';

export interface DataConfig {
  tableName: string;
  region: string;
  /** Set for DynamoDB Local (for example http://localhost:8100); unset in AWS. */
  endpoint?: string;
}

/** Read data settings from the environment. Lambda gets TABLE_NAME and AWS_REGION from CDK. */
export function dataConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DataConfig {
  const endpoint = env['DYNAMODB_ENDPOINT'];
  return {
    tableName: env['TABLE_NAME'] ?? TABLE.defaultName,
    region: env['AWS_REGION'] ?? 'ap-south-1',
    ...(endpoint ? { endpoint } : {}),
  };
}

/**
 * Document client that keeps null as an attribute value and drops undefined. Against DynamoDB
 * Local it uses placeholder credentials (Local ignores them); in AWS it uses the Lambda role.
 * No access keys are ever read from code or files here.
 */
export function createDocClient(config: DataConfig): DynamoDBDocumentClient {
  const client = new DynamoDBClient({
    region: config.region,
    ...(config.endpoint
      ? {
          endpoint: config.endpoint,
          credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
        }
      : {}),
  });
  return DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true, convertEmptyValues: false },
  });
}
