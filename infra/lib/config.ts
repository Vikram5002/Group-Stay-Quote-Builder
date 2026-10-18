import { RemovalPolicy } from 'aws-cdk-lib';

/**
 * One deployment stage (blueprint 7.4): dev is auto-deployed from main; prod is the
 * examiner-facing release deployed from a tag. Values come from CDK context (-c key=value).
 */
export interface StageConfig {
  stage: 'dev' | 'prod';
  account: string;
  region: string;
  /** Stack and resource name prefix, for example "c32-dev". */
  prefix: string;
  /** Receives budget and alarm emails; no email subscription when unset. */
  alertEmail: string | undefined;
  /** Sender of quote and invoice emails (SES identity, D-059). */
  senderEmail: string;
  monthlyBudgetUsd: number;
  /** Cognito hosted UI prefix; must be globally unique. */
  cognitoDomainPrefix: string;
  /** owner/name, for the GitHub OIDC deploy role. */
  githubRepo: string;
  /** Browser origins besides the CloudFront site, for local development against AWS. */
  extraOrigins: string[];
  /** Retain data in prod; destroy everything in dev so `cdk destroy` leaves no cost behind. */
  removalPolicy: RemovalPolicy;
}

type Context = (key: string) => unknown;

export function stageConfig(ctx: Context, account: string, region: string): StageConfig {
  const stage = ctx('stage') === 'prod' ? 'prod' : 'dev';
  const str = (key: string) => {
    const v = ctx(key);
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
  };
  return {
    stage,
    account,
    region,
    prefix: `c32-${stage}`,
    alertEmail: str('alertEmail'),
    senderEmail: str('senderEmail') ?? 'forawws@gmail.com',
    monthlyBudgetUsd: Number(str('budgetUsd') ?? 5),
    cognitoDomainPrefix: str('cognitoDomain') ?? `c32-quote-${stage}-${account}`,
    githubRepo: str('githubRepo') ?? 'Vikram5002/Group-Stay-Quote-Builder',
    extraOrigins: stage === 'dev' ? ['http://localhost:5173'] : [],
    removalPolicy: stage === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
  };
}
