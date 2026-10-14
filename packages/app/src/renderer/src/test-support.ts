// One builder per shared fixture shape, for the renderer's own tests
// (M9 fix 442). SessionInfo (52 fields) and ActivitySession (19) each had a
// local `session()` in ten or so test files returning a full literal, so a
// field fix 405 added went into every copy; these fill in a plausible
// default for every field and let a test override only what it reads.
//
// Not part of the app: kept out of tsconfig.web.json's build (see its
// exclude) and out of the node --test glob by not ending in .test.ts, but
// still typechecked, through tsconfig.test.json's sweep of every renderer
// file, alongside the tests that import it.
import type { ActivitySession, SessionInfo, TeamMember } from '@emerald/shared';

export function aSession(over: Partial<SessionInfo> = {}): SessionInfo {
  const base: SessionInfo = {
    id: 's1',
    kind: 'shell',
    name: 's1',
    autoName: false,
    spawnCwd: 'C:\\repo',
    args: [],
    cwd: 'C:\\repo',
    groupCwd: 'C:\\repo',
    branch: null,
    lastPrompt: null,
    lastReply: null,
    state: 'idle',
    stateSince: 0,
    lastEventAt: null,
    stale: false,
    needsInputReason: null,
    errorType: null,
    waitingOn: [],
    team: [],
    model: null,
    contextPercent: null,
    contextWindow: null,
    tokens: null,
    comment: null,
    phase: null,
    color: null,
    title: null,
    transcriptPath: null,
    liveReply: null,
    liveTool: null,
    claudeSessionId: null,
    remoteSessionId: null,
    startHead: null,
    conversation: null,
    commits: [],
    shellCwd: null,
    pid: 1,
    exitCode: null,
    createdAt: 0,
  };
  return { ...base, ...over };
}

export function anActivitySession(over: Partial<ActivitySession> = {}): ActivitySession {
  const base: ActivitySession = {
    sessionId: 's1',
    name: 's1',
    color: null,
    kind: 'claude',
    claudeSessionId: null,
    removedAt: null,
    cwd: null,
    groupCwd: null,
    requests: [],
    commits: [],
    lifetime: false,
    spans: [],
    debt: [],
    awayMs: 0,
    cappedMs: 0,
    parentId: null,
    agentId: null,
    agentType: null,
    outside: false,
  };
  return { ...base, ...over };
}

export function aMember(over: Partial<TeamMember> = {}): TeamMember {
  const base: TeamMember = {
    id: 'a1',
    kind: 'agent',
    type: null,
    description: null,
    command: null,
    startedAt: 0,
    endedAt: null,
    outcome: 'running',
    cwd: null,
    branch: null,
    commits: [],
    activity: null,
  };
  return { ...base, ...over };
}
