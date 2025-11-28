import { createStep, createWorkflow } from "../inngest";
import { z } from "zod";
import { truthSentinelAgent } from "../agents/truthSentinelAgent";


export const verifyMessageLogic = async ({ inputData, mastra }: { inputData: any, mastra?: any }) => {
  const logger = mastra?.getLogger();
  logger?.info("🚀 [Truth Sentinel] Starting verification workflow", {
    chatId: inputData.chatId,
    messageId: inputData.messageId,
    userName: inputData.userName,
    hasPhoto: inputData.hasPhoto,
    hasDocument: inputData.hasDocument,
  });

  const textContent = inputData.message || inputData.caption || "";

  if (!textContent && !inputData.hasPhoto && !inputData.hasDocument) {
    logger?.info("⏭️ [Truth Sentinel] Empty message, skipping");
    return {
      processed: false,
      skipped: true,
      skipReason: "Empty message with no media",
    };
  }

  let prompt = `Analyze this Telegram message and verify it against official university documents.

MESSAGE DETAILS:
- From: ${inputData.firstName} (@${inputData.userName})
- Chat ID: ${inputData.chatId}
- Message ID: ${inputData.messageId}
- Text: "${textContent}"
${inputData.isForwarded ? "- This is a FORWARDED message (higher chance of being a rumor)" : ""}
${inputData.replyToMessage ? `- Reply to: "${inputData.replyToMessage}"` : ""}
`;

  if (inputData.hasPhoto && inputData.photoFileId) {
    prompt += `
- Contains a PHOTO (file_id: ${inputData.photoFileId})
- This could be a screenshot of a fake circular/notice. Analyze it carefully.
`;
  }

  if (inputData.hasDocument && inputData.documentFileId) {
    prompt += `
- Contains a DOCUMENT (file_id: ${inputData.documentFileId})
- This could be a fake official document. Verify its contents.
`;
  }

  prompt += `
INSTRUCTIONS:
1. First use the gatekeeper-filter tool to check if this message needs verification
2. If it has media, use image-analysis tool to extract text from photos
3. Use rag-search tool to find relevant official facts
4. Based on your findings, provide your verification result as text
5. If the gatekeeper says to skip, return empty text
6. DO NOT use the telegram-response tool - just return your verification text

IMPORTANT: Return ONLY your concise 1-2 line verification result. Do NOT call telegram-response tool.`;

  logger?.info("🤖 [Truth Sentinel] Sending to agent", { promptLength: prompt.length });

  try {
    // If there's a photo, download it and pass to agent for visual analysis
    let attachmentData = null;

    if (inputData.hasPhoto && inputData.photoFileId) {
      try {
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (botToken) {
          logger?.info("📸 [Truth Sentinel] Downloading image for visual analysis");

          const fileInfoUrl = `https://api.telegram.org/bot${botToken}/getFile?file_id=${inputData.photoFileId}`;
          const fileInfoResponse = await fetch(fileInfoUrl);
          const fileInfo = await fileInfoResponse.json();

          if (fileInfo.ok && fileInfo.result?.file_path) {
            const filePath = fileInfo.result.file_path;
            const fileUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;

            const imageResponse = await fetch(fileUrl);
            if (imageResponse.ok) {
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

              attachmentData = {
                mimeType: contentType,
                data: base64Image
              };

              logger?.info("✅ [Truth Sentinel] Image downloaded successfully");
            }
          }
        }
      } catch (imageError: any) {
        logger?.error("❌ [Truth Sentinel] Failed to download image", { error: imageError.message });
      }
    } else if (inputData.hasDocument && inputData.documentFileId) {
      // Handle PDF Documents
      try {
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (botToken) {
          logger?.info("Vk [Truth Sentinel] Downloading PDF for analysis");

          const fileInfoUrl = `https://api.telegram.org/bot${botToken}/getFile?file_id=${inputData.documentFileId}`;
          const fileInfoResponse = await fetch(fileInfoUrl);
          const fileInfo = await fileInfoResponse.json();

          if (fileInfo.ok && fileInfo.result?.file_path) {
            const filePath = fileInfo.result.file_path;

            // Only process PDFs
            if (filePath.toLowerCase().endsWith('.pdf')) {
              const fileUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;

              const docResponse = await fetch(fileUrl);
              if (docResponse.ok) {
                const docBuffer = await docResponse.arrayBuffer();
                const base64Doc = Buffer.from(docBuffer).toString("base64");

                attachmentData = {
                  mimeType: "application/pdf",
                  data: base64Doc
                };

                logger?.info("✅ [Truth Sentinel] PDF downloaded successfully");
              }
            } else {
              logger?.warn("⚠️ [Truth Sentinel] Document is not a PDF, skipping attachment");
            }
          }
        }
      } catch (docError: any) {
        logger?.error("❌ [Truth Sentinel] Failed to download PDF", { error: docError.message });
      }
    }

    const response = await truthSentinelAgent.generate(
      prompt,
      {
        resourceId: "truth-sentinel-bot",
        threadId: inputData.threadId,
        maxSteps: 10,
        ...(attachmentData && {
          experimental_attachments: [{
            contentType: attachmentData.mimeType,
            url: `data:${attachmentData.mimeType};base64,${attachmentData.data}`
          }]
        })
      }
    );

    logger?.info("✅ [Truth Sentinel] Agent processing complete", {
      responseLength: response.text?.length,
    });

    // Send response directly via Telegram API if agent generated text
    if (response.text) {
      logger?.info("📤 [Truth Sentinel] Sending response to Telegram");

      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (botToken) {
        try {
          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: inputData.chatId,
              text: response.text,
              reply_to_message_id: inputData.messageId,
              parse_mode: "Markdown"
            }),
          });
          logger?.info("✅ [Truth Sentinel] Response sent successfully");
        } catch (sendError: any) {
          logger?.error("❌ [Truth Sentinel] Failed to send response", { error: sendError.message });
        }
      }
    }


    // If agent returns empty text, log a warning
    if (!response.text) {
      logger?.warn("⚠️ [Truth Sentinel] Agent returned empty response");
      return {
        processed: true,
        response: "I encountered an internal error while processing your request. Please try again.",
        skipped: false,
      };
    }


    return {
      processed: true,
      response: response.text || "Processed, but no text response generated.",
      skipped: false,
    };
  } catch (error: any) {
    logger?.error("❌ [Truth Sentinel] Error in agent processing", { error: error.message });

    // FALLBACK: Try to send a generic error message to the user so they aren't left hanging
    try {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (botToken) {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: inputData.chatId,
            text: "⚠️ I encountered an error while verifying this information. Please try again later.",
            reply_to_message_id: inputData.messageId,
          }),
        });
        logger?.info("✅ [Truth Sentinel] Fallback error message sent");
      }
    } catch (fallbackError: any) {
      logger?.error("❌ [Truth Sentinel] Failed to send fallback error message", { error: fallbackError.message });
    }

    return {
      processed: false,
      skipped: false,
      skipReason: `Error processing message: ${error.message}`,
    };
  }
};

const verifyMessageStep = createStep({
  id: "verify-message",
  description:
    "Processes incoming Telegram messages through the Truth Sentinel agent to verify claims against official documents",

  inputSchema: z.object({
    chatId: z.number().describe("Telegram chat ID"),
    messageId: z.number().describe("Message ID to reply to"),
    userName: z.string().describe("Username of the sender"),
    firstName: z.string().describe("First name of the sender"),
    message: z.string().describe("Text message content"),
    caption: z.string().optional().describe("Caption from media"),
    hasPhoto: z.boolean().describe("Whether message contains a photo"),
    hasDocument: z.boolean().describe("Whether message contains a document"),
    photoFileId: z.string().optional().describe("File ID of the largest photo"),
    documentFileId: z.string().optional().describe("File ID of the document"),
    isForwarded: z.boolean().describe("Whether message is forwarded"),
    replyToMessage: z.string().optional().describe("Content of replied-to message"),
    threadId: z.string().describe("Thread ID for conversation tracking"),
  }),

  outputSchema: z.object({
    processed: z.boolean(),
    response: z.string().optional(),
    skipped: z.boolean(),
    skipReason: z.string().optional(),
  }),

  execute: verifyMessageLogic,
});

export const truthSentinelWorkflow = createWorkflow({
  id: "truth-sentinel-workflow",

  inputSchema: z.object({
    chatId: z.number().describe("Telegram chat ID"),
    messageId: z.number().describe("Message ID to reply to"),
    userName: z.string().describe("Username of the sender"),
    firstName: z.string().describe("First name of the sender"),
    message: z.string().describe("Text message content"),
    caption: z.string().optional().describe("Caption from media"),
    hasPhoto: z.boolean().describe("Whether message contains a photo"),
    hasDocument: z.boolean().describe("Whether message contains a document"),
    photoFileId: z.string().optional().describe("File ID of the largest photo"),
    documentFileId: z.string().optional().describe("File ID of the document"),
    isForwarded: z.boolean().describe("Whether message is forwarded"),
    replyToMessage: z.string().optional().describe("Content of replied-to message"),
    threadId: z.string().describe("Thread ID for conversation tracking"),
  }) as any,

  outputSchema: z.object({
    processed: z.boolean(),
    response: z.string().optional(),
    skipped: z.boolean(),
    skipReason: z.string().optional(),
  }),
})
  .then(verifyMessageStep as any)
  .commit();