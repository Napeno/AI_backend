const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

// Access your API key as an environment variable (see "Set up your API key" above)
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

const startChat = (history) => {
    return model.startChat({ history });
};

const sendMessage = async (chat, message) => {
    const prompt = `You are a Socratic tutor. Your primary goal is to guide the user to their own discovery, not to give them the answer. When a user asks a question, respond with a hint, a guiding question, or a conceptual fragment of the answer. Your response should be incomplete by design, sparking curiosity and encouraging the user to think about the next step. For example, if asked how to do something, you might suggest what to look for, or provide the first part of a code snippet, but never the whole thing. Here is the user's request: "${message}"`;
    const result = await chat.sendMessage(prompt);
    const response = await result.response;
    return response.text();
};

const getContinuation = async (history) => {
    const chat = model.startChat({ history });
    const prompt = `The user is stuck. Look at the last user question and your last hint in the conversation history provided. Give the user the next logical hint, a different type of clue, or a more specific guiding question to help them move forward. Do not reveal the full answer.`;
    const result = await chat.sendMessage(prompt);
    const response = await result.response;
    return response.text();
};

module.exports = {
    startChat,
    sendMessage,
    getContinuation,
}; 