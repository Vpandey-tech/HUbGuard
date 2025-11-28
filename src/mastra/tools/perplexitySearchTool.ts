import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export const perplexitySearchTool = createTool({
  id: "perplexitySearchTool",
  description: "Performs a deep reasoning search using Perplexity AI to verify claims with high accuracy. Use this as a final fallback when other methods fail or for complex queries requiring real-time synthesis.",
  inputSchema: z.object({
    query: z.string().describe("The search query to verify."),
  }),
  outputSchema: z.object({
    content: z.string(),
    citations: z.array(z.string()),
  }),
  execute: async ({ context }) => {
    const apiKey = process.env.PERPLEXITY_API_KEY;

    // Graceful fallback if API key is missing
    if (!apiKey) {
      console.warn("⚠️ PERPLEXITY_API_KEY is missing. Skipping high-precision verification.");
      return {
        content: "⚠️ Perplexity verification skipped (API Key missing). Falling back to standard web search results.",
        citations: [],
      };
    }

    try {
      const response = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "sonar-pro",
          messages: [
            {
              role: "system",
              content: "You are a high-accuracy fact-checking assistant. Your goal is to verify the user's query with >96% accuracy. You must cite valid sources. If you cannot verify the information with high confidence, state that you are unable to verify. Be concise and factual."
            },
            {
              role: "user",
              content: context.query
            }
          ],
          temperature: 0.1
        }),
      });

      if (!response.ok) {
        // Handle API errors gracefully
        const errorText = await response.text();
        console.error(`Perplexity API error: ${response.status} - ${errorText}`);
        return {
          content: `⚠️ Perplexity API Error: ${response.statusText}. Using available data only.`,
          citations: [],
        };
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content || "No response content";
      const citations = data.citations || [];

      return {
        content,
        citations,
      };
    } catch (error) {
      console.error("Perplexity execution failed:", error);
      return {
        content: "⚠️ Perplexity verification failed due to network/system error.",
        citations: [],
      };
    }
  },
});
