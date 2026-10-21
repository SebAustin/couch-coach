# AppSync Events via a hand-written client, no Amplify

The TV app must run on React Native for Vega, where Amplify support is unproven and bundle weight matters. AppSync Events' WebSocket protocol is small (subprotocol `aws-appsync-event-ws` + base64url auth header, `connection_init`/`subscribe`/`publish`), so we own a ~150-line `events-client` shared by phone and TV. Rejected: API Gateway WebSocket + Lambda + DynamoDB connection table (more code and moving parts for the same pub/sub semantics).
