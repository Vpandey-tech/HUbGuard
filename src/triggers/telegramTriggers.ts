import type { ContentfulStatusCode } from "hono/utils/http-status";

import { registerApiRoute } from "../mastra/inngest";
import { Mastra } from "@mastra/core";

if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.warn(
    "Trying to initialize Telegram triggers without TELEGRAM_BOT_TOKEN. Can you confirm that the Telegram integration is configured correctly?",
  );
}

export type TelegramPhoto = {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
};

export type TelegramDocument = {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
};

export type TriggerInfoTelegramOnNewMessage = {
  type: "telegram/message";
  params: {
    chatId: number;
    messageId: number;
    userName: string;
    firstName: string;
    message: string;
    caption?: string;
    hasPhoto: boolean;
    hasDocument: boolean;
    photos?: TelegramPhoto[];
    document?: TelegramDocument;
    isForwarded: boolean;
    replyToMessage?: string;
  };
  payload: any;
};

export function registerTelegramTrigger({
  triggerType,
  handler,
}: {
  triggerType: string;
  handler: (
    mastra: Mastra,
    triggerInfo: TriggerInfoTelegramOnNewMessage,
  ) => Promise<void>;
}) {
  return [
    registerApiRoute("/webhooks/telegram/action", {
      method: "POST",
      handler: async (c) => {
        const mastra = c.get("mastra");
        const logger = mastra.getLogger();
        try {
          const payload = await c.req.json();

          logger?.info("📝 [Telegram] Incoming payload", { payload });

          const message = payload.message || payload.edited_message || payload.channel_post;

          if (!message) {
            logger?.info("📝 [Telegram] No message found in payload, skipping");
            return c.text("OK", 200);
          }

          const text = message.text || "";
          const caption = message.caption || "";
          const photos = message.photo || [];
          const document = message.document;
          const forwardFrom = message.forward_from || message.forward_from_chat;
          const replyTo = message.reply_to_message;

          const triggerInfo: TriggerInfoTelegramOnNewMessage = {
            type: triggerType as "telegram/message",
            params: {
              chatId: message.chat?.id,
              messageId: message.message_id,
              userName: message.from?.username || "unknown",
              firstName: message.from?.first_name || "User",
              message: text,
              caption: caption,
              hasPhoto: photos.length > 0,
              hasDocument: !!document,
              photos: photos.length > 0 ? photos : undefined,
              document: document,
              isForwarded: !!forwardFrom,
              replyToMessage: replyTo?.text || replyTo?.caption,
            },
            payload,
          };

          logger?.info("📝 [Telegram] Parsed trigger info", {
            chatId: triggerInfo.params.chatId,
            userName: triggerInfo.params.userName,
            hasText: !!text,
            hasCaption: !!caption,
            hasPhoto: triggerInfo.params.hasPhoto,
            hasDocument: triggerInfo.params.hasDocument,
            isForwarded: triggerInfo.params.isForwarded,
          });

          logger?.info("🎯 [Telegram Trigger] Processing message", {
            chatId: triggerInfo.params.chatId,
            userName: triggerInfo.params.userName,
            hasPhoto: triggerInfo.params.hasPhoto,
            hasDocument: triggerInfo.params.hasDocument,
          });

          try {
            await handler(mastra, triggerInfo);
          } catch (handlerError: any) {
            logger?.error("❌ [Telegram Trigger] Error in workflow handler", {
              error: handlerError.message,
              stack: handlerError.stack
            });
            // Don't rethrow, just log so we return 200 OK to Telegram
          }

          return c.text("OK", 200);
        } catch (error) {
          logger?.error("Error handling Telegram webhook:", { error });
          return c.text("Internal Server Error", 500);
        }
      },
    }),
  ];
}
