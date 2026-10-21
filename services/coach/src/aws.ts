import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createSecretReader } from '../../shared/secret';

export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const secrets = new SecretsManagerClient({});
export const getSecretString = createSecretReader(
  async (arn) => (await secrets.send(new GetSecretValueCommand({ SecretId: arn }))).SecretString,
);
