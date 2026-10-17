import { App, Tags } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ApiStack } from '../lib/api-stack.js';
import { AuthStack } from '../lib/auth-stack.js';
import { stageConfig } from '../lib/config.js';
import { DataStack } from '../lib/data-stack.js';
import { GitHubOidcStack } from '../lib/github-oidc-stack.js';
import { ObservabilityStack } from '../lib/observability-stack.js';
import { WebContentStack } from '../lib/web-content-stack.js';
import { WebStack } from '../lib/web-stack.js';

/**
 * The C32 CDK app. Deploy order: Web -> Data, Auth (need the site URL for CORS and redirects)
 * -> Api -> Observability -> WebContent (the built app, once the API and Cognito exist).
 *   npm run bundle -w @c32/api            # Lambda code, required
 *   npx cdk deploy --all -c stage=dev -c alertEmail=you@example.com
 */
const app = new App();
const account = process.env['CDK_DEFAULT_ACCOUNT'] ?? '000000000000';
const region = process.env['CDK_DEFAULT_REGION'] ?? 'ap-south-1';
const config = stageConfig((k) => app.node.tryGetContext(k), account, region);
const env = { account, region };
const repo = fileURLToPath(new URL('../../', import.meta.url));

function lambdaCode(name: 'api' | 'worker'): lambda.Code {
  const dir = `${repo}apps/api/dist-lambda/${name}`;
  if (!existsSync(`${dir}/index.mjs`)) {
    throw new Error(`Missing ${dir}/index.mjs: run "npm run bundle -w @c32/api" first`);
  }
  return lambda.Code.fromAsset(dir);
}

const p = config.prefix;
const web = new WebStack(app, `${p}-web`, { env, config });
const appOrigins = [web.siteUrl, ...config.extraOrigins];

const data = new DataStack(app, `${p}-data`, { env, config, allowedOrigins: appOrigins });
const auth = new AuthStack(app, `${p}-auth`, { env, config, appOrigins });
const api = new ApiStack(app, `${p}-api`, {
  env,
  config,
  table: data.table,
  docs: data.docs,
  userPool: auth.userPool,
  userPoolClient: auth.client,
  appOrigins,
  apiCode: lambdaCode('api'),
  workerCode: lambdaCode('worker'),
  appVersion: String(app.node.tryGetContext('version') ?? 'dev'),
});
new ObservabilityStack(app, `${p}-observability`, {
  env,
  config,
  api: api.api,
  apiFn: api.apiFn,
  workerFn: api.workerFn,
  dlq: api.dlq,
});

const webDist = `${repo}apps/web/dist`;
if (existsSync(`${webDist}/index.html`)) {
  new WebContentStack(app, `${p}-web-content`, {
    env,
    site: web.site,
    distribution: web.distribution,
    distDir: webDist,
  });
}

// One deploy role per account, created with dev.
if (config.stage === 'dev') {
  new GitHubOidcStack(app, 'c32-github-oidc', { env, githubRepo: config.githubRepo });
}

Tags.of(app).add('project', 'c32-group-quote');
Tags.of(app).add('stage', config.stage);
