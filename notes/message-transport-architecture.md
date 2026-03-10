# Message Transport Architecture

> Created 2026-03-09 to consolidate scattered discussion from multiple sessions into one working note.
> Purpose: park the current message/runtime architecture thinking in one place before a later top-down design session.

---

## Why this note exists

We have discussed the chat/message architecture in several separate sessions, but the reasoning is fragmented.

This note is the temporary merge point for those discussions so a future dedicated session can start from one coherent summary instead of rebuilding context from scattered remarks.

This is **not** yet the final architecture spec.
It is a consolidated design direction, product assumption set, and open-question list.

For the execution-oriented phase-1 refactor contract, use `notes/http-runtime-phase1.md`.

---

## Current product assumptions that simplify the architecture

These assumptions matter because they directly change what complexity is worth paying for.

1. **Full token streaming is not essential to the core product value.**
   Because RemoteLab is already oriented around asynchronous multi-session work, receiving a completed turn is often acceptable.

2. **The frontend is mainly a control/display surface, not the source of truth.**
   UI responsiveness matters, but a transient frontend disconnect should not endanger core run state.

3. **The main web service should be cheap to restart.**
   We would rather accept reconnect/replay than keep growing a restart-fragile server.

4. **Logical continuity matters more than transport continuity.**
   The durable promise should be: no important state is lost, completed output is replayable, interrupted runs are inspectable/resumable when possible.

5. **A thin transport is preferable to a clever transport.**
   If product requirements allow it, we should remove work from WebSocket rather than harden an increasingly stateful real-time channel.

---

## Core direction

The preferred direction is:

**stateless-ish control plane + thin runtime plane + durable event/result storage + thin realtime invalidation channel**

In practical terms:

- The main service owns auth, Apps, visitor/owner policy, session metadata, business logic, cleanup, and API shape.
- The execution side should be as close as possible to a thin shell/supervisor layer.
- Output and status should be written to durable storage quickly so the main service can always re-read canonical state.
- Realtime transport should only notify that something changed; HTTP should fetch what changed.

---

## Latest synthesis from the current discussion

The latest discussion sharpened one important point:

> the deepest split is not merely **stateless server vs stateful manager**; it is **durable session semantics vs ephemeral execution**.

That changes the framing in a few useful ways.

### 1. The real product promise

The product should optimize for **logical continuity**, not for pretending the transport never breaks.

The honest promise is:

- no important session state is lost
- completed work is replayable
- interrupted runs are explicit
- resumable work is resumable

The promise is **not**:

- the WebSocket never drops
- the same HTTP process can restart without any visible reconnect
- the current child PID is the identity of the Agent

This matters because mobile networks, Cloudflare tunnels, browser reconnects, and server restarts already make transport churn normal.

### 2. The durable unit

For proactive Agents, the durable unit should be:

- session metadata
- run metadata
- append-only normalized event log
- provider-native resume identifiers
- trigger queue / waiting conditions
- executor lease / ownership record
- notification outbox

If one of these matters after a restart, it should not live only in process memory.

### 3. What a "lightweight manager" actually means

The runtime manager can stay lightweight only if it owns a very small but very real set of invariants:

- exclusive lease for an active session/run
- spawn / resume / cancel contract
- heartbeat / reaping / timeout handling
- trigger delivery
- resource budgeting / concurrency limits

So the right goal is not "make the manager dumb enough to be irrelevant."
The right goal is "make the manager narrow, explicit, and free of product/business logic."

### 4. Proactive behavior does not require immortal child processes

A key clarification from the discussion:

- proactive behavior is often better modeled as **trigger-driven resumable runs**
- not as "keep one CLI child process alive forever"

That means many future capabilities can be built from:

- deferred self-messages
- condition-based triggers
- resumable provider state
- durable event storage
- push notifications / inbox surfacing

Long-lived processes may still exist for some cases, but they should be justified by a real product need rather than assumed as the default identity of the Agent.

---

## Proposed split

### 1. Control plane

Responsibilities:

- authentication and session cookies
- session CRUD and app/visitor logic
- deciding what command/run should exist
- storing session metadata, run metadata, and normalized events
- providing read APIs for history, session state, artifacts, and progress
- emitting lightweight invalidation notifications to connected clients

Properties we want:

- safe to restart
- minimal in-memory authority
- no dependence on a persistent frontend connection

### 2. Runtime plane

Responsibilities:

- accept a run request from the control plane
- spawn the selected tool/process
- capture stdout/stderr and normalize/write results quickly
- expose run status and cancellation hooks
- terminate after a turn when possible

Properties we want:

- thin and dumb
- no business policy
- no auth logic
- no ownership of product semantics

### 3. Durable store

This becomes the real system of record.

Minimum durable objects:

- session metadata
- run metadata
- append-only event log
- generated artifacts / file references
- provider-native resume identifiers
- trigger queue / waiting conditions
- executor lease / ownership record
- notification outbox

The important rule is:

> if state matters after a disconnect or restart, it should not live only in process memory.

---

## Transport principle

### Thin realtime channel

WebSocket should ideally be reduced to a push-only invalidation mechanism, for example:

```json
{
  "type": "session_updated",
  "sessionId": "...",
  "runId": "...",
  "latestSeq": 42
}
```

Then the client performs HTTP reads such as:

- fetch session metadata
- fetch events since cursor/sequence
- fetch run status
- fetch artifacts if needed

This gives us:

- low coupling between transport and payload format
- easier reconnect semantics
- fewer server-side in-memory delivery assumptions
- easier debugging because canonical state is fetchable without a live socket

### HTTP as source of truth

The payload itself should come from HTTP, not from whatever happened to survive inside one WebSocket stream.

That means reconnect logic becomes much simpler:

- reconnect socket if available
- receive invalidation
- re-fetch canonical state

If the socket drops entirely, the app still has a valid model for recovery.

---

## Clarifications from the latest round

This round made several operating principles more explicit.

### 1. All client-initiated behavior should go through HTTP

The client should create messages, cancel runs, resume runs, and perform other active operations through HTTP APIs.

Realtime transport should be treated only as a low-cost server-to-client invalidation mechanism.

That means correctness does not depend on a live socket:

- if realtime is connected, it nudges the client to re-fetch
- if realtime is disconnected, manual refresh or the next HTTP interaction should still converge to the same state

Use HTTP revalidation (`ETag` / `If-None-Match`) on hot read routes so these re-fetches stay cheap.

This is a cleaner model for mobile networks and restart-heavy development.

### 2. Thin WebSocket and SSE are both viable once writes move to HTTP

If all writes and canonical reads are already modeled as HTTP resources, then the realtime channel no longer needs bidirectional rich payload semantics.

That makes both of these valid:

- keep WebSocket, but reduce it to invalidation-only payloads
- replace it later with SSE if server-push-only delivery proves simpler

The transport choice should be made on implementation simplicity, proxy behavior, reconnect ergonomics, and migration cost — not on the assumption that realtime must carry the authoritative content.

### 3. The first implementation should not assume token streaming

We can intentionally remove token-level streaming from the first version of this architecture.

UI updates can happen at coarser milestones such as:

- run accepted
- assistant message committed
- tool step finished / artifact ready
- run waiting for input
- run completed / failed

This removes a large amount of transport, buffering, and in-memory coordination complexity while still preserving useful responsiveness.

### 4. Control plane owns canonical state, but the runner still needs a tiny durable spool

The control plane should continue to own:

- normalized session/run/event state
- auth and business policy
- app / visitor / owner semantics
- API shape and cache semantics

However, a runner that writes nothing durable is too fragile.

If the control plane is down while a run is executing, we still need a way to recover anything the run produced during that window.

So the runner should have a very small durable contract, for example:

- raw append-only output spool
- heartbeat / status file
- exit result record

The control plane can later consume and normalize that spool into the canonical event store.

This keeps product logic out of the runner without making the crash window lossy.

### 5. Storage should stay filesystem-first unless proven otherwise

Given the current product assumptions:

- single-owner local deployment
- no token streaming in the first version
- relatively low event volume compared with chat systems that stream every token

The first implementation can stay lightweight:

- atomic JSON for small metadata objects
- append-only JSONL for event logs, runner spools, and outboxes
- per-run directories for temporary runtime state and artifacts

If file coordination, queries, or compaction later become painful, then upgrading canonical metadata to SQLite is the next step. That is still an embedded local file, not a heavy external service.

### 6. HTTP caching helps, but validators and incremental reads matter more than shared-cache dreams

Because most hot session state is private and mutable, the main win is not public CDN-style caching of active API responses.

The more realistic wins are:

- `ETag` / `If-None-Match`
- `Last-Modified` where it stays honest
- cursor / sequence-based incremental reads
- immutable caching for static assets and finalized artifacts

So the architecture should optimize first for correct canonical reads and cheap revalidation, then treat broader caching as a secondary benefit.

---

## Failure model we are aiming for

### If WebSocket disconnects

- no important state is lost
- client can reconnect or manually refresh
- latest persisted state can be re-fetched

### If control plane restarts

- auth/API surface comes back cleanly
- frontend reconnects and re-fetches state
- active runs should ideally continue if runtime is detached

### If runtime crashes

- already-persisted events remain visible
- the failed run is inspectable
- interruption/recovery status is explicit
- worst case loss is limited to the currently unflushed partial output

This is a much better product promise than trying to pretend a live stream is unbreakable.

---

## Important simplification preference

The runtime side does **not** need to become a second application server.

The intended shape is closer to:

- receive command/run request
- execute
- write normalized results/status
- exit or idle

The runtime should not absorb:

- auth
- visitor/owner rules
- app semantics
- session presentation logic
- cleanup policy
- cross-session product behavior

Those stay in the control plane.

---

## Long-lived shell vs one-shot run

There are two nearby interpretations of the runtime split:

### Option A — keep a long-lived shell per session

Pros:

- may preserve more immediate process continuity
- can keep an in-progress stream alive without re-spawn overhead

Cons:

- accumulates hidden state
- harder to reason about after restarts
- more lifecycle edge cases
- more likely to drift into a second stateful application layer

### Option B — detached supervisor + mostly one-shot runs

Pros:

- simpler lifecycle
- cleaner persistence boundaries
- better fit for completed-turn delivery
- easier to debug and restart

Cons:

- partial streaming becomes less central
- may require clearer resume/retry semantics

Current bias:

**prefer detached supervision with mostly one-shot runs unless the product later proves that persistent shells are truly necessary.**

---

## Where the current implementation already points in this direction

The existing codebase already contains useful pieces of this model:

- `chat/ws.mjs` attaches a client and replays persisted history on attach.
- `chat/session-manager.mjs` writes events before/while broadcasting them.
- `chat/history.mjs` persists conversation state on disk.
- `static/chat.js` already has reconnect + re-attach + pending-message recovery behavior.
- `notes/self-hosting-dev-restarts.md` already identifies detached per-session runners as the first architecture that can honestly claim restart-safe active runs.

So this direction is not a conceptual reset. It is an architectural cleanup and sharpening of the existing trajectory.

---

## Likely migration path

This is the rough order that currently looks most sensible:

1. **Make the data model more explicit**
   - define run metadata, event sequence/cursor, and artifact references clearly

2. **Stop treating WebSocket payloads as authoritative**
   - make realtime delivery a notification layer, not the only carrier of content

3. **Add idempotent send semantics**
   - a client message ID / request ID should make retries safe

4. **Upgrade event persistence**
   - move away from full-file rewrite history if it becomes a hot path
   - append-only JSONL or SQLite are better candidates than repeatedly rewriting one JSON array

5. **Introduce a runtime manager boundary**
   - spawn/cancel/resume should go through a thinner execution interface

6. **Only then decide how much realtime transport is still needed**
   - WebSocket may remain as thin invalidation
   - SSE may also become viable if the client no longer needs bidirectional rich payload exchange

---

## Recommended dependency order for the simplified first pass

For the next implementation phase, the dependency order should be even more opinionated than the rough migration list above.

The goal is to maximize simplification early while minimizing churn in the future runner layer.

### Phase 1 — lock the canonical HTTP contract first

Define the server-side resource model before touching transport details:

- session metadata read
- event log read by cursor / sequence
- run status read
- create-message / cancel / resume writes
- idempotency key or client request ID

Reason:

- once reads and writes are clearly modeled as HTTP resources, the frontend, storage layer, and realtime layer all get a stable target
- this also prevents us from overfitting the runner contract to the current WebSocket behavior

### Phase 2 — switch the frontend mental model from stream consumption to state re-fetch

Before introducing a new runner boundary, make the UI behave as if realtime may disappear at any time:

- submit via HTTP
- render from canonical HTTP reads
- treat realtime as only a hint to re-fetch
- keep manual refresh and reconnect as valid recovery paths; do not rely on background polling in the main UI path

Reason:

- this removes the most fragile coupling first
- it proves the product can function without transport continuity
- it reduces the migration risk before backend internals are split further

### Phase 3 — upgrade durable storage while it is still owned by one server

Once the control-plane contract is clear, upgrade persistence in the simplest local-first way:

- atomic JSON for small metadata
- append-only JSONL for events and outboxes
- stable sequence / cursor semantics
- per-run artifact directories

Reason:

- doing this before the runner split keeps normalization logic in one place
- it gives the future runner somewhere stable to hand off into

### Phase 4 — define the minimal stable runner contract

Only after the HTTP + storage contracts are stable should we freeze the runner boundary.

The runner should own only a tiny fixed surface:

- start a run
- expose heartbeat / liveness
- append raw output spool
- record exit result
- accept cancel signal

The runner should explicitly not own:

- auth
- session presentation
- visitor / owner policy
- canonical event normalization
- cache validators
- app semantics

Reason:

- this keeps the runner stable and boring
- if we want to avoid touching it later, it must not absorb product semantics now
- the more logic we leave in the control plane, the more future iteration stays cheap

### Phase 5 — introduce detached execution only after the above boundaries hold

After the control plane can already operate correctly via HTTP + durable reads, then make active runs survive server restarts.

Reason:

- detached execution is much easier to reason about once the system already treats the control plane as rehydratable and the runner as a narrow sidecar
- otherwise we risk solving restart survival with a runner that later needs frequent product-driven changes

### Phase 6 — keep realtime last and thin

At this point, choose the cheapest invalidation channel:

- keep WebSocket if it is already good enough operationally
- switch to SSE if the code becomes noticeably simpler

Reason:

- by this stage realtime is not a correctness dependency anymore
- that means the choice can be made on maintenance cost instead of architectural fear

### Practical conclusion for this round

So the recommended order is:

1. lock HTTP resource contract
2. migrate frontend to HTTP-source-of-truth semantics
3. upgrade local durable storage
4. freeze the minimal runner contract
5. detach execution from server lifetime
6. thin or replace realtime transport last

This order best matches the current product goal:

- keep the runner lightweight and rarely changed
- keep business logic in the main state service
- keep the first version simple enough to ship without streaming

---

## External message channels should be clients of the same session protocol

One architecture gap is now visible more clearly:

- the browser chat client already behaves like a client of the canonical session/run/event model
- the agent mailbox flow is **partly aligned** with that model
- the GitHub-style auto-triage / auto-reply flow is **not aligned** and still behaves like a separate automation product

If we want email, GitHub/GitLab bots, and future chatbots to feel like first-class parts of the same system, we should make the server own one canonical message protocol and treat every external surface as a client.

### What is already good in the current shape

- The main chat service already exposes durable session and run APIs.
- The browser already submits messages over HTTP.
- WebSocket is already thin invalidation instead of the source of truth.
- Request IDs already exist and make message submission idempotent.

This is the right foundation.

### What the mailbox flow currently gets right

The mailbox pipeline is:

`raw email -> allowlist/quarantine/review -> approved item -> chat-server session -> run complete -> outbound email`

The important good property is that, after approval, the worker uses the same chat-server APIs the browser uses:

- it authenticates as a client
- it creates a normal session
- it posts a normal session message
- it waits for normal run completion
- it sends the final assistant reply back out

So mailbox automation is already directionally correct.

### What is still mailbox-specific and therefore not yet the final abstraction

- The inbox / approval queue is outside the canonical session event model.
- The session binding is based on a one-shot mailbox item ID, not a stable external conversation/thread identity.
- Outbound delivery is modeled as an email-specific completion target, not as a generic outbound message capability.
- Raw source mail is preserved, but the mapping from external conversation identity to server session identity is still ad hoc.
- Email reply threading metadata is not yet part of the durable protocol surface.

That means mailbox is currently a useful adapter, not yet the canonical general mechanism.

### What the GitHub-style auto-reply flow currently gets wrong architecturally

The current GitHub triage path polls GitHub, builds local snapshots/state, drafts a reply, and can post the comment directly back to GitHub.

That means:

- no canonical RemoteLab session is created for that conversation
- no canonical user message event is appended into the server history
- no canonical run exists for the reply
- reply state lives in poller-local snapshot/state files instead of the main session/event store

So this path is operationally useful, but architecturally it is a separate automation stack.

### Target model

The clean model is:

`external surface receives user message -> client submits inbound message to server -> server resolves/creates session -> server appends canonical user event -> server runs tool -> server persists assistant event -> clients observe completion -> one client delivers the reply outward`

In this model:

- the **server** owns durable truth
- the **session/event/run store** is the canonical product state
- the **raw external payload** is preserved as an immutable artifact for audit/replay
- the **client adapter** only handles edge concerns: receiving external input, auth, and external delivery

This better matches the product philosophy: the chat page, email bot, GitHub/GitLab bot, and future chatbots are all just different clients around the same core session engine.

### Durable objects that should become canonical

The main service should own the following durable concepts:

- `session` — the conversation thread in RemoteLab
- `event` — canonical inbound/outbound messages and status changes
- `run` — one execution attempt tied to a specific inbound message
- `channel binding` — maps an external conversation/thread identity to a server session
- `delivery target` — describes where a completed reply should be sent
- `raw artifact` — the highest-confidence original source payload (raw email, webhook JSON, issue snapshot, etc.)

This is the crucial shift:

- local poller snapshots and mailbox queue files may still exist
- but they should become ingress/ops artifacts, not the authoritative conversation model

### Minimal protocol shape

Long term, the server should expose one first-class inbound contract for external clients.

Conceptually:

```json
{
  "requestId": "client_message_unique_id",
  "source": {
    "kind": "email | github | gitlab | web | im",
    "account": "which integration identity received it",
    "conversationId": "stable external thread key",
    "messageId": "external message key"
  },
  "actor": {
    "id": "external sender identity",
    "displayName": "human readable sender",
    "address": "email/login/etc",
    "trust": "trusted | review_required | blocked"
  },
  "content": {
    "text": "normalized inbound text",
    "artifacts": ["raw payload refs / attachments"]
  },
  "session": {
    "tool": "codex",
    "appId": "owner-default or a future bot app",
    "nameHint": "optional",
    "systemPrompt": "optional policy overlay"
  },
  "delivery": {
    "kind": "email | github_comment | gitlab_note | webhook",
    "target": "channel-specific reply target"
  }
}
```

Server semantics:

1. Validate/authenticate the client.
2. Preserve the raw artifact if present.
3. Resolve `source.conversationId` through a durable channel binding.
4. Create a new session if this is a new conversation; otherwise reuse the bound session.
5. Append one canonical user message event.
6. Create one canonical run.
7. Persist the assistant reply as a canonical assistant message event.
8. Mark delivery as ready / sent / failed and notify interested clients.

### Important nuance: approval is still allowed

The mailbox safety boundary is still valid.

For risky channels, we can keep:

`external arrival -> quarantine/review -> operator approval -> canonical inbound message submission`

The key change is not "remove approval."

The key change is:

- approval should be an ingress policy gate
- after approval, the message should enter the same canonical session protocol as every other client

### Callback vs WebSocket vs polling

The server should remain correct without any single realtime dependency.

- browser clients can keep using thin WebSocket invalidation and then refetch over HTTP
- headless bot clients can poll run/session status over HTTP
- later we can add optional callbacks/webhooks for completion delivery

But all three should sit on top of the same canonical session/run/event model.

### Concrete interpretation for current flows

#### Browser chat

- Already very close to the desired architecture.

#### Agent mailbox

- Keep the ingress bridge, allowlist, quarantine, and approval flow.
- Replace mailbox-specific conversation identity with a durable channel binding keyed by external thread/conversation identity.
- Evolve email-only completion targets into generic delivery targets.
- Keep raw `.eml` payloads as linked artifacts.

#### GitHub / GitLab repo bots

- Stop treating the poller as the system of record.
- The poller/webhook receiver should become only a client adapter.
- On new external activity, it should submit a canonical inbound message to the server.
- The server should create/reuse the session, run the assistant, and persist the reply.
- The adapter should only deliver that persisted assistant reply back as a comment/note.

### Practical migration order

1. **Lock the canonical external-message model**
   - session binding
   - inbound message envelope
   - generic delivery target
   - raw artifact attachment
2. **Generalize current completion targets**
   - email becomes one delivery adapter, not the abstraction itself
3. **Add one atomic server endpoint for external clients**
   - create-or-resolve session
   - append canonical user message
   - create run
   - return session/run IDs
4. **Refactor mailbox worker onto that endpoint**
   - keep review logic, drop mailbox-only session glue
5. **Refactor GitHub/GitLab bot onto that endpoint**
   - keep polling or webhook intake if needed
   - remove reply-generation logic as a separate state machine
6. **Only then add more client surfaces**
   - IM bots
   - webhook-driven assistants
   - cross-session triggers

### Current recommendation

If we are aligning architecture before a larger refactor, the right conclusion is:

- keep the browser path as the reference model
- treat mailbox as a partially-correct adapter we should generalize
- treat GitHub/GitLab auto-reply as the main path that should be pulled back into the canonical session protocol
- make the server own one durable conversation model, and let every external surface become a client around it

This is the simpler long-term architecture.

---

## Open questions for the future dedicated design session

These are the questions worth revisiting top-down later.

### Product questions

- Is completed-turn delivery sufficient as the default UX?
- Which user-visible cases genuinely require token-level streaming?
- How much partial output loss is acceptable during a crash?

### Transport questions

- Thin WebSocket or SSE?
- Do we need bidirectional realtime beyond invalidation?
- What is the smallest notification payload that still feels responsive?

### Runtime questions

- One detached supervisor for all runs, or one supervisor per session?
- Should active runs be represented as leases?
- What is the cancellation contract if the control plane disappears mid-run?

### Storage questions

- JSONL or SQLite for event log / run state?
- How do we handle compaction, retention, and artifact references?
- What is the minimal event schema that still supports replay, debugging, and resume?

### API questions

- What HTTP endpoints should represent canonical session/run/event reads?
- Should clients fetch full history or incremental events by cursor?
- How should resend/idempotency be modeled?

---

## Temporary conclusion

The current design instinct is good:

- make WebSocket thinner
- make the server easier to restart
- keep business logic out of the execution shell
- persist results early
- optimize for correctness and recoverability over fragile live streaming

That is currently the most promising simplification path.

The next serious discussion should revisit this note from the top down, decide which product assumptions are firm, and then lock the implementation shape accordingly.

### Suggested order for that later top-down session

1. Define the user-facing promise: what continuity do we guarantee, and what do we explicitly not guarantee?
2. Define the durable data model: session, run, event, trigger, lease, artifact, notification.
3. Define the runtime contract: spawn, resume, cancel, timeout, retry, ownership transfer.
4. Define proactive behavior: timer, webhook, file-watch, and "on complete" triggers.
5. Only after that, decide the transport shape: thin WebSocket, SSE, or hybrid.

---

## Related files

- `AGENTS.md`
- `notes/self-hosting-dev-restarts.md`
- `notes/autonomous-execution.md`
- `notes/ai-driven-interaction.md`
- `chat/ws.mjs`
- `chat/session-manager.mjs`
- `chat/process-runner.mjs`
- `chat/history.mjs`
- `static/chat.js`
