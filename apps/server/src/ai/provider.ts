import type { AiModel, AiProvider } from '@daggery/shared';

export interface ToolDefinition { name: string; description: string; parameters: Record<string, unknown> }
export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export interface ModelMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string; reasoning_content?: string }
export interface Completion { message: ModelMessage; cost: number }
export interface CompletionOptions { temperature?: number; maxTokens?: number }
export const PROVIDERS = {
  'opencode-go': { name: 'OpenCode Go', models: 'https://opencode.ai/inference/go/v1/models', chat: 'https://opencode.ai/inference/go/openai/v1/chat/completions' },
  opencode: { name: 'OpenCode Console · pay as you go', models: 'https://opencode.ai/inference/v1/models', chat: 'https://opencode.ai/inference/openai/v1/chat/completions' },
  openrouter: { name: 'OpenRouter', models: 'https://openrouter.ai/api/v1/models', chat: 'https://openrouter.ai/api/v1/chat/completions' },
} as const;
export class ProviderError extends Error {}

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
      const contextWindow = positiveNumber(isOpenCode(provider) ? item.limit?.context : item.context_length);
      const temperature = isOpenCode(provider) ? item.capabilities?.temperature === true : Array.isArray(item.supported_parameters) && item.supported_parameters.includes('temperature');
      return { id: String(item.id), name: String(item.name ?? item.id), ...(contextWindow > 0 ? { contextWindow } : {}), temperature };
    });
    if (!models.length) throw new ProviderError('No tool-capable models are available from this provider.');
    return models.sort((a, b) => a.name.localeCompare(b.name));
  }
  async complete(provider: AiProvider, key: string, model: string, messages: ModelMessage[], tools: ToolDefinition[], signal: AbortSignal, session: string, options: CompletionOptions = {}): Promise<Completion> {
    const body: Record<string, unknown> = { model, messages, max_tokens: options.maxTokens ?? 2400, stream: false };
    if (tools.length) Object.assign(body, { tools: tools.map(tool => ({ type: 'function', function: tool })), tool_choice: 'auto', parallel_tool_calls: false });
    if (options.temperature !== undefined) body.temperature = options.temperature;
    let response: Response;
    try {
      response = await this.fetcher(PROVIDERS[provider].chat, {
        method: 'POST', redirect: 'error', signal,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key, 'User-Agent': 'Daggery-AI-GM/1.0', 'x-opencode-session': session },
        body: JSON.stringify(body),
      });
    } catch (error) { if (signal.aborted) throw error; throw new ProviderError('Could not reach your AI provider. Check the server connection and try again.'); }
    if (!response.ok) {
      if (response.status === 401) throw new ProviderError('The provider rejected this API key. Replace it in GM connection.');
      if (response.status === 402) throw new ProviderError(provider === 'opencode-go' ? 'OpenCode Go could not cover this request. Check your active Go subscription and model allowance in the OpenCode Console, or select another Go model. Daggery did not switch to pay-as-you-go billing.' : provider === 'opencode' ? 'The OpenCode pay-as-you-go balance is insufficient. If you have a Go subscription, select OpenCode Go in GM connection and retry.' : 'Your provider balance is insufficient. Add credits or choose another model.');
      if (response.status === 403) throw new ProviderError(provider === 'opencode-go' ? 'OpenCode Go denied this request. Check your subscription, model privacy settings and Go client-use restrictions. Daggery identifies itself as Daggery; GM use may not be accepted by Go.' : 'This key or model is not available to Daggery. Use a Console inference key with model-request permission and an externally accessible model.');
      if (response.status === 429) throw new ProviderError('Your provider’s usage limit was reached. Wait before trying again.');
      if (response.status === 400 || response.status === 404) throw new ProviderError('The selected model rejected this request. Choose another tool-capable model in GM connection.');
      throw new ProviderError('Your AI provider is temporarily unavailable (' + response.status + ').');
    }
    const payload = await response.text();
    if (payload.length > 2000000) throw new ProviderError('The provider response was too large. Choose another model.');
    let data: any;
    try { data = JSON.parse(payload); } catch { throw new ProviderError('The provider returned an unreadable response.'); }
    const message = data.choices?.[0]?.message;
    if (!message || message.role !== 'assistant' || message.content !== null && message.content !== undefined && typeof message.content !== 'string') throw new ProviderError('The model returned an unsupported response.');
    const calls = message.tool_calls as ToolCall[] | undefined;
    if (calls && (!Array.isArray(calls) || calls.length > 12 || calls.some(call => typeof call.id !== 'string' || call.id.length > 200 || call.type !== 'function' || typeof call.function?.name !== 'string' || typeof call.function?.arguments !== 'string' || call.function.arguments.length > 32000))) throw new ProviderError('The model returned invalid tool requests.');
    return { message: { role: 'assistant', content: message.content ?? null, ...(calls?.length ? { tool_calls: calls } : {}), ...(typeof message.reasoning_content === 'string' ? { reasoning_content: message.reasoning_content } : {}) }, cost: Number.isFinite(data.usage?.cost) ? Math.max(0, data.usage.cost) : 0 };
  }
}
