# The coach calls Bedrock Converse directly instead of an AgentCore runtime

Supersedes the runtime half of ADR 0002. On Oct 21, with about 52 hours left and nothing built yet, deploying a Strands agent container to AgentCore Runtime with AgentCore Memory was the largest unknown left on the critical path. The `coach` Lambda now calls Bedrock Converse (Haiku) with the current Set plus the Member's last five Sets, which are read from DynamoDB. That history is how the Coach "remembers" each Member.

The Lambda still validates the Session token and the per-Session cap, synthesises the Cue with Polly and publishes it over AppSync Events, so ADR 0002's client contract stays the same. Moving back to AgentCore later only changes the inside of the `coach` Lambda.
