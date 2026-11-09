import { Icon } from '../../components/Icon';
import { inventoryIconTone, inventoryItemIcon } from './inventoryIcons';
import type { InventoryEntry } from './types';

export function ItemGlyph({item,className=''}:{item:Pick<InventoryEntry,'kind'|'name'|'icon'>;className?:string}) {
  const icon=inventoryItemIcon(item);
  return <span className={`item-glyph ${className}`} data-tone={inventoryIconTone(icon)} aria-hidden="true"><Icon name={icon} /></span>;
}
