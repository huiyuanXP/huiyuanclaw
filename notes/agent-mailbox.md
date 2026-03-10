# Agent Mailbox Bootstrap

Created 2026-03-09 to give the machine-owning agent a first-class email identity and a safe intake path.

## Identity

- English name: `Rowan`
- Preferred address: `rowan@jiujianian.dev`
- Local intake root: `~/.config/remotelab/agent-mailbox/`
- Public webhook host: `mailhook.jiujianian.dev`

## Current delivery status

The mailbox is now configured on a supported TLD and the public webhook path is live.

- Forward Email DNS records are published for `jiujianian.dev`.
- The public webhook is reachable through the `agent-mailbox` Cloudflare Tunnel.
- The local bridge accepts trusted Forward Email traffic, rejects untrusted public POSTs, and routes mail into the review/quarantine queues.
- Real external inbound delivery from `jiujianian@gmail.com` is validated.
- Approved messages can now open a normal RemoteLab session and send the final assistant turn back out by email once outbound credentials are configured.

The point is not to make email a generic support inbox.
The point is to give the agent a stable internet-facing identity that can receive operator-forwarded material like WeChat-exported chat records, long-form notes, and attachments that are awkward to paste into chat.

## Security boundary

Phase 1 intentionally keeps the system conservative:

1. Public mail reaches the mailbox entry point.
2. Sender allowlist is checked before any AI processing.
3. Allowed senders go to the local `review/` queue.
4. Unknown senders go to `quarantine/`.
5. Nothing is AI-eligible until a human explicitly approves it into `approved/`.

This means the safety boundary remains:

`email arrival -> allowlist gate -> manual review -> optional AI processing`

And only after approval can the optional reply loop run:

`approved email -> RemoteLab session -> assistant turn complete -> outbound email callback`

## Local implementation added in this session

The local mailbox flow now spans intake, approval, AI processing, and optional outbound reply:

- `lib/agent-mailbox.mjs`
- `lib/agent-mail-outbound.mjs`
- `scripts/agent-mail.mjs`
- `scripts/agent-mail-worker.mjs`
- `chat/completion-targets.mjs`

The CLI supports:

- `init` — create identity + initial allowlist
- `status` — show the active identity and queue counts
- `allow add|list` — maintain the sender allowlist
- `ingest` — import `.eml` files or a directory of emails
- `queue` — inspect `review`, `quarantine`, or `approved`
- `approve` — mark a reviewed email as AI-eligible
- `outbound status|configure-forwardemail` — configure the cross-platform HTTP sender
- `automation status|configure` — configure the chat-server-backed reply worker

Queue layout:

```text
~/.config/remotelab/agent-mailbox/
├── identity.json
├── allowlist.json
├── automation.json
├── outbound.json
├── events.jsonl
├── raw/
├── review/
├── quarantine/
└── approved/
```

## Approved-mail reply loop

Approved email replies now use only Node.js + HTTP APIs so the flow stays portable across macOS and Linux.

Runtime path:

`approved/ item -> agent-mail-worker -> chat-server /api/sessions -> detached AI run -> completion target -> Forward Email /v1/emails`

Key design choices:

- The worker creates a normal RemoteLab chat session through the same session API the UI uses.
- The session carries a one-shot completion target bound to that specific request ID.
- When the run finishes, the completion target reads the final assistant message for that run and sends it through the configured outbound email provider.
- Delivery state is written back into the mailbox item, so `approved/` items can show `processing_for_reply`, `reply_sent`, or `reply_failed`.
- The outbound path is provider-HTTP-based, not OS-mail-tool-based, so the same implementation works on Linux too.
- Long-term backlog note: this reply loop is intentionally email-specific for now; later it should likely sit on top of a provider-level outbound message/email capability instead of remaining a mailbox-only abstraction.

## Public ingress architecture configured on this machine

The live path for this machine is:

`Internet mail -> Forward Email MX -> HTTPS webhook -> Cloudflare Tunnel -> local bridge -> allowlist/review queue`

Concrete pieces:

- Mailbox address: `rowan@jiujianian.dev`
- Forwarding TXT: `forward-email=rowan:https://mailhook.jiujianian.dev/forward-email/webhook`
- MX records: `mx1.forwardemail.net`, `mx2.forwardemail.net`
- Public webhook: `https://mailhook.jiujianian.dev/forward-email/webhook`
- Local bridge: `http://127.0.0.1:7694`

Reasoning:

- Cloudflare Email Routing API was not available through the current token surface.
- The machine does have enough Cloudflare control for DNS and standalone tunnels.
- Forward Email supports DNS-configured alias forwarding straight to a webhook URL, and `.dev` is supported on the free tier.
- The local bridge keeps the safety boundary on this machine: no mail becomes AI-eligible before allowlist + manual review.

## What is already possible right now

- The agent identity is chosen.
- The local intake and manual-review queue exist.
- The public webhook host is live and health-checked.
- Forward Email DNS records are published for `rowan@jiujianian.dev`.
- The bridge rejects untrusted public POSTs and accepts trusted/local webhook payloads into the intake queue.
- The source check now accepts either:
  - loopback traffic for local testing,
  - a reverse-PTR Forward Email host (`mx1.forwardemail.net`, `mx2.forwardemail.net`, or `smtp.forwardemail.net`), or
  - a source IP that currently resolves from a trusted Forward Email hostname.

## Runtime artifacts

Live configuration files:

- Bridge state: `~/.config/remotelab/agent-mailbox/bridge.json`
- Identity: `~/.config/remotelab/agent-mailbox/identity.json`
- Outbound sender config: `~/.config/remotelab/agent-mailbox/outbound.json`
- Reply automation config: `~/.config/remotelab/agent-mailbox/automation.json`
- Tunnel config: `~/.cloudflared/agent-mailbox-config.yml`
- Bridge LaunchAgent: `~/Library/LaunchAgents/com.remotelab.agent-mail-bridge.plist`
- Tunnel LaunchAgent: `~/Library/LaunchAgents/com.remotelab.agent-mail-tunnel.plist`

Logs:

- Bridge stdout: `~/Library/Logs/agent-mail-bridge.log`
- Bridge stderr: `~/Library/Logs/agent-mail-bridge.error.log`
- Tunnel stdout: `~/Library/Logs/agent-mail-tunnel.log`
- Tunnel stderr: `~/Library/Logs/agent-mail-tunnel.error.log`

Health checks:

- Local: `http://127.0.0.1:7694/healthz`
- Public: `https://mailhook.jiujianian.dev/healthz`

## Current validation state

The earlier `.win` mailbox was blocked at the provider layer, so the setup was migrated to `jiujianian.dev`.

- Public `GET /healthz` now returns healthy JSON at `mailhook.jiujianian.dev`.
- Untrusted public `POST` traffic is rejected before intake.
- A trusted local synthetic Forward Email webhook payload from `jiujianian@gmail.com` is accepted into `review/`.
- The synthetic validation item was cleaned back out so the next real message is easy to spot.
- A real email from `jiujianian@gmail.com` now reaches `review/`, confirming live inbound delivery.
- Approved mail can now seed a normal RemoteLab session and deliver the final assistant turn through the new completion-target email callback.

## Remaining optional checks

The core public proof is complete. The highest-value remaining checks are:

1. send a real message from a non-allowlisted sender and confirm it lands in `quarantine/`, and
2. add live Forward Email outbound credentials and verify one end-to-end auto-reply, and
3. keep the manual review gate until attachment handling and automatic summaries are proven safe.

## Next operator steps

1. Configure `outbound.json` with a Forward Email API token or alias password.
2. Run `node scripts/agent-mail-worker.mjs --once` (or keep it running with polling) to process newly approved mail.
3. Send a real message from a non-allowlisted sender and confirm it lands in `quarantine/`.

## Initial commands

```bash
cd ~/code/remotelab
node scripts/agent-mail.mjs init \
  --name Rowan \
  --local-part rowan \
  --domain jiujianian.dev \
  --allow jiujianian@gmail.com

node scripts/agent-mail.mjs status
node scripts/agent-mail.mjs queue review
```
