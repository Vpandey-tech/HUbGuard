import { config } from "dotenv";
import path from "path";

// Explicitly load .env from project root
config({ path: path.resolve(process.cwd(), ".env") });

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { YoutubeTranscript } from "youtube-transcript";

export const youtubeVerificationTool = createTool({
    id: "youtube-verification",
    description:
        "Verifies the content of a YouTube video against a user's claim. Fetches video metadata (title, description) via API and transcripts to check if the video actually supports the claim.",

    inputSchema: z.object({
        videoUrl: z.string().describe("The YouTube video URL to verify"),
        claim: z.string().describe("The claim the user is making about this video (e.g., 'Exams cancelled')"),
    }),

    outputSchema: z.object({
        isValid: z.boolean().describe("Whether the video content matches the claim"),
        videoTitle: z.string().describe("Title of the video"),
        channelName: z.string().describe("Name of the channel"),
        summary: z.string().describe("Brief summary of what the video is actually about"),
        verdict: z.string().describe("Final verdict: VERIFIED or HOAX based on video content"),
        transcriptSnippet: z.string().optional().describe("Relevant snippet from transcript"),
    }),

    execute: async ({ context, mastra }) => {
        const logger = mastra?.getLogger();
        const apiKey = process.env.YOUTUBE_API_KEY;

        if (!apiKey) {
            throw new Error("YOUTUBE_API_KEY is missing in .env file");
        }

        logger?.info("📹 [YouTube Tool] Verifying video", { url: context.videoUrl });

        try {
            // 1. Extract Video ID
            const videoIdMatch = context.videoUrl.match(/(?:v=|\/)([0-9A-Za-z_-]{11}).*/);
            const videoId = videoIdMatch ? videoIdMatch[1] : null;

            if (!videoId) {
                return {
                    isValid: false,
                    videoTitle: "Unknown",
                    channelName: "Unknown",
                    summary: "Invalid YouTube URL provided.",
                    verdict: "HOAX",
                };
            }

            // 2. Fetch Metadata via YouTube Data API (FASTEST)
            const apiUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${apiKey}`;
            const apiResponse = await fetch(apiUrl);
            const apiData = await apiResponse.json();

            if (!apiData.items || apiData.items.length === 0) {
                return {
                    isValid: false,
                    videoTitle: "Video Not Found",
                    channelName: "Unknown",
                    summary: "Video does not exist or is private.",
                    verdict: "HOAX",
                };
            }

            const snippet = apiData.items[0].snippet;
            const title = snippet.title;
            const description = snippet.description;
            const channelTitle = snippet.channelTitle;

            logger?.info("📹 [YouTube Tool] Metadata fetched", { title, channelTitle });

            // 3. Fetch Transcript (DEEP VERIFICATION)
            let transcriptText = "";
            try {
                const transcriptItems = await YoutubeTranscript.fetchTranscript(videoId);
                // Get first 1000 words for quick verification (usually enough)
                transcriptText = transcriptItems
                    .map((t) => t.text)
                    .join(" ")
                    .slice(0, 5000);
            } catch (error) {
                logger?.warn("⚠️ [YouTube Tool] No transcript found, relying on metadata");
                transcriptText = "Transcript not available. Verifying based on title and description only.";
            }

            // 4. Verify Content Logic (Simple keyword check + AI will do the rest)
            // We return the raw data, the Agent will make the final decision based on this data.
            // But we construct a helpful summary for the agent.

            const combinedContent = `
      VIDEO TITLE: ${title}
      CHANNEL: ${channelTitle}
      DESCRIPTION: ${description}
      TRANSCRIPT START: ${transcriptText}
      `;

            return {
                isValid: true, // The fetch was valid, Agent decides if claim is valid
                videoTitle: title,
                channelName: channelTitle,
                summary: `Video content fetched. Title: "${title}". Channel: "${channelTitle}".`,
                verdict: "PENDING_AGENT_REVIEW", // Agent will set final verdict
                transcriptSnippet: combinedContent,
            };

        } catch (error: any) {
            logger?.error("❌ [YouTube Tool] Error", { error: error.message });
            return {
                isValid: false,
                videoTitle: "Error",
                channelName: "Error",
                summary: `Failed to verify video: ${error.message}`,
                verdict: "HOAX",
            };
        }
    },
});
