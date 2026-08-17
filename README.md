# AOP Software Delivery Plugin for DeepSeek Harness

[![GitHub](https://img.shields.io/badge/github-get--aop%2Faop--plugin-blue)](https://github.com/get-aop/aop-plugin)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Homepage](https://img.shields.io/badge/AOP-getaop.com-purple)](https://getaop.com)

**@get-aop/aop-plugin** is a software delivery workflow plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and [Cordis](https://cordis.moe). It automates the multi-agent software engineering lifecycle:

$$\text{Plan} \longrightarrow \text{Implementation} \longleftrightarrow \text{Review} \longleftrightarrow \text{Browser QA} \longrightarrow \text{Ship (yolo only)}$$

Each role runs with independent context, specific model/thinking profiles, tailored toolsets, and rigid evaluator gates.

## Slash commands

- `/aop <objective>` — plan, implement, review, and browser-test the objective; findings ping-pong back to implementation until both evaluators pass.
- `/aopy <objective>` — **AOP YOLO**: the same workflow, then a Ship pass opens a pull request, verifies CI/CD, fixes conflicts and issues, and merges automatically.

---

## Key Features

- **Evaluator-Gated Ping-Pong**: Adversarial code reviewer and independent browser QA engineer reject flawed implementations. Any reported finding forces an implementation pass with an exact disposition requirement.
- **Review Precedes QA**: Any code modification must pass code review with 0 findings before Browser QA can execute.
- **Mandatory Retesting**: QA tracks every prior defect ID and verifies observable resolution before certification.
- **Verified Browser QA**: Browser QA requires real navigation to the QA target (the given `qaUrl`, or one it discovers and declares itself) followed by post-navigation browser interaction and snapshot evidence. Evidence is pinned to the declared target — navigation and observed evidence must settle against exactly that URL.
- **YOLO Ship Pass** (`/aopy`, `mode: yolo`): after QA passes, the ship pass commits and pushes a branch, opens a PR, verifies CI with bounded polling, fixes conflicts and CI failures, and merges automatically — using the implementation role's writer tools. Honest blockers (no remote, no push permission, no CI, unresolvable conflict) stop the run instead of inventing a merge.
- **Model Routing**: Configure distinct models/providers per stage:
  - **Plan**: `sol-xhigh` (deep reasoning architecture)
  - **Implementation**: `deepseek-v4-flash-max` (fast, focused coding writer)
  - **Review**: `fable-5-max` (adversarial code review)
  - **Browser QA**: `sol-medium` (browser and UI verification)
- **Safe Isolation**: Evaluators are strictly limited to `read` tools. Only the implementation role (and its ship pass) possesses workspace `write` access.

---

## State Machine Workflow

```mermaid
stateDiagram-v2
    [*] --> Plan: Objective / Ticket
    Plan --> Implementation: Ready Plan (ACs defined)
    Implementation --> Review: Changes Made + Verified
    Review --> Implementation: Changes Required (Findings)
    Review --> QA: Pass (0 Review Findings)
    QA --> Implementation: Changes Required (QA Defects)
    QA --> Ship: Pass (All ACs Verified) — yolo mode only
    Ship --> Completed: PR Opened, CI Green, Merged
    Ship --> Blocked: No Remote / No CI / Unresolvable Conflict
    QA --> Completed: Pass (All ACs Verified)
    Plan --> Blocked: External Dependency
    Implementation --> Blocked: Blocker Reported
    Review --> Blocked: Blocker Reported
    QA --> Blocked: Blocker Reported
```

---

## Installation & Configuration

### 1. Install

Add `@get-aop/aop-plugin` to your DeepSeek Harness environment:

```bash
pnpm add @get-aop/aop-plugin
```

### 2. Configure in `cordis.yml`

Mount the plugin in your `cordis.yml` profile or overlay:

```yaml
- id: aop-delivery
  name: '@get-aop/aop-plugin'
  config:
    subagentProvider: spawn
    maxCycles: 8
    maxFindings: 64
    maxArtifactChars: 32768
    maxResultChars: 262144
    runTimeoutMs: 3600000
    phaseTimeoutMs: 1800000
    roles:
      plan:
        provider: opencode-go
        model: deepseek-v4-pro
        tools:
          - name: read
            access: read
          - name: grep
            access: read
          - name: glob
            access: read

      implementation:
        provider: opencode-go
        model: deepseek-v4-flash
        toolPresentation: native
        tools:
          - name: read
            access: read
          - name: write
            access: write
          - name: edit
            access: write
          - name: bash
            access: write
          - name: grep
            access: read
          - name: glob
            access: read

      review:
        provider: kimi-coding
        model: k3
        tools:
          - name: read
            access: read
          - name: grep
            access: read
          - name: glob
            access: read

      qa:
        provider: opencode-go
        model: deepseek-v4-flash
        tools:
          - name: read
            access: read
          - name: browser_navigate
            access: read
            browserNavigation: true
          - name: browser_snapshot
            access: read
            browserEvidence: true
          - name: browser_click
            access: read
            browserEvidence: true
          - name: browser_fill
            access: read
            browserEvidence: true
```

---

## Tool API

### `aop_delivery` (or `delivery_workflow`)

Invoked by an agent or user to execute the complete delivery lifecycle:

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `objective` | `string` | **Yes** | The complete implementation objective or ticket. |
| `qaUrl` | `string` | No | Absolute HTTP(S) target URL for browser QA. When omitted, QA discovers the deliverable itself — it inspects the workspace (package.json scripts, README, plan acceptance criteria) to find how the app runs and which URL it serves, and declares it in the QA artifact's `discoveredUrl`. Browser evidence is always pinned to one concrete target (given or discovered). |
| `qaInstructions` | `string` | No | Concrete browser behaviors, interactions, and expected outcomes. When omitted, QA derives them from the plan's acceptance criteria and reports them under `QA-INSTRUCTIONS`. |
| `maxCycles` | `number` | No | Optional implementation-pass ceiling (bounded by deployment policy). |
| `mode` | `string` | No | `standard` (default) or `yolo`. `yolo` adds the Ship pass after QA passes: pull request, CI verification, conflict/issue fixes, automatic merge. |

> **Ship pass trust boundary**: the ship pass uses the implementation role's writer tools (git/gh via bash) on the real repository. It merges only after CI checks report green; external outcomes (PR state, CI results, merge) are read from the repository's actual tooling, and the run terminates with a concrete blocker instead of fabricating a merge it cannot perform.

Wall-clock guards: `runTimeoutMs` cancels the whole run; `phaseTimeoutMs` cancels the whole run when any single **evaluator** phase exceeds it (Plan/Review/QA, armed via the `workflow/phase` event stream). The Implementation and Ship phases are exempt from the phase cap — they are the only phases that legitimately drive external pipelines (CI, releases) — and are bounded by `runTimeoutMs` alone.

> **Discovery-mode trust boundary**: when `qaUrl` is omitted, the target is *declared by the QA model* in the artifact's `discoveredUrl`. The workflow enforces that navigation and evidence are pinned to exactly that declared URL (no navigation elsewhere can certify evidence), but it cannot verify that the declared URL is genuinely the deliverable — target *authenticity* is trusted to the QA model. For strict environments, always pass an explicit `qaUrl`.

**Desktop apps (Electron etc.)**: QA is read-only and cannot start the app under test. The implementation phase (the only role with shell access) is instructed to start the deliverable's dev server or preview path in the background and report it as a `URL: http://...` verification entry; QA uses that URL first. If nothing is running, QA probes common dev ports once and returns `blocked` naming exactly what must be started and how.

---

## About AOP

**Agents Operating Platform (AOP)** is a local-first orchestrator for autonomous coding agents.

- **Website**: [getaop.com](https://getaop.com)
- **GitHub**: [github.com/get-aop](https://github.com/get-aop)

## License

[MIT](LICENSE) © AOP contributors
