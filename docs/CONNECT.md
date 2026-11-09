# Connect BILA to Claude or ChatGPT

BILA runs a hosted MCP endpoint. Any MCP-capable assistant can plug in and ask BILA to pay on its behalf. BILA checks the limits first. Over the limit, it says no and says why.

Your endpoint URL looks like this (the last part is your agent token, treat it like a password):

```
https://<your-vercel-domain>/api/mcp?k=<agent-token>
```

## Claude

1. Open **Customize → Connectors**.
2. Click **Add custom connector**.
3. Paste the endpoint URL. Name it BILA.
4. Leave sign-in on **No sign-in** (the token is already in the URL). Click **Add**.
5. In a chat, click **+ → Connectors** and switch BILA on for that conversation.

Team and Enterprise: an Owner adds it under **Organization settings → Connectors**, then members connect it.

## ChatGPT

Custom MCP connectors are in developer mode. Availability depends on the plan.

1. **Settings → Security and login**, turn on **Developer mode**.
2. Open the **Plugins** page and click the **+** at the top right.
3. Name: BILA. Connection: **Server URL**, paste the endpoint URL. Authentication: **No Auth**.
4. Tick the risk confirmation and click **Create**.
5. In a chat, click **+**, pick BILA, then connect it when asked.

## Try it

- "Check my BILA budget."
- "Pay 0.1 NEAR to <recipient> for the test, memo: demo."
- "Pay 0.9 NEAR to <recipient>." (should be refused if it is above the per-payment limit)

## What the assistant can and cannot do

It can ask for payments, check its own budget and read its history. It cannot change limits, withdraw or touch other agents. Only the owner can, from their own wallet.
