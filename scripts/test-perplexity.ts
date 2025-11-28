import "dotenv/config";
import { perplexitySearchTool } from "../src/mastra/tools/perplexitySearchTool";

async function testPerplexity() {
    console.log("Testing Perplexity Search Tool...");

    // We no longer exit early if key is missing, to test the tool's fallback logic
    if (!process.env.PERPLEXITY_API_KEY) {
        console.log("ℹ️ PERPLEXITY_API_KEY not found in env. Testing fallback behavior...");
    } else {
        console.log("✅ PERPLEXITY_API_KEY found.");
    }

    try {
        const result = await perplexitySearchTool.execute({
            context: {
                query: "Is Mumbai University exam postponed for November 2024?"
            }
        });

        console.log("Result:", JSON.stringify(result, null, 2));
    } catch (error) {
        console.error("Error executing tool:", error);
    }
}

testPerplexity();
