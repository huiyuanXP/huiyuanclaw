# Session-First Workflow Surfaces

> Status: current baseline.
> Purpose: freeze the organization model for session list / grouping / task-like workflow views so RemoteLab does not drift into parallel domain objects before they are truly needed.

---

## Core Decision

For the current RemoteLab architecture:

> `Session` is the only durable work object.

Everything the owner sees in workflow organization should be one of two things:

- canonical metadata attached to a session
- a derived UI projection over sessions

That means the current system does **not** have separate canonical objects for:

- `Task`
- `ProgressItem`
- `Group`

Those are product surfaces, not independent storage authorities.

## Current Product-Shape Rule

For the current discovery phase:

- Do not let any secondary workflow view define the main product shape while the owner interaction is still being discovered.
- Keep the active owner flow centered on the session list instead of preserving half-used planning surfaces.
- If a richer workflow view returns later, it should return as a derived projection over sessions, not as the object that justifies the workflow model.

This means the legacy board implementation was not something to refine in place during this phase. It was something to delete so the next interaction model could be designed more honestly from the session-first core.

---

## Workflow Surface Consequence

For the next product iteration:

- do not preserve retired workflow surfaces just to avoid losing familiar UI vocabulary
- do not let card/column vocabulary steer the main interaction model
- do not treat the removed board as the central product risk during this rewrite
- do use the session-first foundation to design the owner flow again from first principles

---

## What Belongs On The Session Today

The current session-first workflow model is intentionally lightweight.

Durable session metadata may include fields such as:

- `name`
- `group`
- `description`
- `workflowState`
- `workflowPriority`
- `lastReviewedAt`
- `pinned`
- app/source association fields when relevant

Live execution state is still separate and should remain separate:

- active run lifecycle
- queued follow-ups
- rename / compaction activity

Any workflow projection should read those session-level signals. It should not invent a second durable “task status” object.

---

## What Workflow Projection Is

The remaining workflow projection is a projection over sessions.

In practical terms:

- session ordering is derived from live session activity, `workflowState`, `workflowPriority`, pinning, and recency
- attention cues are derived from `workflowState`, `workflowPriority`, and review timestamps
- any future secondary workflow view must still point back to the underlying session
- the session list and any future workflow view are projections over the same canonical objects

So the correct mental model is:

```text
Session list = session compact view
Any future workflow view = session workflow projection
```

Not:

```text
A workflow view = separate task system that happens to link to sessions
```

---

## How To Think About `group`

`group` is currently a lightweight session metadata field.

It is useful for:

- visual grouping in the sidebar
- lightweight project/domain clustering
- helping the model generate a stable label for related work

It is **not** currently:

- a first-class parent entity
- a permissions boundary
- a durable container with its own lifecycle
- a place where independent workflow-surface logic should live

So the right current reading is:

```text
group = a session facet, not a new object
```

---

## How To Think About `task`

People can absolutely talk about “tasks” in product language.

But under the current architecture, a “task” should usually collapse into one of these:

- the session itself when the work is one durable thread
- the session title / description when the work only needs labeling
- `workflowState` / `workflowPriority` when the work only needs lightweight workflow organization
- future cross-session structure only when one real unit of work outgrows a single session

So unless something has its own identity and lifecycle independent from a session, do **not** persist it as a separate task object.

---

## Architectural Rules

When adding workflow-management features, prefer these rules in order:

1. Attach durable presentation/workflow metadata to `Session` first.
2. Derive list/filter/secondary workflow views from sessions second.
3. Only introduce a new object if session metadata can no longer express the product honestly.

Three hard constraints should hold:

1. A workflow view must not own truth that the session does not.
2. The frontend must not silently invent a second authoritative workflow model.
3. The backend must not maintain a separate task-style store unless the product intentionally grows a new canonical object.

---

## When A Second Layer Becomes Legitimate

It is reasonable that RemoteLab may eventually need something above sessions.

But that should happen only when the product has a real need for a cross-session work object, for example when one unit of work needs:

- multiple sessions over time
- a stable identity independent from any single session
- its own summary / status / archival semantics
- cross-session notes, attachments, or checkpoints
- navigation that should survive session splits, forks, or rewrites

If that day comes, the right move is:

```text
Workstream/Case/Project (new object)
  -> many Sessions
    -> many Runs
```

Not:

```text
A task-like workflow artifact becomes the hidden real object
and Session becomes a chat attachment hanging off it
```

In other words: if RemoteLab grows a second layer, it should be an explicit parent above sessions, not a shadow workflow artifact beside sessions.

---

## Practical Product Guidance

For current feature work, these defaults should hold:

- if the owner wants a richer workflow view later, improve session metadata and derivation first
- if the owner wants better recall after many delegated conversations, improve session naming / grouping / descriptions / summaries first
- if the owner wants easier attention management, improve workflow projection first
- if a proposal needs its own object, ask whether it truly survives beyond any one session

This keeps RemoteLab aligned with its core product identity:

> durable AI work is centered on sessions, and workflow organization is built around them rather than replacing them.
