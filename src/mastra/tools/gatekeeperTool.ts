import { createTool } from "@mastra/core/tools";
import { z } from "zod";

const CASUAL_WORDS = [
  "hi",
  "hello",
  "hey",
  "thanks",
  "thank",
  "ok",
  "okay",
  "bot",
  "bye",
  "good",
  "nice",
  "cool",
  "yes",
  "no",
  "maybe",
  "sure",
  "great",
  "awesome",
  "lol",
  "haha",
  "hmm",
  "oh",
  "ah",
  "wow",
];

const PANIC_KEYWORDS = [
  "postponed",
  "postpone",
  "exam",
  "exams",
  "syllabus",
  "leaked",
  "leak",
  "cancel",
  "cancelled",
  "canceled",
  "holiday",
  "holidays",
  "notice",
  "timetable",
  "schedule",
  "fake",
  "true?",
  "is it true",
  "confirm",
  "rumor",
  "rumour",
  "official",
  "circular",
  "announcement",
  "deadline",
  "extended",
  "extension",
  "results",
  "result",
  "marks",
  "grade",
  "grades",
  "revaluation",
  "supplementary",
  "backlog",
  "attendance",
  "semester",
  "fee",
  "fees",
  "admission",
  "placement",
  "internship",
  "hostel",
  "mess",
  "library",
  "lab",
  "practical",
  "viva",
  "project",
  "thesis",
  "dissertation",
  "convocation",
  "degree",
  "certificate",
  "transcript",
  "migration",
  "transfer",
  "re-exam",
  "reexam",
  "compartment",
  "detained",
  "suspended",
  "expelled",
  "rusticated",
];

// Levenshtein distance for fuzzy matching (spelling mistakes)
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

// Fuzzy keyword matching with spelling tolerance
function fuzzyMatchKeyword(word: string, keyword: string, maxDistance: number = 2): boolean {
  // Exact match
  if (word === keyword) return true;

  // Contains match
  if (word.includes(keyword) || keyword.includes(word)) return true;

  // Fuzzy match for spelling mistakes
  if (word.length >= 4 && keyword.length >= 4) {
    const distance = levenshteinDistance(word, keyword);
    const threshold = Math.min(maxDistance, Math.floor(keyword.length * 0.3));
    return distance <= threshold;
  }

  return false;
}

export const gatekeeperTool = createTool({
  id: "gatekeeper-filter",
  description:
    "Pre-filters incoming messages to determine if they need verification. Activates for messages with panic keywords (including spelling mistakes), images, or potential misinformation.",

  inputSchema: z.object({
    message: z.string().describe("The text message to analyze"),
    caption: z.string().optional().default("").describe("Caption from image/document if any"),
    hasPhoto: z.boolean().describe("Whether the message contains a photo"),
    hasDocument: z.boolean().describe("Whether the message contains a document"),
    isForwarded: z.boolean().describe("Whether the message is forwarded"),
  }),

  outputSchema: z.object({
    shouldProcess: z.boolean().describe("Whether the message should be processed by the AI"),
    reason: z.string().describe("Reason for the decision"),
    detectedKeywords: z.array(z.string()).describe("Panic keywords found in the message"),
    priority: z.enum(["high", "medium", "low", "skip"]).describe("Priority level for processing"),
  }),

  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔍 [Gatekeeper] Starting filter check", {
      messageLength: context.message?.length,
      hasPhoto: context.hasPhoto,
      hasDocument: context.hasDocument,
      isForwarded: context.isForwarded,
    });

    const textToAnalyze = `${context.message || ""} ${context.caption || ""}`.toLowerCase().trim();
    const words = textToAnalyze.split(/\s+/).filter((w) => w.length > 0);
    const wordCount = words.length;

    logger?.info("🔍 [Gatekeeper] Text analysis", { textToAnalyze, wordCount });

    // STRICT FILTERING - Only process suspicious/malicious content

    // 1. Check for media (Always process - could be fake documents)
    if (context.hasPhoto || context.hasDocument) {
      logger?.info("📷 [Gatekeeper] Media detected - HIGH priority activation");
      return {
        shouldProcess: true,
        reason: "Message contains media (potential fake document)",
        detectedKeywords: [],
        priority: "high" as const,
      };
    }

    // 2. Check for forwarded messages (Higher chance of rumors)
    if (context.isForwarded) {
      logger?.info("📤 [Gatekeeper] Forwarded message - MEDIUM priority activation");
      return {
        shouldProcess: true,
        reason: "Forwarded message (potential rumor)",
        detectedKeywords: [],
        priority: "medium" as const,
      };
    }

    // 3. Check for very short casual greetings (Skip these)
    if (wordCount <= 3) {
      const isCasual = words.every((word) =>
        CASUAL_WORDS.some((casual) => word.includes(casual))
      );
      if (isCasual) {
        logger?.info("⏭️ [Gatekeeper] Casual greeting - SKIP");
        return {
          shouldProcess: false,
          reason: "Casual greeting/chat",
          detectedKeywords: [],
          priority: "skip" as const,
        };
      }
    }

    // 4. ENHANCED: Check for PANIC KEYWORDS with fuzzy matching (catches spelling mistakes)
    const detectedKeywords: string[] = [];

    for (const word of words) {
      for (const keyword of PANIC_KEYWORDS) {
        if (fuzzyMatchKeyword(word, keyword.toLowerCase())) {
          if (!detectedKeywords.includes(keyword)) {
            detectedKeywords.push(keyword);
          }
        }
      }
    }

    if (detectedKeywords.length > 0) {
      logger?.info("⚠️ [Gatekeeper] Panic keywords detected (fuzzy match) - HIGH priority activation", {
        keywords: detectedKeywords
      });
      return {
        shouldProcess: true,
        reason: `Contains suspicious keywords: ${detectedKeywords.join(", ")}`,
        detectedKeywords,
        priority: "high" as const,
      };
    }

    // 5. Skip regular neutral conversations
    logger?.info("⏭️ [Gatekeeper] Regular conversation - SKIP");
    return {
      shouldProcess: false,
      reason: "Regular neutral message (no suspicious content)",
      detectedKeywords: [],
      priority: "skip" as const,
    };
  },
});
