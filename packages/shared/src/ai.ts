export type AiProvider = 'opencode-go' | 'opencode' | 'openrouter';
export const isOpenCodeProvider = (provider: AiProvider): boolean => provider === 'opencode' || provider === 'opencode-go';
export const canReuseAiKey = (from: AiProvider, to: AiProvider): boolean => from === to || isOpenCodeProvider(from) && isOpenCodeProvider(to);
export interface AiModel { id: string; name: string; contextWindow?: number; temperature?: boolean }
/** contextWindow is the model's context window from the catalog, or 0 when unknown. */
export interface AiConnection { provider: AiProvider; model: string; keyHint: string; contextWindow: number }
export type AiBudget = 'lean' | 'balanced' | 'rich' | 'maximum';
/** Estimated tokens for memory plus recent messages in the fixed tiers. Maximum depends on the model's context window. The static prompt and tool schemas are counted separately. */
export const AI_BUDGET_TOKENS: Record<Exclude<AiBudget, 'maximum'>, number> = { lean: 12000, balanced: 24000, rich: 48000 };
export interface AiSetup { premise: string; tone: string; heroId: string; persona: string; /** Campaign frame ID, or '' for a custom world. */ frame: string }
/** A campaign frame the GM can run from an installed sourcebook. */
export interface AiFrame { id: string; title: string; summary: string }
export interface AiInteraction {
  kind: 'roll' | 'damage' | 'choices'; resolved: boolean; heroId?: string;
  trait?: string; difficulty?: number; enemyId?: string; damage?: number; direct?: boolean; choices?: string[];
}
export interface AiMessage { id: string; role: 'player' | 'gm' | 'roll' | 'notice'; text: string; at: string; interaction?: AiInteraction }
export interface AiAction { id: string; tool: string; label: string; result: unknown; at: string }
export type AiTurnKind = 'turn' | 'compact' | 'end' | 'pause';
export type AiRunStatus = 'running' | 'complete' | 'failed' | 'cancelled';
export interface AiRun { id: string; kind: AiTurnKind; chatId: string; status: AiRunStatus; error: string; steps: number; cost: number; at: string }
export type AiChatStatus = 'open' | 'paused' | 'ended';
export interface AiChat { id: string; ordinal: number; title: string; status: AiChatStatus; messageCount: number; updatedAt: string; endedAt: string | null }
export type AiJournalKind = 'event' | 'note' | 'chapter';
export interface AiJournalEntry {
  id: string; kind: AiJournalKind; title: string; body: string; visibility: 'shared' | 'gm';
  chatId: string | null; chatLabel: string; author: 'engine' | 'gm' | 'owner';
  createdAt: string; updatedAt: string;
  /** True for owner-editable entries (notes and chapters). Events are read only. */
  editable: boolean;
}
export interface AiJournalPage { entries: AiJournalEntry[]; nextCursor: string | null }
export interface AiThread { id: string; title: string; status: 'open' | 'stalled' | 'resolved'; note: string }
export interface AiNpc { id: string; name: string; role: string; attitude: string; lastSeen: string }
export interface AiState {
  location: string; timeOfDay: string; objective: string;
  threads: AiThread[]; npcs: AiNpc[]; promises: { id: string; text: string }[]; facts: string[];
}
export interface AiMemoryStatus { chapters: number; contextTokens: number; budgetTokens: number }
/**
 * Adventure page payload. Owner-only fields are empty strings or null for other members:
 * memory, digest, state, chatSummary, connection, actions.
 */
export interface AiAdventure {
  enabled: boolean; ready: boolean; connection: AiConnection | null;
  setup: AiSetup; budget: AiBudget;
  /** Campaign frames offered by the installed sourcebooks that this GM can run. */
  frames: AiFrame[];
  /** Estimated input tokens for each memory size with the owner's model. */
  budgets: Record<AiBudget, number>;
  memory: string; digest: string; state: AiState | null; chatSummary: string;
  chats: AiChat[];
  activeChatId: string | null;
  /** Messages of the active session, oldest first, most recent page only. */
  messages: AiMessage[];
  /** Pass as `before` with the same chat to load the page of older messages. */
  earlierCursor: string | null;
  memoryStatus: AiMemoryStatus;
  actions: AiAction[];
  run: AiRun | null;
  isGm: boolean;
}
