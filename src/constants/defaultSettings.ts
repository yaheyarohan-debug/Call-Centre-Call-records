import { AppSettings, CqmParameterConfig, FnolQaRuleConfig, PerformanceBand, PerformanceThresholds } from '../types/cqm';

export const DEFAULT_CQM_SCORECARD: CqmParameterConfig[] = [
  {
    id: 'greeting',
    name: 'Greeting',
    weight: 5,
    description: 'Proper opening salutation, company identification, and polite Agent introduction.',
    guideline: 'Agent should greet warmly, clearly state the insurer name and personal name, and offer assistance promptly without rushing.',
  },
  {
    id: 'active_listening',
    name: 'Active Listening',
    weight: 10,
    description: 'Attentive listening without interrupting, acknowledging customer distress, and avoiding repeated questions.',
    guideline: 'Verify the Agent acknowledges details already given by the customer and avoids asking the same question unnecessarily.',
  },
  {
    id: 'identifying_query',
    name: 'Identifying Query',
    weight: 10,
    description: 'Accurate recognition of the FNOL incident type, urgency, injuries, and coverage context.',
    guideline: 'Agent must promptly identify that the call is a First Notice of Loss (accident/incident), check safety/injuries, and ask relevant diagnostic questions.',
  },
  {
    id: 'holding_procedure',
    name: 'Holding Procedure',
    weight: 10,
    description: 'Requesting permission before placing on hold, adhering to hold duration limits, and thanking upon return.',
    guideline: 'If a hold is used, Agent must request consent, state reason/duration, and thank the customer on return. If no hold occurred, evaluate as Not Assessable or N/A per QA policy—do not invent a hold.',
  },
  {
    id: 'product_knowledge',
    name: 'Product Knowledge',
    weight: 10,
    description: 'Clear, accurate explanation of motor/general FNOL coverage rules, excess, surveyor/towing, and next steps.',
    guideline: 'Evaluate accuracy of insurance guidance, documentation requirements, and claims procedure explanations without misleading statements.',
  },
  {
    id: 'guidelines_order',
    name: 'Guidelines Order',
    weight: 10,
    description: 'Following mandatory FNOL verification sequence and capturing required accident facts accurately.',
    guideline: 'Check DOB before NIC/Driving Licence, Insured identified before Driver, Relationship=Other captured clearly, late intimation reason if delayed, and distance moved if vehicle was moved.',
  },
  {
    id: 'script_order',
    name: 'Script Order',
    weight: 10,
    description: 'Logical conversational flow following Contact Centre FNOL call script structure.',
    guideline: 'Assess whether call flows logically: opening -> verification -> incident details -> vehicle/driver details -> next steps -> closing.',
  },
  {
    id: 'data_protection',
    name: 'Data Protection',
    weight: 5,
    description: 'Proper customer identity verification before disclosing policy details and safeguarding sensitive data.',
    guideline: 'Agent must verify caller identity (policy number, vehicle number, DOB/NIC) before sharing sensitive policy or claim information.',
  },
  {
    id: 'courtesy',
    name: 'Courtesy',
    weight: 20,
    description: 'Empathy, calm tone, respectful phrasing across Sinhala/English/Tamil, and patience under stress.',
    guideline: 'Crucial 20-mark weight: evaluate genuine empathy during an accident call, polite address (Sir/Madam/respectful Sinhala or Tamil honorifics), and professional composure.',
  },
  {
    id: 'call_duration',
    name: 'Call Duration',
    weight: 5,
    description: 'Efficient call handling without dead air, excessive silence, or unnecessary prolongation.',
    guideline: 'Assess call pacing against actual recording duration and conversational efficiency; avoid penalising necessary empathy or complex multilingual clarification.',
  },
  {
    id: 'end_greeting',
    name: 'End Greeting',
    weight: 5,
    description: 'Clear summary of next steps, confirmation of no further questions, and polite closing.',
    guideline: 'Agent should summarize claim reference/next steps, ask if further assistance is needed, and deliver a courteous closing salutation.',
  },
];

export const DEFAULT_FNOL_QA_RULES: FnolQaRuleConfig[] = [
  {
    id: 'verify_insurer',
    title: 'Clear Insurer Identification',
    description: 'Agent clearly identifies the insurance company at the start of the call.',
    enabled: true,
    requiresMccSystemCheck: false,
  },
  {
    id: 'dob_before_nic_dl',
    title: 'DOB Obtained Before NIC or Driving Licence',
    description: 'Date of Birth must be requested before NIC or Driving Licence number during caller/driver verification.',
    enabled: true,
    requiresMccSystemCheck: false,
  },
  {
    id: 'insured_before_driver',
    title: 'Insured Identified Before Driver',
    description: 'Agent confirms the insured policyholder details before capturing the driver details.',
    enabled: true,
    requiresMccSystemCheck: false,
  },
  {
    id: 'relationship_other',
    title: 'Exact Relationship Captured When Relationship is Other',
    description: 'When driver is not the insured, Agent must verify and state the exact relationship (and record in MCC).',
    enabled: true,
    requiresMccSystemCheck: true,
  },
  {
    id: 'late_intimation_reason',
    title: 'Late Intimation Reason Requested & Recorded',
    description: 'If the accident was not reported immediately, Agent must ask for the reason for late intimation and record it.',
    enabled: true,
    requiresMccSystemCheck: true,
  },
  {
    id: 'distance_moved',
    title: 'Distance Moved Checked If Vehicle Moved',
    description: 'If the vehicle has been moved from the exact accident spot, Agent must check how far it was moved.',
    enabled: true,
    requiresMccSystemCheck: true,
  },
  {
    id: 'next_steps_explained',
    title: 'Clear Explanation of Next Steps',
    description: 'Agent explains claim reference, assessor/surveyor visit, or required documents clearly.',
    enabled: true,
    requiresMccSystemCheck: false,
  },
  {
    id: 'no_repeated_questions',
    title: 'Avoids Unnecessary Repeated Questions',
    description: 'Agent does not repeatedly ask for details the customer has already clearly provided.',
    enabled: true,
    requiresMccSystemCheck: false,
  },
  {
    id: 'data_protection_mcc',
    title: 'Data Protection & MCC System Recording Verification',
    description: 'Caller identity verified before policy disclosure; actual MCC system entry cannot be verified from audio alone.',
    enabled: true,
    requiresMccSystemCheck: true,
  },
];

export const DEFAULT_THRESHOLDS: PerformanceThresholds = {
  excellentMin: 90, // > 90 is Excellent
  goodMin: 80, // 80 to 90 is Good
  averageMin: 70, // 70 to < 80 is Average; < 70 is Poor
};

export const DEFAULT_SETTINGS: AppSettings = {
  scorecard: DEFAULT_CQM_SCORECARD,
  qaRules: DEFAULT_FNOL_QA_RULES,
  transcriptionPrefs: {
    sinhalaDisplay: 'singlish',
    tamilDisplay: 'script',
    showConfidenceWarnings: true,
    preserveCodeSwitching: true,
  },
  languageHandling: {
    enableSinhala: true,
    enableEnglish: true,
    enableTamil: true,
    preferDedicatedTranscriptionFirst: true,
  },
  thresholds: DEFAULT_THRESHOLDS,
  dataRetention: {
    retainAudioInBrowser: false,
    maxHistoryDays: 0,
  },
};

export function computePerformanceBand(
  score: number,
  thresholds: PerformanceThresholds = DEFAULT_THRESHOLDS
): PerformanceBand {
  if (score > thresholds.excellentMin) return 'Excellent';
  if (score >= thresholds.goodMin) return 'Good';
  if (score >= thresholds.averageMin) return 'Average';
  return 'Poor';
}
