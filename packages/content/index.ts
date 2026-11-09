// Generated JSON (see tools/*.py). Keep raw source data intact and expose the
// core-book catalog to every consumer, including sheets, maps and combat.
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
import rawItems from './items.json';
import ranges from './ranges.json';
import rawTransformations from './transformations.json';
import rawWeapons from './weapons.json';

function selectCore<T extends { id: string }>(items: T[], ids: string[]): T[] {
  const allowed = new Set(ids);
  return items.filter((item) => allowed.has(item.id));
}

const classes = selectCore(rawClasses, coreCatalog.classes).map((item) => ({
  ...item,
  subclasses: item.subclasses.filter((subclass) => coreCatalog.subclasses.includes(subclass.id)),
}));
const domains = selectCore(rawDomains, coreCatalog.domains).map((item) => ({
  ...item,
  classes: item.classes.filter((id) => coreCatalog.classes.includes(id)),
}));
const domainCards = selectCore(rawDomainCards, coreCatalog.domainCards);
const ancestries = selectCore(rawAncestries, coreCatalog.ancestries);
const communities = selectCore(rawCommunities, coreCatalog.communities);
const weapons = selectCore(rawWeapons, coreCatalog.weapons);
const armor = selectCore(rawArmor, coreCatalog.armor);
const items = selectCore(rawItems, coreCatalog.items);
const consumables = selectCore(rawConsumables, coreCatalog.consumables);
const adversaries = selectCore(rawAdversaries, coreCatalog.adversaries);
const environments = selectCore(rawEnvironments, coreCatalog.environments);
// Transformations in this catalog come from the expanded SRD, not the core book.
const transformations: typeof rawTransformations = [];

export {
  adversaries, ancestries, armor, cardsIndex, classes, communities, conditions,
  consumables, domainCards, domains, environments, items, ranges, transformations, weapons,
};

/** URL of a card image served by the server. */
export const cardUrl = (file: string, thumb = false) =>
  thumb ? `/cards/thumbs/${file}` : `/cards/${file}`;
