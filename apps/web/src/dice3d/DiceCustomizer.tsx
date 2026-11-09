import { useState } from 'react';
import { Icon } from '../components/Icon';
import { DEFAULT_APPEARANCE, DICE_PRESETS, paletteFor, setDiceAppearance, useDiceAppearance } from './appearance';
import { previewDice } from './tray';
import './customizer.css';

export function DiceCustomizer({ ready }: { ready: boolean }) {
  const appearance = useDiceAppearance();
  const [previewing,setPreviewing] = useState(false);
  const [error,setError] = useState('');
  return <details className="dice-customizer">
    <summary><Icon name="palette" /><strong>Dice style</strong><span>{DICE_PRESETS.find(p=>p.id===appearance.preset)?.name}</span><Icon name="chevron" /></summary>
    <div className="dice-customizer-body">
      <div className="dice-preset-grid" role="group" aria-label="Dice color sets">
        {DICE_PRESETS.map(preset=><button type="button" key={preset.id} aria-pressed={appearance.preset===preset.id} onClick={()=>setDiceAppearance({...appearance,preset:preset.id,colors:{}})}>
          <span className="dice-preset-swatches" aria-hidden="true">{preset.colors.map(color=><i key={color} style={{background:color}} />)}</span><span>{preset.name}</span>{appearance.preset===preset.id && <Icon name="check" />}
        </button>)}
      </div>
      <label className="dice-finish-label">Finish<select aria-label="Dice finish" value={appearance.finish} onChange={event=>setDiceAppearance({...appearance,finish:event.target.value as typeof appearance.finish})}><option value="matte">Matte</option><option value="polished">Polished</option><option value="metal">Metal</option></select></label>
      <fieldset className="dice-effects"><legend>Effect</legend><div>{(['none','glow','sparks'] as const).map(effect=><button type="button" key={effect} aria-pressed={appearance.effect===effect} onClick={()=>setDiceAppearance({...appearance,effect})}>{effect==='none'?'None':effect==='glow'?'Glow':'Sparks'}</button>)}</div></fieldset>
      <details className="dice-custom-colors"><summary>Custom colors<Icon name="chevron" /></summary><div>{(['hope','fear','neutral'] as const).map(role=><label key={role}><span>{role==='neutral'?'Other dice':role==='hope'?'Hope':'Fear'}</span><input type="color" aria-label={`${role==='neutral'?'Other':role==='hope'?'Hope':'Fear'} dice color`} value={paletteFor(role,appearance).body} onChange={event=>setDiceAppearance({...appearance,colors:{...appearance.colors,[role]:event.target.value}})} /></label>)}</div></details>
      <div className="dice-style-actions"><button type="button" disabled={!ready||previewing} onClick={async()=>{setPreviewing(true);setError('');try{await previewDice();}catch{setError('Could not preview dice.');}finally{setPreviewing(false);}}}><Icon name="dice" />{previewing?'Previewing…':'Preview set'}</button><button type="button" className="dice-style-reset" onClick={()=>setDiceAppearance({...DEFAULT_APPEARANCE,colors:{}})}>Reset</button></div>
      <p className="dice-style-note">Saved on this device. Previews don’t count as rolls.</p>{error && <p role="alert">{error}</p>}
    </div>
  </details>;
}
