import type { CSSProperties, ReactNode } from 'react';
import { Icon, type IconName } from '../../components/Icon';
import { presentAbility } from './abilityPresentation';
import './ability.css';

const DOMAINS: Record<string, { color: string; icon: IconName }> = {
  arcana: { color: 'light-dark(#7750a5, #bba0f6)', icon: 'magic' }, blade: { color: 'light-dark(#a04460, #eaa0b2)', icon: 'weapon' },
  bone: { color: 'light-dark(#846027, #dfc18e)', icon: 'bone' }, codex: { color: 'light-dark(#426ca5, #9ebef4)', icon: 'book' },
  dread: { color: 'light-dark(#5b3f74, #c5a9df)', icon: 'adversary' },
  grace: { color: 'light-dark(#8f4d87, #dca8d5)', icon: 'feather' }, midnight: { color: 'light-dark(#71509d, #b4a4e7)', icon: 'moon' },
  sage: { color: 'light-dark(#3d7554, #9bcdad)', icon: 'leaf' }, splendor: { color: 'light-dark(#886a22, #ead19c)', icon: 'sun' },
  valor: { color: 'light-dark(#376c85, #9ecbdf)', icon: 'shield' },
};

export function AbilityCard({ name, text, category = 'Class feature', domain, footer, compact = false }: {
  name: string; text: string; category?: string; domain?: string; footer?: ReactNode; compact?: boolean;
}) {
  const isHope = /^Hope:\s*/i.test(name);
  const title = name.replace(/^Hope:\s*/i, '').toLocaleLowerCase().replace(/(^|\s)(\p{L})/gu, (_, space: string, letter: string) => space + letter.toLocaleUpperCase());
  const presentation = presentAbility(name, text);
  const theme = domain ? DOMAINS[domain] : undefined;
  const color = theme?.color ?? (isHope ? 'light-dark(#8a5d14, #e5b04b)' : 'light-dark(#2e6480, #8ad8ea)');
  const icon = presentation.icon ?? theme?.icon ?? (isHope ? 'spark' : 'book');
  const expandedRules = presentation.summary !== text.trim() || !!presentation.benefits?.length || !!presentation.metric;
  const heading = <header className="ability-heading"><span className="ability-emblem"><Icon name={icon} /></span><div><span className="ability-category">{isHope ? 'Hope feature' : category}</span><h4>{title}</h4></div></header>;
  const content = <>
    {presentation.metric && <div className="ability-metric"><strong>{presentation.metric.value}</strong><span>{presentation.metric.label}</span></div>}
    {presentation.summary && <p className="ability-summary">{presentation.summary}</p>}
    {presentation.facts.length > 0 && <dl className="ability-facts">{presentation.facts.map(fact => <div key={fact.label}><dt><Icon name={fact.icon} />{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>}
    {presentation.benefits && <ul className="ability-benefits">{presentation.benefits.map(benefit => <li key={benefit.text}><span><Icon name={benefit.icon} /></span><p>{benefit.text}</p></li>)}</ul>}
    {expandedRules && <details className="ability-rules"><summary aria-label={`Full rules for ${title}`}><Icon name="book" /><span>Full rules</span><Icon name="chevron" /></summary><div>{text.split(/\n+/).filter(Boolean).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div></details>}
    {footer && <footer className="ability-footer">{footer}</footer>}
  </>;
  if (compact) return <details className="ability-card ability-compact" style={{ '--ability-color': color } as CSSProperties}><summary aria-label={`Open ability ${title}`}>{heading}<Icon name="chevron" /></summary><div className="ability-compact-body">{content}</div></details>;
  return <article className="ability-card" style={{ '--ability-color': color } as CSSProperties} aria-label={name}>{heading}{content}</article>;
}
