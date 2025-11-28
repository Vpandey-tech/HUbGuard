import "dotenv/config";
import { Mastra } from "@mastra/core";
import { MastraError } from "@mastra/core/error";
import { PinoLogger } from "@mastra/loggers";
import { LogLevel, MastraLogger } from "@mastra/core/logger";
import pino from "pino";
import { MCPServer } from "@mastra/mcp";
import { NonRetriableError } from "inngest";
import { z } from "zod";

import { sharedPostgresStorage } from "./storage";
import { inngest, inngestServe } from "./inngest";
import { truthSentinelWorkflow, verifyMessageLogic } from "./workflows/truthSentinelWorkflow";
import { whatsappVerificationWorkflow, verifyWhatsAppMessageLogic } from "./workflows/whatsappVerificationWorkflow";
import { truthSentinelAgent } from "./agents/truthSentinelAgent";
import { registerTelegramTrigger } from "../triggers/telegramTriggers";
import { registerWhatsAppTrigger } from "../triggers/whatsappTriggers";
import { gatekeeperTool } from "./tools/gatekeeperTool";
import { ragSearchTool, reloadDocumentsTool } from "./tools/ragSearchTool";
import { imageAnalysisTool } from "./tools/imageAnalysisTool";
import { telegramResponseTool } from "./tools/telegramResponseTool";
import { whatsappResponseTool } from "./tools/whatsappResponseTool";
import { exaSearchTool, universitySearchTool } from "./tools/exaSearchTool";
import { perplexitySearchTool } from "./tools/perplexitySearchTool";
import { dataFolderCleanupTool, dataFolderStatusTool } from "./tools/dataManagementTool";

class ProductionPinoLogger extends MastraLogger {
  protected logger: pino.Logger;

  constructor(
    options: {
      name?: string;
      level?: LogLevel;
    } = {},
  ) {
    super(options);

    this.logger = pino({
      name: options.name || "app",
      level: options.level || LogLevel.INFO,
      base: {},
      formatters: {
        level: (label: string, _number: number) => ({
          level: label,
        }),
      },
      timestamp: () => `,"time":"${new Date(Date.now()).toISOString()}"`,
    });
  }

  debug(message: string, args: Record<string, any> = {}): void {
    this.logger.debug(args, message);
  }

  info(message: string, args: Record<string, any> = {}): void {
    this.logger.info(args, message);
  }

  warn(message: string, args: Record<string, any> = {}): void {
    this.logger.warn(args, message);
  }

  error(message: string, args: Record<string, any> = {}): void {
    this.logger.error(args, message);
  }
}

export const mastra = new Mastra({
  storage: sharedPostgresStorage,
  workflows: {
    truthSentinelWorkflow,
  },
  agents: {
    truthSentinelAgent,
  },
  mcpServers: {
    allTools: new MCPServer({
      name: "allTools",
      version: "1.0.0",
      tools: {
        gatekeeperTool,
        ragSearchTool,
        reloadDocumentsTool,
        imageAnalysisTool,
        telegramResponseTool,
        whatsappResponseTool,
        exaSearchTool,
        universitySearchTool,
        perplexitySearchTool,
        dataFolderCleanupTool,
        dataFolderStatusTool,
      },
    }),
  },
  bundler: {
    externals: [
      "@slack/web-api",
      "inngest",
      "inngest/hono",
      "hono",
      "hono/streaming",
    ],
    sourcemap: true,
  },
  server: {
    host: "0.0.0.0",
    port: 5000,
    middleware: [
      async (c, next) => {
        const mastra = c.get("mastra");
        const logger = mastra?.getLogger();
        logger?.debug("[Request]", { method: c.req.method, url: c.req.url });
        try {
          await next();
        } catch (error) {
          logger?.error("[Response]", {
            method: c.req.method,
            url: c.req.url,
            error,
          });
          if (error instanceof MastraError) {
            if (error.id === "AGENT_MEMORY_MISSING_RESOURCE_ID") {
              throw new NonRetriableError(error.message, { cause: error });
            }
          } else if (error instanceof z.ZodError) {
            throw new NonRetriableError(error.message, { cause: error });
          }

          throw error;
        }
      },
    ],
    apiRoutes: [
      {
        path: "/api/inngest",
        method: "ALL",
        createHandler: async ({ mastra }) => inngestServe({ mastra, inngest }),
      },

      {
        path: "/health",
        method: "GET",
        createHandler: async () => async (c: any) => {
          return c.json({ status: "ok", timestamp: new Date().toISOString() });
        },
      },

      {
        path: "/api/health",
        method: "GET",
        createHandler: async () => async (c: any) => {
          return c.json({
            status: "alive",
            bot: "Truth Sentinel",
            version: "1.0.0",
            timestamp: new Date().toISOString()
          });
        },
      },

      ...registerTelegramTrigger({
        triggerType: "telegram/message",
        handler: async (mastra, triggerInfo) => {
          const logger = mastra.getLogger();
          logger?.info("🎯 [Telegram Trigger] Received message", {
            chatId: triggerInfo.params.chatId,
            userName: triggerInfo.params.userName,
            messageText: triggerInfo.params.message?.substring(0, 50),
            hasPhoto: triggerInfo.params.hasPhoto,
            hasDocument: triggerInfo.params.hasDocument,
          });

          // Extract photo file ID
          const photos = triggerInfo.params.photos || [];
          const largestPhoto = photos.length > 0
            ? photos.reduce((prev: any, curr: any) =>
              (curr.file_size || 0) > (prev.file_size || 0) ? curr : prev
            )
            : null;

          const threadId = `telegram-chat-${triggerInfo.params.chatId}-${Date.now()}`;
          const workflowInput = {
            chatId: triggerInfo.params.chatId,
            messageId: triggerInfo.params.messageId,
            userName: triggerInfo.params.userName,
            firstName: triggerInfo.params.firstName,
            message: triggerInfo.params.message || "",
            caption: triggerInfo.params.caption,
            hasPhoto: triggerInfo.params.hasPhoto,
            hasDocument: triggerInfo.params.hasDocument,
            photoFileId: largestPhoto?.file_id,
            documentFileId: triggerInfo.params.document?.file_id,
            isForwarded: triggerInfo.params.isForwarded,
            replyToMessage: triggerInfo.params.replyToMessage,
            threadId,
          };

          logger?.info("📤 [Telegram Trigger] Prepared workflow input", {
            hasAllRequiredFields: !!(workflowInput.chatId && workflowInput.messageId),
          });

          try {
            logger?.info("🚀 [Telegram Trigger] Starting workflow directly...");

            // Execute logic directly without Inngest
            await verifyMessageLogic({ inputData: workflowInput, mastra });

            logger?.info("✅ [Telegram Trigger] Workflow completed successfully");

          } catch (error: any) {
            logger?.error("❌ [Telegram Trigger] Processing failed", {
              error: error.message,
              stack: error.stack,
            });

            // Send fallback error message
            try {
              const botToken = process.env.TELEGRAM_BOT_TOKEN;
              if (botToken) {
                await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    chat_id: triggerInfo.params.chatId,
                    text: "⚠️ I'm experiencing technical difficulties. Please try again in a moment.",
                    reply_to_message_id: triggerInfo.params.messageId,
                  }),
                });
                logger?.info("✅ [Telegram Trigger] Error message sent to user");
              }
            } catch (fallbackError) {
              logger?.error("❌ [Telegram Trigger] Failed to send error message", {
                error: fallbackError,
              });
            }
          }
        },
      }),

      ...registerWhatsAppTrigger({
        triggerType: "whatsapp/message",
        handler: async (mastra, triggerInfo) => {
          const logger = mastra.getLogger();
          logger?.info("🎯 [WhatsApp Trigger] Received message", {
            from: triggerInfo.params.from,
            hasText: !!triggerInfo.params.body,
            hasMedia: triggerInfo.params.numMedia > 0,
          });

          const workflowInput = {
            from: triggerInfo.params.from,
            to: triggerInfo.params.to,
            body: triggerInfo.params.body,
            messageId: triggerInfo.params.messageId,
            numMedia: triggerInfo.params.numMedia,
            mediaUrls: triggerInfo.params.mediaUrls,
            mediaContentTypes: triggerInfo.params.mediaContentTypes,
          };

          logger?.info("📤 [WhatsApp Trigger] Prepared workflow input", {
            hasAllRequiredFields: !!(workflowInput.from && workflowInput.messageId),
          });

          try {
            logger?.info("🚀 [WhatsApp Trigger] Starting workflow directly...");

            // Execute logic directly without Inngest
            await verifyWhatsAppMessageLogic({ inputData: workflowInput, mastra });

            logger?.info("✅ [WhatsApp Trigger] Workflow completed successfully");

          } catch (error: any) {
            logger?.error("❌ [WhatsApp Trigger] Processing failed", {
              error: error.message,
              stack: error.stack,
            });

            // Send fallback error message
            try {
              const accountSid = process.env.TWILIO_ACCOUNT_SID;
              const authToken = process.env.TWILIO_AUTH_TOKEN;
              const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+14155238886";

              if (accountSid && authToken) {
                const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

                const formData = new URLSearchParams();
                formData.append('From', fromNumber);
                formData.append('To', triggerInfo.params.from);
                formData.append('Body', "⚠️ I'm experiencing technical difficulties. Please try again in a moment.");

                await fetch(url, {
                  method: "POST",
                  headers: {
                    "Authorization": `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
                    "Content-Type": "application/x-www-form-urlencoded",
                  },
                  body: formData.toString(),
                });

                logger?.info("✅ [WhatsApp Trigger] Error message sent to user");
              }
            } catch (fallbackError) {
              logger?.error("❌ [WhatsApp Trigger] Failed to send error message", {
                error: fallbackError,
              });
            }
          }
        },
      }),
    ],
  },
  logger:
    process.env.NODE_ENV === "production"
      ? new ProductionPinoLogger({
        name: "Mastra",
        level: "info",
      })
      : new PinoLogger({
        name: "Mastra",
        level: "info",
      }),
});