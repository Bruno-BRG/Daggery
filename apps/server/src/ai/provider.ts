import type { AiModel, AiProvider } from '@daggery/shared';

export interface ToolDefinition { name: string; description: string; parameters: Record<string, unknown> }
export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export interface ModelMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string; reasoning_content?: string }
export interface Completion { message: ModelMessage; cost: number }
export interface CompletionOptions {
  temperature?: number;
  maxTokens?: number;
  /** When set, ask the provider to stream and call this with each narration delta. Tool arguments are never passed here. */
  onDelta?: (delta: string) => void;
}
export const PROVIDERS = {
  'opencode-go': { name: 'OpenCode Go', models: 'https://opencode.ai/inference/go/v1/models', chat: 'https://opencode.ai/inference/go/openai/v1/chat/completions' },
  opencode: { name: 'OpenCode Console · pay as you go', models: 'https://opencode.ai/inference/v1/models', chat: 'https://opencode.ai/inference/openai/v1/chat/completions' },
  openrouter: { name: 'OpenRouter', models: 'https://openrouter.ai/api/v1/models', chat: 'https://openrouter.ai/api/v1/chat/completions' },
} as const;
export class ProviderError extends Error {}

/** DeepSeek reasoning models run at the top effort their catalog offers. */
export const DEEPSEEK_REASONING_EFFORT = 'max';
/** The DeepSeek V4 family advertises a 1M-token context; use it when the catalog is silent or lower. */
export const DEEPSEEK_CONTEXT_WINDOW = 1_000_000;
/** GM turns on a reasoning model: reasoning tokens count toward this, so leave real room for narration and tool calls. */
export const DEEPSEEK_MAX_TOKENS = 32000;
const DEFAULT_MAX_TOKENS = 2400;
/** Streaming and non-streaming replies share this cap so a runaway provider cannot exhaust memory. */
const MAX_RESPONSE_CHARS = 2000000;
/** A streamed tool call, merged from its index-keyed deltas before validation. */
interface StreamedCall { id: string; name: string; arguments: string }

export function isDeepSeekModel(model: string): boolean {
  return model.toLowerCase().includes('deepseek');
}

export function isDeepSeekV4Model(model: string): boolean {
  return /deepseek[-_.]?v4/i.test(model);
}

/** The context window used for memory budgeting. DeepSeek V4 is budgeted at 1M even if a catalog omits or lowers it. */
export function effectiveContextWindow(model: string, contextWindow: number): number {
  if (isDeepSeekV4Model(model) && contextWindow < DEEPSEEK_CONTEXT_WINDOW) return DEEPSEEK_CONTEXT_WINDOW;
  return contextWindow;
}

function isOpenCode(provider: AiProvider): boolean { return provider === 'opencode' || provider === 'opencode-go'; }
function positiveNumber(value: unknown): number { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : 0; }

export class ModelProvider {
  constructor(private fetcher: typeof fetch = fetch) {}
  async models(provider: AiProvider): Promise<AiModel[]> {
    const response = await this.fetcher(PROVIDERS[provider].models, { signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (!response.ok) throw new ProviderError('Could not load the provider’s model catalog. Try again shortly.');
    const data = await response.json() as { data?: Array<Record<string, any>> };
    const models = (data.data ?? []).filter(item => {
      if (isOpenCode(provider)) return item.type === 'chat' && item.capabilities?.tools?.supported && (provider === 'opencode-go' || Number(item.cost?.text?.input?.price ?? 0) > 0);
      return Array.isArray(item.supported_parameters) && item.supported_parameters.includes('tools');
    }).map((item): AiModel => {
      const contextWindow = effectiveContextWindow(String(item.id), positiveNumber(isOpenCode(provider) ? item.limit?.context : item.context_length));
      const temperature = isOpenCode(provider) ? item.capabilities?.temperature === true : Array.isArray(item.supported_parameters) && item.supported_parameters.includes('temperature');
      return { id: String(item.id), name: String(item.name ?? item.id), ...(contextWindow > 0 ? { contextWindow } : {}), temperature };
    });
    if (!models.length) throw new ProviderError('No tool-capable models are available from this provider.');
    return models.sort((a, b) => a.name.localeCompare(b.name));
  }
  private requestBody(model: string, messages: ModelMessage[], tools: ToolDefinition[], options: CompletionOptions, stream: boolean): Record<string, unknown> {
    const reasoning = isDeepSeekModel(model);
    const body: Record<string, unknown> = { model, messages, max_tokens: options.maxTokens ?? (reasoning ? DEEPSEEK_MAX_TOKENS : DEFAULT_MAX_TOKENS), stream };
    if (reasoning) body.reasoning_effort = DEEPSEEK_REASONING_EFFORT;
    if (tools.length) Object.assign(body, { tools: tools.map(tool => ({ type: 'function', function: tool })), tool_choice: 'auto', parallel_tool_calls: false });
    if (options.temperature !== undefined) body.temperature = options.temperature;
    // Ask OpenAI-compatible providers to report usage in the final streamed chunk, so turn cost stays tracked.
    if (stream) body.stream_options = { include_usage: true };
    return body;
  }

  private async send(provider: AiProvider, key: string, body: Record<string, unknown>, signal: AbortSignal, session: string): Promise<Response> {
    try {
      return await this.fetcher(PROVIDERS[provider].chat, {
        method: 'POST', redirect: 'error', signal,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key, 'User-Agent': 'Daggery-AI-GM/1.0', 'x-opencode-session': session },
        body: JSON.stringify(body),
      });
    } catch (error) { if (signal.aborted) throw error; throw new ProviderError('Could not reach your AI provider. Check the server connection and try again.'); }
  }

  private assertOk(provider: AiProvider, response: Response): void {
    if (response.ok) return;
    if (response.status === 401) throw new ProviderError('The provider rejected this API key. Replace it in GM connection.');
    if (response.status === 402) throw new ProviderError(provider === 'opencode-go' ? 'OpenCode Go could not cover this request. Check your active Go subscription and model allowance in the OpenCode Console, or select another Go model. Daggery did not switch to pay-as-you-go billing.' : provider === 'opencode' ? 'The OpenCode pay-as-you-go balance is insufficient. If you have a Go subscription, select OpenCode Go in GM connection and retry.' : 'Your provider balance is insufficient. Add credits or choose another model.');
    if (response.status === 403) throw new ProviderError(provider === 'opencode-go' ? 'OpenCode Go denied this request. Check your subscription, model privacy settings and Go client-use restrictions. Daggery identifies itself as Daggery; GM use may not be accepted by Go.' : 'This key or model is not available to Daggery. Use a Console inference key with model-request permission and an externally accessible model.');
    if (response.status === 429) throw new ProviderError('Your provider’s usage limit was reached. Wait before trying again.');
    if (response.status === 400 || response.status === 404) throw new ProviderError('The selected model rejected this request. Choose another tool-capable model in GM connection.');
    throw new ProviderError('Your AI provider is temporarily unavailable (' + response.status + ').');
  }

  /** Reads and validates a non-streaming JSON completion. */
  private async readJson(provider: AiProvider, response: Response): Promise<Completion> {
    this.assertOk(provider, response);
    const payload = await response.text();
    if (payload.length > MAX_RESPONSE_CHARS) throw new ProviderError('The provider response was too large. Choose another model.');
    let data: any;
    try { data = JSON.parse(payload); } catch { throw new ProviderError('The provider returned an unreadable response.'); }
    const message = data.choices?.[0]?.message;
    if (!message || message.role !== 'assistant' || message.content !== null && message.content !== undefined && typeof message.content !== 'string') throw new ProviderError('The model returned an unsupported response.');
    const calls = message.tool_calls as ToolCall[] | undefined;
    if (calls && (!Array.isArray(calls) || calls.length > 12 || calls.some(call => typeof call.id !== 'string' || call.id.length > 200 || call.type !== 'function' || typeof call.function?.name !== 'string' || typeof call.function?.arguments !== 'string' || call.function.arguments.length > 32000))) throw new ProviderError('The model returned invalid tool requests.');
    return { message: { role: 'assistant', content: message.content ?? null, ...(calls?.length ? { tool_calls: calls } : {}), ...(typeof message.reasoning_content === 'string' ? { reasoning_content: message.reasoning_content } : {}) }, cost: Number.isFinite(data.usage?.cost) ? Math.max(0, data.usage.cost) : 0 };
  }

  /**
   * Parses an SSE chat completion stream into the same Completion shape as the JSON path: content and
   * reasoning deltas are concatenated, and index-keyed tool-call chunks are merged. Only content is
   * handed to onDelta, because tool arguments can carry GM-only secrets. Malformed data lines are
   * skipped so one bad frame does not lose the rest of the reply.
   */
  private async readStream(response: Response, onDelta: (delta: string) => void): Promise<Completion> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const calls = new Map<number, StreamedCall>();
    let buffer = '', content = '', reasoning = '', size = 0, finished = false;
    let usage: any = undefined;
    const handle = (line: string): boolean => {
      if (!line.startsWith('data:')) return false;
      const data = line.slice(5).trim();
      if (!data) return false;
      if (data === '[DONE]') return true;
      let event: any;
      try { event = JSON.parse(data); } catch { return false; }
      if (event.usage && typeof event.usage === 'object') usage = event.usage;
      const delta = event.choices?.[0]?.delta;
      if (!delta) return false;
      if (typeof delta.content === 'string' && delta.content) { content += delta.content; onDelta(delta.content); }
      const thought = typeof delta.reasoning_content === 'string' ? delta.reasoning_content : typeof delta.reasoning === 'string' ? delta.reasoning : '';
      if (thought) reasoning += thought;
      if (Array.isArray(delta.tool_calls)) for (const part of delta.tool_calls) {
        if (!part || typeof part !== 'object') continue;
        const index = typeof part.index === 'number' ? part.index : 0;
        const current = calls.get(index) ?? { id: '', name: '', arguments: '' };
        if (typeof part.id === 'string' && part.id) current.id = part.id;
        if (typeof part.function?.name === 'string') current.name += part.function.name;
        if (typeof part.function?.arguments === 'string') current.arguments += part.function.arguments;
        calls.set(index, current);
      }
      return false;
    };
    try {
      while (!finished) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_RESPONSE_CHARS) throw new ProviderError('The provider response was too large. Choose another model.');
        buffer += decoder.decode(chunk.value, { stream: true });
        let newline = buffer.indexOf('\n');
        while (newline >= 0) {
          const line = buffer.slice(0, newline).replace(/\r$/, '');
          buffer = buffer.slice(newline + 1);
          if (handle(line)) { finished = true; break; }
          newline = buffer.indexOf('\n');
        }
      }
      if (!finished && buffer.trim()) handle(buffer.replace(/\r$/, ''));
    } finally {
      reader.releaseLock();
    }
    const toolCalls = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, call]) => ({ id: call.id, type: 'function' as const, function: { name: call.name, arguments: call.arguments } }));
    if (toolCalls.length > 12 || toolCalls.some(call => !call.id || call.id.length > 200 || !call.function.name || call.function.arguments.length > 32000)) throw new ProviderError('The model returned invalid tool requests.');
    return { message: { role: 'assistant', content: content || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}), ...(reasoning ? { reasoning_content: reasoning } : {}) }, cost: Number.isFinite(usage?.cost) ? Math.max(0, usage.cost) : 0 };
  }

  async complete(provider: AiProvider, key: string, model: string, messages: ModelMessage[], tools: ToolDefinition[], signal: AbortSignal, session: string, options: CompletionOptions = {}): Promise<Completion> {
    if (!options.onDelta) {
      const response = await this.send(provider, key, this.requestBody(model, messages, tools, options, false), signal, session);
      return this.readJson(provider, response);
    }
    const response = await this.send(provider, key, this.requestBody(model, messages, tools, options, true), signal, session);
    if (response.ok) {
      const type = response.headers.get('content-type') ?? '';
      if (type.includes('text/event-stream') && response.body) return this.readStream(response, options.onDelta);
      // The provider ignored the stream flag and answered with JSON, which is still a valid reply.
      return this.readJson(provider, response);
    }
    // Some providers reject the streaming request shape. Retry once without streaming so the turn still completes.
    if (response.status === 400 || response.status === 404 || response.status === 422) {
      const fallback = await this.send(provider, key, this.requestBody(model, messages, tools, options, false), signal, session);
      return this.readJson(provider, fallback);
    }
    this.assertOk(provider, response);
    throw new ProviderError('Your AI provider is temporarily unavailable (' + response.status + ').');
  }
}
