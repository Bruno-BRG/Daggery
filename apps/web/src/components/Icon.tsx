import {
  HouseIcon,
  MapTrifoldIcon,
  IdentificationCardIcon,
  SwordIcon,
  BookOpenIcon,
  NotePencilIcon,
  MoonIcon,
  SunIcon,
  DiceFiveIcon,
  MagnifyingGlassIcon,
  ArrowRightIcon,
  CaretRightIcon,
  XIcon,
  DotsThreeIcon,
  UserPlusIcon,
  CompassIcon,
  SignOutIcon,
  HeartIcon,
  LightningIcon,
  ShieldIcon,
  SparkleIcon,
  HandIcon,
  CursorIcon,
  RulerIcon,
  EyeIcon,
  EyeSlashIcon,
  GridFourIcon,
  MagnetIcon,
  CrosshairIcon,
  PlusIcon,
  MinusIcon,
  ArrowClockwiseIcon,
  CopyIcon,
  LockSimpleIcon,
  LockSimpleOpenIcon,
  CornersOutIcon,
  CornersInIcon,
  GearSixIcon,
  ArrowUUpLeftIcon,
  TrashIcon,
  CheckIcon,
  UsersIcon,
  BackpackIcon, FlaskIcon, ScrollIcon, KeyIcon, DiamondIcon, CoinsIcon,
  FireIcon, LassoIcon, WrenchIcon, TreasureChestIcon, CircleIcon, FeatherIcon,
  TagIcon, ShieldChevronIcon, KnifeIcon, AxeIcon, MagicWandIcon, FolderOpenIcon,
  PaletteIcon, SwapIcon, BoneIcon, LeafIcon, FingerprintIcon, SkullIcon, TreeIcon,
  PersonSimpleRunIcon, BarbellIcon, ChatCircleTextIcon, BrainIcon, FilePdfIcon,
  ImageIcon, UploadSimpleIcon, PenNibIcon,
  PawPrintIcon,
} from '@phosphor-icons/react';
import './icons.css';

const icons = {
  home: HouseIcon,
  map: MapTrifoldIcon,
  sheet: IdentificationCardIcon,
  combat: SwordIcon,

  book: BookOpenIcon,
  note: NotePencilIcon,
  library: FolderOpenIcon,
  moon: MoonIcon,

  sun: SunIcon,
  dice: DiceFiveIcon,
  search: MagnifyingGlassIcon,
  arrow: ArrowRightIcon,

  chevron: CaretRightIcon,
  close: XIcon,
  more: DotsThreeIcon,
  invite: UserPlusIcon,

  compass: CompassIcon,
  logout: SignOutIcon,
  heart: HeartIcon,
  stress: LightningIcon,

  shield: ShieldIcon,
  spark: SparkleIcon,
  hand: HandIcon,
  cursor: CursorIcon,
  ruler: RulerIcon,

  eye: EyeIcon,
  eyeOff: EyeSlashIcon,
  grid: GridFourIcon,
  snap: MagnetIcon,
  target: CrosshairIcon,

  plus: PlusIcon,
  minus: MinusIcon,
  rotate: ArrowClockwiseIcon,
  copy: CopyIcon,

  lock: LockSimpleIcon,
  unlock: LockSimpleOpenIcon,
  expand: CornersOutIcon,

  shrink: CornersInIcon,
  settings: GearSixIcon,
  undo: ArrowUUpLeftIcon,
  trash: TrashIcon,

  check: CheckIcon,
  users: UsersIcon,
  backpack: BackpackIcon, potion: FlaskIcon, scroll: ScrollIcon, key: KeyIcon,
  gem: DiamondIcon, coins: CoinsIcon, torch: FireIcon, rope: LassoIcon,
  tools: WrenchIcon, chest: TreasureChestIcon, ring: CircleIcon, feather: FeatherIcon,
  tag: TagIcon, armor: ShieldChevronIcon, weapon: SwordIcon, dagger: KnifeIcon,
  axe: AxeIcon, magic: MagicWandIcon, ranged: CrosshairIcon, palette: PaletteIcon,
  swap: SwapIcon, bone: BoneIcon, leaf: LeafIcon, ancestry: FingerprintIcon,
  adversary: SkullIcon, tree: TreeIcon, agility: PersonSimpleRunIcon,
  strength: BarbellIcon, presence: ChatCircleTextIcon, knowledge: BrainIcon,
  pdf: FilePdfIcon, image: ImageIcon, upload: UploadSimpleIcon, custom: PenNibIcon,
  paw: PawPrintIcon,
};

export type IconName = keyof typeof icons;
const UTILITY_ICONS = new Set<IconName>(['search','arrow','chevron','close','more','logout','cursor','ruler','eye','eyeOff','grid','snap','target','plus','minus','rotate','copy','lock','unlock','expand','shrink','settings','undo','trash','check','swap','upload']);

/** Shared rendering for the app and table. Semantic symbols have depth; controls stay crisp. */
export function IconGlyph({ glyph: Component, name, className, size = 24, utility = false }: {
  glyph: typeof SwordIcon; name: string; className?: string; size?: number; utility?: boolean;
}) {
  return <Component className={className} data-icon={name} size={size} weight={utility?'bold':'duotone'} aria-hidden="true" focusable="false" />;
}

export function Icon({ name }: { name: IconName }) {
  const Component = icons[name];

  return <IconGlyph glyph={Component} name={name} className="daggery-icon" utility={UTILITY_ICONS.has(name)} />;
}
