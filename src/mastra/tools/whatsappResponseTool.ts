import { config } from "dotenv";
import path from "path";

// Explicitly load .env from project root
config({ path: path.resolve(process.cwd(), ".env") });

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export const whatsappResponseTool = createTool({
    id: "whatsapp-response",
    description:
        "Sends a verification response message to a WhatsApp chat using Twilio. Use this to respond with the verification result (HOAX DETECTED, VERIFIED, or informational message).",

    inputSchema: z.object({
        to: z.string().describe("The WhatsApp number to send the message to (format: whatsapp:+1234567890)"),
        message: z.string().describe("The verification response message to send"),
    }),

    outputSchema: z.object({
        success: z.boolean(),
        messageId: z.string().optional(),
        error: z.string().optional(),
    }),

    execute: async ({ context, mastra }) => {
        const logger = mastra?.getLogger();
        logger?.info("📤 [WhatsApp Response] Attempting to send message", {
            to: context.to,
            messageLength: context.message.length,
        });

        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+14155238886";

        if (!accountSid || !authToken) {
            logger?.error("❌ [WhatsApp Response] Twilio credentials missing!");
            return { success: false, error: "Twilio credentials missing" };
        }

        try {
            const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

            const formData = new URLSearchParams();
            formData.append('From', fromNumber);
            formData.append('To', context.to);
            formData.append('Body', context.message);

            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Authorization": `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: formData.toString(),
            });

            const responseData = await response.json();

            if (!response.ok) {
                logger?.error("❌ [WhatsApp Response] Twilio API Error", {
                    status: response.status,
                    error: responseData,
                });
                return {
                    success: false,
                    error: `Twilio API Error: ${JSON.stringify(responseData)}`,
                };
            }

            logger?.info("✅ [WhatsApp Response] Message sent successfully", {
                messageId: responseData.sid,
            });

            return {
                success: true,
                messageId: responseData.sid,
            };
        } catch (error: any) {
            logger?.error("❌ [WhatsApp Response] Network/System Error", { error: error.message });
            return {
                success: false,
                error: error.message,
            };
        }
    },
});
