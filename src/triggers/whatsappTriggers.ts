import { config } from "dotenv";
import path from "path";

// Explicitly load .env from project root
config({ path: path.resolve(process.cwd(), ".env") });

import type { ContentfulStatusCode } from "hono/utils/http-status";
import { registerApiRoute } from "../mastra/inngest";
import { Mastra } from "@mastra/core";

// Debug: Check what env vars are loaded
console.log("🔍 [WhatsApp Debug] Checking Twilio credentials:");
console.log("  TWILIO_ACCOUNT_SID:", process.env.TWILIO_ACCOUNT_SID ? "✅ Found" : "❌ Missing");
console.log("  TWILIO_AUTH_TOKEN:", process.env.TWILIO_AUTH_TOKEN ? "✅ Found" : "❌ Missing");
console.log("  TWILIO_WHATSAPP_NUMBER:", process.env.TWILIO_WHATSAPP_NUMBER ? "✅ Found" : "❌ Missing");

if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
  console.warn(
    "Trying to initialize WhatsApp triggers without Twilio credentials. Can you confirm that the WhatsApp integration is configured correctly?",
  );
}

export type TriggerInfoWhatsAppOnNewMessage = {
  type: "whatsapp/message";
  params: {
    from: string;
    to: string;
    body: string;
    messageId: string;
    numMedia: number;
    mediaUrls?: string[];
    mediaContentTypes?: string[];
  };
  payload: any;
};

export function registerWhatsAppTrigger({
  triggerType,
  handler,
}: {
  triggerType: string;
  handler: (
    mastra: Mastra,
    triggerInfo: TriggerInfoWhatsAppOnNewMessage,
  ) => Promise<void>;
}) {
  return [
    registerApiRoute("/webhooks/whatsapp/action", {
      method: "POST",
      handler: async (c) => {
        const mastra = c.get("mastra");
        const logger = mastra.getLogger();
        try {
          const formData = await c.req.parseBody();

          logger?.info("📱 [WhatsApp] Incoming payload", { formData });

          const from = formData.From as string;
          const to = formData.To as string;
          const body = formData.Body as string || "";
          const messageId = formData.MessageSid as string;
          const numMedia = parseInt(formData.NumMedia as string || "0");

          // Extract media URLs if present
          const mediaUrls: string[] = [];
          const mediaContentTypes: string[] = [];

          for (let i = 0; i < numMedia; i++) {
            const mediaUrl = formData[`MediaUrl${i}`] as string;
            const mediaContentType = formData[`MediaContentType${i}`] as string;
            if (mediaUrl) mediaUrls.push(mediaUrl);
            if (mediaContentType) mediaContentTypes.push(mediaContentType);
          }

          const triggerInfo: TriggerInfoWhatsAppOnNewMessage = {
            type: triggerType as "whatsapp/message",
            params: {
              from,
              to,
              body,
              messageId,
              numMedia,
              mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
              mediaContentTypes: mediaContentTypes.length > 0 ? mediaContentTypes : undefined,
            },
            payload: formData,
          };

          logger?.info("📱 [WhatsApp] Parsed trigger info", {
            from: triggerInfo.params.from,
            hasText: !!body,
            hasMedia: numMedia > 0,
          });

          logger?.info("🎯 [WhatsApp Trigger] Processing message", {
            from: triggerInfo.params.from,
            hasMedia: triggerInfo.params.numMedia > 0,
          });

          try {
            await handler(mastra, triggerInfo);
          } catch (handlerError: any) {
            logger?.error("❌ [WhatsApp Trigger] Error in workflow handler", {
              error: handlerError.message,
              stack: handlerError.stack
            });
            // Don't rethrow, just log so we return 200 OK to Twilio
          }

          // Twilio expects TwiML response
          return c.text('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', 200, {
            'Content-Type': 'text/xml'
          });
        } catch (error) {
          logger?.error("Error handling WhatsApp webhook:", { error });
          return c.text('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', 500, {
            'Content-Type': 'text/xml'
          });
        }
      },
    }),
  ];
}
