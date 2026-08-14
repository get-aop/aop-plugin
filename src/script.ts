/** AOP Software Delivery workflow script for worker-thread execution. */
export const AOP_DELIVERY_WORKFLOW_SCRIPT = String.raw`
const findingSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
    summary: { type: 'string' },
    evidence: { type: 'string' },
    location: { type: 'string' },
    remediation: { type: 'string' },
  },
  required: ['id', 'severity', 'summary', 'evidence', 'location', 'remediation'],
  additionalProperties: false,
}
const acceptanceCriterionSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    requirement: { type: 'string' },
    verification: { type: 'string' },
  },
  required: ['id', 'requirement', 'verification'],
  additionalProperties: false,
}
const planSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['ready', 'blocked'] },
    summary: { type: 'string' },
    steps: { type: 'array', items: { type: 'string' } },
    acceptanceCriteria: { type: 'array', items: acceptanceCriterionSchema },
    blocker: { type: 'string' },
  },
  required: ['status', 'summary', 'steps', 'acceptanceCriteria', 'blocker'],
  additionalProperties: false,
}
const implementationSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['changed', 'unchanged', 'blocked'] },
    summary: { type: 'string' },
    changedFiles: { type: 'array', items: { type: 'string' } },
    addressedFindingIds: { type: 'array', items: { type: 'string' } },
    verification: { type: 'array', items: { type: 'string' } },
    blocker: { type: 'string' },
  },
  required: ['status', 'summary', 'changedFiles', 'addressedFindingIds', 'verification', 'blocker'],
  additionalProperties: false,
}
const reviewSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['pass', 'changes-required', 'blocked'] },
    summary: { type: 'string' },
    findings: { type: 'array', items: findingSchema },
    blocker: { type: 'string' },
  },
  required: ['status', 'summary', 'findings', 'blocker'],
  additionalProperties: false,
}
const qaCheckSchema = {
  type: 'object',
  properties: {
    requirementId: { type: 'string' },
    status: { type: 'string', enum: ['passed', 'failed'] },
    evidence: { type: 'string' },
  },
  required: ['requirementId', 'status', 'evidence'],
  additionalProperties: false,
}
const qaSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['pass', 'changes-required', 'blocked'] },
    summary: { type: 'string' },
    checks: { type: 'array', items: qaCheckSchema },
    retestedFindingIds: { type: 'array', items: { type: 'string' } },
    findings: { type: 'array', items: findingSchema },
    blocker: { type: 'string' },
    discoveredUrl: { type: 'string' },
  },
  required: ['status', 'summary', 'checks', 'retestedFindingIds', 'findings', 'blocker', 'discoveredUrl'],
  additionalProperties: false,
}

function normalized(value) {
  return typeof value === 'string' && value.length > 0 && value === value.trim()
}
function normalizedOptional(value) {
  return typeof value === 'string' && value === value.trim()
}
function normalizedList(value) {
  return Array.isArray(value) && value.every(normalized)
}
function unique(values) {
  return new Set(values).size === values.length
}
function validDiscoveredUrl(value) {
  if (value === '') return true
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
function sized(value, stage) {
  const length = JSON.stringify(value).length
  if (length > args.maxArtifactChars) throw new Error(stage + ' artifact exceeds maxArtifactChars (' + length + ' > ' + args.maxArtifactChars + ')')
  return value
}
function validFinding(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && normalized(value.id)
    && ['critical', 'high', 'medium', 'low'].includes(value.severity)
    && normalized(value.summary)
    && normalized(value.evidence)
    && normalized(value.location)
    && normalized(value.remediation)
}
function validAcceptanceCriterion(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && normalized(value.id) && value.id !== 'QA-INSTRUCTIONS'
    && normalized(value.requirement) && normalized(value.verification)
}
function validateFindings(findings, stage) {
  if (!Array.isArray(findings) || findings.length > args.maxFindings || !findings.every(validFinding)) {
    throw new Error(stage + ' findings are malformed or exceed maxFindings')
  }
  const ids = findings.map(finding => finding.id)
  if (!unique(ids)) throw new Error(stage + ' finding ids must be unique')
  return findings
}
function validatePlan(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || !normalized(value.summary) || !normalizedList(value.steps)
    || !Array.isArray(value.acceptanceCriteria) || !value.acceptanceCriteria.every(validAcceptanceCriterion)
    || !unique(value.acceptanceCriteria.map(criterion => criterion.id)) || !normalizedOptional(value.blocker)) {
    throw new Error('plan artifact is malformed')
  }
  if (value.status === 'ready') {
    if (value.steps.length === 0 || value.acceptanceCriteria.length === 0 || value.blocker !== '') throw new Error('ready plan needs steps, acceptance criteria, and no blocker')
  } else if (value.status === 'blocked') {
    if (!normalized(value.blocker) || value.steps.length !== 0 || value.acceptanceCriteria.length !== 0) throw new Error('blocked plan needs only a concrete blocker')
  } else throw new Error('plan status is invalid')
  return sized(value, 'plan')
}
function validateImplementation(value, pendingIds, feedbackDriven) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || !normalized(value.summary) || !normalizedList(value.changedFiles)
    || !normalizedList(value.addressedFindingIds) || !normalizedList(value.verification)
    || !normalizedOptional(value.blocker) || !unique(value.changedFiles) || !unique(value.addressedFindingIds)) {
    throw new Error('implementation artifact is malformed')
  }
  if (value.status !== 'blocked' && feedbackDriven) {
    if (pendingIds.some(id => !value.addressedFindingIds.includes(id))) {
      throw new Error('implementation omitted a pending finding disposition')
    }
    if (value.addressedFindingIds.some(id => !pendingIds.includes(id))) {
      throw new Error('implementation named an unknown pending finding')
    }
  } else if (value.status !== 'blocked' && value.addressedFindingIds.length !== 0) {
    throw new Error('initial implementation cannot name pending findings')
  }
  if (value.status === 'changed') {
    if (value.changedFiles.length === 0 || value.verification.length === 0 || value.blocker !== '') {
      throw new Error('changed implementation needs changed files, focused verification, and no blocker')
    }
  } else if (value.status === 'unchanged') {
    if (value.changedFiles.length !== 0 || value.blocker !== '') throw new Error('unchanged implementation needs no changed files or blocker')
  } else if (value.status === 'blocked') {
    if (!normalized(value.blocker) || value.changedFiles.length !== 0 || value.addressedFindingIds.length !== 0 || value.verification.length !== 0) throw new Error('blocked implementation needs only a concrete blocker')
  } else throw new Error('implementation status is invalid')
  return sized(value, 'implementation')
}
function validateReview(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || !normalized(value.summary) || !normalizedOptional(value.blocker)) throw new Error('review artifact is malformed')
  validateFindings(value.findings, 'review')
  if (value.status === 'pass') {
    if (value.findings.length !== 0 || value.blocker !== '') throw new Error('passing review needs no findings or blocker')
  } else if (value.status === 'changes-required') {
    if (value.findings.length === 0 || value.blocker !== '') throw new Error('changes-required review needs findings and no blocker')
  } else if (value.status === 'blocked') {
    if (!normalized(value.blocker) || value.findings.length !== 0) throw new Error('blocked review needs only a concrete blocker')
  } else throw new Error('review status is invalid')
  return sized(value, 'review')
}
function validateQa(value, acceptanceCriteria, priorFindings) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || !normalized(value.summary) || !normalizedOptional(value.blocker) || !Array.isArray(value.checks)
    || !normalizedList(value.retestedFindingIds) || !unique(value.retestedFindingIds)
    || typeof value.discoveredUrl !== 'string' || !validDiscoveredUrl(value.discoveredUrl)
    || !value.checks.every(check => check !== null && typeof check === 'object' && normalized(check.requirementId)
      && ['passed', 'failed'].includes(check.status) && normalized(check.evidence))) throw new Error('QA artifact is malformed')
  validateFindings(value.findings, 'QA')
  if (value.status !== 'blocked' && value.discoveredUrl === '') {
    throw new Error('QA must report the discoveredUrl it tested')
  }
  const requiredIds = [...acceptanceCriteria.map(criterion => criterion.id), 'QA-INSTRUCTIONS']
  const checkIds = value.checks.map(check => check.requirementId)
  if (!unique(checkIds) || checkIds.some(id => !requiredIds.includes(id))) {
    throw new Error('QA checks must name each requirement at most once')
  }
  if (value.status !== 'blocked' && requiredIds.some(id => !checkIds.includes(id))) {
    throw new Error('QA checks must cover every acceptance criterion and QA-INSTRUCTIONS exactly once')
  }
  const priorIds = priorFindings.map(finding => finding.id)
  if (value.retestedFindingIds.some(id => !priorIds.includes(id))) {
    throw new Error('QA retested an unknown prior finding id')
  }
  if (value.status !== 'blocked' && (
    priorIds.some(id => !value.retestedFindingIds.includes(id))
    || value.retestedFindingIds.some(id => !priorIds.includes(id))
  )) {
    throw new Error('QA must retest every prior QA finding id exactly once')
  }
  if (value.status === 'pass') {
    if (value.checks.some(check => check.status !== 'passed') || value.findings.length !== 0 || value.blocker !== '') throw new Error('passing QA needs all checks passing, no findings, and no blocker')
  } else if (value.status === 'changes-required') {
    if (!value.checks.some(check => check.status === 'failed') || value.findings.length === 0 || value.blocker !== '') throw new Error('changes-required QA needs a failed check, findings, and no blocker')
  } else if (value.status === 'blocked') {
    if (!normalized(value.blocker) || value.checks.length !== 0 || value.retestedFindingIds.length !== 0 || value.findings.length !== 0) throw new Error('blocked QA needs only a concrete blocker')
  } else throw new Error('QA status is invalid')
  return sized(value, 'QA')
}
function roleOptions(role, schema, label, phaseName) {
  const route = args.roles[role]
  return {
    label,
    phase: phaseName,
    schema,
    persona: args.personas[role],
    toolFilter: { allow: route.tools },
    toolAccess: route.toolAccess,
    ...(route.toolPresentation === undefined ? {} : { toolPresentation: route.toolPresentation }),
    ...(route.provider === undefined ? {} : { provider: route.provider }),
    ...(route.model === undefined ? {} : { model: route.model }),
  }
}
function failure(status, stage, message, cycles, pendingFindings) {
  return { status, stage, message, cycles, pendingFindings }
}
function findingKey(finding) {
  return JSON.stringify(['id', 'severity', 'summary', 'evidence', 'location', 'remediation'].map(key => finding[key]))
}
function mergeFindings(...groups) {
  const merged = []
  const seenKeys = new Set()
  for (const group of groups) {
    for (const finding of group.findings) {
      const key = group.source + ':' + findingKey(finding)
      if (!seenKeys.has(key)) {
        seenKeys.add(key)
        merged.push({ ...finding, id: group.source + ':' + finding.id })
      }
    }
  }
  const uniqueIdMerged = []
  const usedIds = new Set()
  for (const item of merged) {
    let finalId = item.id
    let counter = 1
    while (usedIds.has(finalId)) {
      counter++
      finalId = item.id + '-' + counter
    }
    usedIds.add(finalId)
    uniqueIdMerged.push({ ...item, id: finalId })
  }
  return uniqueIdMerged
}
function terminalFindings() {
  return mergeFindings(
    { source: 'qa', findings: qaRetestFindings },
    { source: feedbackSource === 'QA' ? 'qa' : 'review', findings: pendingFindings },
  )
}

phase('Plan')
const rawPlan = await agent([
  'Create a decision-complete implementation plan for the objective below. Inspect the workspace before planning. Do not modify files.',
  'Objective:\n' + args.objective,
  'Return ready only when the plan has concrete ordered steps and observable acceptance criteria. Give every criterion a stable id other than QA-INSTRUCTIONS plus a requirement and browser-verifiable method. Return blocked only for an external prerequisite that inspection cannot resolve.',
].join('\n\n'), roleOptions('plan', planSchema, 'Delivery plan', 'Plan'))
if (rawPlan === null) return failure('stage-failed', 'plan', 'Planner child failed', { implementation: 0, review: 0, qa: 0 }, [])
const plan = validatePlan(rawPlan)
if (plan.status === 'blocked') return failure('blocked', 'plan', plan.blocker, { implementation: 0, review: 0, qa: 0 }, [])

let implementation
let review
let qa
let pendingFindings = []
let qaRetestFindings = []
let feedbackSource = 'initial plan'
const cycles = { implementation: 0, review: 0, qa: 0 }

while (true) {
  if (cycles.implementation >= args.maxCycles) {
    return failure('cycle-limit', 'implementation', 'implementation cycle limit reached', cycles, terminalFindings())
  }
  cycles.implementation += 1
  phase('Implementation')
  const rawImplementation = await agent([
    'Implement the accepted plan in the shared workspace. You are the only role allowed to modify source files.',
    'Objective:\n' + args.objective,
    'Accepted plan:\n' + JSON.stringify(plan),
    'Feedback source: ' + feedbackSource,
    'Pending findings:\n' + JSON.stringify(pendingFindings),
    'Previous implementation artifact:\n' + JSON.stringify(implementation ?? null),
    'Inspect current workspace state, implement every pending item, run focused verification, and return an exact disposition for every pending finding id.',
  ].join('\n\n'), roleOptions('implementation', implementationSchema, 'Implementation pass ' + cycles.implementation, 'Implementation'))
  if (rawImplementation === null) return failure('stage-failed', 'implementation', 'Implementation child failed', cycles, terminalFindings())
  const pendingIds = pendingFindings.map(finding => finding.id)
  implementation = validateImplementation(rawImplementation, pendingIds, pendingFindings.length > 0)
  if (implementation.status === 'blocked') return failure('blocked', 'implementation', implementation.blocker, cycles, terminalFindings())
  if (pendingFindings.length > 0 && implementation.status === 'unchanged') {
    return failure('stage-failed', 'implementation', 'implementation stalled with unresolved findings', cycles, terminalFindings())
  }

  cycles.review += 1
  phase('Review')
  const rawReview = await agent([
    'Perform an adversarial code review of the current workspace. Do not modify files.',
    'Objective:\n' + args.objective,
    'Accepted plan:\n' + JSON.stringify(plan),
    'Latest implementation artifact:\n' + JSON.stringify(implementation),
    'Findings that caused this implementation pass:\n' + JSON.stringify(pendingFindings),
    'Read the actual changed code and relevant call sites. Verify claimed fixes and acceptance criteria. Pass only with zero findings.',
  ].join('\n\n'), roleOptions('review', reviewSchema, 'Review pass ' + cycles.review, 'Review'))
  if (rawReview === null) return failure('stage-failed', 'review', 'Review child failed', cycles, terminalFindings())
  review = validateReview(rawReview)
  if (review.status === 'blocked') return failure('blocked', 'review', review.blocker, cycles, terminalFindings())
  if (review.status === 'changes-required') {
    pendingFindings = mergeFindings(
      { source: 'review', findings: review.findings },
      { source: 'qa', findings: qaRetestFindings },
    )
    feedbackSource = 'review'
    continue
  }
  if (review.status !== 'pass') throw new Error('review status is invalid')
  pendingFindings = []
  feedbackSource = 'post-review'
  cycles.qa += 1
  phase('QA')
  const qaPromptParts = [
    'Independently test the delivered behavior in a real browser. Do not modify source files.',
    'Objective:\n' + args.objective,
    'Accepted plan:\n' + JSON.stringify(plan),
    'Latest implementation artifact:\n' + JSON.stringify(implementation),
    'Passing review artifact:\n' + JSON.stringify(review),
    ...(args.qaUrl === undefined ? [] : ['Target URL: ' + args.qaUrl]),
    ...(args.qaInstructions === undefined ? [] : ['QA instructions:\n' + args.qaInstructions]),
    'Prior QA findings requiring retest:\n' + JSON.stringify(qaRetestFindings),
  ]
  if (args.qaUrl === undefined) {
    qaPromptParts.push(
      'Discover the deliverable target yourself: inspect the workspace (package.json scripts, README, server config, and the plan acceptance criteria verification methods) to find how the app runs and which URL it serves, then navigate a real browser to it.',
    )
  }
  if (args.qaInstructions === undefined) {
    qaPromptParts.push(
      'Derive the browser test procedure from the plan acceptance criteria and report it as requirementId QA-INSTRUCTIONS.',
    )
  } else {
    qaPromptParts.push(
      'Report the supplied QA instructions as requirementId QA-INSTRUCTIONS.',
    )
  }
  qaPromptParts.push(
    'Exercise every accepted criterion through browser tools. Report the exact URL you tested as discoveredUrl (absolute http(s)); if no deliverable target is discoverable, return blocked with discoveredUrl "" and a concrete blocker. Retest every prior QA finding and return its id in retestedFindingIds. Use changes-required for product defects and blocked only when the target or an external prerequisite is unavailable.',
  )
  const rawQa = await agent(qaPromptParts.join('\n\n'), roleOptions('qa', qaSchema, 'QA pass ' + cycles.qa, 'QA'))
  if (rawQa === null) return failure('stage-failed', 'qa', 'QA child failed', cycles, terminalFindings())
  qa = validateQa(rawQa, plan.acceptanceCriteria, qaRetestFindings)
  if (qa.status === 'blocked') return failure('blocked', 'qa', qa.blocker, cycles, terminalFindings())
  if (qa.status === 'changes-required') {
    pendingFindings = mergeFindings({ source: 'qa', findings: qa.findings })
    qaRetestFindings = qa.findings
    feedbackSource = 'QA'
    continue
  }
  if (qa.status !== 'pass') throw new Error('QA status is invalid')
  return {
    status: 'completed',
    cycles,
    plan,
    implementation,
    review,
    qa,
  }
}
`
