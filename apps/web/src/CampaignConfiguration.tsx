import { useState, type FormEvent } from 'react';
import { DEFAULT_CONFIGURATION, GAME_SYSTEMS, getRuleset, normalizeConfiguration, type CampaignConfiguration } from '@daggery/shared';
import { Dialog } from './components/Dialog';
import { api } from './api';
import type { ActiveCampaign } from './campaign-context';
import './campaignConfiguration.css';
import { getSystemUI } from './modules';

export function ConfigurationFields({ value, onChange, lockSystem = false }: { value: CampaignConfiguration; onChange: (value: CampaignConfiguration) => void; lockSystem?: boolean }) {
  const system = GAME_SYSTEMS.find(system => system.id === value.systemId);
  const ruleset = getRuleset(value);
  const Options = getSystemUI(value)?.optionsEditor;
  return <fieldset className="campaign-config-fields"><legend>How will you play?</legend>
    <label>Game system<select aria-label="Game system" disabled={lockSystem} value={value.systemId} onChange={event => {
      const next = GAME_SYSTEMS.find(system => system.id === event.target.value)!;
      onChange(normalizeConfiguration({ systemId: next.id, rulesetId: next.rulesets[0]!.id }));
    }}>{GAME_SYSTEMS.map(system => <option value={system.id} key={system.id}>{system.name}</option>)}</select></label>
    <label>Ruleset<select aria-label="Ruleset" value={value.rulesetId} onChange={event => onChange(normalizeConfiguration({ systemId: value.systemId, rulesetId: event.target.value, gmController: value.gmController }))}>{system?.rulesets.map(ruleset => <option value={ruleset.id} key={ruleset.id}>{ruleset.name}</option>)}</select></label>
    <p>{ruleset?.description ?? 'This system is unavailable.'}</p>
    {Options && <Options value={value} onChange={onChange} />}
    {system?.supportsAiGm && <label>Game Master<select aria-label="Game Master" value={value.gmController ?? 'human'} onChange={event => onChange(normalizeConfiguration({ ...value, gmController: event.target.value }))}><option value="human">Human GM / solo oracles</option><option value="ai">AI Game Master · connect your API key</option></select></label>}
  </fieldset>;
}

export function CampaignSettings({ campaign, onClose, onSaved }: { campaign: ActiveCampaign & { description?: string; archivedAt?: string | null }; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(campaign.name);
  const [description, setDescription] = useState(campaign.description ?? '');
  const [configuration, setConfiguration] = useState(campaign.configuration ?? DEFAULT_CONFIGURATION);
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
    <ConfigurationFields value={configuration} onChange={setConfiguration} lockSystem />
    <p className="text-sm text-slate-400">Changing game systems requires a new campaign. Solo mode requires a campaign with no other members. Your existing campaign documents are retained when changing rulesets.</p>
    {error && <p role="alert">{error}</p>}
    <button className="daggery-primary" disabled={saving}>{saving ? 'Saving…' : 'Save campaign'}</button>
  </form></Dialog>;
}
