import type { ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { cardUrl } from '@daggery/content';
import { Chip, FeatureBadge, FeatureList, RollButton, SectionTitle, StatTile, type ZoomRequest } from './components';
import {
  cardFileForEntry,
  damageTypeLabel,
  domainLabel,
  subclassCardFile,
  type AdversaryData,
  type AncestryData,
  type ArmorData,
  type ClassData,
  type CommunityData,
  type ConditionData,
  type ConsumableData,
  type DomainCardData,
  type Entry,
  type EnvironmentData,
  type ItemData,
  type RangeData,
  type SubclassData,
  type SubclassPart,
  type TransformationData,
  type WeaponData,
} from './data';

interface DetailProps {
  entry: Entry;
  author: string;
  onZoom: (request: ZoomRequest) => void;
}

export function EntryDetail(props: DetailProps) {
  const file = cardFileForEntry(props.entry);
  return (
    <div className="compendium-detail-content">
      {file && (
        <button
          type="button"
          className="compendium-art-button"
          onClick={() => props.onZoom({ src: cardUrl(file), alt: props.entry.name })}
        >
          <Icon name="expand" />
          View original card
        </button>
      )}
      <EntryContent {...props} />
    </div>
  );
}
function EntryContent({ entry, author, onZoom }: DetailProps) {
  switch (entry.kind) {
    case 'class':
      return <ClassDetail data={entry.data as ClassData} onZoom={onZoom} />;
    case 'domainCard':
      return <DomainCardDetail entry={entry} />;
    case 'ancestry':
      return <AncestryDetail data={entry.data as AncestryData} entry={entry} />;
    case 'community':
      return <CommunityDetail data={entry.data as CommunityData} entry={entry} />;
    case 'transformation':
      return <TransformationDetail data={entry.data as TransformationData} />;
    case 'weapon':
      return <WeaponDetail data={entry.data as WeaponData} author={author} />;
    case 'armor':
      return <ArmorDetail data={entry.data as ArmorData} />;
    case 'item':
      return <ItemDetail data={entry.data as ItemData} />;
    case 'consumable':
      return <ConsumableDetail data={entry.data as ConsumableData} />;
    case 'adversary':
      return <AdversaryDetail data={entry.data as AdversaryData} author={author} />;
    case 'environment':
      return <EnvironmentDetail data={entry.data as EnvironmentData} />;
    case 'condition':
      return <ConditionDetail data={entry.data as ConditionData} />;
    case 'range':
      return <RangeDetail data={entry.data as RangeData} />;
  }
}

/* ------------------------------------------------------------------ */
/* Shared pieces                                                       */
/* ------------------------------------------------------------------ */

function DetailHeading({ name, description, chips }: { name: string; description?: string; chips?: ReactNode }) {
  return (
    <header className="border-b border-slate-800 pb-3">
      <h2 className="text-xl font-semibold tracking-tight text-slate-50">{name}</h2>
      {chips ? <div className="mt-2 flex flex-wrap gap-1.5">{chips}</div> : null}
      {description ? (
        <details className="compendium-overview">
          <summary>Overview</summary>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">{description}</p>
        </details>
      ) : null}
    </header>
  );
}

function NumberedList({ items, title }: { items: string[]; title: string }) {
  if (items.length === 0) return null;
  return (
    <section>
      <SectionTitle>{title}</SectionTitle>
      <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm leading-relaxed text-slate-400">
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ol>
    </section>
  );
}

const SUBCLASS_PARTS: { part: SubclassPart; label: string; field: 'foundation' | 'specialization' | 'mastery' }[] = [
  { part: 'foundation', label: 'Foundation', field: 'foundation' },
  { part: 'specialization', label: 'Specialization', field: 'specialization' },
  { part: 'mastery', label: 'Mastery', field: 'mastery' },
];

/* ------------------------------------------------------------------ */
/* Class                                                              */
/* ------------------------------------------------------------------ */

function ClassDetail({ data, onZoom }: { data: ClassData; onZoom: DetailProps['onZoom'] }) {
  return (
    <article className="flex flex-col gap-5">
      <DetailHeading
        name={`${data.name} — ${data.subclasses[0]?.name ?? 'Subclass'}`}
        description={data.description}
        chips={
          <>
            {data.domains.map((domain) => (
              <Chip key={domain} tone="violet">
                {domainLabel(domain)}
              </Chip>
            ))}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-2">
        <StatTile label="Starting Evasion" value={data.startingEvasion} />
        <StatTile label="Starting Hit Points" value={data.startingHP} />
      </div>

      <section>
        <SectionTitle>Class Items</SectionTitle>
        <p className="text-sm leading-relaxed text-slate-400">{data.classItems}</p>
      </section>

      <section>
        <SectionTitle>Hope Feature</SectionTitle>
        <div className="rounded-lg border border-accent-600/40 bg-accent-500/5 px-3 py-2">
          <div className="text-sm font-semibold text-accent-200">{data.hopeFeature.name}</div>
          <p className="mt-1 text-sm leading-relaxed text-slate-300">{data.hopeFeature.text}</p>
        </div>
      </section>

      <FeatureList features={data.classFeatures} title="Class Features" />

      <section>
        <SectionTitle>Subclasses</SectionTitle>
        <p className="mb-3 text-xs text-slate-400">
          Foundation is the starting card. Specialization and Mastery are gained through advancements.
        </p>
        <div className="flex flex-col gap-4">
          {data.subclasses.map((subclass) => (
            <SubclassBlock key={subclass.id} subclass={subclass} onZoom={onZoom} />
          ))}
        </div>
      </section>

      <NumberedList items={data.backgroundQuestions} title="Background Questions" />
      <NumberedList items={data.connections} title="Connections" />
    </article>
  );
}

function SubclassBlock({ subclass, onZoom }: { subclass: SubclassData; onZoom: DetailProps['onZoom'] }) {
  return (
    <section className="compendium-subclass">
      <h3>{subclass.name}</h3>
      {subclass.description && <p>{subclass.description}</p>}
      {SUBCLASS_PARTS.map((part) => {
        const file = subclassCardFile(subclass.id, part.part);
        return (
          <section key={part.part}>
            <div className="compendium-feature-heading">
              <h4>{part.label}</h4>
              {file && (
                <button
                  type="button"
                  className="compendium-art-button"
                  onClick={() => onZoom({ src: cardUrl(file), alt: `${subclass.name} · ${part.label}` })}
                >
                  <Icon name="expand" />
                  Card
                </button>
              )}
            </div>
            <FeatureList features={subclass[part.field]} title={`${part.label} features`} />
          </section>
        );
      })}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Domain cards                                                       */
/* ------------------------------------------------------------------ */

function DomainCardDetail({ entry }: { entry: Entry }) {
  const data = entry.data as DomainCardData;
  return (
    <article className="flex flex-col gap-5">
      <DetailHeading
        name={data.name}
        chips={
          <>
            <Chip tone="violet">{domainLabel(data.domain)}</Chip>
            <Chip>Level {data.level}</Chip>
            <Chip>{data.type}</Chip>
            <Chip>Recall {data.recallCost}</Chip>
          </>
        }
      />
      <section>
        <SectionTitle>Effect</SectionTitle>
        <p className="whitespace-pre-line text-sm leading-relaxed text-slate-300">{data.text}</p>
      </section>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Ancestry / community / transformation                              */
/* ------------------------------------------------------------------ */

function AncestryDetail({ data }: { data: AncestryData; entry: Entry }) {
  return (
    <article className="flex flex-col gap-5">
      <DetailHeading name={data.name} description={data.description} chips={<Chip>Ancestry</Chip>} />
      <FeatureList features={data.features} title="Ancestry features" />
    </article>
  );
}
function CommunityDetail({ data }: { data: CommunityData; entry: Entry }) {
  return (
    <article className="flex flex-col gap-5">
      <DetailHeading name={data.name} description={data.description} chips={<Chip>Community</Chip>} />
      <FeatureList features={data.features} title="Community features" />
    </article>
  );
}

function TransformationDetail({ data }: { data: TransformationData }) {
  return (
    <article className="flex flex-col gap-4">
      <DetailHeading name={data.name} description={data.description} chips={<Chip tone="violet">Transformation</Chip>} />
      <FeatureList features={data.features} />
      <NumberedList items={data.questions} title="Questions" />
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Equipment                                                          */
/* ------------------------------------------------------------------ */

function WeaponDetail({ data, author }: { data: WeaponData; author: string }) {
  return (
    <article className="flex flex-col gap-4">
      <DetailHeading
        name={data.name}
        chips={
          <>
            <Chip tone="amber">Tier {data.tier}</Chip>
            <Chip>{data.category}</Chip>
            <Chip>{data.trait}</Chip>
            <Chip>{data.burden}</Chip>
          </>
        }
      />

      <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-slate-400">Damage</span>
          <span className="text-lg font-semibold tabular-nums text-slate-100">{data.damage}</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span>Range: {data.range}</span>
          <span>·</span>
          <span>{damageTypeLabel(data.damageType)}</span>
          <RollButton notation={data.damage} author={author} />
        </div>
      </div>

      {data.feature ? <FeatureList features={[data.feature]} title="Feature" /> : null}
    </article>
  );
}

function ArmorDetail({ data }: { data: ArmorData }) {
  return (
    <article className="flex flex-col gap-4">
      <DetailHeading
        name={data.name}
        chips={
          <>
            <Chip tone="amber">Tier {data.tier}</Chip>
            <Chip>Armor</Chip>
          </>
        }
      />
      <div className="grid grid-cols-3 gap-2">
        <StatTile label="Score" value={data.baseScore} />
        <StatTile label="Major Threshold" value={data.baseThresholds.major} />
        <StatTile label="Severe Threshold" value={data.baseThresholds.severe} />
      </div>
      {data.feature ? <FeatureList features={[data.feature]} title="Feature" /> : null}
    </article>
  );
}

function ItemDetail({ data }: { data: ItemData }) {
  return (
    <article className="flex flex-col gap-4">
      <DetailHeading name={data.name} description={data.description} chips={<Chip>Item</Chip>} />
      {data.feature ? <FeatureList features={[data.feature]} title="Feature" /> : null}
      {data.rollTable ? (
        <section>
          <SectionTitle>Roll Table</SectionTitle>
          <p className="text-sm text-slate-400">
            {data.rollTable.name} · roll {data.rollTable.roll}
          </p>
        </section>
      ) : null}
    </article>
  );
}

function ConsumableDetail({ data }: { data: ConsumableData }) {
  return (
    <article className="flex flex-col gap-4">
      <DetailHeading name={data.name} description={data.description} chips={<Chip tone="emerald">Consumable</Chip>} />
      {data.rollTable ? (
        <section>
          <SectionTitle>Roll Table</SectionTitle>
          <p className="text-sm text-slate-400">
            {data.rollTable.name} · roll {data.rollTable.roll}
          </p>
        </section>
      ) : null}
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Adversaries                                                        */
/* ------------------------------------------------------------------ */

function AdversaryDetail({ data, author }: { data: AdversaryData; author: string }) {
  const attack = data.attack;
  return (
    <article className="flex flex-col gap-4">
      <DetailHeading
        name={data.name}
        description={data.description}
        chips={
          <>
            <Chip tone="rose">Tier {data.tier}</Chip>
            <Chip tone="amber">{data.type}</Chip>
          </>
        }
      />

      {data.motives ? (
        <p className="text-sm italic leading-relaxed text-slate-400">
          <span className="font-semibold not-italic text-slate-500">Motives: </span>
          {data.motives}
        </p>
      ) : null}

      <div className="grid grid-cols-3 gap-2">
        <StatTile label="Difficulty" value={data.difficulty} />
        <StatTile label="HP" value={data.hp} />
        <StatTile label="Stress" value={data.stress} />
        <StatTile label="Major Threshold" value={data.thresholds.major} />
        <StatTile label="Severe Threshold" value={data.thresholds.severe} />
        <StatTile label="Attack" value={`+${attack.modifier}`} hint={attack.range} />
      </div>

      <section>
        <SectionTitle>Attack</SectionTitle>
        <div className="rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-slate-100">{attack.name}</span>
            <Chip tone="sky">+{attack.modifier}</Chip>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-slate-300">
            <span className="font-mono">{attack.damage}</span>
            <RollButton notation={attack.damage} author={author} />
            <span className="text-slate-500">·</span>
            <span>{attack.range}</span>
            <Chip>{damageTypeLabel(attack.damageType)}</Chip>
          </div>
        </div>
      </section>

      {data.experiences.length > 0 ? (
        <section>
          <SectionTitle>Experiences</SectionTitle>
          <ul className="flex flex-wrap gap-1.5">
            {data.experiences.map((experience) => (
              <li key={experience.name}>
                <Chip tone="emerald">
                  {experience.name} +{experience.bonus}
                </Chip>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <FeatureList features={data.features} />
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Environments / conditions / ranges                                 */
/* ------------------------------------------------------------------ */

function EnvironmentDetail({ data }: { data: EnvironmentData }) {
  return (
    <article className="flex flex-col gap-4">
      <DetailHeading
        name={data.name}
        description={data.description}
        chips={
          <>
            <Chip tone="rose">Tier {data.tier}</Chip>
            <Chip tone="amber">{data.type}</Chip>
            <Chip tone="sky">Difficulty {data.difficulty}</Chip>
          </>
        }
      />

      {data.impulses ? (
        <p className="text-sm leading-relaxed text-slate-400">
          <span className="font-semibold text-slate-500">Impulses: </span>
          {data.impulses}
        </p>
      ) : null}

      {data.potentialAdversaries ? (
        <section>
          <SectionTitle>Potential Adversaries</SectionTitle>
          <p className="text-sm leading-relaxed text-slate-400">{data.potentialAdversaries}</p>
        </section>
      ) : null}

      <FeatureList features={data.features} />
    </article>
  );
}

function ConditionDetail({ data }: { data: ConditionData }) {
  return (
    <article className="flex flex-col gap-4">
      <DetailHeading name={data.name} chips={<Chip>Condition</Chip>} />
      <p className="whitespace-pre-line text-sm leading-relaxed text-slate-300">{data.text}</p>
    </article>
  );
}

function RangeDetail({ data }: { data: RangeData }) {
  return (
    <article className="flex flex-col gap-4">
      <DetailHeading name={data.name} chips={<Chip>Range</Chip>} />
      <p className="text-sm leading-relaxed text-slate-300">{data.distance}</p>
    </article>
  );
}
