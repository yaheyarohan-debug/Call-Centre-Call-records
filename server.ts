import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const PORT = Number(process.env.PORT) || 3000;

const app = express();
app.use(express.json({ limit: '10mb' }));

// Process audio in memory only — never persist sensitive customer recordings to server disk
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB max
  },
  fileFilter: (_req, file, cb) => {
    const allowedExt = /\.(wav|mp3|m4a|ogg|webm|aac|flac)$/i;
    const isAudioMime = file.mimetype.startsWith('audio/') || file.mimetype === 'application/octet-stream';
    if (isAudioMime || allowedExt.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file format. Please upload WAV, MP3, M4A, OGG, or WEBM audio files.'));
    }
  },
});

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('GEMINI_API_KEY is not configured. Please configure it in Settings > Secrets.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function normalizeAudioMimeType(originalMime: string, originalName: string): string {
  const ext = path.extname(originalName).toLowerCase();
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.mp3') return 'audio/mp3';
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
        msg.includes('UNAVAILABLE') ||
        msg.includes('high demand') ||
        msg.includes('timeout');
      if (!isTransient || attempt === maxRetries) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

let dedicatedModelUnsupported = false;

function isUnavailableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('503') ||
    msg.includes('429') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('high demand') ||
    msg.includes('timed out')
  );
}

function mapGeminiError(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : 'Unexpected server error during Gemini processing.';
  if (raw.includes('GEMINI_API_KEY is not configured')) {
    return { status: 503, message: raw };
  }
  if (raw.includes('503') || raw.includes('UNAVAILABLE') || raw.includes('high demand')) {
    return {
      status: 503,
      message: 'Gemini AI model is experiencing temporary high demand (503). Please try again in a few moments.',
    };
  }
  if (raw.includes('API_KEY_INVALID') || raw.includes('PERMISSION_DENIED') || raw.includes('403')) {
    return {
      status: 403,
      message: 'Gemini API authentication failed. Please verify GEMINI_API_KEY in Settings > Secrets.',
    };
  }
  if (raw.includes('RESOURCE_EXHAUSTED') || raw.includes('429')) {
    return {
      status: 429,
      message: 'Gemini API rate limit or quota reached. Please wait briefly and try again.',
    };
  }
  if (raw.includes('NOT_FOUND') || raw.includes('404')) {
    return {
      status: 502,
      message: `Requested Gemini model was unavailable: ${raw}`,
    };
  }
  return { status: 500, message: raw };
}

app.get('/api/health', (_req: Request, res: Response) => {
  const hasKey = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY');
  res.json({
    ok: true,
    geminiConfigured: hasKey,
    models: {
      dedicatedTranscription: 'gemini-3.5-transcribe',
      audioUnderstandingAndEvaluation: 'gemini-4-hydrogen',
    },
  });
});

app.post('/api/transcribe', upload.single('audio'), async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No audio file was uploaded.' });
    return;
  }
  if (req.file.size === 0) {
    res.status(400).json({ error: 'Uploaded audio file is empty.' });
    return;
  }

  let parsedConfig: {
    preferDedicatedTranscriptionFirst?: boolean;
    enableSinhala?: boolean;
    enableEnglish?: boolean;
    enableTamil?: boolean;
    tamilDisplay?: 'script' | 'roman';
  } = {};

  try {
    if (typeof req.body?.config === 'string') {
      parsedConfig = JSON.parse(req.body.config);
    }
  } catch {
    parsedConfig = {};
  }

  const mimeType = normalizeAudioMimeType(req.file.mimetype, req.file.originalname);
  const preferDedicatedFirst = parsedConfig.preferDedicatedTranscriptionFirst !== false;
  let uploadedFileName: string | null = null;

  try {
    const ai = getAiClient();

    // Prepare audio part: inlineData for <= 12MB, temporary Files API upload for larger recordings (deleted in finally)
    let audioPart: { inlineData: { mimeType: string; data: string } } | { fileData: { fileUri: string; mimeType: string } };

    if (req.file.size <= 12 * 1024 * 1024) {
      audioPart = {
        inlineData: {
          mimeType,
          data: req.file.buffer.toString('base64'),
        },
      };
    } else {
      const uint8 = new Uint8Array(req.file.buffer);
      const blob = new Blob([uint8], { type: mimeType });
      const uploaded = await ai.files.upload({
        file: blob,
        config: { mimeType },
      });
      if (!uploaded.uri || !uploaded.name) {
        throw new Error('Failed to upload large audio buffer for processing.');
      }
      uploadedFileName = uploaded.name;
      audioPart = {
        fileData: {
          fileUri: uploaded.uri,
          mimeType: uploaded.mimeType || mimeType,
        },
      };
    }

    const warnings: string[] = [];
    let primarySucceeded = false;
    let fallbackUsed = false;
    let rawDedicatedTranscript = '';

    // Stage A: Attempt Gemini dedicated transcription model (gemini-3.5-transcribe)
    if (preferDedicatedFirst && !dedicatedModelUnsupported) {
      const tA = Date.now();
      try {
        const transcribeResp = await withRetry(() =>
          withTimeout(
            ai.models.generateContent({
              model: 'gemini-3.5-transcribe',
              contents: {
                parts: [
                  audioPart,
                  {
                    text: 'Transcribe this Sri Lankan insurance FNOL contact centre call recording verbatim. Speakers may switch between Sinhala, English, and Tamil.',
                  },
                ],
              },
            }),
            20000,
            'gemini-3.5-transcribe'
          )
        );
        rawDedicatedTranscript = (transcribeResp.text || '').trim();
        console.log(`[transcribe] stageA=gemini-3.5-transcribe ms=${Date.now() - tA} chars=${rawDedicatedTranscript.length}`);
        if (rawDedicatedTranscript.length > 0) {
          primarySucceeded = true;
        } else {
          fallbackUsed = true;
          warnings.push('Dedicated transcription returned empty output; processed using Gemini audio-understanding fallback.');
        }
      } catch (err: unknown) {
        fallbackUsed = true;
        const msg = err instanceof Error ? err.message : 'Dedicated transcription unavailable';
        console.log(`[transcribe] stageA_fallback ms=${Date.now() - tA}`);
        if (msg.includes('404') || msg.includes('NOT_FOUND')) {
          dedicatedModelUnsupported = true;
          warnings.push('Dedicated transcription endpoint (gemini-3.5-transcribe) is unavailable for this API configuration; processed via Gemini multimodal audio understanding.');
        } else {
          warnings.push('Dedicated transcription was unavailable; processed via Gemini multimodal audio understanding.');
        }
      }
    } else {
      fallbackUsed = true;
      warnings.push(
        dedicatedModelUnsupported
          ? 'Dedicated transcription endpoint (gemini-3.5-transcribe) is unavailable for this API configuration; processed via Gemini multimodal audio understanding.'
          : 'Direct multimodal audio-understanding mode selected in Settings.'
      );
    }

    // Stage B: Structured Diarized Multilingual Transcription + Singlish transliteration using gemini-4-hydrogen
    const enabledLanguages = [
      parsedConfig.enableSinhala !== false ? 'Sinhala (displayed in Roman Sinhala / Singlish)' : null,
      parsedConfig.enableEnglish !== false ? 'English' : null,
      parsedConfig.enableTamil !== false ? 'Tamil' : null,
    ]
      .filter(Boolean)
      .join(', ');

    const systemInstruction = `You are a strict, verbatim audio transcription and speaker diarization engine.

ANTI-HALLUCINATION RULE (HIGHEST PRIORITY):
- First determine whether actual human speech is audible in the recording (set "hasIntelligibleSpeech" to true or false).
- If the audio contains ONLY silence, static, dial tones, test tones, music, or unintelligible noise with NO clear spoken words, set "hasIntelligibleSpeech": false, return an empty "segments": [] array, and add a clear warning in "overallReliabilityWarnings".
- NEVER invent, guess, or fabricate dialogue. For any unintelligible phrase inside a real conversation, write "[Unclear audio]".

LANGUAGE & DISPLAY RULES (Supported: ${enabledLanguages || 'Sinhala, English, Tamil'}):
1. SINHALA -> SINGLISH (ROMAN SINHALA):
   - Transcribe spoken Sinhala words phonetically in Romanized Singlish (Roman letters).
   - NEVER output Sinhala Unicode script in "text".
   - NEVER translate Sinhala speech into English; preserve the exact spoken meaning in Singlish.
2. ENGLISH:
   - Transcribe spoken English words verbatim. Preserve Sinhala-English code-switching within the same sentence.
3. TAMIL:
   - Output Tamil speech in Tamil script in "text" and provide Roman Tamil in "romanText".
   - If Tamil speech cannot be reliably recognised, set confidence to "low", explain in "uncertaintyNote", and use "[Unclear audio]".
4. SPEAKER DIARIZATION:
   - Label each turn "Agent" or "Customer" based on conversational role. Do NOT assume the first speaker is always the Agent.
5. TIMESTAMPS:
   - Provide accurate chronological MM:SS timestamps strictly within the recording duration.`;

    const referenceHint = rawDedicatedTranscript
      ? `\n\nReference raw ASR output from dedicated transcription pass (verify directly against the audio; correct any errors, apply Singlish for Sinhala, and add accurate speaker labels + timestamps):\n"""\n${rawDedicatedTranscript.slice(0, 12000)}\n"""`
      : '';

    let audioUnderstandingModelUsed = 'gemini-4-hydrogen';
    const stageBSchema = {
      type: Type.OBJECT,
      properties: {
        hasIntelligibleSpeech: {
          type: Type.BOOLEAN,
          description: 'True ONLY if actual intelligible human speech is audible in the audio; false for tones, silence, or noise.',
        },
        detectedLanguages: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'List of languages detected in the recording.',
        },
        overallReliabilityWarnings: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'Honest warnings if any language or audio portion could not be reliably recognised.',
        },
        segments: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              speaker: {
                type: Type.STRING,
                description: 'Must be "Agent" or "Customer".',
              },
              timestamp: {
                type: Type.STRING,
                description: 'Timestamp in MM:SS format.',
              },
              language: {
                type: Type.STRING,
                description:
                  'One of: "Sinhala (Singlish)", "English", "Tamil", "Mixed (Sinhala/English)", "Mixed (Tamil/English)", "Unclear".',
              },
              text: {
                type: Type.STRING,
                description: 'Transcribed speech. Sinhala MUST be in Singlish (Roman Sinhala), NOT Sinhala Unicode and NOT translated to English.',
              },
              romanText: {
                type: Type.STRING,
                description: 'Romanized Tamil transliteration when language is Tamil or Mixed (Tamil/English); empty string otherwise.',
              },
              confidence: {
                type: Type.STRING,
                description: 'One of: "high", "medium", "low".',
              },
              uncertaintyNote: {
                type: Type.STRING,
                description: 'Short explanation if confidence is medium/low or segment contains [Unclear audio].',
              },
            },
            required: ['speaker', 'timestamp', 'language', 'text', 'confidence'],
          },
        },
      },
      required: ['hasIntelligibleSpeech', 'detectedLanguages', 'segments'],
    };

    const stageBPrompt = `Listen carefully to the entire call recording from start to finish and produce a complete, chronological, speaker-diarized transcript following all Singlish, code-switching, Tamil, and [Unclear audio] rules.${referenceHint}`;

    let stageBResp;
    const tB = Date.now();
    try {
      stageBResp = await withRetry(() =>
        withTimeout(
          ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: { parts: [audioPart, { text: stageBPrompt }] },
            config: {
              systemInstruction,
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              responseMimeType: 'application/json',
              responseSchema: stageBSchema,
            },
          }),
          40000,
          'gemini-4-hydrogen'
        )
      );
      console.log(`[transcribe] stageB=gemini-4-hydrogen ms=${Date.now() - tB}`);
    } catch (err: unknown) {
      if (!isUnavailableError(err)) throw err;
      audioUnderstandingModelUsed = 'gemini-3.1-flash-lite';
      fallbackUsed = true;
      warnings.push('Primary audio-understanding model temporarily busy; processed using gemini-3.1-flash-lite fallback.');
      const tF = Date.now();
      stageBResp = await withRetry(() =>
        withTimeout(
          ai.models.generateContent({
            model: 'gemini-3.1-flash-lite',
            contents: { parts: [audioPart, { text: stageBPrompt }] },
            config: {
              systemInstruction,
              responseMimeType: 'application/json',
              responseSchema: stageBSchema,
            },
          }),
          30000,
          'gemini-3.1-flash-lite'
        )
      );
      console.log(`[transcribe] stageB_fallback=gemini-3.1-flash-lite ms=${Date.now() - tF}`);
    }

    const parsed = JSON.parse((stageBResp.text || '{}').trim());
    const hasSpeech = parsed.hasIntelligibleSpeech !== false;
    const rawSegments = hasSpeech && Array.isArray(parsed.segments) ? parsed.segments : [];
    const modelWarnings = Array.isArray(parsed.overallReliabilityWarnings) ? parsed.overallReliabilityWarnings : [];

    // Post-check: if any segment accidentally contains Sinhala Unicode (U+0D80..U+0DFF), convert it to Roman Sinhala (Singlish)
    const sinhalaUnicodeRegex = /[\u0D80-\u0DFF]/;
    const segmentsWithUnicode = rawSegments
      .map((s: Record<string, unknown>, i: number) => ({ index: i, text: String(s.text || '') }))
      .filter((item: { index: number; text: string }) => sinhalaUnicodeRegex.test(item.text));

    if (segmentsWithUnicode.length > 0) {
      try {
        const convResp = await withTimeout(
          ai.models.generateContent({
            model: 'gemini-3.1-flash-lite',
            contents: `Convert any Sinhala Unicode script in these lines into natural Sri Lankan Singlish (Roman Sinhala). Preserve all English words unchanged and do NOT translate Sinhala into English. Return JSON array of { index, singlishText }.\n${JSON.stringify(segmentsWithUnicode)}`,
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    index: { type: Type.INTEGER },
                    singlishText: { type: Type.STRING },
                  },
                  required: ['index', 'singlishText'],
                },
              },
            },
          }),
          15000,
          'singlish-conversion'
        );
        const converted = JSON.parse((convResp.text || '[]').trim());
        if (Array.isArray(converted)) {
          for (const item of converted) {
            if (typeof item.index === 'number' && rawSegments[item.index] && typeof item.singlishText === 'string') {
              rawSegments[item.index].text = item.singlishText;
            }
          }
        }
      } catch {
        warnings.push('Some Sinhala Unicode characters could not be auto-converted to Singlish; please review manually.');
      }
    }

    const normalizedSegments =
      rawSegments.length === 0
        ? [
            {
              id: `seg-1-${Date.now()}`,
              speaker: 'Customer' as const,
              timestamp: '00:00',
              timestampSeconds: 0,
              language: 'Unclear' as const,
              text: '[Unclear audio — no intelligible speech detected]',
              confidence: 'low' as const,
              uncertaintyNote: 'No intelligible human speech was detected in this recording.',
              isEdited: false,
            },
          ]
        : rawSegments.map((seg: Record<string, unknown>, idx: number) => {
      const speaker = seg.speaker === 'Customer' ? 'Customer' : 'Agent';
      const timestamp = typeof seg.timestamp === 'string' && /^\d{1,2}:\d{2}/.test(seg.timestamp.trim())
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
      const language = validLanguages.includes(String(seg.language))
        ? String(seg.language)
        : 'Unclear';
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
        uncertaintyNote: typeof seg.uncertaintyNote === 'string' && seg.uncertaintyNote.trim() ? seg.uncertaintyNote.trim() : undefined,
        isEdited: false,
      };
    });

    res.json({
      segments: normalizedSegments,
      detectedLanguages: Array.isArray(parsed.detectedLanguages) ? parsed.detectedLanguages : [],
      processingMeta: {
        primaryModelAttempted: 'gemini-3.5-transcribe',
        primarySucceeded,
        audioUnderstandingModel: audioUnderstandingModelUsed,
        fallbackUsed,
        warnings: [...warnings, ...modelWarnings].filter(Boolean),
        rawDedicatedTranscript: rawDedicatedTranscript || undefined,
      },
    });
  } catch (err: unknown) {
    const mapped = mapGeminiError(err);
    res.status(mapped.status).json({ error: mapped.message });
  } finally {
    if (uploadedFileName) {
      try {
        const ai = getAiClient();
        await ai.files.delete({ name: uploadedFileName });
      } catch {
        // Best-effort cleanup of ephemeral file
      }
    }
  }
});

app.post('/api/transliterate-singlish', async (req: Request, res: Response) => {
  try {
    const { text } = req.body || {};
    if (typeof text !== 'string' || !text.trim()) {
      res.status(400).json({ error: 'Text is required for Singlish conversion.' });
      return;
    }
    const ai = getAiClient();
    const prompt = `Convert any Sinhala Unicode script in the following insurance call line into natural Sri Lankan Singlish (Roman Sinhala). Preserve all English words unchanged and do NOT translate Sinhala into English:\n\n${text}`;
    const schema = {
      type: Type.OBJECT,
      properties: {
        singlishText: { type: Type.STRING },
      },
      required: ['singlishText'],
    };
    let resp;
    try {
      resp = await withTimeout(
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: prompt,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: schema,
          },
        }),
        15000,
        'transliterate-singlish'
      );
    } catch (err: unknown) {
      if (!isUnavailableError(err)) throw err;
      resp = await withTimeout(
        ai.models.generateContent({
          model: 'gemini-3.1-flash-lite',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: schema,
          },
        }),
        15000,
        'transliterate-singlish-fallback'
      );
    }
    const parsed = JSON.parse((resp.text || '{}').trim());
    res.json({ singlishText: parsed.singlishText || text });
  } catch (err: unknown) {
    const mapped = mapGeminiError(err);
    res.status(mapped.status).json({ error: mapped.message });
  }
});

app.post('/api/evaluate', async (req: Request, res: Response) => {
  try {
    const {
      transcriptSegments,
      metadata,
      scorecardConfig,
      qaRules,
      thresholds,
      durationSeconds,
    } = req.body || {};

    if (!Array.isArray(transcriptSegments) || transcriptSegments.length === 0) {
      res.status(400).json({ error: 'Cannot evaluate call without transcript segments.' });
      return;
    }

    const ai = getAiClient();

    const activeScorecard: Array<{ id: string; name: string; weight: number; description: string; guideline: string }> =
      Array.isArray(scorecardConfig) && scorecardConfig.length > 0 ? scorecardConfig : [];

    const activeRules: Array<{ id: string; title: string; description: string; enabled: boolean; requiresMccSystemCheck: boolean }> =
      Array.isArray(qaRules) ? qaRules.filter((r) => r.enabled !== false) : [];

    const formattedTranscript = transcriptSegments
      .map(
        (s: {
          timestamp: string;
          speaker: string;
          language: string;
          text: string;
          confidence?: string;
          uncertaintyNote?: string;
        }) =>
          `[${s.timestamp}] ${s.speaker} (${s.language}${s.confidence === 'low' ? ', LOW CONFIDENCE' : ''}): ${s.text}${
            s.uncertaintyNote ? ` [Note: ${s.uncertaintyNote}]` : ''
          }`
      )
      .join('\n');

    const scorecardSpec = activeScorecard
      .map((p) => `- ID: "${p.id}" | Parameter: "${p.name}" | Weight: ${p.weight} | Description: ${p.description} | Guideline: ${p.guideline}`)
      .join('\n');

    const rulesSpec = activeRules
      .map(
        (r) =>
          `- Rule ID: "${r.id}" | Title: "${r.title}" | MCC System Check Required: ${r.requiresMccSystemCheck ? 'YES' : 'NO'} | Criteria: ${r.description}`
      )
      .join('\n');

    const systemInstruction = `You are a senior insurance Contact Centre Quality Assurance Specialist evaluating a First Notice of Loss (FNOL) call in Sri Lanka (calls may be in Singlish/Roman Sinhala, English, or Tamil).

EVALUATION PRINCIPLES (STRICT):
1. Evaluate EVERY CQM parameter independently based ONLY on actual transcript evidence.
2. NEVER invent conversations, customer statements, or Agent actions that are not in the transcript.
3. NEVER award marks based on assumptions. Do not assume information was recorded in the MCC system merely because it was spoken on the call—explicitly flag MCC-system-dependent checks for manual system verification.
4. NOT ASSESSABLE RULE: If a parameter cannot be evaluated from the recording (for example, Holding Procedure if no hold occurred and no hold policy breach applies, OR if the relevant audio segment is [Unclear audio] / low-confidence transcription), mark status as "Not Assessable", set awardedMarks to 0, set needsHumanReview to true, and explain why manual review is required. Do NOT silently award full marks.
5. Do not penalise an Agent for a requirement that is not applicable (e.g., late intimation reason if the accident happened just now; distance moved if the vehicle was not moved).
6. Distinguish clearly between a genuine Agent process failure and a transcription uncertainty.
7. Provide exact MM:SS timestamps and verbatim transcript quotes for evidence, especially for negative findings.
8. Explain clearly why marks were deducted, and provide practical, constructive coaching feedback without repeating the same issue across unrelated parameters.
9. Performance bands: Below 70 = Poor, 70 to <80 = Average, 80 to 90 = Good, Above 90 = Excellent.`;

    const prompt = `Evaluate this FNOL call transcript against the exact CQM Scorecard and FNOL QA Rules below.

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

    const evalSchema = {
      type: Type.OBJECT,
      properties: {
        scorecard: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              parameterId: { type: Type.STRING },
              parameterName: { type: Type.STRING },
              maxMarks: { type: Type.NUMBER },
              awardedMarks: { type: Type.NUMBER },
              status: {
                type: Type.STRING,
                description: 'One of: "Excellent", "Good", "Needs Improvement", "Failed", "Not Assessable".',
              },
              reason: { type: Type.STRING },
              evidence: { type: Type.STRING },
              timestamp: { type: Type.STRING, description: 'MM:SS timestamp or "N/A".' },
              recommendedImprovement: { type: Type.STRING },
              needsHumanReview: { type: Type.BOOLEAN },
              systemVerificationRequired: { type: Type.BOOLEAN },
            },
            required: [
              'parameterId',
              'parameterName',
              'maxMarks',
              'awardedMarks',
              'status',
              'reason',
              'evidence',
              'timestamp',
              'recommendedImprovement',
              'needsHumanReview',
              'systemVerificationRequired',
            ],
          },
        },
        fnolChecks: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              ruleId: { type: Type.STRING },
              ruleTitle: { type: Type.STRING },
              applicable: { type: Type.BOOLEAN },
              result: {
                type: Type.STRING,
                description:
                  'One of: "Passed", "Failed", "Partial", "Not Applicable", "Requires Manual MCC Verification".',
              },
              evidence: { type: Type.STRING },
              timestamp: { type: Type.STRING },
              notes: { type: Type.STRING },
            },
            required: ['ruleId', 'ruleTitle', 'applicable', 'result', 'evidence', 'timestamp', 'notes'],
          },
        },
        criticalFindings: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              category: {
                type: Type.STRING,
                description:
                  'One of: "Process Failure", "Data Protection", "Missed Mandatory Question", "Incorrect Information", "Customer Handling".',
              },
              severity: { type: Type.STRING, description: '"High" or "Medium".' },
              description: { type: Type.STRING },
              timestamp: { type: Type.STRING },
              evidence: { type: Type.STRING },
            },
            required: ['category', 'severity', 'description', 'timestamp', 'evidence'],
          },
        },
        coachingFeedback: {
          type: Type.OBJECT,
          properties: {
            strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
            areasForImprovement: { type: Type.ARRAY, items: { type: Type.STRING } },
            recommendedActions: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ['strengths', 'areasForImprovement', 'recommendedActions'],
        },
      },
      required: ['scorecard', 'fnolChecks', 'criticalFindings', 'coachingFeedback'],
    };

    let evalResp;
    try {
      evalResp = await withRetry(() =>
        withTimeout(
          ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: prompt,
            config: {
              systemInstruction,
              thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
              responseMimeType: 'application/json',
              responseSchema: evalSchema,
            },
          }),
          30000,
          'gemini-4-hydrogen-eval'
        )
      );
    } catch (err: unknown) {
      if (!isUnavailableError(err)) throw err;
      evalResp = await withRetry(() =>
        withTimeout(
          ai.models.generateContent({
            model: 'gemini-3.1-flash-lite',
            contents: prompt,
            config: {
              systemInstruction,
              responseMimeType: 'application/json',
              responseSchema: evalSchema,
            },
          }),
          25000,
          'gemini-3.1-flash-lite-eval'
        )
      );
    }

    const parsed = JSON.parse((evalResp.text || '{}').trim());
    const aiScorecardRaw: Array<Record<string, unknown>> = Array.isArray(parsed.scorecard) ? parsed.scorecard : [];

    // Deterministic server-side scorecard reconciliation against configured weights
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

    const aiOverallScore = Math.round(
      normalizedScorecard.reduce((sum, item) => sum + item.awardedMarks, 0) * 10
    ) / 10;

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
    const rawChecks: Array<Record<string, unknown>> = Array.isArray(parsed.fnolChecks) ? parsed.fnolChecks : [];
    const normalizedChecks = activeRules.map((rule) => {
      const found = rawChecks.find((c) => c.ruleId === rule.id);
      const resVal = found && validRuleResults.includes(String(found.result))
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

    const rawFindings: Array<Record<string, unknown>> = Array.isArray(parsed.criticalFindings) ? parsed.criticalFindings : [];
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
      strengths: Array.isArray(parsed.coachingFeedback?.strengths) ? parsed.coachingFeedback.strengths : [],
      areasForImprovement: Array.isArray(parsed.coachingFeedback?.areasForImprovement)
        ? parsed.coachingFeedback.areasForImprovement
        : [],
      recommendedActions: Array.isArray(parsed.coachingFeedback?.recommendedActions)
        ? parsed.coachingFeedback.recommendedActions
        : [],
    };

    const requiresManualReview = normalizedScorecard.some((p) => p.needsHumanReview || p.systemVerificationRequired);

    res.json({
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
    const mapped = mapGeminiError(err);
    res.status(mapped.status).json({ error: mapped.message });
  }
});

// Express error handler (including multer validation/size errors)
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: 'Audio file exceeds the 50 MB upload limit.' });
      return;
    }
    res.status(400).json({ error: `Upload error: ${err.message}` });
    return;
  }
  const message = err instanceof Error ? err.message : 'Unexpected server error.';
  res.status(400).json({ error: message });
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AI FNOL CQM Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
