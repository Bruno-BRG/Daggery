import { useState, type FormEvent } from 'react';
import { GAME_SYSTEMS, normalizeConfiguration, type CampaignConfiguration } from '@daggery/shared';
import { Dialog } from './components/Dialog';
import { api } from './api';
import type { ActiveCampaign } from './campaign-context';
import './campaignConfiguration.css';
import { getSystemUI } from './modules';

/** Every new campaign is solo: Daggerheart with the Duality GME oracles. */
export const SOLO_CONFIGURATION: CampaignConfiguration = normalizeConfiguration({ systemId: 'daggerheart', rulesetId: 'solo' });

/** "Lone hero", "Hero + companion" or "Small party". */
export function partyLabel(configuration: CampaignConfiguration): string {
  const mode = configuration.options.partyMode;
  return mode === 'party' ? 'Small party' : mode === 'companion' ? 'Hero + companion' : 'Lone hero';
}

/** Who you play and how the world answers. No systems or rulesets to pick: it is always solo. */
export function ConfigurationFields({ value, onChange }: { value: CampaignConfiguration; onChange: (value: CampaignConfiguration) => void }) {
  const system = GAME_SYSTEMS.find(system => system.id === value.systemId);
  const Options = getSystemUI(value)?.optionsEditor;
  return <fieldset className="campaign-config-fields"><legend>Your game</legend>
    {Options && <Options value={value} onChange={onChange} />}
    {system?.supportsAiGm && <label>The world answers through<select aria-label="The world answers through" value={value.gmController ?? 'human'} onChange={event => onChange(normalizeConfiguration({ ...value, gmController: event.target.value }))}><option value="human">Oracles (Duality GME)</option><option value="ai">An AI Game Master · needs your API key</option></select></label>}
  </fieldset>;
}

export function CampaignSettings({ campaign, onClose, onSaved }: { campaign: ActiveCampaign & { description?: string; archivedAt?: string | null }; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(campaign.name);
  const [description, setDescription] = useState(campaign.description ?? '');
  const [configuration, setConfiguration] = useState(campaign.configuration ?? SOLO_CONFIGURATION);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError('');
    try {
      await api(`/api/campaigns/${encodeURIComponent(campaign.id)}`, 'PATCH', { name, description, configuration, archived: !!campaign.archivedAt });
      onSaved();
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not save settings.'); }
    finally { setSaving(false); }
  }
  return <Dialog open onClose={onClose} title="Campaign settings"><form className="campaign-settings-form" onSubmit={save}>
    <label>Campaign name<input required maxLength={100} value={name} onChange={event => setName(event.target.value)} /></label>
    <label>Description<textarea rows={3} maxLength={2000} value={description} onChange={event => setDescription(event.target.value)} /></label>
    <ConfigurationFields value={configuration} onChange={setConfiguration} />
    {error && <p role="alert">{error}</p>}
    <button className="daggery-primary" disabled={saving}>{saving ? 'Saving…' : 'Save campaign'}</button>
  </form></Dialog>;
}
