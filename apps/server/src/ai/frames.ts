/**
 * Campaign frames the AI GM can run from the installed sourcebooks.
 *
 * This registry is authored, short metadata only: a one-sentence summary and a few brief
 * seeds. The printed pages stay in data/rules/ (gitignored, copyrighted) and are read on
 * demand through the sourcebook tools. Page numbers use the page value returned by
 * sourcebook search: the printed page when the book has one, otherwise the PDF page.
 */
export interface FrameSeed {
  tone: string;
  factions: string[];
  npcs: string[];
  locations: string[];
  hooks: string[];
}

export interface CampaignFrame {
  id: string;
  title: string;
  source: string;
  pageStart: number;
  pageEnd: number;
  summary: string;
  seed: FrameSeed;
  /** Where the printed pages came from, when the source changed. */
  sourceNote?: string;
}

// The four Hope & Fear frames are printed in the Hope & Fear book
// (source 'hope-and-fear-book'). The older campaign-frame tile PDF only had
// text on pages 1-3; pages 4+ are image-only, so it is no longer used.
const HOPE_AND_FEAR_NOTE =
  'Printed in Daggerheart: Hope & Fear. The older campaign-frame tile PDF had text only on pages 1-3; its pages 4+ are image-only.';

export const CAMPAIGN_FRAMES: readonly CampaignFrame[] = [
  {
    id: 'the-witherwild',
    title: 'The Witherwild',
    source: 'core-rulebook',
    pageStart: 254,
    pageEnd: 261,
    summary: 'A wounded forest god and an invading army turn the frontier into a spreading, hostile bloom.',
    seed: {
      tone: 'Adventurous, epic and uncanny; a wounded land that answers back.',
      factions: ['Haven, the invading nation', "Fanewick's forest folk and their allies"],
      npcs: ['The wounded forest deity', "Haven's occupying commanders"],
      locations: ["Fanewick's overgrown frontier", 'Settlements threatened by the Witherwild bloom'],
      hooks: ['The overgrowth reaches a place the heroes cannot abandon', 'A Haven patrol offers help at a price'],
    },
  },
  {
    id: 'five-banners-burning',
    title: 'Five Banners Burning',
    source: 'core-rulebook',
    pageStart: 262,
    pageEnd: 269,
    summary: 'Five nations circle each other after a fragile armistice, and the party is caught between their agents.',
    seed: {
      tone: 'Dramatic, political and intimate; every alliance has a cost.',
      factions: ['The five rival nations of Althas', 'Agents and spies working across the armistice'],
      npcs: ['An ambitious envoy', 'A veteran who remembers the last war'],
      locations: ['The capital where the armistice is signed', 'A border city courted by several nations'],
      hooks: ['A sabotage is blamed on the heroes’ patron', 'A defector brings terms no nation can refuse'],
    },
  },
  {
    id: 'beast-feast',
    title: 'Beast Feast',
    source: 'core-rulebook',
    pageStart: 270,
    pageEnd: 279,
    summary: "Townsfolk descend into monster-filled caves when the magic protecting their village fails, and cook what they find.",
    seed: {
      tone: 'Absurd, lighthearted and a little creepy; appetite is a virtue.',
      factions: ['The villagers of Elmore', 'The creatures of the Plover Caves'],
      npcs: ["Elmore's village cook or elder", 'A cavern guide with strange tastes'],
      locations: ['Elmore village', 'The Plover Caves'],
      hooks: ['The magic lure that keeps Elmore safe is failing', 'Something in the caves has learned to cook back'],
    },
  },
  {
    id: 'the-age-of-umbra',
    title: 'The Age of Umbra',
    source: 'core-rulebook',
    pageStart: 280,
    pageEnd: 289,
    summary: 'A sunless realm of shattered kingdoms where scattered communities guard the last light against monstrous dark.',
    seed: {
      tone: 'Grim, ominous and epic; hope is scarce but stubborn.',
      factions: ["The Halcyon Domain's surviving communities", 'Servants of the betrayed God-King Othedias'],
      npcs: ['God-King Othedias', "A keeper of a community's last light"],
      locations: ['A decaying fortress holding a refuge', 'The shadow-choked wilds between settlements'],
      hooks: ["A refuge's light begins to fail", 'A monster offers a bargain it claims can restore the gods'],
    },
  },
  {
    id: 'motherboard',
    title: 'Motherboard',
    source: 'core-rulebook',
    pageStart: 290,
    pageEnd: 307,
    summary: 'Fallen technology behaves like magic, and a virus is waking the machines that roam the wastes.',
    seed: {
      tone: 'Innovative, mysterious and post-post-apocalyptic; technology is magic.',
      factions: ["The walled cities of the Echo Vale", 'The wild machines of the Wastes'],
      npcs: ['A city engineer who trusts the network', 'The intelligence behind the virus'],
      locations: ["The Echo Vale's walled cities", 'The machine-haunted Wastes'],
      hooks: ["The virus reaches a city's core system", 'A wandering city broadcasts a call for help'],
    },
  },
  {
    id: 'colossus-of-the-drylands',
    title: 'Colossus of the Drylands',
    source: 'core-rulebook',
    pageStart: 308,
    pageEnd: 327,
    summary: "Colossal creatures rise beneath a desert frontier of outlaws and miners, shattering the region's fragile peace.",
    seed: {
      tone: 'Awe-inspiring, gritty and eerie; the frontier is larger than life.',
      factions: ['Drylands settlers and outlaws', 'Those who serve or fear the colossi'],
      npcs: ['A gunslinger with a debt to the region', 'The voice that wakes the colossi'],
      locations: ['A crystal-growing desert frontier', 'A town in the shadow of a colossus'],
      hooks: ['A colossus changes course toward a settlement', "A crystal mine uncovers a god's remains"],
    },
  },
  {
    id: 'castle-high',
    title: 'Castle High',
    source: 'hope-and-fear-book',
    pageStart: 116,
    pageEnd: 127,
    summary: 'Students at a floating magic school investigate a string of disappearances while juggling classes, tower rivalries and sky-island expeditions.',
    sourceNote: HOPE_AND_FEAR_NOTE,
    seed: {
      tone: 'Adventurous, dreamy, modern and melodramatic; high school with spellbooks and flying mounts.',
      factions: ["Castle High's four towers and its faculty", 'Sky pirates and the dangers of the skylands', "The hidden cause of the disappearances"],
      npcs: ['Dean Parsons of Zenith tower', "Mrs. Wickett, the headmaster's assistant", 'Oliver Fleming, a missing student who returns', 'Riley Averill, a student tied to the mystery'],
      locations: ['Castle High and its floating campus', 'The surrounding skylands and their ruins', 'The castle stables and roosts'],
      hooks: ['Oliver crash-lands in the courtyard with an unfinished warning', 'Another student vanishes during a skyland field trip'],
    },
  },
  {
    id: 'reign-of-the-weredragon',
    title: 'Reign of the Weredragon',
    source: 'hope-and-fear-book',
    pageStart: 128,
    pageEnd: 143,
    summary: 'Destined heroes of Whelvia rise against Forlorne Lykona, a weredragon queen who rules through propaganda, knights and fear.',
    sourceNote: HOPE_AND_FEAR_NOTE,
    seed: {
      tone: "Epic, grim fairy tale with hope; swords, sorcery and tyranny's rise and fall.",
      factions: ["Forlorne Lykona's court and the Knights of Whelvia", "Whelvian rebels and the Astromancer's allies", 'The Jagged Knife gang'],
      npcs: ['Forlorne Lykona, the weredragon queen', "The Astromancer of Heaven's Eye", 'Schon, a knight who might turn', "Dolorez and Harrowyrr, figures from Forlorne's past"],
      locations: ["Heaven's Eye observatory", 'The Whelvewood', 'Froghaven Bog and Dragonmyrth mansion', "Nwarlyth, the queen's fortress"],
      hooks: ['A seagull delivers a map to Heaven\'s Eye', 'A village is cursed into ravenous weredrakes'],
    },
  },
  {
    id: 'dark-heart-of-andaluria',
    title: 'Dark Heart of Andaluria',
    source: 'hope-and-fear-book',
    pageStart: 144,
    pageEnd: 157,
    summary: 'Monster hunters investigate why the nights grow longer in a wine-soaked land where old rites are failing and a demonic legacy stirs.',
    sourceNote: HOPE_AND_FEAR_NOTE,
    seed: {
      tone: 'Gothic, grim and romantic; wine festivals by day, hungry things by night.',
      factions: ['The Sombral Spade monster hunters', 'The Council of Five and the Nightwatch', 'The Church of the Golden Eminence and Caio folk practitioners'],
      npcs: ['Julio Cantafierro, cursed leader of the Sombral Spade', 'Andrea Nocta of the Nightwatch', 'Condesa Delamoña, whose vintage hides a secret'],
      locations: ['Jesaña, the capital on the southern bay', 'The Serracorte volcanoes and their vineyards', 'Santavio, the festival village'],
      hooks: ['Monsters burst from the festival casks at Santavio', 'The Condesa offers the party a private commission'],
    },
  },
  {
    id: 'journey-to-horizon',
    title: 'Journey to Horizon',
    source: 'hope-and-fear-book',
    pageStart: 158,
    pageEnd: 179,
    summary: 'Chosen heroes cross a reshaped Valloren collecting ten Soul Echoes to resurrect the goddess Aurelia before disaster ends the world.',
    sourceNote: HOPE_AND_FEAR_NOTE,
    seed: {
      tone: 'Epic, hopeful and wondrous; a road trip through a broken, beautiful world.',
      factions: ['The Aurelian Order and the faithful', 'Cultists of the Two-Headed Coin and the Fellsworn Templars', 'Seekers-in-Shadow'],
      npcs: ['Saraya Rinn, high priestess of the Aurelian Order', 'Tolren, her treacherous apprentice', 'Esio Bonte, Guildmaster of Cyntix'],
      locations: ['Marrogate sanctuary', 'The Cliffs of Horizon', 'Cyntix and the other sanctuaries', 'The wilds of New Valloren'],
      hooks: ["Saraya's Vessel of Light is stolen by a Fellsworn Templar", 'The Doom Track advances as the party travels'],
    },
  },
  {
    id: 'sablewood',
    title: 'Sablewood',
    source: 'sablewood',
    pageStart: 1,
    pageEnd: 10,
    summary: 'An ancient forest of hybrid beasts and forgotten gods supports a rich woodland trade, and its wonders are not all friendly.',
    seed: {
      tone: 'Verdant, serene and ancient; wonder with teeth.',
      factions: ["Sablewood's woodland traders", 'The Forgotten Gods and their emissaries'],
      npcs: ['A hybrid-herd guide', 'A trader with a forbidden route'],
      locations: ['The Sablewood', 'A settlement built into the canopy'],
      hooks: ['A trade route goes silent', 'A god-touched beast asks the party for help'],
    },
  },
];

export function findCampaignFrame(id: string): CampaignFrame | undefined {
  const wanted = id.trim().toLowerCase();
  return CAMPAIGN_FRAMES.find(frame => frame.id === wanted);
}

/** The line the GM sees when the campaign was set up with a frame. */
export function framePrompt(frame: CampaignFrame): string {
  return [
    'This campaign uses the "' + frame.title + '" campaign frame from ' + frame.source + ', pages ' + frame.pageStart + '–' + frame.pageEnd + '.',
    'Before the opening scene and at the start of each session, consult the frame with load_campaign_frame and search_sourcebook. Keep its premise, factions and pressures moving in the background.',
    'Orientation only (the printed pages are authoritative): ' + frame.summary,
  ].join(' ');
}

export function frameRange(frame: CampaignFrame): { pageStart: number; pageEnd: number } {
  return { pageStart: frame.pageStart, pageEnd: frame.pageEnd };
}
