import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";

interface DocumentChunk {
  content: string;
  source: string;
  chunkIndex: number;
}

let documentChunks: DocumentChunk[] = [];
let isInitialized = false;

function chunkText(text: string, chunkSize: number = 500, overlap: number = 100): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    let chunkEnd = end;
    
    if (end < text.length) {
      const lastPeriod = text.lastIndexOf(".", end);
      const lastNewline = text.lastIndexOf("\n", end);
      const breakPoint = Math.max(lastPeriod, lastNewline);
      if (breakPoint > start + chunkSize / 2) {
        chunkEnd = breakPoint + 1;
      }
    }

    chunks.push(text.slice(start, chunkEnd).trim());
    start = chunkEnd - overlap;
  }

  return chunks.filter((chunk) => chunk.length > 50);
}

function simpleTokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2);
}

function calculateSimilarity(query: string, document: string): number {
  const queryTokens = new Set(simpleTokenize(query));
  const docTokens = simpleTokenize(document);
  const docTokenSet = new Set(docTokens);

  let matchCount = 0;
  for (const token of queryTokens) {
    if (docTokenSet.has(token)) {
      matchCount++;
    }
    for (const docToken of docTokenSet) {
      if (docToken.includes(token) || token.includes(docToken)) {
        matchCount += 0.5;
      }
    }
  }

  const score = matchCount / Math.max(queryTokens.size, 1);
  return score;
}

async function loadPDFsFromDirectory(dataDir: string, logger?: any): Promise<DocumentChunk[]> {
  const chunks: DocumentChunk[] = [];

  if (!fs.existsSync(dataDir)) {
    logger?.warn(`📁 [RAG] Data directory not found: ${dataDir}`);
    fs.mkdirSync(dataDir, { recursive: true });
    logger?.info(`📁 [RAG] Created data directory: ${dataDir}`);
    return chunks;
  }

  const files = fs.readdirSync(dataDir);
  const pdfFiles = files.filter((file) => file.toLowerCase().endsWith(".pdf"));
  const txtFiles = files.filter((file) => file.toLowerCase().endsWith(".txt"));

  logger?.info(`📚 [RAG] Found ${pdfFiles.length} PDF files and ${txtFiles.length} TXT files`);

  for (const file of txtFiles) {
    try {
      const filePath = path.join(dataDir, file);
      const content = fs.readFileSync(filePath, "utf-8");
      const textChunks = chunkText(content);

      textChunks.forEach((chunk, index) => {
        chunks.push({
          content: chunk,
          source: file,
          chunkIndex: index,
        });
      });

      logger?.info(`✅ [RAG] Loaded ${textChunks.length} chunks from ${file}`);
    } catch (error) {
      logger?.error(`❌ [RAG] Error loading ${file}:`, { error });
    }
  }

  for (const file of pdfFiles) {
    try {
      const filePath = path.join(dataDir, file);
      
      logger?.info(`📄 [RAG] PDF file found: ${file}. Note: For full PDF parsing, add text extracts to data/*.txt files.`);
      
      chunks.push({
        content: `[PDF Document: ${file}] - This is a placeholder. For better results, extract text content to a .txt file.`,
        source: file,
        chunkIndex: 0,
      });
    } catch (error) {
      logger?.error(`❌ [RAG] Error processing ${file}:`, { error });
    }
  }

  return chunks;
}

export const ragSearchTool = createTool({
  id: "rag-search",
  description:
    "Searches the official university document database (PDFs and text files in data/ folder) to find relevant facts for verification.",

  inputSchema: z.object({
    query: z.string().describe("The search query to find relevant official documents"),
    topK: z.number().optional().default(3).describe("Number of top results to return"),
  }),

  outputSchema: z.object({
    results: z.array(
      z.object({
        content: z.string(),
        source: z.string(),
        relevanceScore: z.number(),
      })
    ),
    totalDocuments: z.number(),
    hasRelevantResults: z.boolean(),
  }),

  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔍 [RAG Search] Starting search", { query: context.query, topK: context.topK });

    const dataDir = path.join(process.cwd(), "data");

    if (!isInitialized || documentChunks.length === 0) {
      logger?.info("📚 [RAG Search] Initializing document index...");
      documentChunks = await loadPDFsFromDirectory(dataDir, logger);
      isInitialized = true;
      logger?.info(`📚 [RAG Search] Loaded ${documentChunks.length} total chunks`);
    }

    if (documentChunks.length === 0) {
      logger?.warn("⚠️ [RAG Search] No documents loaded. Add PDF or TXT files to the data/ folder.");
      return {
        results: [],
        totalDocuments: 0,
        hasRelevantResults: false,
      };
    }

    const scoredChunks = documentChunks.map((chunk) => ({
      ...chunk,
      relevanceScore: calculateSimilarity(context.query, chunk.content),
    }));

    scoredChunks.sort((a, b) => b.relevanceScore - a.relevanceScore);

    const topK = context.topK || 3;
    const topResults = scoredChunks.slice(0, topK);
    const hasRelevantResults = topResults.some((r) => r.relevanceScore > 0.1);

    logger?.info("✅ [RAG Search] Search complete", {
      totalChunks: documentChunks.length,
      topResultScore: topResults[0]?.relevanceScore,
      hasRelevantResults,
    });

    return {
      results: topResults.map((r) => ({
        content: r.content,
        source: r.source,
        relevanceScore: Math.round(r.relevanceScore * 100) / 100,
      })),
      totalDocuments: documentChunks.length,
      hasRelevantResults,
    };
  },
});

export const reloadDocumentsTool = createTool({
  id: "reload-documents",
  description: "Reloads the document index from the data/ folder. Use when new documents are added.",

  inputSchema: z.object({}),

  outputSchema: z.object({
    success: z.boolean(),
    documentCount: z.number(),
    message: z.string(),
  }),

  execute: async ({ mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔄 [RAG] Reloading document index...");

    const dataDir = path.join(process.cwd(), "data");
    documentChunks = await loadPDFsFromDirectory(dataDir, logger);
    isInitialized = true;

    logger?.info(`✅ [RAG] Reloaded ${documentChunks.length} chunks`);

    return {
      success: true,
      documentCount: documentChunks.length,
      message: `Successfully loaded ${documentChunks.length} document chunks from data/ folder`,
    };
  },
});
