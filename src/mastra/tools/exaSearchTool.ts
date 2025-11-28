import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env") });

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import Exa from "exa-js";

export const exaSearchTool = createTool({
  id: "exa-web-search",
  description:
    "Searches the web using Exa AI (similar to Perplexity) to find real-time information from authentic sources like official university websites, news sites, and government portals. Use this when local data folder doesn't have relevant information.",

  inputSchema: z.object({
    query: z.string().describe("The search query to find information about"),
    numResults: z.number().optional().default(5).describe("Number of results to return"),
    includeDomains: z
      .array(z.string())
      .optional()
      .describe("Specific domains to search (e.g., mu.ac.in, ugc.ac.in)"),
  }),

  outputSchema: z.object({
    results: z.array(
      z.object({
        title: z.string(),
        url: z.string(),
        content: z.string(),
        publishedDate: z.string().optional(),
        score: z.number().optional(),
      })
    ),
    hasResults: z.boolean(),
    searchQuery: z.string(),
  }),

  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🌐 [Exa Search] Starting web search", {
      query: context.query,
      numResults: context.numResults,
      includeDomains: context.includeDomains,
    });

    const apiKey = process.env.EXA_API_KEY;
    if (!apiKey) {
      logger?.warn("⚠️ [Exa Search] EXA_API_KEY not configured, falling back to basic search");
      return {
        results: [],
        hasResults: false,
        searchQuery: context.query,
      };
    }

    try {
      const exa = new Exa(apiKey);

      const searchOptions: any = {
        numResults: context.numResults || 5,
        type: "neural",
        useAutoprompt: true,
        text: true,
      };

      if (context.includeDomains && context.includeDomains.length > 0) {
        searchOptions.includeDomains = context.includeDomains;
      }

      logger?.info("🔍 [Exa Search] Executing search...", { searchOptions });

      const response = await exa.searchAndContents(context.query, searchOptions);

      const results = response.results.map((result: any) => ({
        title: result.title || "No title",
        url: result.url || "",
        content: result.text?.substring(0, 1500) || "No content available",
        publishedDate: result.publishedDate || undefined,
        score: result.score || 0,
      }));

      logger?.info("✅ [Exa Search] Search complete", {
        resultCount: results.length,
        topResult: results[0]?.title,
      });

      return {
        results,
        hasResults: results.length > 0,
        searchQuery: context.query,
      };
    } catch (error: any) {
      logger?.error("❌ [Exa Search] Search failed", { error: error.message });
      return {
        results: [],
        hasResults: false,
        searchQuery: context.query,
      };
    }
  },
});

export const universitySearchTool = createTool({
  id: "university-web-search",
  description:
    "Specialized search for official Indian university announcements. Searches Mumbai University, UGC, and other educational authority websites for verified information about exams, results, circulars, and notices.",

  inputSchema: z.object({
    query: z.string().describe("The claim or topic to verify"),
    university: z
      .enum(["mumbai", "general", "ugc"])
      .optional()
      .default("general")
      .describe("Which university/authority to prioritize"),
  }),

  outputSchema: z.object({
    results: z.array(
      z.object({
        title: z.string(),
        url: z.string(),
        content: z.string(),
        source: z.string(),
        isOfficial: z.boolean(),
      })
    ),
    hasOfficialInfo: z.boolean(),
    sourcesChecked: z.array(z.string()),
  }),

  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🎓 [University Search] Starting official source search", {
      query: context.query,
      university: context.university,
    });

    const apiKey = process.env.EXA_API_KEY;
    if (!apiKey) {
      logger?.warn("⚠️ [University Search] EXA_API_KEY not configured");
      return {
        results: [],
        hasOfficialInfo: false,
        sourcesChecked: [],
      };
    }

    const officialDomains: Record<string, string[]> = {
      mumbai: [
        "mu.ac.in",
        "mum.digitaluniversity.ac",
        "mkuniversity.ac.in",
      ],
      ugc: [
        "ugc.ac.in",
        "education.gov.in",
        "aicte-india.org",
      ],
      general: [
        "mu.ac.in",
        "ugc.ac.in",
        "education.gov.in",
        "aicte-india.org",
        "mum.digitaluniversity.ac",
      ],
    };

    const domains = officialDomains[context.university || "general"];

    try {
      const exa = new Exa(apiKey);

      const enhancedQuery = `${context.query} official notice announcement circular`;

      logger?.info("🔍 [University Search] Searching official domains", { domains });

      const response = await exa.searchAndContents(enhancedQuery, {
        numResults: 8,
        type: "neural",
        useAutoprompt: true,
        text: true,
        includeDomains: domains,
      });

      const results = response.results.map((result: any) => {
        const url = result.url || "";
        const domain = new URL(url).hostname;
        const isOfficial = domains.some((d) => domain.includes(d));

        return {
          title: result.title || "No title",
          url,
          content: result.text?.substring(0, 1200) || "No content",
          source: domain,
          isOfficial,
        };
      });

      const hasOfficialInfo = results.some((r) => r.isOfficial && r.content.length > 100);

      logger?.info("✅ [University Search] Search complete", {
        resultCount: results.length,
        hasOfficialInfo,
        officialSources: results.filter((r) => r.isOfficial).length,
      });

      return {
        results,
        hasOfficialInfo,
        sourcesChecked: domains,
      };
    } catch (error: any) {
      logger?.error("❌ [University Search] Search failed", { error: error.message });
      return {
        results: [],
        hasOfficialInfo: false,
        sourcesChecked: domains,
      };
    }
  },
});
