import { useMemo, useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { AbilityCard } from './AbilityCard';
import { ItemGlyph } from './ItemGlyph';
import { CUSTOM_ITEM_ICONS } from './inventoryIcons';
import { MAX_ARMOR_SCORE, armorScore, damageNotation, damageThresholds, evasion, getArmor, getWeapon, weaponModifier, weaponForSlot } from './rules';
import { EQUIPMENT_LABELS, inventoryEquipmentId, inventoryEquipmentSlot, secondaryBlocked, type EquipmentSlot } from './equipment';
import {
  CUSTOM_DAMAGE_DICE, CUSTOM_TIERS, CUSTOM_WEAPON_BURDENS, CUSTOM_WEAPON_CATEGORIES, CUSTOM_WEAPON_RANGES, CUSTOM_WEAPON_TRAITS,
  INVENTORY_CATALOG, INVENTORY_KIND_LABELS, customWeaponDamage, inventoryCatalogEntry,
  type InventoryAddition, type InventoryCatalogEntry,
} from './inventory';
import type { InventoryEntry, InventoryKind, Sheet } from './types';
import './equipment.css';

type CustomType = 'item' | 'weapon' | 'armor';
interface Choice { key:string; item:InventoryCatalogEntry; owned?:InventoryEntry }
interface PickerProps {
  sheet:Sheet; slot?:EquipmentSlot; initialKind?:InventoryKind|'all'; initialQuery?:string; onClose:()=>void;
  onEquip?:(inventoryEntryId:string)=>void; onAdd?:(addition:InventoryAddition)=>void; onAddItems?:(query:string)=>void;
}

/** The equipment mode is owned-only. Catalog browsing exists solely in the acquisition mode. */
export function EquipmentPicker({slot,sheet,initialKind='all',initialQuery='',onEquip,onAdd,onAddItems,onClose}:PickerProps) {
  const [selected,setSelected]=useState<string|null>(null);
  const [query,setQuery]=useState(initialQuery);
  const [kind,setKind]=useState<InventoryKind|'all'>(initialKind);
  const [tier,setTier]=useState('all');
  const [qty,setQty]=useState('1');
  const [customName,setCustomName]=useState('');
  const [customDescription,setCustomDescription]=useState('');
  const [customIcon,setCustomIcon]=useState('auto');
  const [customType,setCustomType]=useState<CustomType>(initialKind==='weapon'?'weapon':initialKind==='armor'?'armor':'item');
  const [trait,setTrait]=useState<string>('Agility');
  const [range,setRange]=useState<string>('Melee');
  const [category,setCategory]=useState<string>('Primary');
  const [damageCount,setDamageCount]=useState('1');
  const [damageDie,setDamageDie]=useState<string>('d8');
  const [damageBonus,setDamageBonus]=useState('0');
  const [damageType,setDamageType]=useState<'phy'|'mag'>('phy');
  const [burden,setBurden]=useState<string>('One-Handed');
  const [weaponTier,setWeaponTier]=useState('1');
  const [armorTier,setArmorTier]=useState('1');
  const [majorThreshold,setMajorThreshold]=useState('10');
  const [severeThreshold,setSevereThreshold]=useState('20');
  const [baseScore,setBaseScore]=useState('2');
  const [featureName,setFeatureName]=useState('');
  const [featureText,setFeatureText]=useState('');
  const [error,setError]=useState('');
  const custom=!slot&&kind==='custom';
  const currentId=slot==='armor'?sheet.armorId:sheet.weapons.find(weapon=>weapon.slot===slot)?.weaponId;
  const current=slot==='armor'?getArmor(currentId,sheet):getWeapon(currentId,sheet);
  const choices=useMemo<Choice[]>(()=>{
    if (slot) return sheet.inventory.flatMap(entry=>{
      if (entry.qty<=0||inventoryEquipmentSlot(entry)!==slot) return [];
      const item=inventoryCatalogEntry(entry);
      return item?[{key:entry.id,item,owned:entry}]:[];
    });
    return INVENTORY_CATALOG.map(item=>({key:item.kind+':'+item.id,item}));
  },[sheet.inventory,slot]);
  const results=choices.filter(({item})=>(!!slot||kind==='all'||item.kind===kind)&&(!!slot||tier==='all'||item.tier===undefined||item.tier===Number(tier))&&
    (item.name+' '+item.description+' '+(item.weapon?item.weapon.trait+' '+item.weapon.range+' '+item.weapon.burden:'')).toLowerCase().includes(query.toLowerCase()))
    .sort((a,b)=>(a.item.tier??0)-(b.item.tier??0)||a.item.name.localeCompare(b.item.name));
  const choice=choices.find(entry=>entry.key===selected);
  const picked=choice?.item, pickedWeapon=picked?.weapon, pickedArmor=picked?.armor;
  const previewSheet={...sheet,armorId:pickedArmor?.id??sheet.armorId};
  const thresholds=damageThresholds(previewSheet);
  const secondary=weaponForSlot(sheet,'secondary');
  const blocked=slot==='secondary'&&secondaryBlocked(sheet);
  const quantity=Number(qty);
  const validQty=Number.isInteger(quantity)&&quantity>=1&&quantity<=999;
  const damageValue=(()=>{try{return customWeaponDamage(Number(damageCount),damageDie,Number(damageBonus));}catch{return '';}})();
  const armorValid=(()=>{
    const major=Number(majorThreshold),severe=Number(severeThreshold),score=Number(baseScore);
    return Number.isInteger(major)&&Number.isInteger(severe)&&Number.isInteger(score)&&major>=0&&severe>=major&&severe<=99&&score>=0&&score<=MAX_ARMOR_SCORE;
  })();
  const customValid=!!customName.trim()&&(customType==='item'||(customType==='weapon'&&!!damageValue)||(customType==='armor'&&armorValid));
  const customFeature=featureName.trim()?{name:featureName.trim(),text:featureText.trim()}:undefined;
  const customGlyphKind:InventoryKind=customType==='weapon'?'weapon':customType==='armor'?'armor':'custom';
  const confirm=()=>{
    setError('');
    try {
      if(slot&&choice?.owned) onEquip?.(choice.owned.id);
      else if(custom) {
        if (customType==='weapon') {
          if (!damageValue) throw new Error('Set the weapon damage first.');
          onAdd?.({kind:'custom',name:customName,description:customDescription,qty:quantity,...(customIcon==='auto'?{}:{icon:customIcon}),weapon:{trait,range,category,damage:damageValue,damageType,burden,tier:Number(weaponTier),...(customFeature?{feature:customFeature}:{})}});
        } else if (customType==='armor') {
          onAdd?.({kind:'custom',name:customName,description:customDescription,qty:quantity,...(customIcon==='auto'?{}:{icon:customIcon}),armor:{baseThresholds:{major:Number(majorThreshold),severe:Number(severeThreshold)},baseScore:Number(baseScore),tier:Number(armorTier),...(customFeature?{feature:customFeature}:{})}});
        } else {
          onAdd?.({kind:'custom',name:customName,description:customDescription,qty:quantity,...(customIcon==='auto'?{}:{icon:customIcon})});
        }
      }
      else if(picked) onAdd?.({kind:picked.kind,catalogId:picked.id,qty:quantity});
    } catch(caught) { setError(caught instanceof Error?caught.message:'Could not update inventory.'); }
  };
  const quantityField=<label className="inventory-quantity">Quantity<input type="number" min={1} max={999} step={1} inputMode="numeric" value={qty} onChange={event=>setQty(event.target.value)} /></label>;
  const featureFields=<div className="inventory-custom-grid"><label className="inventory-custom-field inventory-custom-wide">Feature name<input maxLength={120} value={featureName} onChange={event=>setFeatureName(event.target.value)} placeholder="Optional feature name" /></label><label className="inventory-custom-field inventory-custom-wide">Feature text<textarea rows={3} maxLength={2000} value={featureText} onChange={event=>setFeatureText(event.target.value)} placeholder="What does it do?" /></label></div>;
  return <Dialog open title={slot?'Change '+EQUIPMENT_LABELS[slot].toLowerCase():'Add items to inventory'} onClose={onClose} className="equipment-picker">
    {!slot&&<div className="inventory-source-tabs" role="group" aria-label="Item source"><button type="button" aria-label="Browse catalog" aria-pressed={!custom} onClick={()=>{setKind('all');setSelected(null);setError('');}}><Icon name="book" />Catalog</button><button type="button" aria-pressed={custom} onClick={()=>{setKind('custom');setSelected(null);setError('');}}><Icon name="custom" />Custom item</button></div>}
    <div className={'equipment-picker-layout' +(custom?' is-custom':'')}>
      <div className="equipment-picker-catalog">
        {slot?<div className="inventory-source-heading"><div><h3>From your inventory</h3>{current&&<p>Equipped: {current.name}</p>}</div><button type="button" onClick={()=>onAddItems?.(query)}><Icon name="plus" />Add items</button></div>:
          !custom&&<div className="equipment-filter inventory-add-filters"><label>Category<select aria-label="Item category" value={kind} onChange={event=>{setKind(event.target.value as InventoryKind|'all');setSelected(null);setTier('all');setError('');}}>
            <option value="all">All items</option>{Object.entries(INVENTORY_KIND_LABELS).map(([value,label])=><option key={value} value={value}>{label}</option>)}
          </select></label>{!custom&&(kind==='weapon'||kind==='armor')&&<label>Tier<select value={tier} onChange={event=>{setTier(event.target.value);setSelected(null);}}><option value="all">All tiers</option>{[1,2,3,4].map(value=><option key={value} value={value}>Tier {value}</option>)}</select></label>}</div>}
        {!custom&&<><label className="equipment-search"><Icon name="search" /><input data-autofocus aria-label={slot?'Search owned '+EQUIPMENT_LABELS[slot].toLowerCase():'Search items to add'} placeholder={slot?'Search carried gear…':'Search name, trait, feature…'} value={query} onChange={event=>{setQuery(event.target.value);setSelected(null);}} /></label>
          <p className="inventory-choice-count">{results.length} {slot?(results.length===1?'carried item':'carried items'):(results.length===1?'item':'items')}</p>
          <div className="equipment-picker-results" role="group" aria-label={slot?'Owned equipment choices':'Catalog items'}>
            {results.map(({key,item,owned})=><button key={key} type="button" aria-pressed={key===selected} onClick={()=>{setSelected(key);setError('');}}><ItemGlyph item={owned??item} /><span><strong>{item.name}</strong><small>{item.tier?'Tier '+item.tier+' · ':''}{item.weapon?item.weapon.damage+' · '+item.weapon.burden:item.armor?'Armor '+item.armor.baseScore:INVENTORY_KIND_LABELS[item.kind]}{owned?' · Qty '+owned.qty:''}{owned?.kind==='armor'&&(owned.armorSlotsMarked??0)>0?' · '+owned.armorSlotsMarked+' slots used':''}</small></span><Icon name={key===selected?'check':'chevron'} /></button>)}
            {!results.length&&<div className="inventory-empty-choice"><Icon name="backpack" /><h3>{slot&&!choices.length?'No carried gear for this slot':'No matches'}</h3><p>{slot&&!choices.length?'Add an item to your inventory, then equip it here.':'Try a different search or category.'}</p>{slot&&<button type="button" onClick={()=>onAddItems?.(query)}><Icon name="plus" />Add items to inventory</button>}</div>}
          </div></>}
      </div>
      <div className="equipment-picker-preview character-folio">
        {custom?<><div className="inventory-custom-identity"><ItemGlyph item={{kind:customGlyphKind,name:customName,icon:customIcon}} /><div><span className="sheet-mini-label">Custom {customType==='item'?'item':customType}</span><strong>{customName.trim()||'Your item'}</strong></div></div>
          <div className="inventory-source-tabs inventory-custom-type" role="group" aria-label="Custom item type">
            {(['item','weapon','armor'] as const).map(type=><button type="button" key={type} aria-pressed={customType===type} onClick={()=>{setCustomType(type);setError('');}}><Icon name={type==='weapon'?'weapon':type==='armor'?'armor':'tag'} />{type==='item'?'Item':type==='weapon'?'Weapon':'Armor'}</button>)}
          </div>
          <div className="inventory-custom-grid">
            <label className="inventory-custom-field inventory-custom-wide">Name<input data-autofocus aria-label="Custom item name" maxLength={120} value={customName} onChange={event=>setCustomName(event.target.value)} placeholder={customType==='weapon'?'e.g. Moonlit blade':customType==='armor'?'e.g. Thornweave coat':'e.g. A silver key'} /></label>
            {customType!=='item'&&<label className="inventory-custom-field">Tier<select aria-label="Custom item tier" value={customType==='weapon'?weaponTier:armorTier} onChange={event=>customType==='weapon'?setWeaponTier(event.target.value):setArmorTier(event.target.value)}>{CUSTOM_TIERS.map(value=><option key={value} value={value}>Tier {value}</option>)}</select></label>}
            {customType==='weapon'&&<><label className="inventory-custom-field">Attack trait<select aria-label="Weapon trait" value={trait} onChange={event=>setTrait(event.target.value)}>{CUSTOM_WEAPON_TRAITS.map(value=><option key={value} value={value}>{value}</option>)}</select></label>
              <label className="inventory-custom-field">Range<select aria-label="Weapon range" value={range} onChange={event=>setRange(event.target.value)}>{CUSTOM_WEAPON_RANGES.map(value=><option key={value} value={value}>{value}</option>)}</select></label>
              <label className="inventory-custom-field">Slot<select aria-label="Weapon slot" value={category} onChange={event=>setCategory(event.target.value)}>{CUSTOM_WEAPON_CATEGORIES.map(value=><option key={value} value={value}>{value}</option>)}</select></label>
              <label className="inventory-custom-field">Hands<select aria-label="Weapon burden" value={burden} onChange={event=>setBurden(event.target.value)}>{CUSTOM_WEAPON_BURDENS.map(value=><option key={value} value={value}>{value}</option>)}</select></label>
              <label className="inventory-custom-field">Damage type<select aria-label="Weapon damage type" value={damageType} onChange={event=>setDamageType(event.target.value==='mag'?'mag':'phy')}><option value="phy">Physical</option><option value="mag">Magic</option></select></label>
              <label className="inventory-custom-field">Dice<input type="number" min={0} max={20} step={1} inputMode="numeric" aria-label="Damage dice count" value={damageCount} onChange={event=>setDamageCount(event.target.value)} /></label>
              <label className="inventory-custom-field">Die<select aria-label="Damage die" value={damageDie} onChange={event=>setDamageDie(event.target.value)}>{CUSTOM_DAMAGE_DICE.map(value=><option key={value} value={value}>{value}</option>)}</select></label>
              <label className="inventory-custom-field">Bonus<input type="number" min={0} max={99} step={1} inputMode="numeric" aria-label="Damage bonus" value={damageBonus} onChange={event=>setDamageBonus(event.target.value)} /></label>
              <p className="inventory-custom-hint">Damage: <strong>{damageValue||'—'}</strong>. Use 0 dice for a flat modifier.</p></>}
            {customType==='armor'&&<><label className="inventory-custom-field">Armor Score<input type="number" min={0} max={MAX_ARMOR_SCORE} step={1} inputMode="numeric" aria-label="Armor score" value={baseScore} onChange={event=>setBaseScore(event.target.value)} /></label>
              <label className="inventory-custom-field">Major threshold<input type="number" min={0} max={99} step={1} inputMode="numeric" aria-label="Major damage threshold" value={majorThreshold} onChange={event=>setMajorThreshold(event.target.value)} /></label>
              <label className="inventory-custom-field">Severe threshold<input type="number" min={0} max={99} step={1} inputMode="numeric" aria-label="Severe damage threshold" value={severeThreshold} onChange={event=>setSevereThreshold(event.target.value)} /></label></>}
          </div>
          {quantityField}
          <label className="inventory-custom-field">Notes<textarea aria-label="Custom item notes" maxLength={4000} rows={4} value={customDescription} onChange={event=>setCustomDescription(event.target.value)} placeholder="Description, purpose, or special rules…" /></label>
          {customType!=='item'&&featureFields}
          <details className="inventory-icon-picker"><summary><ItemGlyph item={{kind:customGlyphKind,name:customName,icon:customIcon}} /><span>Item icon<small>{customIcon==='auto'?'Automatic':CUSTOM_ITEM_ICONS.find(icon=>icon.id===customIcon)?.label}</small></span><Icon name="chevron" /></summary><div role="group" aria-label="Custom item icon"><button type="button" aria-pressed={customIcon==='auto'} onClick={()=>setCustomIcon('auto')} title="Choose icon automatically" aria-label="Automatic icon">Auto</button>{CUSTOM_ITEM_ICONS.map(icon=><button type="button" key={icon.id} aria-label={`Use ${icon.label} icon`} title={icon.label} aria-pressed={customIcon===icon.id} onClick={()=>setCustomIcon(icon.id)}><Icon name={icon.id} /></button>)}</div></details>{error&&<p role="alert">{error}</p>}<button type="button" className="sheet-primary equipment-confirm" disabled={!customValid||!validQty} onClick={confirm}><Icon name="plus" />Add to inventory</button></>:
        picked?<><span className="sheet-mini-label">{slot?'Carried gear':'Item preview'}{picked.tier?' · Tier '+picked.tier:''}</span><div className="inventory-preview-title"><ItemGlyph item={choice.owned??picked} /><h3>{picked.name}</h3></div>
          {pickedWeapon&&<><div className="session-gear-value"><strong>{damageNotation(pickedWeapon.damage,sheet.proficiency)}</strong><span>{pickedWeapon.damageType==='phy'?'Physical':'Magic'} damage</span></div><dl className="sheet-session-facts"><div><dt>Attack trait</dt><dd>{pickedWeapon.trait} {weaponModifier(sheet,pickedWeapon)>=0?'+':''}{weaponModifier(sheet,pickedWeapon)}</dd></div><div><dt>Range</dt><dd>{pickedWeapon.range}</dd></div></dl><p className="sheet-note">{pickedWeapon.burden}</p></>}
          {pickedArmor&&<><div className="session-gear-value"><strong>{armorScore(previewSheet)}</strong><span>Armor Score</span></div><dl className="sheet-session-facts"><div><dt>Major threshold</dt><dd>{thresholds.major}</dd></div><div><dt>Severe threshold</dt><dd>{thresholds.severe}</dd></div><div><dt>Evasion</dt><dd>{evasion(previewSheet)}</dd></div>{choice.owned&&<div><dt>Available slots</dt><dd>{Math.max(0,armorScore(previewSheet)-(choice.owned.armorSlotsMarked??0))} / {armorScore(previewSheet)}</dd></div>}</dl></>}
          {picked.feature&&<AbilityCard name={picked.feature.name} text={picked.feature.text} category="Equipment feature" />}
          {!pickedWeapon&&!pickedArmor&&<p className="inventory-item-rules">{picked.description}</p>}
          {slot&&pickedWeapon?.burden==='Two-Handed'&&secondary&&<p className="equipment-swap-note"><Icon name="hand" />Uses both hands. {secondary.name} will move to inventory.</p>}
          {slot&&currentId&&<p className="sheet-note">Your current gear will move to inventory.</p>}
          {blocked&&<p className="equipment-swap-note">Equip a one-handed primary weapon first.</p>}
          {!slot&&quantityField}{error&&<p role="alert">{error}</p>}
          <button className="sheet-primary equipment-confirm" type="button" disabled={blocked||(!slot&&!validQty)} onClick={confirm}><Icon name={slot?'check':'plus'} />{slot?'Equip '+picked.name:'Add to inventory'}</button>
        </>:<div className="equipment-pick-prompt"><Icon name={slot==='armor'?'armor':'backpack'} /><h3>{slot?'Choose carried gear':'Choose an item'}</h3><p>{slot?'Only items in your inventory appear here.':'Search the catalog, or choose Custom to add your own item.'}</p></div>}
      </div>
    </div>
  </Dialog>;
}
