export type SpeakerRole = 'Agent' | 'Customer';

export type DetectedLanguage =
  | 'Sinhala (Singlish)'
  | 'English'
  | 'Tamil'
  | 'Mixed (Sinhala/English)'
  | 'Mixed (Tamil/English)'
  | 'Unclear';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export type EvaluationStatus =
  | 'Excellent'
  | 'Good'
  | 'Needs Improvement'
  | 'Failed'
  | 'Not Assessable';

export type PerformanceBand = 'Excellent' | 'Good' | 'Average' | 'Poor';

export type ReviewDecision = 'pending' | 'confirmed' | 'adjusted' | 'rejected';

export type RecordReviewState = 'ai_draft' | 'evaluator_reviewed' | 'finalised';

export interface CallMetadata {
  agentName: string;
  agentId: string;
  callReference: string;
  callDate: string; // YYYY-MM-DD
  callType: 'FNOL';
  evaluatorName: string;
  additionalNotes: string;
  fileName: string;
  fileSizeBytes: number;
  durationSeconds: number;
  mimeType: string;
}

export interface TranscriptSegment {
  id: string;
  speaker: SpeakerRole;
  timestamp: string; // MM:SS
  timestampSeconds: number;
  language: DetectedLanguage;
  text: string;
  romanText?: string;
  confidence: ConfidenceLevel;
  uncertaintyNote?: string;
  isEdited?: boolean;
}

export interface TranscriptionProcessingMeta {
  primaryModelAttempted: string;
  primarySucceeded: boolean;
  audioUnderstandingModel: string;
  fallbackUsed: boolean;
  warnings: string[];
  rawDedicatedTranscript?: string;
}

export interface TranscriptionResult {
  segments: TranscriptSegment[];
  detectedLanguages: string[];
  processingMeta: TranscriptionProcessingMeta;
}

export interface CqmParameterConfig {
  id: string;
  name: string;
  weight: number;
  description: string;
  guideline: string;
}

export interface FnolQaRuleConfig {
  id: string;
  title: string;
  description: string;
  enabled: boolean;
  requiresMccSystemCheck: boolean;
}

export interface CqmParameterScore {
  parameterId: string;
  parameterName: string;
  maxMarks: number;
  awardedMarks: number;
  evaluatorMarks: number | null;
  status: EvaluationStatus;
  reason: string;
  evidence: string;
  timestamp: string;
  timestampSeconds: number | null;
  recommendedImprovement: string;
  needsHumanReview: boolean;
  systemVerificationRequired: boolean;
  evaluatorComment: string;
  reviewDecision: ReviewDecision;
}

export interface FnolCheckResult {
  ruleId: string;
  ruleTitle: string;
  applicable: boolean;
  result: 'Passed' | 'Failed' | 'Partial' | 'Not Applicable' | 'Requires Manual MCC Verification';
  evidence: string;
  timestamp: string;
  notes: string;
  evaluatorConfirmed?: boolean | null;
}

export interface CriticalFinding {
  id: string;
  category:
    | 'Process Failure'
    | 'Data Protection'
    | 'Missed Mandatory Question'
    | 'Incorrect Information'
    | 'Customer Handling';
  severity: 'High' | 'Medium';
  description: string;
  timestamp: string;
  evidence: string;
  status: 'pending' | 'confirmed' | 'rejected';
}

export interface CoachingFeedback {
  strengths: string[];
  areasForImprovement: string[];
  recommendedActions: string[];
}

export interface PerformanceThresholds {
  excellentMin: number; // default > 90 (e.g., 90.01 or >= 91)
  goodMin: number; // default >= 80
  averageMin: number; // default >= 70
}

export interface AppSettings {
  scorecard: CqmParameterConfig[];
  qaRules: FnolQaRuleConfig[];
  transcriptionPrefs: {
    sinhalaDisplay: 'singlish';
    tamilDisplay: 'script' | 'roman';
    showConfidenceWarnings: boolean;
    preserveCodeSwitching: boolean;
  };
  languageHandling: {
    enableSinhala: boolean;
    enableEnglish: boolean;
    enableTamil: boolean;
    preferDedicatedTranscriptionFirst: boolean;
  };
  thresholds: PerformanceThresholds;
  dataRetention: {
    retainAudioInBrowser: boolean; // default false
    maxHistoryDays: number; // 0 = unlimited until manually deleted
  };
}

export interface CallEvaluationRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  metadata: CallMetadata;
  transcription: TranscriptionResult;
  scorecard: CqmParameterScore[];
  fnolChecks: FnolCheckResult[];
  criticalFindings: CriticalFinding[];
  coachingFeedback: CoachingFeedback;
  overallScore: number;
  aiOverallScore: number;
  assessedMaxMarks: number;
  performanceBand: PerformanceBand;
  requiresManualReview: boolean;
  reviewState: RecordReviewState;
  finalisedAt?: string;
  finalisedBy?: string;
  hasStoredAudio: boolean;
}
