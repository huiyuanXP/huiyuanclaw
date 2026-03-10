# Self-Hosting Dev Restart Strategy

> Transport/runtimes are now HTTP-first with detached runners. This note stays focused on honest restart behavior and the recommended two-plane dev workflow.

## Brutal truth

If the same `chat-server` process is both:

1. the thing carrying your live browser tab, and
2. the thing you are restarting,

then **transport continuity is still impossible by definition**.

What changed is the important part underneath that transport break:

- the browser no longer depends on live event streaming for correctness
- active runs can keep going in detached sidecars
- the control plane can restart, re-scan durable run output, and converge back to the same state

So the honest promise is now stronger than before, but still bounded:

- **No promise:** zero-disruption live socket continuity
- **Actual promise:** restart-safe control-plane recovery with durable HTTP state and detached active runs

## Current reusable workflow

### 1. Keep two chat-server planes with distinct jobs

- **Coding/operator plane:** stable `7690` chat service; do the actual coding conversation here
- **Validation plane:** `7692` test service (or another manual port); use it to verify behavior and restart freely
- **Emergency fallback:** `7681` auth-proxy terminal

Rule: **do not drive development from the same instance you expect to restart repeatedly**. In practice, keep `7692` disposable and use `7690` as the long-lived operator plane.

### 2. Standardize manual test-instance management

Use `scripts/chat-instance.sh` for custom-port chat-server instances.

Examples:

```bash
scripts/chat-instance.sh restart --port 7692 --name test
scripts/chat-instance.sh status --port 7692 --name test
scripts/chat-instance.sh logs --port 7692 --name test
```

### 3. Treat restart as transport interruption, not run loss

When the control plane shuts down during an active run:

- the browser loses its current socket / page continuity
- the detached runner keeps writing `status.json`, `spool.jsonl`, and `result.json`
- after reconnect, HTTP reads rebuild session and run state from durable files

For older explicitly interrupted cases where resume metadata was captured, the UI may still show **Resume**. That is now a compatibility recovery path, not the main restart story.

### 4. Operational sequence

1. Work and code from `7690`
2. Restart `7692`
3. Re-open / reconnect `7692`
4. Validate the change on `7692`
5. Refresh or re-query the session state by HTTP; do not judge correctness by socket continuity
6. Once `7692` looks good, finish the current message on `7690`, then restart/reload `7690` if needed
7. If both chat services are broken, fall back to `7681`

## What the current architecture solves

- repeatable two-plane restart workflow
- HTTP-canonical recovery after refresh/reconnect
- detached active runs surviving control-plane restarts
- optional WS invalidation hints instead of mandatory event streaming

## What is still intentionally out of scope

- zero-downtime browser transport continuity
- WebSocket replacement / transport redesign
- database migration beyond local filesystem storage

## Recommendation

Prioritize in this order:

1. Keep `7690` as the coding/operator plane and `7692` as the validation plane
2. Use `scripts/chat-instance.sh` for custom-port instances
3. Validate restart behavior through HTTP state recovery, not stream continuity
4. Defer transport swaps and DB changes until they are separately justified
