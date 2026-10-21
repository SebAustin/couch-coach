# A Lambda proxy fronts the AgentCore runtime

AgentCore Runtime accepts either SigV4 or JWT inbound auth, not both. JWT would force a Cognito login on the TV (poor 10-foot UX) and SigV4 would put AWS credentials in clients. So clients call `POST /coach` with a Session token; the `coach-proxy` Lambda validates the token and per-Session cap, invokes the runtime with SigV4, synthesises Polly audio, and publishes the Cue. The proxy's interface is stable, so the backend can fall back to Bedrock Converse + DynamoDB without client changes.
