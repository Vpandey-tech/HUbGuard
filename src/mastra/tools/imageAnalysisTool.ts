import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env") });

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export const imageAnalysisTool = createTool({
  id: "image-analysis",
  description:
    "Analyzes images from Telegram messages using Gemini Vision AI to extract text and identify potential fake circulars or notices. Returns extracted text for verification.",

  inputSchema: z.object({
    fileId: z.string().describe("Telegram file_id of the image to analyze"),
    caption: z.string().optional().describe("Caption accompanying the image"),
  }),

  outputSchema: z.object({
    success: z.boolean(),
    extractedText: z.string(),
    imageDescription: z.string(),
    containsOfficial: z.boolean(),
    confidence: z.number(),
    error: z.string().optional(),
  }),

  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("📸 [Image Analysis] Starting Gemini vision analysis", {
      fileId: context.fileId,
      hasCaption: !!context.caption,
    });

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const googleApiKey = process.env.GOOGLE_API_KEY;

    if (!botToken) {
      logger?.error("❌ [Image Analysis] TELEGRAM_BOT_TOKEN not configured");
      return {
        success: false,
        extractedText: "",
        imageDescription: "",
        containsOfficial: false,
        confidence: 0,
        error: "Telegram bot token not configured",
      };
    }

    if (!googleApiKey) {
      logger?.error("❌ [Image Analysis] GOOGLE_API_KEY not configured");
      return {
        success: false,
        extractedText: "",
        imageDescription: "",
        containsOfficial: false,
        confidence: 0,
        error: "Google API key not configured",
      };
    }

    try {
      const fileInfoUrl = `https://api.telegram.org/bot${botToken}/getFile?file_id=${context.fileId}`;
      logger?.info("📸 [Image Analysis] Fetching file info from Telegram");

      const fileInfoResponse = await fetch(fileInfoUrl);
      const fileInfo = await fileInfoResponse.json();

      if (!fileInfo.ok || !fileInfo.result?.file_path) {
        logger?.error("❌ [Image Analysis] Failed to get file info", { fileInfo });
        return {
          success: false,
          extractedText: "",
          imageDescription: "",
          containsOfficial: false,
          confidence: 0,
          error: "Failed to get file info from Telegram",
        };
      }

      const filePath = fileInfo.result.file_path;
      const fileUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;

      logger?.info("📸 [Image Analysis] Downloading image from Telegram");

      const imageResponse = await fetch(fileUrl);
      if (!imageResponse.ok) {
        logger?.error("❌ [Image Analysis] Failed to download image");
        return {
          success: false,
          extractedText: "",
          imageDescription: "",
          containsOfficial: false,
          confidence: 0,
          error: "Failed to download image from Telegram",
        };
      }

      const imageBuffer = await imageResponse.arrayBuffer();
      const base64Image = Buffer.from(imageBuffer).toString("base64");

      let contentType = imageResponse.headers.get("content-type") || "image/jpeg";

      // Fix for Telegram returning application/octet-stream
      if (contentType === "application/octet-stream") {
        const ext = filePath.split('.').pop()?.toLowerCase();
        if (ext === "png") contentType = "image/png";
        else if (ext === "jpg" || ext === "jpeg") contentType = "image/jpeg";
        else if (ext === "webp") contentType = "image/webp";
        else contentType = "image/jpeg"; // Default fallback
      }

      logger?.info("📸 [Image Analysis] Sending to Gemini Vision API", {
        imageSize: imageBuffer.byteLength,
        contentType,
      });

      const prompt = `Analyze this image carefully. This may be a screenshot of a university notice, circular, or official document.

Your task:
1. Extract ALL text visible in the image (OCR)
2. Describe what type of document or image this is
3. Identify if it appears to be an official university document (look for letterheads, stamps, signatures, official formatting)
4. Note any signs that might indicate the document is fake or manipulated

${context.caption ? `The user provided this caption: "${context.caption}"` : ""}

Respond in this exact format:
EXTRACTED_TEXT: [All text you can read from the image]
DOCUMENT_TYPE: [What kind of document/image is this]
APPEARS_OFFICIAL: [YES/NO/UNCERTAIN]
CONFIDENCE: [0.0 to 1.0]
OBSERVATIONS: [Any notable observations about authenticity]`;

      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${googleApiKey}`;

      const geminiPayload = {
        contents: [
          {
            parts: [
              {
                inline_data: {
                  mime_type: contentType,
                  data: base64Image,
                },
              },
              {
                text: prompt,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 2048,
        },
      };

      const geminiResponse = await fetch(geminiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(geminiPayload),
      });

      if (!geminiResponse.ok) {
        const errorText = await geminiResponse.text();
        logger?.error("❌ [Image Analysis] Gemini API error", { status: geminiResponse.status, error: errorText });
        return {
          success: false,
          extractedText: "",
          imageDescription: "",
          containsOfficial: false,
          confidence: 0,
          error: `Gemini API error: ${geminiResponse.status}`,
        };
      }

      const geminiResult = await geminiResponse.json();
      const responseText = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text || "";

      logger?.info("📸 [Image Analysis] Gemini response received", {
        responseLength: responseText.length,
      });

      const extractedTextMatch = responseText.match(/EXTRACTED_TEXT:\s*([\s\S]*?)(?=DOCUMENT_TYPE:|$)/i);
      const documentTypeMatch = responseText.match(/DOCUMENT_TYPE:\s*([\s\S]*?)(?=APPEARS_OFFICIAL:|$)/i);
      const appearsOfficialMatch = responseText.match(/APPEARS_OFFICIAL:\s*(YES|NO|UNCERTAIN)/i);
      const confidenceMatch = responseText.match(/CONFIDENCE:\s*([\d.]+)/i);
      const observationsMatch = responseText.match(/OBSERVATIONS:\s*([\s\S]*?)$/i);

      const extractedText = extractedTextMatch?.[1]?.trim() || responseText;
      const documentType = documentTypeMatch?.[1]?.trim() || "Unknown document type";
      const appearsOfficial = appearsOfficialMatch?.[1]?.toUpperCase() === "YES";
      const confidence = parseFloat(confidenceMatch?.[1] || "0.5");
      const observations = observationsMatch?.[1]?.trim() || "";

      const imageDescription = `${documentType}. ${observations}`;

      logger?.info("✅ [Image Analysis] Analysis complete", {
        extractedTextLength: extractedText.length,
        appearsOfficial,
        confidence,
      });

      return {
        success: true,
        extractedText,
        imageDescription,
        containsOfficial: appearsOfficial,
        confidence: Math.min(Math.max(confidence, 0), 1),
      };

    } catch (error) {
      logger?.error("❌ [Image Analysis] Error analyzing image", { error });
      return {
        success: false,
        extractedText: "",
        imageDescription: "",
        containsOfficial: false,
        confidence: 0,
        error: `Failed to analyze image: ${error}`,
      };
    }
  },
});
