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

export const gatekeeperTool = createTool({
  id: "gatekeeper-filter",
  description:
    "Pre-filters incoming messages to determine if they need verification. Activates for messages with panic keywords, images, or potential misinformation.",

  inputSchema: z.object({
    message: z.string().describe("The text message to analyze"),
    caption: z.string().optional().describe("Caption from image/document if any"),
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

    // 4. Check for PANIC KEYWORDS (university-related misinformation triggers)
    const detectedKeywords = PANIC_KEYWORDS.filter((keyword) =>
      textToAnalyze.includes(keyword.toLowerCase())
    );

    if (detectedKeywords.length > 0) {
      logger?.info("⚠️ [Gatekeeper] Panic keywords detected - HIGH priority activation", {
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
