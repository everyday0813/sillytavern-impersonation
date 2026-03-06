// Impersonation Extension - Main Logic
// Generates user-style continuations for roleplay, one sentence at a time

import { getContext, extension_settings, loadExtensionSettings } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";

// ============================================
// Constants & Settings
// ============================================

const MODULE_NAME = "impersonation";
const EXTENSION_PATH = `scripts/extensions/third-party/${MODULE_NAME}`;

const defaultSettings = {
    enabled: true,
    maxChars: 150,        // Max characters per generation
    contextMessages: 50,  // Number of recent messages to include
    showLoading: true,
    // Custom API settings
    apiEndpoint: "https://api.z.ai/api/coding/paas/v4/chat/completions",
    apiKey: "",
    apiModel: "zai-org/glm-5"
};

let isGenerating = false;

// ============================================
// Settings Management
// ============================================

function getSettings() {
    extension_settings[MODULE_NAME] = extension_settings[MODULE_NAME] || {};
    if (Object.keys(extension_settings[MODULE_NAME]).length === 0) {
        Object.assign(extension_settings[MODULE_NAME], defaultSettings);
    }
    return extension_settings[MODULE_NAME];
}

async function loadSettings() {
    const settings = getSettings();
    // Apply settings to UI
    $("#impersonation-enabled").prop("checked", settings.enabled);
    $("#impersonation-api-endpoint").val(settings.apiEndpoint);
    $("#impersonation-api-key").val(settings.apiKey);
    $("#impersonation-api-model").val(settings.apiModel);
    $("#impersonation-max-chars").val(settings.maxChars);
}

function saveSettings() {
    const settings = getSettings();
    settings.enabled = $("#impersonation-enabled").prop("checked");
    settings.apiEndpoint = $("#impersonation-api-endpoint").val();
    settings.apiKey = $("#impersonation-api-key").val();
    settings.apiModel = $("#impersonation-api-model").val();
    settings.maxChars = parseInt($("#impersonation-max-chars").val()) || 150;
    saveSettingsDebounced();
    console.log("[Impersonation] Settings saved");
}

// ============================================
// Context Gathering
// ============================================

/**
 * Get the user's chat-specific persona
 */
function getUserPersona() {
    const context = getContext();
    
    // Try to get chat-specific persona
    // SillyTavern stores persona in various places depending on version
    let persona = null;
    
    // Method 1: Check chat metadata for persona
    if (context.chatMetadata?.persona) {
        persona = context.chatMetadata.persona;
    }
    
    // Method 2: Check for active persona from global settings
    if (!persona && context.extensionSettings?.persona) {
        persona = context.extensionSettings.persona;
    }
    
    // Method 3: Use default user avatar/description
    if (!persona) {
        const userAvatar = context.userAvatar;
        if (userAvatar?.description) {
            persona = userAvatar.description;
        }
    }
    
    return persona || "A roleplay participant";
}

/**
 * Get recent chat history formatted for context
 */
function getRecentChatHistory() {
    const context = getContext();
    const settings = getSettings();
    const chat = context.chat || [];
    
    // Get last N messages
    const recentMessages = chat.slice(-settings.contextMessages);
    
    // Format for prompt
    return recentMessages.map(msg => {
        const name = msg.is_user ? "User" : (msg.name || "Character");
        const text = msg.mes || "";
        return `${name}: ${text}`;
    }).join("\n\n");
}

/**
 * Detect if there's an unclosed quote in the text
 */
function detectUnclosedQuote(text) {
    if (!text) return { hasUnclosedQuote: false, quoteChar: null };
    
    const quoteChars = ['"', '"', '"', "'", "'", "'"];
    let result = { hasUnclosedQuote: false, quoteChar: null, lastQuoteIndex: -1 };
    
    for (const char of quoteChars) {
        const count = (text.match(new RegExp(escapeRegex(char), "g")) || []).length;
        if (count % 2 !== 0) {
            // Found odd number of this quote char
            result.hasUnclosedQuote = true;
            result.quoteChar = char;
            result.lastQuoteIndex = text.lastIndexOf(char);
            break;
        }
    }
    
    return result;
}

function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================
// Prompt Building
// ============================================

function buildContinuationPrompt(currentInput, persona, chatHistory) {
    const settings = getSettings();
    const quoteInfo = detectUnclosedQuote(currentInput);
    
    let prompt = `You are continuing a roleplay as the USER character. Write the NEXT sentence only.

USER PERSONA:
${persona}

RECENT CONVERSATION:
${chatHistory}
`;

    if (currentInput && currentInput.trim()) {
        prompt += `\nUSER'S PARTIAL INPUT:
"${currentInput}"
`;
        
        if (quoteInfo.hasUnclosedQuote) {
            prompt += `
IMPORTANT: The user has an unclosed ${quoteInfo.quoteChar} quote. Continue the dialogue naturally and close the quote when appropriate. Also add brief action/narrative if fitting.
`;
        } else {
            prompt += `
Continue naturally from this input. Add brief action/narrative if fitting.
`;
        }
    } else {
        prompt += `
Continue the roleplay as the user. Write their next action or dialogue.
`;
    }

    prompt += `
OUTPUT RULES:
- Output ONLY the continuation text, nothing else
- Max ${settings.maxChars} characters
- Dialogue goes inside quotation marks
- Actions/narrative are plain text (no asterisks needed)
- Natural, brief continuation only
`;

    return prompt;
}

// ============================================
// Generation
// ============================================

async function generateContinuation() {
    const settings = getSettings();
    
    if (!settings.enabled) {
        console.log("[Impersonation] Extension disabled");
        return null;
    }
    
    // Check for API key
    if (!settings.apiKey) {
        toastr.warning("Please configure API key in Impersonation settings", "Impersonation");
        return null;
    }
    
    // Gather context
    const persona = getUserPersona();
    const chatHistory = getRecentChatHistory();
    const currentInput = $("#send_textarea").val() || "";
    
    // Build prompt
    const prompt = buildContinuationPrompt(currentInput, persona, chatHistory);
    
    console.log("[Impersonation] Generating continuation via custom API...");
    
    try {
        // Call custom API directly
        const result = await callCustomAPI(prompt);
        
        // Clean up the result
        let continuation = (result || "").trim();
        
        // Limit length
        if (continuation.length > settings.maxChars) {
            // Try to cut at a sentence boundary
            const cutPoint = continuation.lastIndexOf(".", settings.maxChars);
            if (cutPoint > settings.maxChars / 2) {
                continuation = continuation.substring(0, cutPoint + 1);
            } else {
                continuation = continuation.substring(0, settings.maxChars);
            }
        }
        
        console.log("[Impersonation] Generated:", continuation);
        return continuation;
        
    } catch (error) {
        console.error("[Impersonation] Generation failed:", error);
        toastr.error("Failed to generate continuation: " + error.message, "Impersonation");
        return null;
    }
}

// ============================================
// Direct API Call
// ============================================

async function callCustomAPI(prompt) {
    const settings = getSettings();
    
    const response = await fetch(settings.apiEndpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${settings.apiKey}`,
            "Accept-Language": "en-US,en"
        },
        body: JSON.stringify({
            model: settings.apiModel,
            messages: [
                { role: "user", content: prompt }
            ],
            temperature: 0.8,
            max_tokens: 500,
            stream: false
        })
    });
    
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error ${response.status}: ${errorText}`);
    }
    
    const data = await response.json();
    
    // OpenAI-compatible response format
    if (data.choices && data.choices[0]?.message?.content) {
        return data.choices[0].message.content;
    }
    
    throw new Error("Unexpected API response format");
}

// ============================================
// UI Components
// ============================================

function createWandButton() {
    const button = $(`
        <button id="impersonation-wand" type="button" title="Generate continuation">
            🪄
        </button>
    `);
    
    button.on("click", async (e) => {
        e.preventDefault();
        
        if (isGenerating) {
            console.log("[Impersonation] Already generating, ignoring click");
            return;
        }
        
        // Set loading state
        isGenerating = true;
        button.addClass("loading");
        
        try {
            const continuation = await generateContinuation();
            
            if (continuation) {
                // Get current input
                const currentInput = $("#send_textarea").val() || "";
                
                // Add space if needed
                let separator = "";
                if (currentInput && !currentInput.endsWith(" ") && !currentInput.endsWith("\n")) {
                    separator = " ";
                }
                
                // Append to input box
                $("#send_textarea").val(currentInput + separator + continuation);
                
                // Trigger input event for any listeners
                $("#send_textarea").trigger("input");
            }
        } finally {
            // Reset loading state
            isGenerating = false;
            button.removeClass("loading");
        }
    });
    
    return button;
}

function injectWandButton() {
    // Check if already injected
    if ($("#impersonation-wand").length > 0) {
        console.log("[Impersonation] Button already exists");
        return;
    }
    
    // Find the send button container
    const sendButton = $("#send_but");
    
    if (sendButton.length === 0) {
        console.error("[Impersonation] Send button not found");
        return;
    }
    
    // Create and inject wand button
    const wandButton = createWandButton();
    wandButton.insertBefore(sendButton);
    
    console.log("[Impersonation] Wand button injected");
}

function injectSettingsPanel() {
    // Check if already injected
    if ($("#impersonation-settings").length > 0) {
        return;
    }
    
    const settings = getSettings();
    
    const html = `
    <div id="impersonation-settings" class="impersonation-settings-panel">
        <div class="impersonation-settings-header">
            <h3>Impersonation Settings</h3>
        </div>
        <div class="impersonation-settings-body">
            <div class="impersonation-setting">
                <label for="impersonation-enabled">
                    <input type="checkbox" id="impersonation-enabled" />
                    Enable Extension
                </label>
            </div>
            
            <div class="impersonation-setting">
                <label for="impersonation-api-endpoint">API Endpoint</label>
                <input type="text" id="impersonation-api-endpoint" class="text_pole wide100p" 
                       placeholder="https://api.z.ai/api/coding/paas/v4/chat/completions" />
            </div>
            
            <div class="impersonation-setting">
                <label for="impersonation-api-key">API Key</label>
                <input type="password" id="impersonation-api-key" class="text_pole wide100p" 
                       placeholder="Your API key" />
            </div>
            
            <div class="impersonation-setting">
                <label for="impersonation-api-model">Model</label>
                <input type="text" id="impersonation-api-model" class="text_pole wide100p" 
                       placeholder="glm-5" />
            </div>
            
            <div class="impersonation-setting">
                <label for="impersonation-max-chars">Max Characters</label>
                <input type="number" id="impersonation-max-chars" class="text_pole" 
                       min="50" max="500" value="150" />
            </div>
        </div>
    </div>
    `;
    
    // Find extension settings container
    const container = $("#extensions_settings");
    if (container.length === 0) {
        console.error("[Impersonation] Settings container not found");
        return;
    }
    
    container.append(html);
    
    // Load current values
    $("#impersonation-enabled").prop("checked", settings.enabled);
    $("#impersonation-api-endpoint").val(settings.apiEndpoint);
    $("#impersonation-api-key").val(settings.apiKey);
    $("#impersonation-api-model").val(settings.apiModel);
    $("#impersonation-max-chars").val(settings.maxChars);
    
    // Bind save handlers
    $("#impersonation-enabled").on("change", saveSettings);
    $("#impersonation-api-endpoint").on("input", saveSettings);
    $("#impersonation-api-key").on("input", saveSettings);
    $("#impersonation-api-model").on("input", saveSettings);
    $("#impersonation-max-chars").on("input", saveSettings);
    
    console.log("[Impersonation] Settings panel injected");
}

// ============================================
// Initialization
// ============================================

jQuery(async () => {
    console.log("[Impersonation] Loading extension...");
    
    // Load settings
    await loadSettings();
    
    // Inject UI
    injectWandButton();
    injectSettingsPanel();
});
