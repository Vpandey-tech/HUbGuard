import { createStep, createWorkflow } from "../inngest";
import { z } from "zod";
import { truthSentinelAgent } from "../agents/truthSentinelAgent";

export const verifyWhatsAppMessageLogic = async ({ inputData, mastra }: { inputData: any, mastra?: any }) => {
    const logger = mastra?.getLogger();
    logger?.info("🚀 [WhatsApp Truth Sentinel] Starting verification workflow", {
        from: inputData.from,
        messageId: inputData.messageId,
        hasMedia: inputData.numMedia > 0,
    });

    const textContent = inputData.body || "";

    if (!textContent && inputData.numMedia === 0) {
        logger?.info("⏭️ [WhatsApp Truth Sentinel] Empty message, skipping");
        return {
            processed: false,
            skipped: true,
            skipReason: "Empty message with no media",
        };
    }

    let prompt = `Analyze this WhatsApp message and verify it against official university documents.

MESSAGE DETAILS:
- From: ${inputData.from}
- Message ID: ${inputData.messageId}
- Text: "${textContent}"
`;

    if (inputData.numMedia > 0 && inputData.mediaUrls && inputData.mediaUrls.length > 0) {
        prompt += `
- Contains ${inputData.numMedia} MEDIA file(s)
- Media URLs: ${inputData.mediaUrls.join(", ")}
- This could be a screenshot of a fake circular/notice. Analyze it carefully.
`;
    }

    prompt += `
INSTRUCTIONS:
1. First use the gatekeeper-filter tool to check if this message needs verification
2. If it has media, analyze the images for fake documents
3. Use rag-search tool to find relevant official facts
4. Based on your findings, provide your verification result as text
5. If the gatekeeper says to skip, return empty text
6. DO NOT use the telegram-response or whatsapp-response tool - just return your verification text

IMPORTANT: Return ONLY your concise 1-2 line verification result. Do NOT call any response tools.`;

    logger?.info("🤖 [WhatsApp Truth Sentinel] Sending to agent", { promptLength: prompt.length });

    try {
        // Download media if present
        let attachmentData = null;

        if (inputData.numMedia > 0 && inputData.mediaUrls && inputData.mediaUrls.length > 0) {
            try {
                const mediaUrl = inputData.mediaUrls[0]; // Use first media
                const contentType = inputData.mediaContentTypes?.[0] || "image/jpeg";

                logger?.info("📸 [WhatsApp Truth Sentinel] Downloading media for analysis");

                const accountSid = process.env.TWILIO_ACCOUNT_SID;
                const authToken = process.env.TWILIO_AUTH_TOKEN;

                if (accountSid && authToken) {
                    const mediaResponse = await fetch(mediaUrl, {
                        headers: {
                            "Authorization": `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
                        },
                    });

                    if (mediaResponse.ok) {
                        const mediaBuffer = await mediaResponse.arrayBuffer();
                        const base64Media = Buffer.from(mediaBuffer).toString("base64");

                        attachmentData = {
                            mimeType: contentType,
                            data: base64Media
                        };

                        logger?.info("✅ [WhatsApp Truth Sentinel] Media downloaded successfully");
                    }
                }
            } catch (mediaError: any) {
                logger?.error("❌ [WhatsApp Truth Sentinel] Failed to download media", { error: mediaError.message });
            }
        }

        const response = await truthSentinelAgent.generate(
            prompt,
            {
                resourceId: "truth-sentinel-whatsapp",
                threadId: `whatsapp-${inputData.from}-${Date.now()}`,
                maxSteps: 10,
                ...(attachmentData && {
                    experimental_attachments: [{
                        contentType: attachmentData.mimeType,
                        url: `data:${attachmentData.mimeType};base64,${attachmentData.data}`
                    }]
                })
            }
        );

        logger?.info("✅ [WhatsApp Truth Sentinel] Agent processing complete", {
            responseLength: response.text?.length,
        });

        // Send response directly via Twilio API if agent generated text
        if (response.text) {
            logger?.info("📤 [WhatsApp Truth Sentinel] Sending response to WhatsApp");

            const accountSid = process.env.TWILIO_ACCOUNT_SID;
            const authToken = process.env.TWILIO_AUTH_TOKEN;
            const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+14155238886";

            if (accountSid && authToken) {
                try {
                    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

                    const formData = new URLSearchParams();
                    formData.append('From', fromNumber);
                    formData.append('To', inputData.from);
                    formData.append('Body', response.text);

                    await fetch(url, {
                        method: "POST",
                        headers: {
                            "Authorization": `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
                            "Content-Type": "application/x-www-form-urlencoded",
                        },
                        body: formData.toString(),
                    });

                    logger?.info("✅ [WhatsApp Truth Sentinel] Response sent successfully");
                } catch (sendError: any) {
                    logger?.error("❌ [WhatsApp Truth Sentinel] Failed to send response", { error: sendError.message });
                }
            }
        }

        if (!response.text) {
            logger?.warn("⚠️ [WhatsApp Truth Sentinel] Agent returned empty response");
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
        logger?.error("❌ [WhatsApp Truth Sentinel] Error in agent processing", { error: error.message });

        // FALLBACK: Try to send a generic error message
        try {
            const accountSid = process.env.TWILIO_ACCOUNT_SID;
            const authToken = process.env.TWILIO_AUTH_TOKEN;
            const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+14155238886";

            if (accountSid && authToken) {
                const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

                const formData = new URLSearchParams();
                formData.append('From', fromNumber);
                formData.append('To', inputData.from);
                formData.append('Body', "⚠️ I encountered an error while verifying this information. Please try again later.");

                await fetch(url, {
                    method: "POST",
                    headers: {
                        "Authorization": `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
                        "Content-Type": "application/x-www-form-urlencoded",
                    },
                    body: formData.toString(),
                });

                logger?.info("✅ [WhatsApp Truth Sentinel] Fallback error message sent");
            }
        } catch (fallbackError: any) {
            logger?.error("❌ [WhatsApp Truth Sentinel] Failed to send fallback error message", { error: fallbackError.message });
        }

        return {
            processed: false,
            skipped: false,
            skipReason: `Error processing message: ${error.message}`,
        };
    }
};

const verifyWhatsAppMessageStep = createStep({
    id: "verify-whatsapp-message",
    description:
        "Processes incoming WhatsApp messages through the Truth Sentinel agent to verify claims against official documents",

    inputSchema: z.object({
        from: z.string().describe("WhatsApp number of sender"),
        to: z.string().describe("WhatsApp number of recipient (bot)"),
        body: z.string().describe("Text message content"),
        messageId: z.string().describe("Twilio message SID"),
        numMedia: z.number().describe("Number of media attachments"),
        mediaUrls: z.array(z.string()).optional().describe("URLs of media attachments"),
        mediaContentTypes: z.array(z.string()).optional().describe("Content types of media"),
    }),

    outputSchema: z.object({
        processed: z.boolean(),
        response: z.string().optional(),
        skipped: z.boolean(),
        skipReason: z.string().optional(),
    }),

    execute: verifyWhatsAppMessageLogic,
});

export const whatsappVerificationWorkflow = createWorkflow({
    id: "whatsapp-verification-workflow",

    inputSchema: z.object({
        from: z.string().describe("WhatsApp number of sender"),
        to: z.string().describe("WhatsApp number of recipient (bot)"),
        body: z.string().describe("Text message content"),
        messageId: z.string().describe("Twilio message SID"),
        numMedia: z.number().describe("Number of media attachments"),
        mediaUrls: z.array(z.string()).optional().describe("URLs of media attachments"),
        mediaContentTypes: z.array(z.string()).optional().describe("Content types of media"),
    }) as any,

    outputSchema: z.object({
        processed: z.boolean(),
        response: z.string().optional(),
        skipped: z.boolean(),
        skipReason: z.string().optional(),
    }),
})
    .then(verifyWhatsAppMessageStep as any)
    .commit();
