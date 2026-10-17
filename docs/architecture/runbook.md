# Runbook (dev, ap-south-1)

Operating the deployed system. Stacks are defined in `infra/` (CDK); deployment needs are in
[track1-handoff.md](track1-handoff.md).

## Live dev endpoints

| What        | Value                                                                                 |
| ----------- | ------------------------------------------------------------------------------------- |
| API         | `https://q2etqj5j4d.execute-api.ap-south-1.amazonaws.com`                             |
| Site        | `https://d3rs3n5bwfxtd9.cloudfront.net` (empty until the web app has Cognito sign-in) |
| Cognito     | pool `ap-south-1_G8UVQ0PIf`, client `30kcsc12prvktae0h5pm80uqu8`                      |
| Hosted UI   | `https://c32-quote-dev-187478112301.auth.ap-south-1.amazoncognito.com`                |
| Table       | `c32-dev-main`                                                                        |
| Deploy role | `arn:aws:iam::187478112301:role/c32-github-deploy` (GitHub OIDC)                      |

These are dev, synthetic data only.

## Deploy

Automatic: every push to `main` runs `.github/workflows/deploy-dev.yml` once the repository
variable `AWS_DEPLOY_ROLE_ARN` is set (Settings, Secrets and variables, Actions, Variables).

By hand (an admin IAM user, never root):

```bash
npm ci && npm run bundle -w @c32/api
cd infra && npx cdk deploy c32-dev-web c32-dev-data c32-dev-auth c32-dev-api c32-dev-observability \
  -c stage=dev -c version=dev-$(git rev-parse --short HEAD) -c alertEmail=you@example.com \
  --require-approval never
```

## Seed the case fixture

```bash
SEED_ALLOW_AWS=1 TABLE_NAME=c32-dev-main AWS_REGION=ap-south-1 npm run seed -w @c32/api
```

## Users

Admins create users (no self sign-up). Groups: `Sales`, `Owner`, `Viewer`.

```bash
aws cognito-idp admin-create-user --user-pool-id ap-south-1_G8UVQ0PIf --username name@example.com \
  --user-attributes Name=email,Value=name@example.com Name=email_verified,Value=true
aws cognito-idp admin-add-user-to-group --user-pool-id ap-south-1_G8UVQ0PIf \
  --username name@example.com --group-name Sales
```

Cognito emails a temporary password. Two smoke-test users exist (`smoke-sales@example.com`,
`smoke-owner@example.com`) with random passwords nobody knows; reset them with
`admin-set-user-password` when needed, or delete them.

## Smoke test

```bash
curl -s https://q2etqj5j4d.execute-api.ap-south-1.amazonaws.com/health          # 200
curl -s -o /dev/null -w '%{http_code}' .../v1/quotes                            # 401
```

Verified on 2026-10-17 with real Cognito tokens: the three public checks, approval by an Owner,
confirmation, 403 for a Sales approval, and the audit trail.

## When an alarm fires

| Alarm                     | First look                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `c32-dev-api-5xx`         | CloudWatch logs `/aws/lambda/c32-dev-api`, filter `"level":"error"`                                         |
| `c32-dev-api-latency-p95` | Cold starts vs steady latency on the dashboard                                                              |
| `c32-dev-worker-errors`   | `/aws/lambda/c32-dev-worker`                                                                                |
| `c32-dev-worker-dlq`      | Read the message in `c32-dev-worker-dlq`, fix, then redrive                                                 |
| `c32-dev-ledger-drift`    | The `ledger_drift` log line and `reports/reconcile-*.json` in the docs bucket; never patch counters blindly |

## Roll back

Redeploy the previous commit or tag (`git checkout <tag>` then the deploy command). Data changes
are additive, so code rollback is safe.

## Restore drill (point-in-time recovery)

```bash
aws dynamodb restore-table-to-point-in-time --source-table-name c32-dev-main \
  --target-table-name c32-dev-main-restore --restore-date-time <ISO time>
```

Compare item counts, then point `TABLE_NAME` at the restored table if it is the right one, and
delete the old table afterwards.

## Tear down (end of the course)

```bash
cd infra && npx cdk destroy --all -c stage=dev
```

Dev buckets and tables are created with destroy-on-delete, so nothing billable is left behind
except the small CDKToolkit stack (`aws cloudformation delete-stack --stack-name CDKToolkit`).

## Cost drivers

Everything is pay-per-use (blueprint 13.3): Lambda, HTTP API, DynamoDB on demand, S3,
CloudFront, Cognito (free tier covers a course's users), CloudWatch logs (14-day retention).
No VPC, NAT gateway or always-on server. Fill real numbers from Cost Explorer after a week of use.
