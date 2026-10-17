# infra (Track 3)

AWS CDK app in TypeScript: DataStack, AuthStack, ApiStack, WebStack and ObservabilityStack (blueprint section 15.2). No VPC and no NAT gateway; least-privilege IAM per function; budget alarm before the first deploy.

Starts on branch `T3.01`. The Lambda entry point is `apps/api/src/lambda.ts` (export `handler`).
