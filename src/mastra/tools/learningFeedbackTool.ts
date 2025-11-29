import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";

interface VerificationLog {
    timestamp: string;
    claim: string;
    verdict: "HOAX" | "VERIFIED" | "UNCERTAIN";
    sources: string[];
    confidence: number;
    wasCorrect?: boolean;
    feedback?: string;
}

const LEARNING_LOG_PATH = path.join(process.cwd(), "data", "learning_log.json");

function loadLearningLog(): VerificationLog[] {
    try {
        if (fs.existsSync(LEARNING_LOG_PATH)) {
            const data = fs.readFileSync(LEARNING_LOG_PATH, "utf-8");
            return JSON.parse(data);
        }
    } catch (error) {
        console.error("Error loading learning log:", error);
    }
    return [];
}

function saveLearningLog(logs: VerificationLog[]): void {
    try {
        const dir = path.dirname(LEARNING_LOG_PATH);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(LEARNING_LOG_PATH, JSON.stringify(logs, null, 2));
    } catch (error) {
        console.error("Error saving learning log:", error);
    }
}

export const logVerificationTool = createTool({
    id: "log-verification",
    description: "Logs verification decisions for self-learning and improvement tracking",

    inputSchema: z.object({
        claim: z.string().describe("The claim that was verified"),
        verdict: z.enum(["HOAX", "VERIFIED", "UNCERTAIN"]).describe("The verdict given"),
        sources: z.array(z.string()).describe("Sources consulted"),
        confidence: z.number().min(0).max(100).describe("Confidence level 0-100"),
    }),

    outputSchema: z.object({
        logged: z.boolean(),
        similarPastCases: z.array(z.object({
            claim: z.string(),
            verdict: z.string(),
            wasCorrect: z.boolean().optional(),
        })),
    }),

    execute: async ({ context }) => {
        const logs = loadLearningLog();

        const newLog: VerificationLog = {
            timestamp: new Date().toISOString(),
            claim: context.claim,
            verdict: context.verdict,
            sources: context.sources,
            confidence: context.confidence,
        };

        logs.push(newLog);
        saveLearningLog(logs);

        // Find similar past cases for learning
        const similarCases = logs
            .filter(log => {
                const similarity = calculateSimilarity(context.claim.toLowerCase(), log.claim.toLowerCase());
                return similarity > 0.5 && log.timestamp !== newLog.timestamp;
            })
            .slice(-5)
            .map(log => ({
                claim: log.claim,
                verdict: log.verdict,
                wasCorrect: log.wasCorrect,
            }));

        return {
            logged: true,
            similarPastCases: similarCases,
        };
    },
});

export const getLearningInsightsTool = createTool({
    id: "get-learning-insights",
    description: "Retrieves past verification patterns to improve current decision",

    inputSchema: z.object({
        claim: z.string().describe("The current claim to check against past cases"),
    }),

    outputSchema: z.object({
        totalVerifications: z.number(),
        hoaxPatterns: z.array(z.string()),
        verifiedPatterns: z.array(z.string()),
        recommendation: z.string(),
    }),

    execute: async ({ context }) => {
        const logs = loadLearningLog();

        const hoaxClaims = logs.filter(log => log.verdict === "HOAX").map(log => log.claim);
        const verifiedClaims = logs.filter(log => log.verdict === "VERIFIED").map(log => log.claim);

        // Extract common patterns
        const hoaxPatterns = extractPatterns(hoaxClaims);
        const verifiedPatterns = extractPatterns(verifiedClaims);

        // Check if current claim matches known hoax patterns
        const claimLower = context.claim.toLowerCase();
        const matchesHoaxPattern = hoaxPatterns.some(pattern =>
            claimLower.includes(pattern.toLowerCase())
        );

        let recommendation = "Proceed with standard verification";
        if (matchesHoaxPattern) {
            recommendation = "⚠️ This claim matches known HOAX patterns. Be extra vigilant and verify thoroughly.";
        }

        return {
            totalVerifications: logs.length,
            hoaxPatterns: hoaxPatterns.slice(0, 10),
            verifiedPatterns: verifiedPatterns.slice(0, 10),
            recommendation,
        };
    },
});

function calculateSimilarity(str1: string, str2: string): number {
    const words1 = new Set(str1.split(/\s+/));
    const words2 = new Set(str2.split(/\s+/));

    let common = 0;
    for (const word of words1) {
        if (words2.has(word)) common++;
    }

    return common / Math.max(words1.size, words2.size);
}

function extractPatterns(claims: string[]): string[] {
    const wordFrequency: Map<string, number> = new Map();

    claims.forEach(claim => {
        const words = claim.toLowerCase().split(/\s+/);
        words.forEach(word => {
            if (word.length > 3) {
                wordFrequency.set(word, (wordFrequency.get(word) || 0) + 1);
            }
        });
    });

    return Array.from(wordFrequency.entries())
        .filter(([_, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1])
        .map(([word]) => word);
}
