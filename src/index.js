// Express server for the AI Persona demo.
//
// This file connects the browser interface to the Persona Agent.
// It has three main responsibilities:
// 1. serve the files in /public,
// 2. provide Persona data through /api/persona,
// 3. receive interview questions through /api/chat and run the Agent.

// Load environment variables such as OPENAI_API_KEY and OPENAI_MODEL.
import "dotenv/config";

// path and fileURLToPath help us build reliable file-system paths in ES modules.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

// Express is the web-server framework used in this demo.
import express from "express";

// run() executes an Agent from the OpenAI Agents SDK.
import { run } from "@openai/agents";

// Import both the Persona data and the Agent built from that data.
import { ellaAgent, persona } from "./agent.js";

// The backend must have access to the API key before it can call OpenAI.
// Notice that the key stays on the server and is never sent to the browser.
if (!process.env.OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY.");
  console.error("Create a local .env file and add your OpenAI API key.");
  process.exit(1);
}

// Create the Express application.
const app = express();

// Hosting platforms often provide their own PORT environment variable.
// When running locally, this demo falls back to port 3000.
const port = process.env.PORT || 3000;

// ES modules do not provide __dirname automatically, so we derive it here.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// publicDir points to the project's /public folder.
const publicDir = path.join(__dirname, "..", "public");

// Each session owns an isolated in-memory conversation history.
// The server retains this history until it restarts.
const conversationSessions = new Map();
const MAX_HISTORY_ITEMS = 40;

function createConversationSession(sessionId) {
  let items = [];

  const session = {
    async getSessionId() {
      return sessionId;
    },
    async getItems(limit) {
      if (typeof limit === "number") {
        return items.slice(-limit);
      }
      return [...items];
    },
    async addItems(newItems) {
      items.push(...newItems);
      items = items.slice(-MAX_HISTORY_ITEMS);
    },
    async popItem() {
      return items.pop();
    },
    async clearSession() {
      items = [];
    },
  };

  conversationSessions.set(sessionId, session);
  return session;
}

function getConversationSession(sessionId) {
  return conversationSessions.get(sessionId) || createConversationSession(sessionId);
}

// express.json() allows Express to read JSON request bodies such as
// { "prompt": "What do you think about this product?" }.
app.use(express.json());

// express.static() makes index.html, app.js, style.css, and images available
// to the browser. Visiting http://localhost:3000 therefore opens the UI.
app.use(express.static(publicDir));

// GET /api/persona returns information that the browser is allowed to display.
app.get("/api/persona", (_req, res) => {
  // Object destructuring removes behavior_guidance before sending the profile.
  // This demonstrates that server-side data does not have to be fully exposed
  // to the front end.
  const { behavior_guidance, ...publicPersona } = persona;
  res.json(publicPersona);
});

// POST /api/chat receives one interview question from the browser.
app.post("/api/chat", async (req, res) => {
  // Validate that req.body.prompt exists and is a string.
  // Optional chaining (?.) avoids an error if req.body is missing.
  const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
  const suppliedSessionId =
    typeof req.body?.sessionId === "string" ? req.body.sessionId.trim() : "";
  const sessionId = suppliedSessionId || randomUUID();

  if (!prompt) {
    return res.status(400).json({ error: "Prompt cannot be empty." });
  }

  if (suppliedSessionId.length > 128) {
    return res.status(400).json({ error: "Session ID is too long." });
  }

  try {
    const session = getConversationSession(sessionId);
    const result = await run(ellaAgent, prompt, {
      session,
      sessionInputCallback: (historyItems, newItems) =>
        [...historyItems, ...newItems].slice(-MAX_HISTORY_ITEMS),
    });

    // The session ID lets the browser keep using the same isolated history.
    return res.json({ response: result.finalOutput, sessionId });
  } catch (error) {
    // Log the detailed error on the server, but return a simple message to the UI.
    console.error("Agent run failed:", error);
    return res.status(500).json({ error: "Agent request failed." });
  }
});

// Start listening for browser requests.
app.listen(port, () => {
  console.log(`AI Persona web service running at http://localhost:${port}`);
});
