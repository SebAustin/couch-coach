import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cw from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import type { Construct } from 'constructs';
import { bedrockInvokeArns } from './bedrock-arns';

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
// NodejsFunction bundles with `npx --no-install esbuild` run from projectRoot, so projectRoot must be the
// folder where esbuild is installed (infra/). Entries are stubs in infra/lambda/ re-exporting services/*.
const INFRA_ROOT = here('../');


/** Newest Haiku profile this account can actually invoke (Haiku 5.5 is listed but denied for this account). */
export const DEFAULT_MODEL_PROFILE = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
export const EVENTS_API_KEY_EXPIRES = '2026-12-15T00:00:00Z';
export const MEMBERS_INDEX = 'byHousehold';
export const COACH_FUNCTION_NAME = 'couch-coach-coach';
export const THROTTLE = { rateLimit: 5, burstLimit: 10 } as const;
const BUDGET_USD = 50;

export class CouchCoachStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    cdk.Tags.of(this).add('project', 'couch-coach');

    const budgetEmail = this.node.tryGetContext('budgetEmail') as string | undefined;
    if (!budgetEmail) {
      throw new Error('Pass the budget alert address with: -c budgetEmail=<address> (never hard-coded in source)');
    }
    const modelProfile = (this.node.tryGetContext('bedrockProfileId') as string | undefined) ?? DEFAULT_MODEL_PROFILE;

    // ---------------------------------------------------------------- data
    const table = new dynamodb.Table(this, 'Table', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    // Sparse index: only MEMBER profile items carry gsi1pk, so listing the Household never scans Sets.
    table.addGlobalSecondaryIndex({
      indexName: MEMBERS_INDEX,
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const hmacSecret = new secretsmanager.Secret(this, 'HmacSecret', {
      description: 'HMAC-SHA256 key for Couch Coach phone tokens',
      generateSecretString: { passwordLength: 48, excludePunctuation: true },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const audioBucket = new s3.Bucket(this, 'AudioBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [{ prefix: 'audio/', expiration: cdk.Duration.days(1), abortIncompleteMultipartUploadAfter: cdk.Duration.days(1) }],
      cors: [{ allowedMethods: [s3.HttpMethods.GET], allowedOrigins: ['*'], allowedHeaders: ['*'] }],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // ------------------------------------------------------ AppSync Events
    const apiKeyExpiry = cdk.Expiration.atDate(new Date(EVENTS_API_KEY_EXPIRES));
    const events = new appsync.EventApi(this, 'Events', {
      apiName: 'couch-coach-events',
      authorizationConfig: {
        authProviders: [
          {
            authorizationType: appsync.AppSyncAuthorizationType.API_KEY,
            apiKeyConfig: { name: 'couch-coach-client', description: 'Public client key for /cc/*', expires: apiKeyExpiry },
          },
        ],
        connectionAuthModeTypes: [appsync.AppSyncAuthorizationType.API_KEY],
        defaultPublishAuthModeTypes: [appsync.AppSyncAuthorizationType.API_KEY],
        defaultSubscribeAuthModeTypes: [appsync.AppSyncAuthorizationType.API_KEY],
      },
    });
    events.addChannelNamespace('cc', { channelNamespaceName: 'cc' });
    const eventsApiKey = Object.values(events.apiKeys)[0]!.attrApiKey;

    // ------------------------------------------------------------ phone web
    const phoneBucket = new s3.Bucket(this, 'PhoneBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    const distribution = new cloudfront.Distribution(this, 'PhoneCdn', {
      comment: 'Couch Coach phone web app',
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(phoneBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        compress: true,
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });
    const phoneUrl = `https://${distribution.distributionDomainName}`;

    // ------------------------------------------------------------- lambdas
    const lambdaDefaults = (name: string, entry: string) => ({
      entry: here(entry),
      projectRoot: INFRA_ROOT,
      depsLockFilePath: here('../package-lock.json'),
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      loggingFormat: lambda.LoggingFormat.JSON,
      logGroup: new logs.LogGroup(this, `${name}Logs`, {
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
      bundling: { minify: true, target: 'node22', sourceMap: false },
    });

    const sessionFn = new NodejsFunction(this, 'SessionFn', {
      ...lambdaDefaults('Session', '../lambda/session.ts'),
      description: 'Couch Coach: members and sessions',
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      environment: {
        TABLE_NAME: table.tableName,
        HMAC_SECRET_ARN: hmacSecret.secretArn,
        PHONE_BASE_URL: phoneUrl,
      },
    });

    const coachFn = new NodejsFunction(this, 'CoachFn', {
      ...lambdaDefaults('Coach', '../lambda/coach.ts'),
      // Fixed name: the function invokes itself asynchronously, and the ARN must not reference the function
      // resource (that would make the role depend on the function and the function on its role).
      functionName: COACH_FUNCTION_NAME,
      description: 'Couch Coach: Cue generation (Bedrock Converse + Polly + AppSync Events)',
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      environment: {
        TABLE_NAME: table.tableName,
        HMAC_SECRET_ARN: hmacSecret.secretArn,
        AUDIO_BUCKET: audioBucket.bucketName,
        EVENTS_HTTP_HOST: events.httpDns,
        EVENTS_API_KEY: eventsApiKey,
        MODEL_ID: modelProfile,
        POLLY_VOICE_ID: 'Matthew',
        SELF_FUNCTION_NAME: COACH_FUNCTION_NAME,
      },
    });
    coachFn.configureAsyncInvoke({ retryAttempts: 0, maxEventAge: cdk.Duration.minutes(2) });

    // ----------------------------------------------- least-privilege access
    const allow = (fn: lambda.Function, actions: string[], resources: string[]) =>
      fn.addToRolePolicy(new iam.PolicyStatement({ actions, resources }));

    allow(sessionFn, ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem'], [table.tableArn]);
    allow(sessionFn, ['dynamodb:Query'], [`${table.tableArn}/index/${MEMBERS_INDEX}`]);
    allow(sessionFn, ['secretsmanager:GetSecretValue'], [hmacSecret.secretArn]);

    allow(coachFn, ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:Query'], [table.tableArn]);
    allow(coachFn, ['secretsmanager:GetSecretValue'], [hmacSecret.secretArn]);
    allow(coachFn, ['s3:PutObject', 's3:GetObject'], [audioBucket.arnForObjects('audio/*')]);
    // Polly SynthesizeSpeech has no resource-level permissions; "*" is what the service requires.
    allow(coachFn, ['polly:SynthesizeSpeech'], ['*']);
    allow(coachFn, ['bedrock:InvokeModel'], bedrockInvokeArns(modelProfile, this.account, this.region));
    allow(
      coachFn,
      ['lambda:InvokeFunction'],
      [this.formatArn({ service: 'lambda', resource: 'function', resourceName: COACH_FUNCTION_NAME, arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME })],
    );

    // ------------------------------------------------------------ HTTP API
    const api = new apigw.HttpApi(this, 'Api', {
      apiName: 'couch-coach',
      createDefaultStage: false,
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [apigw.CorsHttpMethod.GET, apigw.CorsHttpMethod.POST, apigw.CorsHttpMethod.OPTIONS],
        allowHeaders: ['content-type'],
        maxAge: cdk.Duration.days(1),
      },
    });
    new apigw.HttpStage(this, 'DefaultStage', {
      httpApi: api,
      stageName: '$default',
      autoDeploy: true,
      throttle: THROTTLE,
    });
    const sessionIntegration = new HttpLambdaIntegration('SessionIntegration', sessionFn);
    api.addRoutes({ path: '/members', methods: [apigw.HttpMethod.GET, apigw.HttpMethod.POST], integration: sessionIntegration });
    api.addRoutes({ path: '/session', methods: [apigw.HttpMethod.POST], integration: sessionIntegration });
    api.addRoutes({ path: '/coach', methods: [apigw.HttpMethod.POST], integration: new HttpLambdaIntegration('CoachIntegration', coachFn) });

    // ----------------------------------------------- client config + phone app
    const phoneDist = (this.node.tryGetContext('phoneDistPath') as string | undefined) ?? here('../../apps/phone/dist');
    const phoneAssets = existsSync(phoneDist) ? phoneDist : here('../placeholder-phone');
    const clientConfig = {
      apiBaseUrl: api.apiEndpoint,
      eventsHttpHost: events.httpDns,
      eventsRealtimeHost: events.realtimeDns,
      eventsApiKey,
      phoneUrl,
    };
    // One BucketDeployment per cache/content-type class (cacheControl and contentType are per deployment),
    // selected with `aws s3 sync` filters (applied in order, later ones win). prune must stay off:
    // the deployments share the bucket root and would otherwise delete each other's files.
    const LONG_CACHE = s3deploy.CacheControl.fromString('public, max-age=31536000, immutable');
    const NO_CACHE = s3deploy.CacheControl.fromString('no-cache');
    const phoneApp = s3deploy.Source.asset(phoneAssets);
    const common = { destinationBucket: phoneBucket, distribution, distributionPaths: ['/*'], prune: false, memoryLimit: 512 };

    // Hashed JS/CSS/fonts plus the MediaPipe runtime and model: long-lived. Content type is inferred.
    new s3deploy.BucketDeployment(this, 'PhoneStaticAssets', {
      ...common,
      sources: [phoneApp],
      exclude: ['*'],
      include: ['assets/*', 'mediapipe/*', 'models/*'],
      cacheControl: [LONG_CACHE],
    });
    // Explicit types: browsers refuse WebAssembly.instantiateStreaming without application/wasm.
    new s3deploy.BucketDeployment(this, 'PhoneWasm', {
      ...common,
      sources: [phoneApp],
      exclude: ['*'],
      include: ['*.wasm'],
      contentType: 'application/wasm',
      cacheControl: [LONG_CACHE],
    });
    new s3deploy.BucketDeployment(this, 'PhoneModels', {
      ...common,
      sources: [phoneApp],
      exclude: ['*'],
      include: ['*.task'],
      contentType: 'application/octet-stream',
      cacheControl: [LONG_CACHE],
    });
    // The entry point and the runtime config must never be stale.
    new s3deploy.BucketDeployment(this, 'PhoneShell', {
      ...common,
      sources: [phoneApp, s3deploy.Source.jsonData('config.json', clientConfig)],
      exclude: ['*'],
      include: ['index.html', 'config.json'],
      cacheControl: [NO_CACHE],
    });

    // ----------------------------------------------------- budget + alarms
    new budgets.CfnBudget(this, 'MonthlyBudget', {
      budget: {
        budgetName: 'couch-coach-monthly',
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: BUDGET_USD, unit: 'USD' },
      },
      notificationsWithSubscribers: [
        {
          notification: { notificationType: 'ACTUAL', comparisonOperator: 'GREATER_THAN', threshold: 80, thresholdType: 'PERCENTAGE' },
          subscribers: [{ subscriptionType: 'EMAIL', address: budgetEmail }],
        },
      ],
    });

    const alarmTopic = new sns.Topic(this, 'AlarmTopic', { displayName: 'Couch Coach alarms' });
    alarmTopic.addSubscription(new subs.EmailSubscription(budgetEmail));
    const alarmAction = new cwActions.SnsAction(alarmTopic);

    const api5xx = new cw.Metric({
      namespace: 'AWS/ApiGateway',
      metricName: '5xx',
      dimensionsMap: { ApiId: api.apiId },
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });
    const coachApi5xx = new cw.Alarm(this, 'Api5xxAlarm', {
      alarmDescription: 'HTTP API returned 5xx (coach/session failures)',
      metric: api5xx,
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cw.TreatMissingData.NOT_BREACHING,
    });
    const coachErrors = new cw.Alarm(this, 'CoachErrorsAlarm', {
      alarmDescription: 'Coach Lambda invocation errors (a 5xx on POST /coach, or a failed async job)',
      metric: coachFn.metricErrors({ period: cdk.Duration.minutes(5), statistic: 'Sum' }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cw.TreatMissingData.NOT_BREACHING,
    });
    coachApi5xx.addAlarmAction(alarmAction);
    coachErrors.addAlarmAction(alarmAction);

    // -------------------------------------------------------------- outputs
    new cdk.CfnOutput(this, 'apiBaseUrl', { value: api.apiEndpoint });
    new cdk.CfnOutput(this, 'eventsHttpHost', { value: events.httpDns });
    new cdk.CfnOutput(this, 'eventsRealtimeHost', { value: events.realtimeDns });
    new cdk.CfnOutput(this, 'eventsApiKey', { value: eventsApiKey });
    new cdk.CfnOutput(this, 'phoneUrl', { value: phoneUrl });
    new cdk.CfnOutput(this, 'bedrockProfileId', { value: modelProfile });
  }
}
