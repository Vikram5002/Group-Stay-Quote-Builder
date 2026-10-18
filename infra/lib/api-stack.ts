import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import type * as cognito from 'aws-cdk-lib/aws-cognito';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';
import type { StageConfig } from './config.js';

export interface ApiStackProps extends StackProps {
  config: StageConfig;
  table: dynamodb.ITableV2;
  docs: s3.IBucket;
  userPool: cognito.IUserPool;
  userPoolClient: cognito.IUserPoolClient;
  /** Browser origins allowed by CORS (the site and local dev). */
  appOrigins: string[];
  /** Prebuilt bundles from `npm run bundle -w @c32/api` (dist-lambda/api and dist-lambda/worker). */
  apiCode: lambda.Code;
  workerCode: lambda.Code;
  appVersion: string;
}

/**
 * ApiStack (blueprint 7.2, docs/architecture/track1-handoff.md): the Express API in Lambda behind
 * an HTTP API with a Cognito JWT authorizer, and the worker with its three triggers (per-quote
 * EventBridge schedules, a 15-minute sweeper, a nightly reconciliation) and a DLQ.
 * No VPC, no NAT gateway, least-privilege roles per function.
 */
export class ApiStack extends Stack {
  readonly api: apigw.HttpApi;
  readonly apiFn: lambda.Function;
  readonly workerFn: lambda.Function;
  readonly dlq: sqs.Queue;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
    const { config } = props;
    const common = {
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'index.handler',
      tracing: lambda.Tracing.ACTIVE,
    };
    const shared = {
      TABLE_NAME: props.table.tableName,
      PROPERTY_ID: 'p1',
      DOCS_BUCKET: props.docs.bucketName,
      NODE_OPTIONS: '--enable-source-maps',
    };

    // ---------------------------------------------------------------- worker
    this.dlq = new sqs.Queue(this, 'WorkerDlq', {
      queueName: `${config.prefix}-worker-dlq`,
      retentionPeriod: Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
    });

    this.workerFn = new lambda.Function(this, 'Worker', {
      ...common,
      functionName: `${config.prefix}-worker`,
      code: props.workerCode,
      memorySize: 512,
      timeout: Duration.minutes(2),
      environment: shared,
      deadLetterQueue: this.dlq,
      retryAttempts: 2,
      logGroup: new logs.LogGroup(this, 'WorkerLogs', {
        logGroupName: `/aws/lambda/${config.prefix}-worker`,
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: config.removalPolicy,
      }),
    });
    props.table.grantReadWriteData(this.workerFn);
    props.docs.grantRead(this.workerFn, 'evidence/*');
    props.docs.grantPut(this.workerFn, 'reports/*');

    new events.Rule(this, 'Sweep', {
      description: 'Expire open quotes the per-quote schedules missed',
      schedule: events.Schedule.rate(Duration.minutes(15)),
      targets: [
        new targets.LambdaFunction(this.workerFn, {
          event: events.RuleTargetInput.fromObject({ type: 'sweep' }),
        }),
      ],
    });
    new events.Rule(this, 'Reconcile', {
      description: 'Nightly ledger reconciliation (02:30 IST)',
      schedule: events.Schedule.cron({ minute: '0', hour: '21' }),
      targets: [
        new targets.LambdaFunction(this.workerFn, {
          event: events.RuleTargetInput.fromObject({ type: 'reconcile' }),
        }),
      ],
    });

    // Per-quote expiry schedules: the API creates them; EventBridge Scheduler invokes the worker.
    const scheduleGroup = new scheduler.CfnScheduleGroup(this, 'ExpiryGroup', {
      name: `${config.prefix}-expiry`,
    });
    const schedulerRole = new iam.Role(this, 'SchedulerRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com', {
        conditions: { StringEquals: { 'aws:SourceAccount': this.account } },
      }),
      description: 'EventBridge Scheduler invokes the worker for quote expiry',
    });
    this.workerFn.grantInvoke(schedulerRole);

    // ------------------------------------------------------------------- api
    this.apiFn = new lambda.Function(this, 'Api', {
      ...common,
      functionName: `${config.prefix}-api`,
      code: props.apiCode,
      memorySize: 1024,
      timeout: Duration.seconds(15),
      environment: {
        ...shared,
        CORS_ORIGINS: props.appOrigins.join(','),
        APP_VERSION: props.appVersion,
        EXPIRY_TARGET_ARN: this.workerFn.functionArn,
        EXPIRY_ROLE_ARN: schedulerRole.roleArn,
        EXPIRY_SCHEDULE_GROUP: scheduleGroup.name as string,
        SENDER_EMAIL: config.senderEmail,
      },
      logGroup: new logs.LogGroup(this, 'ApiLogs', {
        logGroupName: `/aws/lambda/${config.prefix}-api`,
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: config.removalPolicy,
      }),
    });
    props.table.grantReadWriteData(this.apiFn);
    props.docs.grantReadWrite(this.apiFn, 'imports/*');
    props.docs.grantReadWrite(this.apiFn, 'exports/*');
    props.docs.grantRead(this.apiFn, 'evidence/*');
    this.apiFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['scheduler:CreateSchedule', 'scheduler:UpdateSchedule'],
        resources: [
          `arn:aws:scheduler:${this.region}:${this.account}:schedule/${scheduleGroup.name}/c32-expire-*`,
        ],
      }),
    );
    schedulerRole.grantPassRole(this.apiFn.grantPrincipal);

    // Quote and invoice emails (D-059). Creating the identity sends a verification link to the
    // sender address; nothing is delivered until it is clicked. The API may send only as it.
    const sender = new ses.EmailIdentity(this, 'Sender', {
      identity: ses.Identity.email(config.senderEmail),
    });
    // SES checks the recipient's identity too (in the sandbox every recipient is one), so the
    // resource is any identity, but only ever with this sender as the From address.
    this.apiFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ses:SendEmail', 'ses:SendRawEmail'],
        resources: [`arn:aws:ses:${this.region}:${this.account}:identity/*`],
        conditions: { StringEquals: { 'ses:FromAddress': sender.emailIdentityName } },
      }),
    );

    const accessLogs = new logs.LogGroup(this, 'AccessLogs', {
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: config.removalPolicy,
    });
    this.api = new apigw.HttpApi(this, 'Http', {
      apiName: `${config.prefix}-api`,
      corsPreflight: {
        allowOrigins: props.appOrigins,
        allowMethods: [
          apigw.CorsHttpMethod.GET,
          apigw.CorsHttpMethod.POST,
          apigw.CorsHttpMethod.PUT,
          apigw.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ['authorization', 'content-type', 'idempotency-key', 'x-request-id'],
        exposeHeaders: ['x-request-id', 'idempotent-replayed'],
        maxAge: Duration.minutes(10),
      },
    });
    const stage = this.api.defaultStage?.node.defaultChild as apigw.CfnStage;
    stage.defaultRouteSettings = { throttlingBurstLimit: 100, throttlingRateLimit: 50 };
    stage.accessLogSettings = {
      destinationArn: accessLogs.logGroupArn,
      format: JSON.stringify({
        requestId: '$context.requestId',
        ip: '$context.identity.sourceIp',
        method: '$context.httpMethod',
        path: '$context.path',
        status: '$context.status',
        latencyMs: '$context.responseLatency',
        sub: '$context.authorizer.claims.sub',
      }),
    };

    const integration = new HttpLambdaIntegration('ApiIntegration', this.apiFn);
    const authorizer = new HttpJwtAuthorizer(
      'Cognito',
      `https://cognito-idp.${this.region}.amazonaws.com/${props.userPool.userPoolId}`,
      { jwtAudience: [props.userPoolClient.userPoolClientId] },
    );
    this.api.addRoutes({ path: '/health', methods: [apigw.HttpMethod.GET], integration });
    this.api.addRoutes({
      path: '/v1/{proxy+}',
      methods: [apigw.HttpMethod.GET, apigw.HttpMethod.POST, apigw.HttpMethod.PUT],
      integration,
      authorizer,
    });

    new CfnOutput(this, 'ApiUrl', { value: this.api.apiEndpoint });
  }
}
