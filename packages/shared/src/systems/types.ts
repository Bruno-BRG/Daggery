export interface CampaignConfiguration {
  systemId: string;
  rulesetId: string;
  options: Record<string, unknown>;
  gmController?: 'ai';
}
export interface DocumentPolicy {
  namespace: string;
  read: 'members' | 'gm';
  write: 'members' | 'gm' | 'server';
  publicIds?: readonly string[];
  realtimeIds?: readonly string[];
  protectedIds?: readonly string[];
}
export interface RulesetDefinition {
  id: string;
  name: string;
  description: string;
  mode: 'group' | 'solo';
  version: string;
  features: readonly string[];
  documents: readonly DocumentPolicy[];
  initialDocuments?: (options: Record<string, unknown>) => { ns: string; id: string; value: object }[];
  normalizeOptions: (value: Record<string, unknown>) => Record<string, unknown>;
}
export interface GameSystemDefinition {
  id: string; name: string; rulesets: readonly RulesetDefinition[];
  supportsAiGm?: boolean;
  configurationChanged?: (context: {
    before: CampaignConfiguration; after: CampaignConfiguration;
    readDocument: (namespace: string, id: string) => unknown;
    newId: () => string;
  }) => { ns: string; id: string; value: object }[];
}
