# App-Centric Architecture Direction

> Status: consolidation anchor, not final spec.
> Purpose: collect the core idea that was discussed across multiple sessions so a later dedicated architecture conversation can start from one place.

---

## Why This Note Exists

The current App discussion has been spread across several sessions and mixed with implementation details, TODOs, and adjacent product thinking.

This document is a temporary merge point:

- capture the stable part of the idea
- separate current shipped behavior from target architecture direction
- leave a clean starting point for a future top-down redesign discussion

It should be read as a design direction memo, not as an already-approved implementation plan.

---

## Core Framing

RemoteLab's deepest value is not "remote chat" or "shareable prompts".

The real value is:

- an agent acts like a fully authorized person who owns the machine
- the product exists to let humans communicate with that agent
- identities and Apps mainly define how that communication is shaped, constrained, and presented

From that perspective, a "normal conversation" should not be treated as a different primitive from an App.

Instead:

- the default owner chat is a built-in App with the broadest permissions
- a shared/public App is another App with narrower permissions and a different presentation
- a session is one runtime conversation under an App, not a competing abstraction

In other words:

**generic chat is the minimal built-in App, and App-specific sessions are specialized runs of the same core model.**

---

## Proposed Mental Model

The clean stack is:

1. **Agent kernel** — the real machine-owning worker with full machine access
2. **Principal** — who is currently authenticated
3. **App policy** — the identity / capability / presentation layer applied to that principal
4. **Session run** — one conversation thread under that App policy
5. **Environment lease** — optional execution isolation chosen by the platform

Short form:

```text
session = run(agent kernel, principal, app policy, environment)
```

This keeps the abstractions separate:

- the kernel is the real actor
- the principal answers "who logged in"
- the App answers "what kind of constrained identity is being expressed"
- the session answers "which specific conversation/run is active right now"

---

## What "App" Means In This Direction

In the current shipped system, an App is still mostly a shareable template.

In the target direction, an App becomes a broader policy package that can define:

- bootstrap instructions
- optional initial assistant / welcome messages
- skills and tool/provider defaults
- capability boundaries
- memory and visibility scope
- UI / presentation hints
- environment / isolation policy

That means an App is not just "the first prompt".

It is the layer that says:

- what this identity is allowed to do
- how this identity appears to the user
- what context this identity starts with
- what surfaces the UI should expose for this identity

---

## Current Model vs Target Direction

### Current shipped model

- owner chat and shared App flows are conceptually related but still described separately
- App is stored as a lightweight template record
- visitor login creates a fresh session from that template
- role branching is primarily `owner` vs `visitor`
- App behavior is injected mostly through `systemPrompt` and `welcomeMessage`

### Target direction

- every session belongs to an App, including the default owner conversation
- the owner's normal chat becomes a built-in base App
- auth moves toward capability-based policy instead of many scattered role branches
- App defines a structured bootstrap stack instead of one ad hoc prompt injection
- presentation and permissions stay aligned because they come from the same App policy

---

## Important Clarifications

### 1. Session should not disappear

Even if "generic chat" becomes a built-in App, the session abstraction is still necessary.

Reason:

- an App is reusable policy
- a session is a concrete runtime thread with history, status, resume IDs, and outputs

Collapsing them into one record would mix reusable definition and live execution state.

### 2. App should not mean only "shareable public app"

If the default owner conversation is also an App, then App becomes the universal policy layer, not a special feature for link sharing.

That gives the architecture a cleaner center of gravity.

### 3. Permission control is the right center

The base owner App can hold advanced capabilities such as:

- creating and managing other Apps
- broader environment access
- broader visibility into sessions and system state

Other App identities can expose narrower capability sets without needing a separate runtime model.

### 4. Isolation should be platform-defined, not purely model-decided

The agent can decide how to work inside an environment, but the platform should still define the available isolation classes.

For example:

- shared machine context
- scoped workspace
- container / sandbox
- stronger virtualized environment

The App policy can request a class; the system enforces the available options.

---

## Design Consequences

If this direction is adopted, several architecture choices become cleaner.

### A. Default chat becomes a built-in App

No more special "no-app" path.

Every session gets an `appId`, even if it points to a built-in system App such as `owner-default`.

### B. Owner / visitor becomes a compatibility layer, not the deepest model

The deeper model becomes capabilities and scope.

`owner` and `visitor` can remain as practical compatibility aliases during migration, but they should not be the final architectural center.

### C. App bootstrap becomes structured

Instead of only:

- system context
- optional App `systemPrompt`
- optional welcome message

the future structure can become something like:

- system context
- App policy instructions
- capability declaration
- memory scope / isolation hints
- initial assistant message
- UI presentation hints

### D. UI becomes App-defined at the policy layer

The frontend remains minimal, but the visible surfaces can vary by App policy:

- full owner console
- chat-only share flow
- more guided form-like interaction
- future custom surface blocks

This keeps the display logic downstream of the App identity rather than as a parallel product taxonomy.

---

## Open Questions For The Next Architecture Session

These questions should be resolved in a dedicated top-down discussion, not piecemeal during feature work.

1. **Principal ↔ App binding**
   - Does a login token map directly to one App?
   - Or does it map to a principal that then gets one or more App capabilities?

2. **App schema**
   - What is the minimal durable App policy schema?
   - Which fields are bootstrap, capability, presentation, memory, and environment concerns?

3. **Capability model**
   - Which capabilities are first-class?
   - How are owner-only operations represented without hardcoding many route-specific role checks forever?

4. **Isolation model**
   - Which isolation classes are real platform guarantees?
   - Which parts are only agent conventions?

5. **Migration path**
   - How does the current App template system evolve into the broader App policy model without breaking share links or existing sessions?

6. **Built-in Apps**
   - What built-in Apps exist on day one?
   - Is there only one `owner-default`, or are there other system Apps such as setup / admin / operator modes?

---

## Suggested Starting Point For The Future Discussion

When the current scattered TODOs are finished and a fresh architecture session begins, use this note as the entry point.

Recommended order:

1. restate the kernel / principal / app / session model
2. define the minimal App policy schema
3. define the capability model
4. define isolation tiers
5. map current code paths onto the target model
6. produce a migration plan instead of directly patching implementation details

That future session should aim to output a concrete v2 architecture doc, not more scattered fragments.
