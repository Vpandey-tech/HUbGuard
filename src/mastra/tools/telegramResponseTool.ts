import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export const telegramResponseTool = createTool({
  id: "telegram-response",
  description:
    "Sends a verification response message to a Telegram chat. Use this to respond with the verification result (HOAX DETECTED, VERIFIED, or informational message).",

  inputSchema: z.object({
    chatId: z.number().describe("The Telegram chat ID to send the message to"),
    message: z.string().describe("The verification response message to send"),
    replyToMessageId: z.number().optional().describe("Message ID to reply to"),
    parseMode: z.enum(["HTML", "Markdown", "MarkdownV2"]).optional().default("HTML").describe("Message parse mode"),
  }),

  outputSchema: z.object({
    success: z.boolean(),
    messageId: z.number().optional(),
    error: z.string().optional(),
  }),

  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("📤 [Telegram Response] Attempting to send message", {
      chatId: context.chatId,
      messageLength: context.message.length,
      replyTo: context.replyToMessageId,
    });

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      logger?.error("❌ [Telegram Response] TELEGRAM_BOT_TOKEN is missing!");
      return { success: false, error: "Bot token missing" };
    }

    try {
      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      const body = {
        chat_id: context.chatId,
        text: context.message,
        reply_to_message_id: context.replyToMessageId,
        parse_mode: "Markdown",
      };

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const responseData = await response.json();

      if (!response.ok) {
        logger?.error("❌ [Telegram Response] API Error", {
          status: response.status,
          error: responseData,
        });
        return {
          success: false,
          error: `Telegram API Error: ${JSON.stringify(responseData)}`,
        };
      }

      logger?.info("✅ [Telegram Response] Message sent successfully", {
        messageId: responseData.result?.message_id,
      });

      return {
        success: true,
        messageId: responseData.result?.message_id,
      };
    } catch (error: any) {
      logger?.error("❌ [Telegram Response] Network/System Error", { error: error.message });
      return {
        success: false,
        error: error.message,
      };
    }
  },
});
