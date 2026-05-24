import { Provider } from "../config/provider.js";

/**
 * Anthropic (Claude) API provider
 *
 * Uses Messages API to send chat requests and return streaming responses.
 * https://docs.anthropic.com/en/api/messages
 */
export class AnthropicProvider extends Provider {
  constructor(config) {
    super(config);
    this.baseUrl = config.baseUrl || "https://api.anthropic.com";
    this.apiKey = config.apiKey;
    this.anthropicVersion = "2023-06-01";
  }

  async *chat(messages, options = {}) {
    const model = options.model || this.defaultModel;
    const maxTokens = options.maxTokens || 4096;
    const tools = options.tools || [];

    const body = {
      model,
      max_tokens: maxTokens,
      messages: this._convertMessages(messages),
      stream: true,
    };

    if (tools.length > 0) {
      body.tools = tools;
    }

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": this.anthropicVersion,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${errBody}`);
    }

    // Stream SSE parsing
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") return;
          try {
            const parsed = JSON.parse(data);

            switch (parsed.type) {
              case "content_block_start":
                if (parsed.content_block?.type === "tool_use") {
                  yield {
                    type: "tool_use_start",
                    tool: parsed.content_block.name,
                    id: parsed.content_block.id,
                  };
                }
                break;

              case "content_block_delta":
                if (parsed.delta?.type === "text_delta") {
                  yield { type: "text", content: parsed.delta.text };
                }
                if (parsed.delta?.type === "input_json_delta") {
                  yield { type: "tool_input", partial: parsed.delta.partial_json };
                }
                break;

              case "content_block_stop":
                yield { type: "content_block_stop" };
                break;

              case "message_stop":
                yield { type: "message_stop" };
                return;

              case "error":
                throw new Error(`Anthropic streaming error: ${JSON.stringify(parsed.error)}`);
            }
          } catch (e) {
            if (e.message.includes("Anthropic")) throw e;
            // skip parse errors for incomplete chunks
          }
        }
      }
    }
  }

  _convertMessages(messages) {
    return messages.map(m => {
      if (m.role === "system") {
        return { role: "user", content: m.content };
      }
      if (m.role === "tool" || m.role === "function") {
        return { role: "user", content: `Tool result: ${m.content}` };
      }
      return { role: m.role, content: m.content };
    });
  }
}
