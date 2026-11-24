export interface Env {
  GROQ_API_KEY?: string;
  GEMINI_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  ASSETS?: {
    fetch: (request: Request) => Promise<Response>;
  };
}

const GROQ_TRANSCRIBE_MODEL = 'whisper-large-v3-turbo';
const GROQ_CHAT_MODEL = 'llama-3.3-70b-versatile';

const FAIRFIRST_CQM_KNOWLEDGE = `
FAIRFIRST INSURANCE SRI LANKA — CALL QUALITY MONITORING (CQM) & FNOL KNOWLEDGE BASE

1. STANDARD GREETING:
- Expected standard greeting: "Ayubowan Fairfirst Insurance I am (Agent Name) How May I assist You?" (or clear polite equivalent in Sinhala/Singlish/English/Tamil stating Fairfirst Insurance, Agent Name, and offer to assist).
- Check whether greeting is prompt, clear, polite, and includes brand + agent identity + assistance offer.

2. HOLDING PROCEDURE:
- Before placing a customer on hold, agent should politely ask permission: "කරුණාකර දුරකතනයේ රැඳී ඉන්න පුළුවන්ද සර්/මිස් මහත්මයා" (or polite Singlish/English/Tamil equivalent).
- Upon returning from hold, agent should thank the customer: "ස්තුතියි සර් / මිස් රැඳී සිටියාට" (or polite equivalent).
- If no hold occurred and no hold-related issue happened, mark as Not Assessable (unless hold was clearly needed and missed).

3. COURTESY TOWARDS CLIENT, EMPATHY & TONE:
- Courtesy (ආචාරශීලී බව): Respectful address (Sir/Madam/මහත්මයා/ඔබතුමා/ඔබතුමිය), polite phrasing, no interrupting or dismissive language.
- Empathy: Appropriate empathetic expressions especially during accidents, injuries, vehicle damage, stress, or delays (e.g., checking if anyone is injured, expressing concern/care).
- Tone: Evaluate vocal tone/manner reflected in phrasing and delivery (calm, supportive, professional, attentive vs rushed, cold, defensive, or harsh).

4. ACCIDENT / FNOL SCRIPT & KEY INFORMATION CHECKLIST:
- Wellbeing & Injuries: Ask if anyone is injured and how many people are injured.
- Vehicle Number & Data Protection: Ask for vehicle number; assure that information provided is protected/confidential.
- Policyholder & Caller Details: Ask whose name the vehicle is insured under; ask whether the calling phone number belongs to the caller.
- Driver & Relationship: Ask who was driving at the time of the accident. If someone else called, ask politely to speak with the driver (if comfortable). If driver is different from the insured/policyholder, ask the relationship to the policyholder.
- Driver Identification: Ask for full name, Date of Birth (DOB), and Driver's License number or NIC number.
- Time of Accident & Late Intimation: Ask how long ago the accident occurred. If it is a prior/late intimation, ask date and time of accident and reason for delay in intimating.
- Location, Police Station & Incident Description: Ask where the accident happened, relevant Police Station, and how the accident occurred.
- Third Party, Damages & Occupants: If third party is involved, ask for the other vehicle number and insurance company. Ask about damages to the vehicle and how many people were in the vehicle at the time of the accident.
- Closing & Clarity: Thank customer for information, explain next steps clearly, ask if information is clear ("තොරතුරු පැහැදිලියි ද ඔබතුමාට ඔබතුමියට"), and close politely ("ස්තුතියි Fairfirst Insurance ඇමතුවාට සුබ දවසක්").

5. INSPECTION ARRANGEMENT RULES (VIRTUAL VS PHYSICAL & RESTRICTIONS):
- Virtual Inspection: If customer has a smartphone, explain clearly that a link will be sent via normal SMS, and when the customer turns on mobile data and taps/touches the link, they will automatically connect with an assessor.
- Mandatory Virtual / C2C Exclusions (DO NOT offer Virtual/C2C when these apply):
  - Heavy damage
  - Drunk and drive
  - Accident occurred between 10:00 PM (22:00) and 6:00 AM (06:00)
  - More than 24 hours have passed since the accident occurred
- Physical Inspection: If physical inspection is arranged, state that an assessor will come within 30 or 45 minutes to inspect the vehicle.
- MANDATORY ASSESSOR SMS RULE (BOTH VIRTUAL & PHYSICAL): In BOTH Virtual and Physical inspection cases, the agent MUST inform the customer that the attending assessor's telephone number will be sent via SMS, and if there is any issue/problem, to call that number ("එන assessor මහත්මයාගේ දුරකථන අංකය ඔබතුමාට SMS එකකින් එවන්නම්. ගැටලුවක් තිබුණොත් ඒකට call කරන්න").

6. SUPPORTING TEAMS & CALLBACK RULE (MOTOR CLAIM / MEDICAL / MOBITEL):
- For Motor Claim calls, Medical calls, or Mobitel-related inquiries connected to internal/call-centre supporting teams:
  - Agent MUST inform the customer that the supporting team will give a callback within 15 minutes, and the customer does NOT need to call back again ("විනාඩි 15 ඇතුළත call back එකක් දෙනවා, නැවත ඔබතුමා ගන්න ඕනේ නැහැ").

7. SERVICE LEVEL AGREEMENTS (SLA) REFERENCE:
- Claims: 15 minutes
- Mobitel / Medical Inquiry: 15 minutes
- Motor Policy / Renewal / Insurance Card: 30 minutes
(Note: When evaluating from audio/transcript alone, flag SLA commitments/timelines communicated to the customer or note if system/turnaround SLA verification requires operational/MCC logs).
`.trim();

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

// Secret එකේ වටේ තියෙන අමතර space හෝ quotes (" ") ඉවත් කරන helper function එක
function cleanSecret(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/^["']+|["']+$/g, '').trim();
}

function getGroqApiKey(env: Env): string {
  const rawKey =
    cleanSecret(env.GROQ_API_KEY) ||
    (typeof process !== 'undefined' ? cleanSecret(process.env?.GROQ_API_KEY) : '');

  if (!rawKey || rawKey === 'MY_GROQ_API_KEY') {
    throw new Error(
      'GROQ_API_KEY is not configured. Please add it in Worker Settings > Variables and secrets.'
    );
  }

  return rawKey;
}

function getExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx >= 0 ? filename.slice(idx).toLowerCase() : '';
}

function isAllowedAudio(mime: string, filename: string): boolean {
  const allowedExt = /\.(wav|mp3|m4a|ogg|webm|aac|flac)$/i;
  const isAudioMime = mime.startsWith('audio/') || mime === 'application/octet-stream';
  return isAudioMime || allowedExt.test(filename);
}

function normalizeAudioMimeType(originalMime: string, originalName: string): string {
  const ext = getExtension(originalName);
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.m4a') return 'audio/mp4';
  if (ext === '.ogg') return 'audio/ogg';
  if (ext === '.webm') return 'audio/webm';
  if (ext === '.flac') return 'audio/flac';
  if (ext === '.aac') return 'audio/aac';
  if (originalMime && originalMime.startsWith('audio/')) return originalMime;
  return 'audio/wav';
}

function parseTimestampToSeconds(ts: string): number {
  const parts = String(ts || '00:00')
    .trim()
    .split(':')
    .map((n) => Number(n));
  if (parts.length === 2 && !Number.isNaN(parts[0]) && !Number.isNaN(parts[1])) {
    return Math.max(0, Math.round(parts[0] * 60 + parts[1]));
  }
  if (parts.length === 3 && parts.every((n) => !Number.isNaN(n))) {
    return Math.max(0, Math.round(parts[0] * 3600 + parts[1] * 60 + parts[2]));
  }
  return 0;
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 1): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient =
        msg.includes('503') ||
        msg.includes('429') ||
        msg.includes('502') ||
        msg.includes('rate limit') ||
        msg.includes('timeout') ||
        msg.includes('timed out');
      if (!isTransient || attempt === maxRetries) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
    }
  }
  throw lastError;
}

function mapGroqError(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : 'Unexpected server error during Groq processing.';
  if (raw.includes('GROQ_API_KEY is not configured')) {
    return { status: 503, message: raw };
  }
  if (raw.includes('401') || raw.toLowerCase().includes('invalid api key') || raw.toLowerCase().includes('unauthorized')) {
    return {
      status: 401,
      message: `Groq API key rejected (${raw}). Please verify GROQ_API_KEY in Cloudflare Worker Settings > Variables and secrets.`,
    };
  }
  if (raw.includes('429') || raw.toLowerCase().includes('rate limit')) {
    return {
      status: 429,
      message: 'Groq API rate limit reached. Please wait a moment and try again.',
    };
  }
  if (raw.includes('503') || raw.includes('502') || raw.includes('timed out')) {
    return {
      status: 503,
      message: 'Groq service is temporarily busy or timed out. Please try again shortly.',
    };
  }
  return { status: 500, message: raw };
}

// Audio file එක Groq Whisper වෙත යවා raw transcript ලබාගැනීම
async function transcribeAudioWithGroq(
  apiKey: string,
  audioBytes: Uint8Array,
  filename: string,
  mimeType: string,
  timeoutMs = 35000
): Promise<string> {
  const endpoint = 'https://api.groq.com/openai/v1/audio/transcriptions';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const form = new FormData();
    const safeBytes = new Uint8Array(audioBytes);
    const blob = new Blob([safeBytes], { type: mimeType });
    form.append('file', blob, filename || 'recording.wav');
    form.append('model', GROQ_TRANSCRIBE_MODEL);
    form.append('response_format', 'json');

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
      signal: controller.signal,
    });

    const text = await resp.text();
    let data: any = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { rawText: text };
    }

    if (!resp.ok) {
      const apiMsg = data?.error?.message || text || `HTTP ${resp.status}`;
      throw new Error(`[${resp.status}] ${apiMsg} (groq-whisper)`);
    }

    return typeof data?.text === 'string' ? data.text.trim() : '';
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`groq-whisper timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Text / JSON response සඳහා Groq Llama chat endpoint භාවිතා කිරීම
async function callGroqChatJson(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  timeoutMs = 35000,
  label = 'groq-llama'
): Promise<any> {
  const endpoint = 'https://api.groq.com/openai/v1/chat/completions';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: GROQ_CHAT_MODEL,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });

    const text = await resp.text();
    let data: any = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { rawText: text };
    }

    if (!resp.ok) {
      const apiMsg = data?.error?.message || text || `HTTP ${resp.status}`;
      throw new Error(`[${resp.status}] ${apiMsg} (${label})`);
    }

    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      return {};
    }

    try {
      return JSON.parse(content.trim());
    } catch {
      return {};
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function handleHealth(env: Env): Promise<Response> {
  const rawKey =
    cleanSecret(env.GROQ_API_KEY) ||
    (typeof process !== 'undefined' ? cleanSecret(process.env?.GROQ_API_KEY) : '');
  const hasKey = Boolean(rawKey && rawKey !== 'MY_GROQ_API_KEY');

  return jsonResponse({
    ok: true,
    provider: 'groq',
    groqConfigured: hasKey,
    cqmKnowledgeLoaded: true,
    keyPrefix: hasKey ? rawKey.slice(0, 8) : null,
    models: {
      transcription: GROQ_TRANSCRIBE_MODEL,
      analysisAndEvaluation: GROQ_CHAT_MODEL,
    },
  });
}

async function handleTranscribe(request: Request, env: Env): Promise<Response> {
  try {
    const formData = await request.formData();
    const audioEntry = formData.get('audio');
    const configEntry = formData.get('config');

    if (!(audioEntry instanceof File)) {
      return jsonResponse({ error: 'No audio file was uploaded.' }, 400);
    }
    if (audioEntry.size === 0) {
      return jsonResponse({ error: 'Uploaded audio file is empty.' }, 400);
    }
    if (audioEntry.size > 20 * 1024 * 1024) {
      return jsonResponse({ error: 'Audio file exceeds the 20 MB inline limit.' }, 413);
    }
    if (!isAllowedAudio(audioEntry.type || '', audioEntry.name || 'recording.wav')) {
      return jsonResponse(
        { error: 'Unsupported file format. Please upload WAV, MP3, M4A, OGG, or WEBM audio files.' },
        400
      );
    }

    let parsedConfig: {
      preferDedicatedTranscriptionFirst?: boolean;
      enableSinhala?: boolean;
      enableEnglish?: boolean;
      enableTamil?: boolean;
      tamilDisplay?: 'script' | 'roman';
    } = {};

    if (typeof configEntry === 'string' && configEntry.trim()) {
      try {
        parsedConfig = JSON.parse(configEntry);
      } catch {
        parsedConfig = {};
      }
    }

    const mimeType = normalizeAudioMimeType(audioEntry.type || '', audioEntry.name || 'recording.wav');
    const arrayBuffer = await audioEntry.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    const apiKey = getGroqApiKey(env);

    const warnings: string[] = [];
    const rawTranscript = await withRetry(() =>
      transcribeAudioWithGroq(
        apiKey,
        uint8,
        audioEntry.name || 'recording.wav',
        mimeType,
        35000
      )
    );

    if (!rawTranscript) {
      warnings.push('No intelligible speech was returned by the audio transcription model.');
    }

    const enabledLanguages = [
      parsedConfig.enableSinhala !== false ? 'Sinhala (displayed in Roman Sinhala / Singlish)' : null,
      parsedConfig.enableEnglish !== false ? 'English' : null,
      parsedConfig.enableTamil !== false ? 'Tamil' : null,
    ]
      .filter(Boolean)
      .join(', ');

    const systemPrompt = `You are a strict, verbatim call-transcript structuring and speaker-diarization specialist.

ANTI-HALLUCINATION RULE (HIGHEST PRIORITY):
- Determine whether actual human speech is present in the transcript (set "hasIntelligibleSpeech" to true or false).
- If the transcript is empty or contains only noise/silence markers with NO clear spoken words, set "hasIntelligibleSpeech": false, return an empty "segments": [] array, and add a clear warning in "overallReliabilityWarnings".
- NEVER invent, guess, or fabricate dialogue. For any unclear phrase, write "[Unclear audio]".

LANGUAGE & DISPLAY RULES (Supported: ${enabledLanguages || 'Sinhala, English, Tamil'}):
1. SINHALA -> SINGLISH (ROMAN SINHALA):
  - Convert spoken Sinhala words phonetically into natural Romanized Singlish (Roman letters).
  - NEVER output Sinhala Unicode script in "text".
  - NEVER translate Sinhala speech into English; keep the exact spoken meaning in Singlish.
2. ENGLISH:
  - Keep spoken English words accurately. Preserve Sinhala-English code-switching within the same line.
3. TAMIL:
  - Keep Tamil speech in Tamil script in "text" and provide Roman Tamil in "romanText".
4. SPEAKER DIARIZATION & TIMESTAMPS:
  - Label each turn "Agent" or "Customer" based on conversational role.
  - Provide chronological MM:SS timestamps.

Return ONLY a valid JSON object matching this structure:
{
  "hasIntelligibleSpeech": boolean,
  "detectedLanguages": string[],
  "overallReliabilityWarnings": string[],
  "segments": [
    {
      "speaker": "Agent" | "Customer",
      "timestamp": "MM:SS",
      "language": "Sinhala (Singlish)" | "English" | "Tamil" | "Mixed (Sinhala/English)" | "Mixed (Tamil/English)" | "Unclear",
      "text": string,
      "romanText": string,
      "confidence": "high" | "medium" | "low",
      "uncertaintyNote": string
    }
  ]
}`;

    const userPrompt = `Structure the following Sri Lankan insurance FNOL contact centre call transcript into speaker-diarized, timestamped segments following all rules:\n\n"""\n${rawTranscript.slice(0, 15000)}\n"""`;

    const parsed = await withRetry(() =>
      callGroqChatJson(apiKey, systemPrompt, userPrompt, 35000, 'groq-diarize-transcript')
    );

    const hasSpeech = parsed?.hasIntelligibleSpeech !== false && Boolean(rawTranscript);
    const rawSegments = hasSpeech && Array.isArray(parsed?.segments) ? parsed.segments : [];
    const modelWarnings = Array.isArray(parsed?.overallReliabilityWarnings) ? parsed.overallReliabilityWarnings : [];

    const normalizedSegments =
      rawSegments.length === 0
        ? [
            {
              id: `seg-1-${Date.now()}`,
              speaker: 'Customer' as const,
              timestamp: '00:00',
              timestampSeconds: 0,
              language: 'Unclear' as const,
              text: rawTranscript || '[Unclear audio — no intelligible speech detected]',
              confidence: 'low' as const,
              uncertaintyNote: 'No intelligible human speech was clearly detected in this recording.',
              isEdited: false,
            },
          ]
        : rawSegments.map((seg: Record<string, unknown>, idx: number) => {
            const speaker = seg.speaker === 'Customer' ? 'Customer' : 'Agent';
            const timestamp =
              typeof seg.timestamp === 'string' && /^\d{1,2}:\d{2}/.test(seg.timestamp.trim())
                ? seg.timestamp.trim()
                : '00:00';
            const validLanguages = [
              'Sinhala (Singlish)',
              'English',
              'Tamil',
              'Mixed (Sinhala/English)',
              'Mixed (Tamil/English)',
              'Unclear',
            ];
            const language = validLanguages.includes(String(seg.language)) ? String(seg.language) : 'Unclear';
            const confidence = ['high', 'medium', 'low'].includes(String(seg.confidence))
              ? String(seg.confidence)
              : 'medium';

            return {
              id: `seg-${idx + 1}-${Date.now()}`,
              speaker,
              timestamp,
              timestampSeconds: parseTimestampToSeconds(timestamp),
              language,
              text: typeof seg.text === 'string' && seg.text.trim() ? seg.text.trim() : '[Unclear audio]',
              romanText: typeof seg.romanText === 'string' && seg.romanText.trim() ? seg.romanText.trim() : undefined,
              confidence,
              uncertaintyNote:
                typeof seg.uncertaintyNote === 'string' && seg.uncertaintyNote.trim()
                  ? seg.uncertaintyNote.trim()
                  : undefined,
              isEdited: false,
            };
          });

    return jsonResponse({
      segments: normalizedSegments,
      detectedLanguages: Array.isArray(parsed?.detectedLanguages) ? parsed.detectedLanguages : [],
      processingMeta: {
        provider: 'groq',
        primaryModelAttempted: GROQ_TRANSCRIBE_MODEL,
        primarySucceeded: Boolean(rawTranscript),
        audioUnderstandingModel: GROQ_CHAT_MODEL,
        fallbackUsed: false,
        warnings: [...warnings, ...modelWarnings].filter(Boolean),
        rawDedicatedTranscript: rawTranscript || undefined,
      },
    });
  } catch (err: unknown) {
    const mapped = mapGroqError(err);
    return jsonResponse({ error: mapped.message }, mapped.status);
  }
}

async function handleTransliterateSinglish(request: Request, env: Env): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as { text?: string };
    const text = body.text;
    if (typeof text !== 'string' || !text.trim()) {
      return jsonResponse({ error: 'Text is required for Singlish conversion.' }, 400);
    }

    const apiKey = getGroqApiKey(env);
    const systemPrompt = `Convert any Sinhala Unicode script in the input text into natural Sri Lankan Singlish (Roman Sinhala). Preserve all English words unchanged and do NOT translate Sinhala into English. Return ONLY JSON: {"singlishText": "..."}.`;
    const userPrompt = text;

    const parsed = await callGroqChatJson(
      apiKey,
      systemPrompt,
      userPrompt,
      20000,
      'groq-transliterate-singlish'
    );

    return jsonResponse({
      singlishText: typeof parsed?.singlishText === 'string' && parsed.singlishText.trim()
        ? parsed.singlishText.trim()
        : text,
    });
  } catch (err: unknown) {
    const mapped = mapGroqError(err);
    return jsonResponse({ error: mapped.message }, mapped.status);
  }
}

async function handleEvaluate(request: Request, env: Env): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      transcriptSegments?: Array<{
        timestamp: string;
        speaker: string;
        language: string;
        text: string;
        confidence?: string;
        uncertaintyNote?: string;
      }>;
      metadata?: {
        agentName?: string;
        agentId?: string;
        callReference?: string;
        callDate?: string;
        additionalNotes?: string;
      };
      scorecardConfig?: Array<{
        id: string;
        name: string;
        weight: number;
        description: string;
        guideline: string;
      }>;
      qaRules?: Array<{
        id: string;
        title: string;
        description: string;
        enabled: boolean;
        requiresMccSystemCheck: boolean;
      }>;
      thresholds?: {
        excellentMin?: number;
        goodMin?: number;
        averageMin?: number;
      };
      durationSeconds?: number;
    };

    const { transcriptSegments, metadata, scorecardConfig, qaRules, thresholds, durationSeconds } = body;

    if (!Array.isArray(transcriptSegments) || transcriptSegments.length === 0) {
      return jsonResponse({ error: 'Cannot evaluate call without transcript segments.' }, 400);
    }

    const apiKey = getGroqApiKey(env);
    const activeScorecard = Array.isArray(scorecardConfig) && scorecardConfig.length > 0 ? scorecardConfig : [];
    const activeRules = Array.isArray(qaRules) ? qaRules.filter((r) => r.enabled !== false) : [];

    const formattedTranscript = transcriptSegments
      .map(
        (s) =>
          `[${s.timestamp}] ${s.speaker} (${s.language}${s.confidence === 'low' ? ', LOW CONFIDENCE' : ''}): ${s.text}${
            s.uncertaintyNote ? ` [Note: ${s.uncertaintyNote}]` : ''
          }`
      )
      .join('\n');

    const scorecardSpec = activeScorecard
      .map(
        (p) =>
          `- ID: "${p.id}" | Parameter: "${p.name}" | Weight: ${p.weight} | Description: ${p.description} | Guideline: ${p.guideline}`
      )
      .join('\n');

    const rulesSpec = activeRules
      .map(
        (r) =>
          `- Rule ID: "${r.id}" | Title: "${r.title}" | MCC System Check Required: ${r.requiresMccSystemCheck ? 'YES' : 'NO'} | Criteria: ${r.description}`
      )
      .join('\n');

    const systemPrompt = `You are a senior insurance Contact Centre Quality Assurance Specialist evaluating a Fairfirst Insurance Sri Lanka call (primarily FNOL / Motor Claim / Medical / Mobitel / Policy & Renewal inquiries; calls may be in Singlish/Roman Sinhala, English, or Tamil).

${FAIRFIRST_CQM_KNOWLEDGE}

EVALUATION PRINCIPLES (STRICT):
1. Evaluate EVERY CQM parameter independently based ONLY on actual transcript evidence and the Fairfirst CQM Knowledge Base above.
2. NEVER invent conversations, customer statements, or Agent actions that are not in the transcript.
3. NEVER award marks based on assumptions. Do not assume information was recorded in the MCC system merely because it was spoken on the call—explicitly flag MCC-system-dependent checks for manual system verification.
4. NOT ASSESSABLE RULE: If a parameter cannot be evaluated from the recording (for example, Holding Procedure if no hold occurred and no hold policy breach applies, OR if the relevant audio segment is [Unclear audio] / low-confidence transcription), mark status as "Not Assessable", set awardedMarks to 0, set needsHumanReview to true, and explain why manual review is required. Do NOT silently award full marks.
5. Do not penalise an Agent for a requirement that is not applicable (e.g., late intimation reason if the accident happened just now; third party details if no third party was involved).
6. Flag policy/rule breaches clearly—especially if Virtual/C2C inspection was offered when heavy damage, drunk & drive, 10:00 PM–6:00 AM timing, or >24 hours elapsed applies, or if mandatory Assessor SMS / 15-minute callback rules were missed.
7. Provide exact MM:SS timestamps and verbatim transcript quotes for evidence, especially for negative findings.
8. Explain clearly why marks were deducted, and provide practical, constructive coaching feedback without repeating the same issue across unrelated parameters.
9. Performance bands: Below 70 = Poor, 70 to <80 = Average, 80 to 90 = Good, Above 90 = Excellent.

Return ONLY a valid JSON object matching this exact structure:
{
  "scorecard": [
    {
      "parameterId": "string",
      "parameterName": "string",
      "maxMarks": number,
      "awardedMarks": number,
      "status": "Excellent" | "Good" | "Needs Improvement" | "Failed" | "Not Assessable",
      "reason": "string",
      "evidence": "string",
      "timestamp": "string",
      "recommendedImprovement": "string",
      "needsHumanReview": boolean,
      "systemVerificationRequired": boolean
    }
  ],
  "fnolChecks": [
    {
      "ruleId": "string",
      "ruleTitle": "string",
      "applicable": boolean,
      "result": "Passed" | "Failed" | "Partial" | "Not Applicable" | "Requires Manual MCC Verification",
      "evidence": "string",
      "timestamp": "string",
      "notes": "string"
    }
  ],
  "criticalFindings": [
    {
      "category": "string",
      "severity": "High" | "Medium",
      "description": "string",
      "timestamp": "string",
      "evidence": "string"
    }
  ],
  "coachingFeedback": {
    "strengths": ["string"],
    "areasForImprovement": ["string"],
    "recommendedActions": ["string"]
  }
}`;

    const userPrompt = `Evaluate this call transcript against the exact CQM Scorecard and FNOL QA Rules below.

CALL METADATA:
- Agent Name: ${metadata?.agentName || 'Unknown'}
- Agent ID: ${metadata?.agentId || 'Unknown'}
- Call Reference: ${metadata?.callReference || 'N/A'}
- Call Date: ${metadata?.callDate || 'N/A'}
- Call Type: FNOL
- Recorded Duration: ${Math.round(Number(durationSeconds) || 0)} seconds
- Additional Notes: ${metadata?.additionalNotes || 'None'}

SCORECARD PARAMETERS (evaluate all ${activeScorecard.length} parameters independently, preserving exact parameterId and maxMarks):
${scorecardSpec}

FNOL PROCESS & MANDATORY QA CHECKS:
${rulesSpec}

CHRONOLOGICAL TRANSCRIPT:
${formattedTranscript}`;

    const parsed = await withRetry(() =>
      callGroqChatJson(apiKey, systemPrompt, userPrompt, 35000, 'groq-evaluate-call')
    );

    const aiScorecardRaw: Array<Record<string, unknown>> = Array.isArray(parsed?.scorecard) ? parsed.scorecard : [];
    const validStatuses = ['Excellent', 'Good', 'Needs Improvement', 'Failed', 'Not Assessable'];

    const normalizedScorecard = activeScorecard.map((cfg) => {
      const match =
        aiScorecardRaw.find((item) => item.parameterId === cfg.id) ||
        aiScorecardRaw.find((item) => String(item.parameterName || '').toLowerCase() === cfg.name.toLowerCase());

      if (!match) {
        return {
          parameterId: cfg.id,
          parameterName: cfg.name,
          maxMarks: cfg.weight,
          awardedMarks: 0,
          evaluatorMarks: null,
          status: 'Not Assessable',
          reason: 'Parameter was not returned by evaluation pass and requires manual review.',
          evidence: 'N/A',
          timestamp: 'N/A',
          timestampSeconds: null,
          recommendedImprovement: 'Review transcript manually for this criterion.',
          needsHumanReview: true,
          systemVerificationRequired: false,
          evaluatorComment: '',
          reviewDecision: 'pending',
        };
      }

      const status = validStatuses.includes(String(match.status)) ? String(match.status) : 'Not Assessable';
      const rawAwarded = Number(match.awardedMarks);
      const clampedMarks =
        status === 'Not Assessable'
          ? 0
          : Number.isFinite(rawAwarded)
          ? Math.max(0, Math.min(cfg.weight, Math.round(rawAwarded * 10) / 10))
          : 0;
      const ts = typeof match.timestamp === 'string' && match.timestamp.trim() ? match.timestamp.trim() : 'N/A';

      return {
        parameterId: cfg.id,
        parameterName: cfg.name,
        maxMarks: cfg.weight,
        awardedMarks: clampedMarks,
        evaluatorMarks: null,
        status,
        reason: typeof match.reason === 'string' ? match.reason : '',
        evidence: typeof match.evidence === 'string' ? match.evidence : 'N/A',
        timestamp: ts,
        timestampSeconds: /^\d{1,2}:\d{2}/.test(ts) ? parseTimestampToSeconds(ts) : null,
        recommendedImprovement: typeof match.recommendedImprovement === 'string' ? match.recommendedImprovement : '',
        needsHumanReview: Boolean(match.needsHumanReview) || status === 'Not Assessable',
        systemVerificationRequired: Boolean(match.systemVerificationRequired),
        evaluatorComment: '',
        reviewDecision: 'pending',
      };
    });

    const aiOverallScore =
      Math.round(normalizedScorecard.reduce((sum, item) => sum + item.awardedMarks, 0) * 10) / 10;

    const assessedMaxMarks = normalizedScorecard.reduce(
      (sum, item) => sum + (item.status === 'Not Assessable' ? 0 : item.maxMarks),
      0
    );

    const excellentMin = Number(thresholds?.excellentMin ?? 90);
    const goodMin = Number(thresholds?.goodMin ?? 80);
    const averageMin = Number(thresholds?.averageMin ?? 70);

    let performanceBand = 'Poor';
    if (aiOverallScore > excellentMin) performanceBand = 'Excellent';
    else if (aiOverallScore >= goodMin) performanceBand = 'Good';
    else if (aiOverallScore >= averageMin) performanceBand = 'Average';

    const validRuleResults = ['Passed', 'Failed', 'Partial', 'Not Applicable', 'Requires Manual MCC Verification'];
    const rawChecks: Array<Record<string, unknown>> = Array.isArray(parsed?.fnolChecks) ? parsed.fnolChecks : [];
    const normalizedChecks = activeRules.map((rule) => {
      const found = rawChecks.find((c) => c.ruleId === rule.id);
      const resVal =
        found && validRuleResults.includes(String(found.result))
          ? String(found.result)
          : rule.requiresMccSystemCheck
          ? 'Requires Manual MCC Verification'
          : 'Not Applicable';

      return {
        ruleId: rule.id,
        ruleTitle: rule.title,
        applicable: found ? Boolean(found.applicable) : true,
        result: resVal,
        evidence: found && typeof found.evidence === 'string' ? found.evidence : 'N/A',
        timestamp: found && typeof found.timestamp === 'string' ? found.timestamp : 'N/A',
        notes: found && typeof found.notes === 'string' ? found.notes : '',
        evaluatorConfirmed: null,
      };
    });

    const rawFindings: Array<Record<string, unknown>> = Array.isArray(parsed?.criticalFindings) ? parsed.criticalFindings : [];
    const normalizedFindings = rawFindings.map((f, idx) => ({
      id: `finding-${idx + 1}-${Date.now()}`,
      category: typeof f.category === 'string' ? f.category : 'Process Failure',
      severity: f.severity === 'High' ? 'High' : 'Medium',
      description: typeof f.description === 'string' ? f.description : '',
      timestamp: typeof f.timestamp === 'string' ? f.timestamp : 'N/A',
      evidence: typeof f.evidence === 'string' ? f.evidence : '',
      status: 'pending',
    }));

    const coachingFeedback = {
      strengths: Array.isArray(parsed?.coachingFeedback?.strengths) ? parsed.coachingFeedback.strengths : [],
      areasForImprovement: Array.isArray(parsed?.coachingFeedback?.areasForImprovement)
        ? parsed.coachingFeedback.areasForImprovement
        : [],
      recommendedActions: Array.isArray(parsed?.coachingFeedback?.recommendedActions)
        ? parsed.coachingFeedback.recommendedActions
        : [],
    };

    const requiresManualReview = normalizedScorecard.some((p) => p.needsHumanReview || p.systemVerificationRequired);

    return jsonResponse({
      scorecard: normalizedScorecard,
      fnolChecks: normalizedChecks,
      criticalFindings: normalizedFindings,
      coachingFeedback,
      overallScore: aiOverallScore,
      aiOverallScore,
      assessedMaxMarks,
      performanceBand,
      requiresManualReview,
    });
  } catch (err: unknown) {
    const mapped = mapGroqError(err);
    return jsonResponse({ error: mapped.message }, mapped.status);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === '/api/health' && request.method === 'GET') {
      return handleHealth(env);
    }

    if (pathname === '/api/transcribe' && request.method === 'POST') {
      return handleTranscribe(request, env);
    }

    if (pathname === '/api/transliterate-singlish' && request.method === 'POST') {
      return handleTransliterateSinglish(request, env);
    }

    if (pathname === '/api/evaluate' && request.method === 'POST') {
      return handleEvaluate(request, env);
    }

    if (pathname.startsWith('/api/')) {
      return jsonResponse({ error: `Method ${request.method} not allowed on ${pathname}` }, 405);
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  },
};
