import { Provider } from "../config/provider.js";

/**
 * OpenAI API provider
 *
 * 使用 Chat Completions API，支持流式响应。
 * https://platform.openai.com/docs/api-reference/chat
 */
export class OpenAIProvider extends Provider {
  constructor(config) {
    super(config);
    this.baseUrl = config.baseUrl || "https://api.openai.com";
    this.apiKey = config.apiKey;
  }

  async *chat(messages, options = {}) {
    const model = options.model || this.defaultModel;
    const maxTokens = options.maxTokens || 4096;

    const body = {
      model,
      max_completion_tokens: maxTokens,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      stream: true,
    };

    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools;
    }

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${errBody}`);
    }

    // 流式解析 SSE
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    /** @type {Map<number, {name: string, args: string}>} */
    const toolCalls = new Map();

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
            const choice = parsed.choices?.[0];
            if (!choice) continue;

            const delta = choice.delta || {};

            // 文本内容
            if (delta.content) {
              yield { type: "text", content: delta.content };
            }

            // tool calls
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (!toolCalls.has(tc.index)) {
                  toolCalls.set(tc.index, { name: tc.function?.name || "", args: "" });
                }
                const entry = toolCalls.get(tc.index);
                if (tc.function?.name) entry.name = tc.function.name;
                if (tc.function?.arguments) entry.args += tc.function.arguments;
              }
            }

            // finish reason — 如果有 tool calls，yield 完整结果
            if (choice.finish_reason === "tool_calls") {
              for (const [index, tc] of toolCalls) {
                yield {
                  type: "tool_use",
                  tool: tc.name,
                  id: `call_${index}`,
                  input: tc.args,
                };
              }
              toolCalls.clear();
            }
          } catch {
            // skip parse errors
          }
        }
      }
    }
  }
}
