# Deployment proof (AWS dev)

Checked on 2026-10-18. Region `ap-south-1`, account owned by the team. Synthetic data only.

| What    | Value                                                                                    |
| ------- | ---------------------------------------------------------------------------------------- |
| Website | https://d3rs3n5bwfxtd9.cloudfront.net (Cognito sign-in)                                  |
| API     | https://q2etqj5j4d.execute-api.ap-south-1.amazonaws.com                                  |
| Health  | `{"status":"ok","service":"c32-api","version":"dev-a82b971","contract_version":"0.1.0"}` |

## CloudFormation stacks

| Stack                   | Status          |
| ----------------------- | --------------- |
| `c32-dev-web`           | UPDATE_COMPLETE |
| `c32-dev-web-content`   | CREATE_COMPLETE |
| `c32-dev-data`          | CREATE_COMPLETE |
| `c32-dev-auth`          | UPDATE_COMPLETE |
| `c32-dev-api`           | CREATE_COMPLETE |
| `c32-dev-observability` | CREATE_COMPLETE |
| `c32-github-oidc`       | CREATE_COMPLETE |

## Smoke test results

- The three public checks pass on the live API with real Cognito tokens
  ([public-checks-live.json](public-checks-live.json)).
- Calls without a valid token are refused (401); a Sales user cannot approve (403); an Owner's
  approval followed by a Sales confirmation works; the audit trail records each step.
- The live evidence bundle is exported by the API itself
  ([evidence-bundle-live.zip](evidence-bundle-live.zip)).

Infrastructure is defined in `infra/` (AWS CDK) and operated with
[the runbook](../../docs/architecture/runbook.md).
