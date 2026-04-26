---
name: remotelab-dogfood
description: Dogfood and QA web applications related to RemoteLab with reproducible evidence. Use when asked to dogfood, QA, exploratory-test, bug hunt, or review the quality of the RemoteLab UI, a local dev server from this repo, or another browser-based workflow that should produce screenshots, repro steps, and a structured report.
---

# RemoteLab Dogfood

Use this skill to run evidence-first QA for RemoteLab surfaces. Keep the workflow lean and repo-specific; rely on the built-in `agent-browser` skill for generic browser mechanics.

## Defaults

- Prefer `http://127.0.0.1:3000`, `http://localhost:3000`, or the URL explicitly provided by the user.
- Write artifacts under `dogfood-output/<timestamp-or-target>/`.
- Save screenshots under `screenshots/`.
- Save videos under `videos/`.
- Use [references/issue-taxonomy.md](references/issue-taxonomy.md) at the start of the session to calibrate severity and coverage.
- Start the report from [assets/dogfood-report-template.md](assets/dogfood-report-template.md).

## Workflow

1. Create the output directory and copy the report template into `report.md`.
2. Open the target app with `agent-browser` and wait for the page to settle.
3. Map the main navigation, core workflows, and empty/error states.
4. Explore one area at a time. For each confirmed issue, stop and capture evidence before moving on.
5. Update the report immediately after each issue so partial work is never lost.
6. End with a severity summary and the top blocking problems.

## Evidence Standard

- Use a single annotated screenshot for static issues visible on load.
- Use step-by-step screenshots plus video for interaction bugs, broken flows, and timing/state issues.
- Verify reproducibility once before spending time on a full capture set.
- Reference every screenshot and video path directly in the report.

## RemoteLab Focus Areas

- Session creation and reconnection behavior
- Streaming chat state and message rendering
- Task dependency UI and workflow visibility
- Mobile layout, sidebar behavior, and theme switching
- Label changes such as `pending-review`, `planned`, and `done`
- Failure states around WebSocket disconnects, missing sessions, or stale task state

## Reporting

- Keep issue titles short and specific.
- State expected behavior and actual behavior in one paragraph.
- Favor 5 to 10 well-documented issues over a long shallow list.
- If no issues are found, still produce a short report describing what was covered and residual risk.
