import * as cdk from 'aws-cdk-lib';
import { CouchCoachStack } from '../lib/couch-coach-stack';

const app = new cdk.App();
new CouchCoachStack(app, 'CouchCoachStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' },
  description: 'Couch Coach: AppSync Events, session + coach Lambdas, Bedrock, Polly, phone web app',
});
