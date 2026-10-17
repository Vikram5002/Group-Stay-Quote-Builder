import type { CreateTableCommandInput } from '@aws-sdk/client-dynamodb';

/**
 * Single-table design (blueprint 8.1, ADR 2). Track 3's DataStack must create the table with
 * exactly these key names, the GSI, on-demand billing and point-in-time recovery.
 *
 * | Entity          | PK               | SK                          |
 * | --------------- | ---------------- | --------------------------- |
 * | Policy          | PROP#<property>  | CONFIG#POLICY               |
 * | Rate plan night | PROP#<property>  | RATE#<room_type>#<date>     |
 * | Inventory night | PROP#<property>  | INV#<room_type>#<date>      |
 * | Quote           | PROP#<property>  | QUOTE#<quote_id>            |
 * | Hold line       | QUOTE#<quote_id> | HOLD#<room_type>#<date>     |
 * | Audit event     | QUOTE#<quote_id> | EVT#<event_id>              |
 *
 * GSI1 lists quotes by status: GSI1PK = PROP#<property>#STATUS#<status>,
 * GSI1SK = valid_until (open quotes) or created_at.
 */
export const TABLE = {
  defaultName: 'c32-main',
  partitionKey: 'PK',
  sortKey: 'SK',
  gsi1: { name: 'GSI1', partitionKey: 'GSI1PK', sortKey: 'GSI1SK' },
} as const;

/** CreateTable input for DynamoDB Local and tests. Production tables come from CDK. */
export function createTableInput(tableName: string): CreateTableCommandInput {
  return {
    TableName: tableName,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: TABLE.partitionKey, AttributeType: 'S' },
      { AttributeName: TABLE.sortKey, AttributeType: 'S' },
      { AttributeName: TABLE.gsi1.partitionKey, AttributeType: 'S' },
      { AttributeName: TABLE.gsi1.sortKey, AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: TABLE.partitionKey, KeyType: 'HASH' },
      { AttributeName: TABLE.sortKey, KeyType: 'RANGE' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: TABLE.gsi1.name,
        KeySchema: [
          { AttributeName: TABLE.gsi1.partitionKey, KeyType: 'HASH' },
          { AttributeName: TABLE.gsi1.sortKey, KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  };
}

/** Key builders. All key strings in the codebase come from here. */
export const keys = {
  property: (propertyId: string) => `PROP#${propertyId}`,
  policy: () => 'CONFIG#POLICY',
  rate: (roomType: string, date: string) => `RATE#${roomType}#${date}`,
  ratePrefix: (roomType: string) => `RATE#${roomType}#`,
  inventory: (roomType: string, date: string) => `INV#${roomType}#${date}`,
  inventoryPrefix: (roomType: string) => `INV#${roomType}#`,
  quote: (quoteId: string) => `QUOTE#${quoteId}`,
  hold: (roomType: string, date: string) => `HOLD#${roomType}#${date}`,
  holdPrefix: () => 'HOLD#',
  event: (eventId: string) => `EVT#${eventId}`,
  statusIndex: (propertyId: string, status: string) => `PROP#${propertyId}#STATUS#${status}`,
} as const;
