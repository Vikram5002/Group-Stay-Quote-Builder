import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { Policy } from '@c32/core';
import type { DataContext } from './catalog.js';
import { VersionConflictError } from './errors.js';
import { keys } from './table.js';

/** The property's policy, or null when none has been saved yet. */
export async function getPolicy(ctx: DataContext): Promise<Policy | null> {
  const out = await ctx.doc.send(
    new GetCommand({
      TableName: ctx.tableName,
      Key: { PK: keys.property(ctx.propertyId), SK: keys.policy() },
      ConsistentRead: true,
    }),
  );
  if (!out.Item) return null;
  const { PK: _pk, SK: _sk, entity: _e, ...fields } = out.Item;
  return Policy.parse(fields);
}

/**
 * Save the policy if it is still at `policy.version` (or does not exist yet when that is 0).
 * The stored version becomes `policy.version + 1`. A stale write throws VersionConflictError.
 */
export async function savePolicy(ctx: DataContext, policy: Policy): Promise<Policy> {
  const next: Policy = { ...policy, property_id: ctx.propertyId, version: policy.version + 1 };
  try {
    await ctx.doc.send(
      new PutCommand({
        TableName: ctx.tableName,
        Item: { PK: keys.property(ctx.propertyId), SK: keys.policy(), entity: 'POLICY', ...next },
        ConditionExpression:
          policy.version === 0 ? 'attribute_not_exists(PK)' : 'version = :expected',
        ...(policy.version === 0
          ? {}
          : { ExpressionAttributeValues: { ':expected': policy.version } }),
      }),
    );
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException)
      throw new VersionConflictError(policy.version);
    throw err;
  }
  return next;
}
