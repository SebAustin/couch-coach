import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { bedrockInvokeArns } from '../lib/bedrock-arns';
import { COACH_FUNCTION_NAME, CouchCoachStack, DEFAULT_MODEL_PROFILE } from '../lib/couch-coach-stack';

const ACCOUNT = '111122223333';

function synth(context: Record<string, string> = { budgetEmail: 'alerts@example.com' }) {
  const app = new cdk.App({ context });
  const stack = new CouchCoachStack(app, 'CouchCoachStack', { env: { account: ACCOUNT, region: 'us-east-1' } });
  return Template.fromStack(stack);
}

let template: Template;
beforeAll(() => {
  template = synth();
});

type Statement = { Action: string | string[]; Effect: string; Resource: unknown };
const statementsOf = (policyLogicalIdPrefix: string): Statement[] => {
  const policies = template.findResources('AWS::IAM::Policy');
  const key = Object.keys(policies).find((k) => k.startsWith(policyLogicalIdPrefix));
  expect(key, `policy ${policyLogicalIdPrefix}`).toBeDefined();
  return policies[key!]!.Properties.PolicyDocument.Statement;
};
const actionsOf = (s: Statement) => (Array.isArray(s.Action) ? s.Action : [s.Action]);

describe('AppSync Events', () => {
  it('creates an Events API with API-key auth for connect, publish and subscribe', () => {
    template.hasResourceProperties('AWS::AppSync::Api', {
      EventConfig: {
        AuthProviders: [{ AuthType: 'API_KEY' }],
        ConnectionAuthModes: [{ AuthType: 'API_KEY' }],
        DefaultPublishAuthModes: [{ AuthType: 'API_KEY' }],
        DefaultSubscribeAuthModes: [{ AuthType: 'API_KEY' }],
      },
    });
  });

  it('exposes the cc channel namespace', () => {
    template.hasResourceProperties('AWS::AppSync::ChannelNamespace', { Name: 'cc' });
  });

  it('issues an API key that expires on 2026-12-15', () => {
    template.hasResourceProperties('AWS::AppSync::ApiKey', { Expires: Date.UTC(2026, 11, 15) / 1000 });
  });
});

describe('data', () => {
  it('has one on-demand table keyed pk/sk with a ttl attribute', () => {
    template.resourceCountIs('AWS::DynamoDB::Table', 1);
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
      KeySchema: [
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
      TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
    });
  });

  it('generates the HMAC key in Secrets Manager instead of taking it from source', () => {
    template.hasResourceProperties('AWS::SecretsManager::Secret', {
      GenerateSecretString: Match.objectLike({ PasswordLength: 48 }),
    });
  });

  it('keeps both buckets private, TLS-only, and expires audio after one day', () => {
    const buckets = template.findResources('AWS::S3::Bucket');
    expect(Object.keys(buckets)).toHaveLength(2);
    for (const b of Object.values(buckets)) {
      expect(b.Properties.PublicAccessBlockConfiguration).toEqual({
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      });
    }
    template.hasResourceProperties('AWS::S3::Bucket', {
      LifecycleConfiguration: { Rules: [Match.objectLike({ ExpirationInDays: 1, Status: 'Enabled' })] },
    });
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: { Statement: Match.arrayWith([Match.objectLike({ Effect: 'Deny', Condition: { Bool: { 'aws:SecureTransport': 'false' } } })]) },
    });
  });
});

describe('HTTP API', () => {
  it('allows CORS from anywhere for GET, POST, OPTIONS with content-type', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      ProtocolType: 'HTTP',
      CorsConfiguration: Match.objectLike({
        AllowOrigins: ['*'],
        AllowMethods: Match.arrayEquals(['GET', 'POST', 'OPTIONS']),
        AllowHeaders: ['content-type'],
      }),
    });
  });

  it('throttles the default stage at 5 rps with a burst of 10', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      StageName: '$default',
      AutoDeploy: true,
      DefaultRouteSettings: { ThrottlingRateLimit: 5, ThrottlingBurstLimit: 10 },
    });
  });

  it('routes the four documented operations', () => {
    const routes = Object.values(template.findResources('AWS::ApiGatewayV2::Route')).map((r) => r.Properties.RouteKey);
    expect(routes.sort()).toEqual(['GET /members', 'POST /coach', 'POST /members', 'POST /session']);
  });
});

describe('Lambdas', () => {
  const fns = () => Object.values(template.findResources('AWS::Lambda::Function')).filter((f) => f.Properties.Environment?.Variables?.TABLE_NAME);

  it('are arm64 Node 22+ with structured JSON logs', () => {
    expect(fns()).toHaveLength(2);
    for (const f of fns()) {
      expect(f.Properties.Architectures).toEqual(['arm64']);
      expect(f.Properties.Runtime).toMatch(/^nodejs(2[2-9]|[3-9]\d)\.x$/);
      expect(f.Properties.LoggingConfig).toMatchObject({ LogFormat: 'JSON' });
    }
  });

  it('configures the coach with the Bedrock profile, Polly voice and no async retries', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: COACH_FUNCTION_NAME,
      Environment: { Variables: Match.objectLike({ MODEL_ID: DEFAULT_MODEL_PROFILE, POLLY_VOICE_ID: 'Matthew', SELF_FUNCTION_NAME: COACH_FUNCTION_NAME }) },
    });
    template.hasResourceProperties('AWS::Lambda::EventInvokeConfig', { MaximumRetryAttempts: 0 });
  });

  it('never puts the HMAC key itself in the environment, only the secret ARN', () => {
    const json = JSON.stringify(template.toJSON());
    expect(json).not.toContain('resolve:secretsmanager');
  });
});

describe('least-privilege IAM', () => {
  it('scopes the coach role to specific ARNs (Polly SynthesizeSpeech is the one AWS-mandated "*")', () => {
    const statements = statementsOf('CoachFnServiceRoleDefaultPolicy');

    const wildcard = statements.filter((s) => s.Resource === '*');
    expect(wildcard.map(actionsOf)).toEqual([['polly:SynthesizeSpeech']]);

    const bedrock = statements.find((s) => actionsOf(s).includes('bedrock:InvokeModel'))!;
    expect(actionsOf(bedrock)).toEqual(['bedrock:InvokeModel']);
    expect(bedrock.Resource).toEqual([
      `arn:aws:bedrock:us-east-1:${ACCOUNT}:inference-profile/${DEFAULT_MODEL_PROFILE}`,
      'arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0',
      'arn:aws:bedrock:us-east-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0',
      'arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0',
    ]);

    const self = statements.find((s) => actionsOf(s).includes('lambda:InvokeFunction'))!;
    expect(JSON.stringify(self.Resource)).toContain(`function:${COACH_FUNCTION_NAME}`);
  });

  it('limits the coach to the audio/ prefix of the audio bucket', () => {
    const s3 = statementsOf('CoachFnServiceRoleDefaultPolicy').find((s) => actionsOf(s).includes('s3:PutObject'))!;

    expect(actionsOf(s3).sort()).toEqual(['s3:GetObject', 's3:PutObject']);
    expect(JSON.stringify(s3.Resource)).toContain('/audio/*');
  });

  it('gives the session role no Bedrock, Polly or S3 access and queries only the members index', () => {
    const statements = statementsOf('SessionFnServiceRoleDefaultPolicy');
    const actions = statements.flatMap(actionsOf);

    expect(actions.filter((a) => /^(bedrock|polly|s3|lambda):/.test(a))).toEqual([]);
    const query = statements.find((s) => actionsOf(s).includes('dynamodb:Query'))!;
    expect(JSON.stringify(query.Resource)).toContain('/index/byHousehold');
  });

  it('uses "*" nowhere else except CDK-managed CloudFront invalidation, and never grants Action "*"', () => {
    const allowedWildcard = new Set(['polly:SynthesizeSpeech', 'cloudfront:GetInvalidation', 'cloudfront:CreateInvalidation']);
    for (const policy of Object.values(template.findResources('AWS::IAM::Policy'))) {
      for (const s of policy.Properties.PolicyDocument.Statement as Statement[]) {
        const actions = actionsOf(s);
        expect(actions.every((a) => a !== '*' && !a.endsWith(':*'))).toBe(true);
        if (s.Resource === '*') expect(actions.every((a) => allowedWildcard.has(a))).toBe(true);
      }
    }
  });
});

describe('phone web app delivery', () => {
  it('serves index.html through CloudFront over HTTPS only, origin locked with OAC', () => {
    template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultRootObject: 'index.html',
        DefaultCacheBehavior: Match.objectLike({ ViewerProtocolPolicy: 'redirect-to-https' }),
      }),
    });
  });

  const deployments = () => Object.values(template.findResources('Custom::CDKBucketDeployment')).map((d) => d.Properties);

  it('deploys config.json with the shell, uncached, via deploy-time substitution of the stack values', () => {
    const shell = deployments().find((d) => d.Exclude && d.Include?.includes('config.json'))!;

    expect(shell.Include).toEqual(['index.html', 'config.json']);
    expect(shell.SystemMetadata['cache-control']).toBe('no-cache');
    expect(JSON.stringify(shell.SourceMarkers)).toContain('marker');
  });

  it('caches the MediaPipe runtime, models and hashed assets for a year', () => {
    const cached = deployments().filter((d) => d.SystemMetadata['cache-control']?.includes('max-age=31536000'));

    expect(cached.flatMap((d) => d.Include)).toEqual(expect.arrayContaining(['assets/*', 'mediapipe/*', 'models/*', '*.wasm', '*.task']));
  });

  it('serves .wasm as application/wasm and .task as application/octet-stream', () => {
    const byInclude = (pattern: string) => deployments().find((d) => d.Include?.includes(pattern))!;

    expect(byInclude('*.wasm').SystemMetadata['content-type']).toBe('application/wasm');
    expect(byInclude('*.task').SystemMetadata['content-type']).toBe('application/octet-stream');
  });

  it('never prunes, so the per-class deployments cannot delete each other', () => {
    for (const d of deployments()) expect(d.Prune).toBe(false);
  });

  it('invalidates CloudFront after each deployment', () => {
    for (const d of deployments()) expect(d.DistributionPaths).toEqual(['/*']);
  });
});

describe('budget and alarms', () => {
  it('sets a $50 monthly cost budget that emails at 80% actual spend', () => {
    template.hasResourceProperties('AWS::Budgets::Budget', {
      Budget: Match.objectLike({ BudgetType: 'COST', TimeUnit: 'MONTHLY', BudgetLimit: { Amount: 50, Unit: 'USD' } }),
      NotificationsWithSubscribers: [
        {
          Notification: Match.objectLike({ NotificationType: 'ACTUAL', ComparisonOperator: 'GREATER_THAN', Threshold: 80, ThresholdType: 'PERCENTAGE' }),
          Subscribers: [{ SubscriptionType: 'EMAIL', Address: 'alerts@example.com' }],
        },
      ],
    });
  });

  it('refuses to synth without budgetEmail, so the address is never hard-coded', () => {
    expect(() => synth({})).toThrow(/budgetEmail/);
  });

  it('alarms on API 5xx and on coach Lambda errors, notifying SNS', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', { MetricName: '5xx', Namespace: 'AWS/ApiGateway', AlarmActions: [Match.anyValue()] });
    template.hasResourceProperties('AWS::CloudWatch::Alarm', { MetricName: 'Errors', Namespace: 'AWS/Lambda', AlarmActions: [Match.anyValue()] });
  });
});

describe('outputs', () => {
  it('exports everything the clients need', () => {
    const outputs = Object.keys(template.toJSON().Outputs);
    expect(outputs).toEqual(expect.arrayContaining(['apiBaseUrl', 'eventsHttpHost', 'eventsRealtimeHost', 'eventsApiKey', 'phoneUrl']));
  });
});

describe('bedrockInvokeArns', () => {
  it('maps a us. profile to the profile ARN plus its three routable foundation models', () => {
    expect(bedrockInvokeArns('us.anthropic.claude-haiku-5-5', ACCOUNT, 'us-east-1')).toEqual([
      `arn:aws:bedrock:us-east-1:${ACCOUNT}:inference-profile/us.anthropic.claude-haiku-5-5`,
      'arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-haiku-5-5',
      'arn:aws:bedrock:us-east-2::foundation-model/anthropic.claude-haiku-5-5',
      'arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-haiku-5-5',
    ]);
  });

  it('rejects profiles it cannot map instead of widening the grant', () => {
    expect(() => bedrockInvokeArns('global.anthropic.claude-haiku-5-5', ACCOUNT, 'us-east-1')).toThrow(/Unsupported/);
  });
});
