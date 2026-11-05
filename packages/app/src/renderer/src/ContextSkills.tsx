import { useState } from 'react';
import type { ContextSkill, ContextSkills as SkillsListing } from '@emerald/shared';
import { useContextHistory } from './context-history-store.ts';
import { LISTING_COLUMN_TITLE, listingNameClass } from './listing-model.ts';
import { ClaudeAiSkillsButton, ListingSwitch, ListingUndoNote, TurnOffOthersButton, useListing } from './ListingSwitch.tsx';
import type { SkillListing } from '../../preload/api.ts';
import type { SkillSectionKey } from './skill-history-model.ts';
import { USED_SHOWN, lastUsedWords, listingTokensText, moreUsedText, skillHistoryOf, skillRowTitle, skillSectionHead, skillSections, syncedFoldText } from './skill-history-model.ts';

// M9 fix 1038 made this section plain; M9 fix 1040 gives it the machine's
// history, after /skill-doctor (docs/design/context-tab.md section 3, A1
// and A11): the never used first, grouped by where each is turned off,
// then the used, most recent first, and a listing switch on every row.
// The history is what the rail's RailContext asked for (FilesRail.tsx),
// read here without asking again; uses live in the row's tooltip, since
// the row's last column is the dropdown.

const READING_TITLE = 'Reading every transcript on this machine';

export function ContextSkills({ skills, folder }: { skills: SkillsListing; folder: string }) {
  const history = useContextHistory(null);
  const { effective } = useListing(folder);
  const [syncedOpen, setSyncedOpen] = useState(false);
  const [allUsed, setAllUsed] = useState<ReadonlySet<SkillSectionKey>>(new Set());
  const now = Date.now();
  const list = skills.skillFrontmatter;
  const row = (s: ContextSkill) => <SkillRow key={s.name} skill={s} folder={folder} value={effective(s.name)} history={history} reading={history.reading} now={now} />;
  const head = (
    <div className="rail-context-columns">
      <span className="rail-context-spacer" />
      <span className="rail-context-column" title="The skill's line in the listing, sent with every request">
        context
      </span>
      <span className="rail-context-column context-skills-last">last used</span>
      <span className="rail-context-column context-skills-listing" title={LISTING_COLUMN_TITLE}>
        listing
      </span>
    </div>
  );
  // Until the first read of every transcript lands, nothing can be
  // grouped; the rows stand by tokens with their history cells reading.
  if (history.reading) {
    return (
      <div className="rail-context-skills" data-reading="">
        {head}
        {[...list].sort((a, z) => z.tokens - a.tokens).map(row)}
        <ListingUndoNote folder={folder} />
      </div>
    );
  }
  const sections = skillSections(list, history);
  // M9 fix 1055: grouped by where each skill lives; the total line sums
  // the never used over every section.
  const neverCount = sections.reduce((n, s) => n + s.never.length + s.synced.length, 0);
  const neverTokens = sections.reduce((n, s) => n + s.tokens, 0);
  return (
    <div className="rail-context-skills">
      {head}
      {neverCount > 0 && <div className="context-skills-never">never used on this machine: {listingTokensText(neverTokens)} in every request</div>}
      {sections.map((section) => {
        const shown = allUsed.has(section.key) ? section.used : section.used.slice(0, USED_SHOWN);
        const rest = section.used.slice(USED_SHOWN);
        return (
          <div key={section.key} className="context-skills-group" data-group={section.key}>
            <div className="context-skills-group-head">{skillSectionHead(section)}</div>
            {section.never.map(row)}
            {section.never.length > 0 && (
              <>
                <div className="context-skills-remedy">turn off in /skills, or remove from .claude/skills</div>
                <TurnOffOthersButton names={section.never.map((s) => s.name)} folder={folder} />
              </>
            )}
            {section.synced.length > 0 && (
              <div className="context-skills-synced" data-open={syncedOpen || undefined}>
                <div className="rail-context-item context-skills-fold" data-clickable="" aria-expanded={syncedOpen} onClick={() => setSyncedOpen(!syncedOpen)}>
                  <span className="rail-context-chevron">{syncedOpen ? '▾' : '▸'}</span>
                  <span className="rail-context-item-name">{syncedFoldText(section.synced)}</span>
                </div>
                {syncedOpen && section.synced.map(row)}
                <div className="context-skills-remedy">turn off on claude.ai; a deleted copy comes back on the next sync</div>
                <ClaudeAiSkillsButton />
              </div>
            )}
            {shown.map(row)}
            {!allUsed.has(section.key) && rest.length > 0 && (
              <button type="button" className="context-skills-more" onClick={() => setAllUsed(new Set([...allUsed, section.key]))}>
                {moreUsedText(rest, history, now)}
              </button>
            )}
          </div>
        );
      })}
      <ListingUndoNote folder={folder} />
    </div>
  );
}

function SkillRow({ skill, folder, value, history, reading, now }: { skill: ContextSkill; folder: string; value: SkillListing; history: Parameters<typeof skillHistoryOf>[0]; reading: boolean; now: number }) {
  const h = reading ? undefined : skillHistoryOf(history, skill);
  const last = value === 'off' ? 'off' : reading ? '…' : lastUsedWords(h?.lastUsedAt, now);
  return (
    <div className="rail-context-item context-skills-row" data-skill={skill.name} title={reading ? READING_TITLE : skillRowTitle(skill, h)}>
      <span className={`rail-context-item-name ${listingNameClass(value)}`.trim()}>{skill.name}</span>
      <span className="rail-context-spacer" />
      <span className="rail-context-item-tokens rail-context-column">{listingTokensText(skill.tokens)}</span>
      <span className="rail-context-column context-skills-last" data-never={last === 'never' || undefined} title={reading ? READING_TITLE : undefined}>
        {last}
      </span>
      <span className="context-skills-listing">
        <ListingSwitch name={skill.name} folder={folder} source={skill.source} {...(skill.pluginName === undefined ? {} : { pluginName: skill.pluginName })} />
      </span>
    </div>
  );
}
