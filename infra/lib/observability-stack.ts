import { Duration, Stack, type StackProps } from 'aws-cdk-lib';
import type * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import type * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import type * as sqs from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';
import type { StageConfig } from './config.js';

export interface ObservabilityStackProps extends StackProps {
  config: StageConfig;
  api: apigw.IHttpApi;
  apiFn: lambda.IFunction;
  workerFn: lambda.IFunction;
  dlq: sqs.IQueue;
}

/**
 * ObservabilityStack (blueprint 13): alarms to an SNS topic (email), one dashboard, and the
 * monthly budget alert. LedgerDrift and ExpiredReleased are the worker's EMF metrics
 * (namespace C32).
 */
export class ObservabilityStack extends Stack {
  readonly topic: sns.Topic;

  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);
    const { config } = props;

    this.topic = new sns.Topic(this, 'Alerts', {
      topicName: `${config.prefix}-alerts`,
      enforceSSL: true,
    });
    if (config.alertEmail)
      this.topic.addSubscription(new subs.EmailSubscription(config.alertEmail));
    const notify = new actions.SnsAction(this.topic);

    const five = Duration.minutes(5);
    const api5xx = props.api.metricServerError({ period: five, statistic: 'Sum' });
    const apiLatency = props.api.metricLatency({ period: five, statistic: 'p95' });
    const workerErrors = props.workerFn.metricErrors({
      period: Duration.minutes(15),
      statistic: 'Sum',
    });
    const dlqDepth = props.dlq.metricApproximateNumberOfMessagesVisible({
      period: five,
      statistic: 'Maximum',
    });
    const drift = new cloudwatch.Metric({
      namespace: 'C32',
      metricName: 'LedgerDrift',
      period: Duration.hours(1),
      statistic: 'Maximum',
    });
    const released = new cloudwatch.Metric({
      namespace: 'C32',
      metricName: 'ExpiredReleased',
      period: Duration.hours(1),
      statistic: 'Sum',
    });

    const alarm = (
      id: string,
      metric: cloudwatch.IMetric,
      threshold: number,
      periods: number,
      description: string,
    ) =>
      new cloudwatch.Alarm(this, id, {
        alarmName: `${config.prefix}-${id}`,
        alarmDescription: description,
        metric,
        threshold,
        evaluationPeriods: periods,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }).addAlarmAction(notify);

    alarm('api-5xx', api5xx, 5, 1, 'API returned 5 or more 5xx responses in 5 minutes');
    alarm('api-latency-p95', apiLatency, 1000, 2, 'API p95 latency at least 1 s for 10 minutes');
    alarm('worker-errors', workerErrors, 1, 1, 'The expiry or reconciliation worker failed');
    alarm('worker-dlq', dlqDepth, 1, 1, 'A worker event landed in the dead-letter queue');
    alarm('ledger-drift', drift, 1, 1, 'Nightly reconciliation found ledger drift (BR-15)');

    new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: `${config.prefix}-quote-builder`,
      widgets: [
        [
          new cloudwatch.GraphWidget({
            title: 'API requests and 5xx',
            left: [props.api.metricCount({ period: five }), api5xx],
          }),
          new cloudwatch.GraphWidget({ title: 'API latency p95 (ms)', left: [apiLatency] }),
        ],
        [
          new cloudwatch.GraphWidget({ title: 'Holds released by expiry', left: [released] }),
          new cloudwatch.GraphWidget({
            title: 'Worker errors and DLQ',
            left: [workerErrors, dlqDepth],
          }),
          new cloudwatch.SingleValueWidget({
            title: 'Ledger drift (last night)',
            metrics: [drift],
          }),
        ],
      ],
    });

    if (config.alertEmail) {
      new budgets.CfnBudget(this, 'Budget', {
        budget: {
          budgetName: `${config.prefix}-monthly`,
          budgetType: 'COST',
          timeUnit: 'MONTHLY',
          budgetLimit: { amount: config.monthlyBudgetUsd, unit: 'USD' },
        },
        notificationsWithSubscribers: [
          {
            notification: {
              notificationType: 'ACTUAL',
              comparisonOperator: 'GREATER_THAN',
              threshold: 80,
              thresholdType: 'PERCENTAGE',
            },
            subscribers: [{ subscriptionType: 'EMAIL', address: config.alertEmail }],
          },
          {
            notification: {
              notificationType: 'FORECASTED',
              comparisonOperator: 'GREATER_THAN',
              threshold: 100,
              thresholdType: 'PERCENTAGE',
            },
            subscribers: [{ subscriptionType: 'EMAIL', address: config.alertEmail }],
          },
        ],
      });
    }
  }
}
