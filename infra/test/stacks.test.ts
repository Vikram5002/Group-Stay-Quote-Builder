import { App, type Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { describe, expect, it } from 'vitest';
import { ApiStack } from '../lib/api-stack.js';
import { AuthStack } from '../lib/auth-stack.js';
import { stageConfig } from '../lib/config.js';
import { DataStack } from '../lib/data-stack.js';
import { GitHubOidcStack } from '../lib/github-oidc-stack.js';
import { ObservabilityStack } from '../lib/observability-stack.js';
import { WebStack } from '../lib/web-stack.js';

/** Synthesise every stack once, the way bin/app.ts wires them, with stub Lambda code. */
function synth(stage: 'dev' | 'prod' = 'dev', alertEmail: string | null = 'alerts@example.com') {
  const app = new App();
  const env = { account: '123456789012', region: 'ap-south-1' };
  const config = stageConfig(
    (k) => ({ stage, alertEmail: alertEmail ?? undefined })[k as 'stage' | 'alertEmail'],
    env.account,
    env.region,
  );
  const web = new WebStack(app, 'web', { env, config });
  const origins = [web.siteUrl, ...config.extraOrigins];
  const data = new DataStack(app, 'data', { env, config, allowedOrigins: origins });
  const auth = new AuthStack(app, 'auth', { env, config, appOrigins: origins });
  const code = lambda.Code.fromInline('export const handler = async () => ({})');
  const api = new ApiStack(app, 'api', {
    env,
    config,
    table: data.table,
    docs: data.docs,
    userPool: auth.userPool,
    userPoolClient: auth.client,
    appOrigins: origins,
    apiCode: code,
    workerCode: code,
    appVersion: 'test',
  });
  const obs = new ObservabilityStack(app, 'obs', {
    env,
    config,
    api: api.api,
    apiFn: api.apiFn,
    workerFn: api.workerFn,
    dlq: api.dlq,
  });
  const oidc = new GitHubOidcStack(app, 'oidc', { env, githubRepo: config.githubRepo });
  const stacks: Stack[] = [web, data, auth, api, obs, oidc];
  return {
    t: Object.fromEntries(stacks.map((s) => [s.stackName, Template.fromStack(s)])) as Record<
      string,
      Template
    >,
    stacks,
  };
}

const { t } = synth();
const all = Object.values(t);

describe('security guardrails (blueprint 12.2): the build fails if any of these slip', () => {
  it('no bucket is public, every bucket is encrypted and refuses plain HTTP', () => {
    for (const tpl of all) {
      for (const bucket of Object.values(tpl.findResources('AWS::S3::Bucket'))) {
        const props = (bucket as { Properties: Record<string, unknown> }).Properties;
        expect(props['PublicAccessBlockConfiguration']).toEqual({
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        });
        expect(props['BucketEncryption']).toBeDefined();
      }
      for (const policy of Object.values(tpl.findResources('AWS::S3::BucketPolicy'))) {
        expect(JSON.stringify(policy)).toContain('aws:SecureTransport');
      }
    }
  });

  it('no IAM policy grants a wildcard action ("*" or "service:*")', () => {
    for (const tpl of all) {
      for (const type of ['AWS::IAM::Policy', 'AWS::IAM::Role']) {
        for (const [name, res] of Object.entries(tpl.findResources(type))) {
          const text = JSON.stringify(res);
          const actions = [...text.matchAll(/"Action":(\[[^\]]*\]|"[^"]*")/g)].flatMap((m) => {
            const v = JSON.parse(m[1] as string) as string | string[];
            return Array.isArray(v) ? v : [v];
          });
          for (const a of actions) {
            expect(a === '*' || /^[a-z0-9-]+:\*$/.test(a), `${name}: ${a}`).toBe(false);
          }
        }
      }
    }
  });

  it('the table has point-in-time recovery, encryption, the GSI and TTL, on demand', () => {
    t['data']!.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      BillingMode: 'PAY_PER_REQUEST',
      SSESpecification: { SSEEnabled: true },
      TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
      GlobalSecondaryIndexes: [
        Match.objectLike({
          IndexName: 'GSI1',
          KeySchema: [
            { AttributeName: 'GSI1PK', KeyType: 'HASH' },
            { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
          ],
        }),
      ],
      Replicas: [
        Match.objectLike({
          PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
        }),
      ],
    });
  });

  it('the CloudFront site is reached only through Origin Access Control over HTTPS', () => {
    t['web']!.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
    t['web']!.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({ ViewerProtocolPolicy: 'redirect-to-https' }),
        DefaultRootObject: 'index.html',
      }),
    });
  });

  it('there is no VPC and no NAT gateway (ADR 7)', () => {
    for (const tpl of all) {
      tpl.resourceCountIs('AWS::EC2::VPC', 0);
      tpl.resourceCountIs('AWS::EC2::NatGateway', 0);
    }
  });
});

describe('API and worker match the Track 1 handoff', () => {
  it('both functions run Node.js 24 on arm64 with X-Ray tracing and the handoff env vars', () => {
    t['api']!.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'c32-dev-api',
      Runtime: 'nodejs24.x',
      Architectures: ['arm64'],
      Handler: 'index.handler',
      TracingConfig: { Mode: 'Active' },
      Environment: {
        Variables: Match.objectLike({
          PROPERTY_ID: 'p1',
          APP_VERSION: 'test',
          EXPIRY_SCHEDULE_GROUP: 'c32-dev-expiry',
          TABLE_NAME: Match.anyValue(),
          DOCS_BUCKET: Match.anyValue(),
          CORS_ORIGINS: Match.anyValue(),
          EXPIRY_TARGET_ARN: Match.anyValue(),
          EXPIRY_ROLE_ARN: Match.anyValue(),
        }),
      },
    });
    t['api']!.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'c32-dev-worker',
      Runtime: 'nodejs24.x',
      Architectures: ['arm64'],
      DeadLetterConfig: { TargetArn: Match.anyValue() },
    });
  });

  it('/health is public and every /v1 route needs the Cognito JWT authorizer', () => {
    const routes = Object.values(t['api']!.findResources('AWS::ApiGatewayV2::Route')).map(
      (r) => (r as { Properties: { RouteKey: string; AuthorizationType?: string } }).Properties,
    );
    expect(routes.find((r) => r.RouteKey === 'GET /health')?.AuthorizationType ?? 'NONE').toBe(
      'NONE',
    );
    const v1 = routes.filter((r) => r.RouteKey.includes('/v1/'));
    expect(v1.map((r) => r.RouteKey).sort()).toEqual([
      'GET /v1/{proxy+}',
      'POST /v1/{proxy+}',
      'PUT /v1/{proxy+}',
    ]);
    for (const r of v1) expect(r.AuthorizationType).toBe('JWT');
    t['api']!.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
      AuthorizerType: 'JWT',
      JwtConfiguration: Match.objectLike({ Audience: Match.anyValue(), Issuer: Match.anyValue() }),
    });
  });

  it('the stage is throttled and logs access as JSON', () => {
    t['api']!.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      DefaultRouteSettings: { ThrottlingBurstLimit: 100, ThrottlingRateLimit: 50 },
      AccessLogSettings: Match.objectLike({ Format: Match.stringLikeRegexp('requestId') }),
    });
  });

  it('the worker is triggered every 15 minutes (sweep) and nightly (reconcile)', () => {
    t['api']!.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'rate(15 minutes)',
      Targets: [Match.objectLike({ Input: '{"type":"sweep"}' })],
    });
    t['api']!.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'cron(0 21 * * ? *)',
      Targets: [Match.objectLike({ Input: '{"type":"reconcile"}' })],
    });
  });

  it('the API may create expiry schedules only in its group and pass only the scheduler role', () => {
    const text = JSON.stringify(t['api']!.findResources('AWS::IAM::Policy'));
    expect(text).toContain('scheduler:CreateSchedule');
    expect(text).toContain('schedule/c32-dev-expiry/c32-expire-*');
    expect(text).toContain('iam:PassRole');
  });
});

describe('quote and invoice email (D-059)', () => {
  it('a sender identity, and the API may send only as it', () => {
    t['api']!.hasResourceProperties('AWS::SES::EmailIdentity', {
      EmailIdentity: 'forawws@gmail.com',
    });
    t['api']!.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: Match.objectLike({ SENDER_EMAIL: 'forawws@gmail.com' }) },
    });
    const text = JSON.stringify(t['api']!.findResources('AWS::IAM::Policy'));
    expect(text).toContain('ses:SendRawEmail');
    expect(text).not.toContain('ses:*');
    // Any recipient, but only ever sent as the hotel's sender address.
    expect(text).toContain('"ses:FromAddress"');
  });
});

describe('auth, observability and the deploy role', () => {
  it('Cognito has the three role groups and a PKCE client without a secret', () => {
    for (const name of ['Owner', 'Sales', 'Viewer']) {
      t['auth']!.hasResourceProperties('AWS::Cognito::UserPoolGroup', { GroupName: name });
    }
    t['auth']!.hasResourceProperties('AWS::Cognito::UserPool', {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
    });
    t['auth']!.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      GenerateSecret: false,
      AllowedOAuthFlows: ['code'],
    });
  });

  it('alarms cover 5xx, latency, worker errors, the DLQ and ledger drift; the budget emails', () => {
    const names = Object.values(t['obs']!.findResources('AWS::CloudWatch::Alarm')).map(
      (a) => (a as { Properties: { AlarmName: string } }).Properties.AlarmName,
    );
    expect(names.sort()).toEqual([
      'c32-dev-api-5xx',
      'c32-dev-api-latency-p95',
      'c32-dev-ledger-drift',
      'c32-dev-worker-dlq',
      'c32-dev-worker-errors',
    ]);
    t['obs']!.hasResourceProperties('AWS::Budgets::Budget', {
      Budget: Match.objectLike({ BudgetLimit: { Amount: 5, Unit: 'USD' }, TimeUnit: 'MONTHLY' }),
    });
    t['obs']!.hasResourceProperties('AWS::SNS::Subscription', {
      Protocol: 'email',
      Endpoint: 'alerts@example.com',
    });
  });

  it('without an alert email there is no budget and no subscription (nothing half-configured)', () => {
    const quiet = synth('dev', null).t;
    quiet['obs']!.resourceCountIs('AWS::Budgets::Budget', 0);
    quiet['obs']!.resourceCountIs('AWS::SNS::Subscription', 0);
  });

  it('only this repo main branch and prod environment can assume the deploy role', () => {
    const role = JSON.stringify(t['oidc']!.findResources('AWS::IAM::Role'));
    expect(role).toContain('repo:Vikram5002/Group-Stay-Quote-Builder:ref:refs/heads/main');
    expect(role).toContain('repo:Vikram5002/Group-Stay-Quote-Builder:environment:prod');
    expect(role).not.toContain(':*"');
  });

  it('prod keeps its data: tables retained and deletion protected', () => {
    const prod = synth('prod').t;
    prod['data']!.hasResource('AWS::DynamoDB::GlobalTable', { DeletionPolicy: 'Retain' });
    // On a global table, deletion protection is set per replica.
    prod['data']!.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      Replicas: [Match.objectLike({ DeletionProtectionEnabled: true })],
    });
  });
});
