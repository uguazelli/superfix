export interface Category { code: string; label: string }
export type Status = 'DRAFT' | 'PROCESSING' | 'AWAITING_ANSWERS' | 'AI_ERROR' | 'DIAGNOSIS_PROPOSED' | 'DIAGNOSING' |
  'INCONCLUSIVE' | 'PAUSED' | 'CHECKLIST' | 'CLOSED'
export interface Intake {
  category: string | null; symptoms: string; brand: string; model: string
  fuel: 'ELECTRIC' | 'GAS' | 'DUAL' | 'UNKNOWN' | null; hazard: boolean | null
  serialNumber: string; modelConfirmed: boolean; diagnosticTopic: string
}
export interface Summary {
  id: string; jobReference: string; category: string | null; status: Status; symptoms: string; brand: string; model: string
  serialNumber: string | null; updatedAt: string; demo: boolean; technicianId: string
  parentCaseId: string | null; dueBack: string | null; deviceState?: 'PENDING' | 'CONFLICT'
}
export type AnswerStatus = 'ANSWERED' | 'UNKNOWN' | 'UNAVAILABLE' | 'NOT_PERFORMED'
export interface Answer { status: AnswerStatus; value: string; reason: string }
export interface Question {
  id: string; label: string; type: 'TEXT' | 'NUMBER' | 'CHOICE' | 'YES_NO' | 'CONFIRMATION'
  unit: string | null; choices: string[]
}
export interface Round { number: number; questions: Question[]; answers: Record<string, Answer>; submitted: boolean; followUpIntake: boolean }
export type Decision = 'ACCEPTED' | 'REJECTED'
export interface Finding {
  causeCode: string | null; cause: string; evidence: string[]; limitation: string; steps: string[]; decision: Decision | null
  translationKey?: string | null; evidenceQuestionIds?: string[]
}
export type CheckStatus = 'CONFIRMED' | 'UNRESOLVED' | 'NOT_APPLICABLE'
export interface Check { status: CheckStatus; reason: string }
export type Outcome = 'RESOLVED' | 'UNRESOLVED' | 'UNVERIFIED'
export type WorkStatus = 'PERFORMED' | 'NOT_PERFORMED'
export type VerificationResult = 'PASSED' | 'FAILED' | 'NOT_PERFORMED'
export interface Part { name: string; partNumber: string; quantity: number }
export interface Reading { name: string; unit: string; beforeValue: string | null; afterValue: string | null }
export interface Verification { result: VerificationResult; notes: string }
export interface WorkLog {
  confirmedFault: string; confirmedCauseCode: string | null
  workStatus: WorkStatus | null
  workPerformed: string
  parts: Part[]
  readings: Reading[]
  verification: Verification | null
}
export interface WorkLogEntry { log: WorkLog; author: string; savedAt: string }
export interface RepairAttempt {
  workLog: WorkLogEntry
  finding: Finding | null
  issue: string | null
  checks: Record<string, Check>
  throughRound: number
  continuedAt: string
}
export interface ApplianceSummary { id: string; category: string; brand: string | null; model: string; serialNumber: string | null }
export interface ReturnPart { id: string; name: string; partNumber: string | null; quantity: number; status: 'REQUESTED' | 'RECEIVED' | 'CANCELLED' }
export interface ReturnVisit {
  id: string; caseId: string; jobReference: string; scheduledFor: string; status: 'SCHEDULED' | 'STARTED' | 'COMPLETED' | 'CANCELLED'
  reason: string; nextAction: string; startedAt: string | null; completedAt: string | null; parts: ReturnPart[]
}
export interface HistoryEntry {
  id: string; jobReference: string; status: Status; symptoms: string; createdAt: string; updatedAt: string
  confirmedFault: string | null; outcome: Outcome | null; verification: VerificationResult | null
  readings: Reading[]; usedParts: Part[]; technicianId: string; parentCaseId: string | null; canOpen: boolean
}
export interface Assignment {
  technicianId: string; previousTechnicianId: string | null; actorId: string; note: string | null; createdAt: string
  technicianName: string; previousTechnicianName: string | null; actorName: string
}
export interface Activity { action: string; actorId: string; actorName: string; createdAt: string }
export interface PilotProcedureReport {
  procedureId: string; revision: number; model: string; reviewer: string | null; reviewedAt: string | null
  closedCases: number; comparableCauses: number; matchingCauses: number
  performedFirstVerifications: number; passedFirstVerifications: number
  unknownConfirmedCauses: number; inconclusiveCases: number
}
export interface ProcedureRef {
  id: string; revision: number; model: string; complaint: string; synthetic: boolean; reviewed: boolean
  reviewer: string | null; reviewedAt: string | null; applicabilityNote: string | null
  source: {title: string; revision: string; page: string; url: string; synthetic: boolean} | null
}
export interface Feedback { outcome: string; rating: string; feedback: string }
export interface Repair {
  id: string; category: string | null; status: Status; version: number; updatedAt: string; createdAt: string
  jobReference: string; technicianId: string; createdBy: string; parentCaseId: string | null; archivedAt: string | null
  deviceState?: 'PENDING' | 'CONFLICT'
  conflictServer?: Repair
  appliance: ApplianceSummary | null; returnVisit: ReturnVisit | null; returnHistory: ReturnVisit[]
  applianceHistory: HistoryEntry[]; assignments: Assignment[]
  timeline: Activity[]
  checklist: {id: string; alwaysRequired: boolean}[]
  details: {
    intake: Intake; demo: boolean; procedure: ProcedureRef | null; resumeStatus: Status | null
    photos: {id: string; contentType: string; size: number; kind: 'SYMPTOM' | 'MODEL_PLATE' | null; clientKey?: string | null}[]; rounds: Round[]
    finding: Finding | null; issue: string | null; checks: Record<string, Check>; feedback: Feedback | null
    workLog: WorkLogEntry | null
    attempts: RepairAttempt[]
  }
}

export interface ConversationMessage {
  id: string; sequence: number; role: 'TECHNICIAN' | 'ASSISTANT' | 'CONTEXT'; authorId: string | null
  text: string; createdAt: string; state: 'SAVED' | 'QUEUED' | 'RUNNING' | 'ANSWERED' | 'FAILED' | 'CANCELLED'
  failureCode: string | null; clientKey: string | null
  attachments: Repair['details']['photos']; suggestion: {summary: string; evidenceMessageIds: string[]; uncertainty: string} | null
}
export interface ConversationHandoff {
  summary: string | null; possibleCause: string | null; evidence: string[]; unresolved: string[]
  source: 'TECHNICIAN' | 'AI_ACCEPTED' | 'UNDETERMINED'; authorId: string | null; savedAt: string | null
}
export interface ConversationIntakeUpdate {
  id: string; field: 'category' | 'brand' | 'model' | 'serialNumber' | 'symptoms'
  previousValue: string | null; value: string; sourceMessageId: string; sourcePhotoId: string | null
  evidenceQuote: string; createdAt: string
}
export interface ConversationView {
  conversationId: string | null; caseId: string; caseVersion: number; caseStatus: Status; started: boolean
  imageAnalysisAvailable: boolean; photoLimit: number; photos: Repair['details']['photos']
  messages: ConversationMessage[]; handoff: ConversationHandoff | null; contextLimited: boolean
  intakeUpdates: ConversationIntakeUpdate[]
  requestsUsed: number; requestLimit: number; pendingMessageId: string | null
  hasMoreMessages: boolean; nextBeforeSequence: number | null
}
