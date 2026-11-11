// Generated JSON (see tools/*.py). Keep raw source data intact and expose the
// core-book catalog plus the Hope & Fear and Sablewood material to every
// consumer, including sheets, maps and combat.
import rawAdversaries from './adversaries.json';
import rawAncestries from './ancestries.json';
import rawArmor from './armor.json';
import cardsIndex from './cards-index.json';
import rawClasses from './classes.json';
import rawCommunities from './communities.json';
import conditions from './conditions.json';
import rawConsumables from './consumables.json';
import coreCatalog from './core-catalog.json';
import rawDomainCards from './domain-cards.json';
import rawDomains from './domains.json';
import rawEnvironments from './environments.json';
import hfAdversaries from './hope-and-fear/adversaries.json';
import hfAncestries from './hope-and-fear/ancestries.json';
import hfArmor from './hope-and-fear/armor.json';
import hfClasses from './hope-and-fear/classes.json';
import hfCommunities from './hope-and-fear/communities.json';
import hfConsumables from './hope-and-fear/consumables.json';
import hfDomainCards from './hope-and-fear/domain-cards.json';
import hfDomains from './hope-and-fear/domains.json';
import hfEnvironments from './hope-and-fear/environments.json';
import hfItems from './hope-and-fear/items.json';
import hfTransformations from './hope-and-fear/transformations.json';
import hfWeapons from './hope-and-fear/weapons.json';
import rawItems from './items.json';
import ranges from './ranges.json';
import swAdversaries from './sablewood/adversaries.json';
import swArmor from './sablewood/armor.json';
import swConsumables from './sablewood/consumables.json';
import swEnvironments from './sablewood/environments.json';
import swItems from './sablewood/items.json';
import swWeapons from './sablewood/weapons.json';
import rawWeapons from './weapons.json';

/** Where an entry in the combined catalog came from. */
export type ContentSource = 'core' | 'hope-and-fear' | 'sablewood';

function selectCore<T extends { id: string }>(items: T[], ids: string[]): T[] {
  const allowed = new Set(ids);
  return items.filter((item) => allowed.has(item.id));
}

function withSource<T extends object>(items: readonly T[], source: ContentSource) {
  return items.map((item) => ({ ...item, source }));
}

const classes = [
  ...withSource(selectCore(rawClasses, coreCatalog.classes), 'core').map((item) => ({
    ...item,
    art: true,
    subclasses: item.subclasses.filter((subclass) => coreCatalog.subclasses.includes(subclass.id)),
  })),
  ...withSource(hfClasses, 'hope-and-fear').map((item) => ({ ...item, art: true })),
];

const domains = [
  ...withSource(selectCore(rawDomains, coreCatalog.domains), 'core'),
  ...withSource(hfDomains, 'hope-and-fear'),
].map((domain) => ({
  ...domain,
  classes: [
    ...new Set([
      ...domain.classes,
      ...classes.filter((item) => item.domains.includes(domain.id)).map((item) => item.id),
    ]),
  ],
}));

const domainCards = [
  ...withSource(selectCore(rawDomainCards, coreCatalog.domainCards), 'core'),
  ...withSource(hfDomainCards, 'hope-and-fear'),
];
const ancestries = [
  ...withSource(selectCore(rawAncestries, coreCatalog.ancestries), 'core'),
  ...withSource(hfAncestries, 'hope-and-fear'),
];
const communities = [
  ...withSource(selectCore(rawCommunities, coreCatalog.communities), 'core'),
  ...withSource(hfCommunities, 'hope-and-fear'),
];
const weapons = [
  ...withSource(selectCore(rawWeapons, coreCatalog.weapons), 'core'),
  ...withSource(hfWeapons, 'hope-and-fear'),
  ...withSource(swWeapons, 'sablewood'),
];
const armor = [
  ...withSource(selectCore(rawArmor, coreCatalog.armor), 'core'),
  ...withSource(hfArmor, 'hope-and-fear'),
  ...withSource(swArmor, 'sablewood'),
];
const items = [
  ...withSource(selectCore(rawItems, coreCatalog.items), 'core'),
  ...withSource(hfItems, 'hope-and-fear'),
  ...withSource(swItems, 'sablewood'),
];
const consumables = [
  ...withSource(selectCore(rawConsumables, coreCatalog.consumables), 'core'),
  ...withSource(hfConsumables, 'hope-and-fear'),
  ...withSource(swConsumables, 'sablewood'),
];
const adversaries = [
  ...withSource(selectCore(rawAdversaries, coreCatalog.adversaries), 'core'),
  ...withSource(hfAdversaries, 'hope-and-fear'),
  ...withSource(swAdversaries, 'sablewood'),
];
const environments = [
  ...withSource(selectCore(rawEnvironments, coreCatalog.environments), 'core'),
  ...withSource(hfEnvironments, 'hope-and-fear'),
  ...withSource(swEnvironments, 'sablewood'),
];
// Transformations come from Hope & Fear; the core book has none.
const transformations = withSource(hfTransformations, 'hope-and-fear');

export {
  adversaries, ancestries, armor, cardsIndex, classes, communities, conditions,
  consumables, domainCards, domains, environments, items, ranges, transformations, weapons,
};

/** URL of a card image served by the server. */
export const cardUrl = (file: string, thumb = false) =>
  thumb ? `/cards/thumbs/${file}` : `/cards/${file}`;
