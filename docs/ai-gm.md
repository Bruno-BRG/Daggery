# AI Game Master

Daggery includes a GM runner in the app, with OpenCode Go, OpenCode pay as you go and OpenRouter connections.
GM control is a campaign option, independent of the Group/Solo ruleset. Existing campaigns
continue to use human control until their owner selects AI Game Master.

## Start an adventure

1. Create a campaign, or open **Campaign settings**, and select **AI Game Master**.
2. Open **Adventure → GM connection**. Select **OpenCode Go · subscription** if you
   have Go, or **OpenCode Console / Zen · pay as you go** if you use credits. Paste
   your API key and select a model from that plan's live catalog. When switching
   between the two OpenCode options, a blank key keeps your encrypted saved key.
   Alternatively, choose OpenRouter and use its API key.
3. Describe a premise and tone/boundaries. Choose a memory size: Lean, Balanced (the
   default), Rich or Maximum. Maximum uses up to 60 percent of the model's context window,
   which Daggery reads when you save the connection. Then choose an existing hero, your
   existing party, or create a hero at level 1 with starter equipment and domain cards.
4. Create a session. Nothing runs until you select **Begin the adventure**. Begin opens the
   session with a recap when the journal has entries, and otherwise with the opening scene.
   Type your actions or use a suggested choice. Resolve requested rolls and incoming damage
   using their cards in the conversation.

The Go connection uses `/inference/go/v1/models` and
`/inference/go/openai/v1/chat/completions`. The pay as you go connection uses the
separate `/inference/v1/models` and `/inference/openai/v1/chat/completions` endpoints.
Existing saved credit connections retain their provider; they are not migrated silently.
Daggery never falls back from Go to the credit endpoint. OpenCode's own **Extra Usage**
account setting can still permit credit spending after an allowance is exhausted.
OpenCode describes Go as intended for coding agent traffic; GM traffic may be restricted.
Daggery sends its own user agent and a stable ID for each session, without impersonating
a coding client. Saving loads the catalog but makes no billed inference request.

Each chat request carries the session's ID in an `x-opencode-session` header. Temperature is
sent only when the model's catalog lists support for it: 0.85 for GM turns and 0.2 for
compaction. The catalog's context window and temperature are stored each time the
connection is saved. Connections saved before this change have no stored values, so they
use the base memory budget and send no temperature until they are saved again.

References: [OpenCode Console API](https://opencode.ai/docs/console/api),
[OpenCode Go](https://opencode.ai/docs/console/go/),
[OpenCode inference](https://opencode.ai/docs/console/api/inference),
[OpenRouter tool calling](https://openrouter.ai/docs/guides/features/tool-calling).

## Reasoning and context

DeepSeek reasoning models on OpenCode Go always run at the top effort in their catalog:
Daggery sends `reasoning_effort: "max"` for any model whose id contains `deepseek`.
GM turns on those models request up to 32,000 output tokens because reasoning tokens
count toward the limit; compaction keeps its own smaller budget. If the catalog omits
the context window or reports less than 1,000,000 for a DeepSeek V4 model, memory
budgeting uses 1,000,000 tokens, so Maximum has room for a long campaign in view.

## Sourcebooks and campaign frames

The GM can search the printed books, read a page, and cite it as “Title, p. N” with
`search_sourcebook` and `read_sourcebook_page`. Catalog lookups still use `search_rules`.

Every shipped PDF is extracted by `tools/extract_sources.py --all`, which knows the
stable id, title and page offset of each file in `sources/`:

```sh
python tools/extract_sources.py --all          # all 11 PDFs, with OCR fallback
python tools/extract_sources.py --all --no-ocr # text layer only
```

The output is committed under `sources/rules/*.json` (the repository is private); the
PDFs themselves are excluded from the Docker image. The server loads both
`sources/rules/` and `<DAGGERY_DATA_DIR>/rules/`, with a data-directory file overriding
the committed copy of the same id, so a local re-extraction wins without a code change.
`sources/rules` resolves against the module first and then the working directory, which
covers `tsx src/index.ts`, the compiled output and the Docker image (checkout at `/app`,
server run from `/app/apps/server`). The folder may be absent, in which case the tools
report that no sourcebooks are installed. Set `DAGGERY_REPO_RULES=off` to ignore the
committed copy (the fixture tests do this).

Page records carry `printed` when the book prints a folio (the core rulebook offset is 1:
PDF 255 is printed 254, “The Witherwild”); front matter and the card sheets at the end
are unnumbered. Pages with no text layer are rendered at 200 dpi and read with RapidOCR
(`pip install rapidocr-onnxruntime`) and marked `"ocr": true`. A pure map or illustration
page whose OCR result is unusable stays in the book with `"imageOnly": true` and a short
generated label, so it still appears in listings and can be cited. Batch extraction
prints per-PDF page, character, OCR and image-only counts, and verifies each book's
detected printed offset against the value taken from its contents page.

Overlapping releases are kept as separate sources, but `search_sourcebook` collapses
near-duplicate pages (identical normalized text or 90% token containment) and represents
each cluster with the most authoritative source: the book first, then the newest
supplement, then card sheets and guides, then older tiles and maps. Results and
`listSourcebooks` include a `sourceLabel`/`label` (Book, Cards, Sheets, Guides, Campaign
frame, Map, Supplement) so citations are unambiguous.

Adventure setup can select a published campaign frame: the six core rulebook frames
(The Witherwild, Five Banners Burning, Beast Feast, The Age of Umbra, Motherboard,
Colossus of the Drylands), the Hope & Fear frames (Reign of the Weredragon, Journey to
Horizon) and the Sablewood location. The GM calls `list_campaign_frames` and
`load_campaign_frame`; the first load seeds brief prep and canon (premise, tone,
factions, key NPCs, locations, hooks), and later calls read the printed pages in chunks.
The frame summaries in the registry are authored; the printed pages are read at runtime
and are never committed.

## Play and control

In this guide, the owner is the campaign GM who set up the AI GM, and the GM is the AI
narrator. Adventure combines narration, player input, contextual roll, damage and choice
cards, party resources, navigation, sessions, the adventure journal and a GM activity
ledger. The owner can edit the GM secrets, change setup or connection, pause or resume the
GM, stop any turn, or remove the key. A player can stop a turn that the player started.
Rolls and document changes also update the existing table and sheets through live sync.

Typed GM actions cover campaign context, catalog and printed-source searches, sourcebook
page reads, campaign frames, GM secrets, campaign state, journal notes and searches,
setting and scenario preparation, notes on the Notes page, scenes, miniatures, drawings,
fog, conditions, spotlight, adversaries, standard attacks, requested hero rolls, Fear
costs, countdowns, loot, inventory rewards and choices. In Solo campaigns the GM can
consult the configured oracles, themes and weighted pool. The engine generates the dice
and provides their results to the model.

Action cards use actual sheet traits, Experience costs, Hope/Fear and critical Stress
recovery. Basic attacks with an equipped weapon update adversary HP. Incoming damage requires
player confirmation, with an available Armor Slot option. Repeated resolution cannot
roll or charge twice. Resolving a card starts a GM turn that narrates the result. The player
handles class/card abilities, special adversary features, reactions, recovery, advancement
and death moves through the sheets and tools. The GM can consult source text; arbitrary
printed abilities are not automatically run.

AI + Solo uses ordinary GM responses and explicit Fear payments. The prompt instructs
the model to avoid also applying solo automatic Fear spending for the same response.
The manual Solo workspace remains available. Fictional judgment and pacing remain the
model's responsibility; not every narrative rule can be enforced mechanically.

## Sessions

A campaign can hold many sessions. Each session works like a separate chat, with its own
transcript and session summary. The journal, the campaign digest, the campaign state, the
GM secrets and the GM preparations belong to the whole campaign and carry over from one
session to the next.

Only the owner creates, renames, ends, compacts and deletes sessions. Members see every
session and can play in open ones. While a GM turn is running, creating, deleting, ending
or compacting a session fails with a conflict. The transcript loads 60 messages at a time.

Creating a session starts no GM turn. The owner or a member presses **Begin the adventure**
in an empty session to open it. When the journal has entries, the GM recaps the story so far
from the campaign digest, the previous session summary, the recent chapters and the journal,
and no player message is stored. When the journal is empty, Begin stores a short opening message from the player, and
the GM opens the scene in reply. A session that already has messages cannot be begun again.

Ending a session makes it read only. The GM writes a final chapter from the messages that
are not yet summarized, and the session's open roll and choice cards close. Open damage
cards stay open, but no card can be answered in an ended session. A session with nothing
left to summarize ends without a chapter. Deleting a session removes its messages and GM
activity. Its journal entries stay and keep the session name they had when the session was
deleted.

## Adventure journal

The journal is a campaign record shared by all sessions. It has three kinds of entries.

Events are written automatically for dice rolls, scene changes, encounters, damage, Fear
spending, countdowns, rewards, attacks, conditions and player choices. Events are read
only. An event about a hidden countdown is visible only to the owner. The event that starts
a countdown is always shared, because the GM creates countdowns visible. An event about an
adversary whose map token is hidden is also visible only to the owner.

Notes are written by the GM with `journal_add`, which allows three per turn, or by the
owner. A note is visible only to the owner unless it is marked shared. Titles can be up to
160 characters. A GM note body can be up to 1,200 characters, and an owner note body up to
6,000. Longer text is refused.

Chapters are written when a compaction summarizes older messages, automatic or manual, and
when a session ends with messages left to summarize. Chapters are always shared. They are
numbered across the campaign, and a final chapter has "(final)" in its title.

The owner can edit and delete notes and chapters. Events cannot be changed. Members see
shared entries only. The journal lists entries newest first, 40 at a time, and can be
filtered by kind and searched by text. The GM can search the journal with `search_journal`.
That search covers every entry, including those visible only to the owner. It returns four
results by default and never more than six, with each body trimmed to 600 characters.

## Memory and compaction

Each GM request starts with the static GM prompt, and the tool schemas are sent with it. The
blocks below follow as system messages, in this order:

1. Campaign setup: the game system, the premise, the tone and the player's hero.
2. GM preparations: the setting and the two newest scenarios. See below.
3. Canon: the active entry titles, newest first, with their IDs. The room for this list scales
   with the model's context window (about 1,500 characters by default, more on a large model).
4. Relevant memory: proactive recall of at most six canon entries and six journal entries that
   match the latest player messages, the location, the objective, the open thread titles and the
   active scene. Each hit carries its ID, and journal hits also carry their session label and
   date. The block is left out when nothing scores above the recall threshold.
5. The campaign digest, a rolling summary of the whole campaign of up to 250 words.
6. The recent chapters (three by default; more when the context window allows).
7. The GM secrets and plans, visible only to the owner.
8. The campaign state, visible only to the owner.
9. The session summary, a working summary of the current session of up to 300 words. When the
   current session has no summary yet, the newest previous session summary appears instead, so
   the opening recap can use it.
10. The recent messages of the session that fit in the budget.
11. The table snapshot, which comes last on every request.

The blocks are rebuilt on every request, so changes apply at once.

`search_journal` and `canon_search` use ranked multi-term retrieval rather than a whole-phrase
substring. Queries are lowercased, stripped of accents and stopwords, and lightly stemmed, so
possessives and plurals match ("miller debt" finds "the miller's unpaid debt", "debts" finds
"debt", and "cafe" finds "café"). A title match ranks above a body match, BM25 supplies the base
score, and the most recently updated entry wins a tie. An empty query lists the newest entries.
The journal search covers every session of the campaign, labels each hit with its session and
date, and down-weights engine events so notes and chapters surface first while a uniquely
matching event is still found. Campaign scoping, the shared-only rule for non-GM readers, the
kinds filter and the archived rule are unchanged. Search snippets are 600 characters by default
and grow to 1,000, 1,200 or 1,500 as the memory size and the model's context window allow. The paginated journal list also
matches any query term, while keeping newest-first order and its cursor.

GM preparations are the setting and the scenarios saved with `write_prep`. The GM sees the
setting and the two most recently saved scenarios as one GM only block of at most 2,500
characters. The block starts with the heading "GM preparations (GM only):". It then lists
the setting and each scenario, and each starts with its title. The setting fields appear in
this order: premise, tone, locations, factions, secrets and agreements. The scenario fields
appear in this order: hook, stakes, scenes, cast, rewards and aftermath. A field can hold
6,000 characters when it is saved, but the block shows only the first 600 characters of each
value. Empty fields are left out. If the block would be longer than 2,500 characters, its end
is cut and a note says so.

Each block has its own length limit. The premise is sent up to 1,500 characters, and the tone
is saved with a limit of 300 characters. The digest is sent up to 1,800 characters, each
chapter up to 1,300 characters of text, the GM secrets up to 4,000 characters, the campaign
state up to 6,000 characters, and the session summary up to 2,000 characters.

Lean, Balanced and Rich stay within 17,000 characters by default, about 4,860 estimated tokens;
Maximum allows 60,000. When the blocks are over that cap, the oldest chapter goes first, one at
a time, until they fit. The proactive recall block is dropped whole next, before any durable
text is touched. If they are still over after every chapter and the recall block have gone, the
preparations block and then the canon title list are cut, each ending with a note that says it
was shortened, and the secrets are shortened last. The setup, the digest, the campaign state
and the session summary are never trimmed by the cap.

The GM secrets hold plans and facts that players must not see. `set_memory` rewrites them in
full, and the owner can also edit them in the app. Both refuse text longer than 4,000
characters and save nothing. The owner cannot save the secrets while a GM turn is running.
The GM reads only the first 4,000 characters of any longer text that is already saved.

Notes on the Notes page are never sent to the GM. The journal is the adventure record the
GM reads. Its last three chapters are in the memory, and `search_journal` reaches the rest.

The campaign state holds the location, the time of day, the objective, threads, NPCs, player
promises and facts. The GM updates it with `update_state`. A thread can be open, stalled or
resolved. The lists hold up to 12 threads, 30 NPCs, 10 promises and 20 facts. Adding a
thread, NPC or promise beyond its limit fails until one is removed. When facts go past 20,
the oldest are dropped. The GM reads the state as plain text lines. Each thread, NPC and
promise line ends with its ID, so `update_state` can change that item. Empty fields are left
out. If the rendered state is longer than 6,000 characters, items are left out from the end
of the text, starting with the last facts. The text then says how many items were left out.

Every GM request ends with the table snapshot. It is valid JSON of at most 4,000 characters,
under a heading line that says it is the present state. It holds up to six heroes, the active
scene, up to eight countdowns, up to twelve adversaries in the scene, up to five pending cards
and, in Solo campaigns, the solo state. The campaign state is not in the snapshot. When the
snapshot is too long, the longest list loses its last items and the object gets
`"truncated": true`.

The GM can call `get_context` to read the same snapshot with the campaign state, the setting,
up to three of the newest scenarios with their fields as saved, and up to 12 of the newest
image assets. Each asset comes with its ID, name and media type. `create_scene` can use one of
those IDs as the map. Every tool result is valid JSON of at most 6,000 characters. A result
that is too long loses items from its longest list.

The memory size sets the token budget for memory and messages together. Lean is 12,000
estimated tokens, Balanced is 24,000 (the default) and Rich is 48,000. Maximum is 60 percent
of the model's context window, so a model with a 1,000,000-token window gets 600,000 tokens.
Memory uses no more than its cap, and recent messages get the rest of the budget, with a floor
of 1,000 tokens. The GM prompt and tool schemas add about 4,600 estimated tokens on top of the
budget, and the snapshot adds up to 4,000 characters more. When the catalog reports a context
window for the model, the fixed sizes are capped at 60 percent of that window too. Until a
connection is saved with its window, Maximum uses 48,000 tokens. Tokens are estimated as
characters divided by 3.5.

The memory caps scale with the model's context window. Lean keeps its small fixed caps on every
model: 17,000 characters, three chapters, 2,500 preparation characters and 6,000 state
characters. Balanced, Rich and Maximum grow once the window reaches 80,000 tokens, and grow
further at 200,000 or more. On a 1,000,000-token model, Balanced allows 42,000 memory
characters and nine chapters, Rich allows 65,000 and fourteen chapters, and Maximum allows
150,000 and thirty chapters. The canon title list, the recall block and the search snippet
length grow with the same tiers. Maximum without a known window keeps its original caps:
60,000 characters and twelve chapters. A Maximum request is therefore far larger than a
Balanced one, so it costs more and can take longer. The setup form shows the estimated budget
for each size.

Compaction keeps long sessions within the budget. At the start of a turn, the GM compacts
when the messages that are not yet summarized exceed 60 percent of the message budget. The
newest 30 percent of the message budget stays verbatim, and older messages are summarized.
After a compaction, the next automatic one comes once about 30 percent of the message budget
in new messages has built up. The interval therefore depends on the memory size and the
length of the messages.

A single summarizer request covers at most 40,000 estimated tokens of messages. A larger
backlog, which is common on Maximum, takes several rounds. Each round writes its own chapter,
and the session summary carries forward from one round to the next. The rounds continue until
only the newest messages that fit in the 30 percent tail remain unsummarized. The transcript
shows the summarized notice once.

The owner can also compact an open session now. That skips the 60 percent trigger and keeps
the same 30 percent tail. If every unsummarized message fits in that tail, a manual
compaction writes nothing.

A compaction is one request to the owner's model with no tools. It carries the previous session
summary, the campaign digest, the existing canon titles and the messages to summarize. The reply
must be a JSON object with three text fields: `chapter`, `working` and `digest`, plus an optional
`canon` array. Each text field is cut to its word limit: 180 words for the chapter, 300 for the
working summary and 250 for the digest. A reply with an empty required field counts as
unreadable. Text around the object, such as a code fence, is ignored. If the reply cannot be
read, the server asks the model once more. A valid reply writes the chapter to the journal and
replaces the session summary and the campaign digest.

The optional `canon` array may hold up to five durable new facts, people, places, factions,
promises or plans that the digest might lose. Each item has a `kind`, `title` and `body`, is
validated against the canon kinds and length limits, and is written with source `compaction`
and GM-only visibility. The server keeps at most six per compaction, dedupes them by title
within the reply, and skips any title that already exists in canon, so a compaction never
duplicates or resurrects an archived entry. Invalid items are ignored. The digest therefore
stays a short rolling summary while long-term facts become retrievable canon entries.

If the second reply also fails, the server writes a fallback chapter of at most 1,200
characters. It is made from the titles of up to 12 shared events from the period the batch
covers, followed by the first sentence of up to 12 GM messages. The session summary and the
digest stay unchanged in that case. Unless the session is ending, the transcript then shows a
notice that earlier messages were summarized. Because the summaries come from the model, they
can omit or misstate details. Compaction requests do not count toward the 12 model responses
in a turn.

Compaction uses the owner's selected model. A GM reply can use up to 2,400 output tokens, and
a compaction reply up to 1,800.

## Semantic retrieval (RAG)

Search is hybrid. BM25 stays the base, and a small local sentence model adds meaning-based hits, so a
player who writes “innkeeper” finds an entry that says “tavern keeper”, in Portuguese or English.
No embedding request goes to a provider, so RAG costs nothing and does not depend on OpenCode or
OpenRouter offering an embeddings endpoint.

- Model: `Xenova/paraphrase-multilingual-MiniLM-L12-v2` through Transformers.js and onnxruntime-node,
  384 dimensions, multilingual (Portuguese and English included). Set `DAGGERY_RAG_MODEL` to use
  another Transformers.js model; its dimension is assumed to be 384 unless changed in code.
- Cache: the model downloads once into `<DAGGERY_DATA_DIR>/models`. Loading is lazy, so server start
  and GM turns never wait for a download. If the model cannot be loaded (offline, unsupported
  platform), the failure is logged once and search silently stays BM25-only.
- Disable: set `DAGGERY_RAG=off`. The server then creates no embedder and no vectors are read or
  written.

Vectors are stored in SQLite (`ai_embeddings`, schema version 9): one row per campaign, kind
(`canon` or `journal`) and entry, with a SHA-256 of the embedded text, the model id, the dimension
and a Float32 BLOB. The campaign foreign key cascades, so deleting a campaign removes its vectors.
Ranking is hybrid reciprocal-rank fusion over the BM25 ranking (title-weighted, phrase bonus) and
the cosine ranking. A semantic hit must clear a minimum similarity (0.32) before it can appear on its
own, so unrelated text is not returned; BM25-only entries remain findable before they are embedded.

Live indexing keeps the index current during play. Every canon upsert, journal insert or edit
(GM notes, engine events, chapters, owner edits), and every compaction chapter or promoted canon
enqueues a debounced background job. Jobs are coalesced by entry and text hash, so save-as-is never
re-embeds; archiving canon and deleting a journal entry remove their vector. A turn never waits on
this queue. On startup the server backfills any missing or stale vectors for existing campaigns.
Tests can await the queue with `AiService.flushEmbeddings()` (or `EmbeddingIndex.flush()`).

Hybrid ranking is used by `canon_search`, `search_journal`, `search_sourcebook`, proactive recall
(the query built from the latest player messages, location, objective, open threads and scene), and
`search_rules` for the structured catalog. Result shapes, campaign scoping, visibility rules
(non-GM readers see only shared, non-secret entries), archived handling and the kinds filter are
unchanged; semantic hits pass through the same SQL filters. Recall includes up to two catalog rules
found by meaning, and the GM’s query is embedded once per turn.

Sourcebook pages get vectors too. Each installed book gets a `<source>.vec` cache under
`<DAGGERY_DATA_DIR>/rules/` (never beside the committed JSON in `sources/rules/`), keyed
by the book’s content hash, model and dimension; a book is re-embedded only when its text
or the model changes. The rule folders are rescanned by directory signature, so a book
extracted or replaced while the server runs becomes BM25-searchable on the next
`search_sourcebook` and is embedded by the background rescan, without a restart. Every
page — including OCR text and image-only labels — participates.

The entire structured catalog bundled in `@daggery/content` is embedded: the core book
plus Hope & Fear and Sablewood, across adversaries, ancestries, communities, environments,
items, consumables, weapons, armor, domain cards, classes (with subclasses), domains,
transformations, conditions and ranges. The in-memory index is backed by
`<DAGGERY_DATA_DIR>/catalog-index.vec`, keyed by a content hash plus model id and
dimension, so a normal start loads it instead of embedding ~1,000 entries again. Nothing
is committed; changing the content package or model rebuilds it on the next start. On
this machine a cold build of all 1,235 entries took about 38 s; loading the cache takes
about 0.2 s. The build runs on the existing background startup queue, so it never blocks
a turn.

`npx tsx tools/check_rag_coverage.ts` verifies the whole pipeline against the installed
PDFs: every PDF page must exist in the JSON, every text page must have a vector, and eight
automatically chosen rare 3–5 word phrases per source must return their originating page
in the top 3 of hybrid search. It also runs hand-written semantic questions and writes
`docs/rag-coverage.md` with per-PDF counts, OCR/image-only statistics, hit rates and known
gaps. `apps/server/src/ai-rag-coverage.test.ts` unit-tests the phrase picker,
near-duplicate detection and the book-over-tile preference.

Docker: the `node:22-bookworm` image installs onnxruntime-node and the model is fetched on first use
into the mounted data directory (about 130 MB for the quantized model). The first semantic query after
a cold start may fall back to BM25 while the model loads, then improve by itself.



Sessions, messages, journal entries, actions, setup, memory and campaign state persist in
SQLite. Each campaign permits one active turn, a timeout of five minutes that includes any
compaction rounds, at most 12
successful model responses and 24 committed actions per turn. Turns stop on cancellation,
pause, a missing connection or lost owner authority. These limits apply to each turn. They
do not cap spending on the provider account.

Tool calls and results are privately checkpointed. Successful actions deduplicate by turn
and provider call ID. Retry resumes from the checkpoint and does not repeat them. A server
restart marks interrupted turns failed and exposes retry. This cannot prevent a provider
billing a request whose response was lost. Narration currently appears after a complete
model reply, with status polling during the turn.

## Keys and access

Keys travel to the authenticated backend and are encrypted with AES-256-GCM, authenticated
to their owning user. Responses return only a masked hint, provider and model. A user's
connection can serve their AI campaigns. Current owner authority is checked before each
action.

Set `DAGGERY_AI_SECRET` to a random key of 32 bytes encoded as base64 in production, or the
server creates `ai-keyring.key` in `DAGGERY_DATA_DIR`. Keep it private and **back it up
with the database**. Losing or replacing it requires entering the provider keys again. Do
not commit it. Schema migrations 4, 5 and 6 add AI tables, checkpoints, sessions and the
journal. Migration 6 gives each existing AI campaign one session named Session 1 and moves
its existing messages into that session. Existing campaign data and the database backup
made before a migration are preserved.

The runner has no account, invitation or tools for campaign administration. Each request
includes only the campaign being played, and other campaigns and credentials are not
included. Members see the transcript and shared journal entries. Only the owner sees the
GM secrets, campaign state, digest, session summary, action results and entries visible
only to the owner. Browser routes keep session checks and exact Origin checks. Outbound
requests use fixed provider URLs and redact provider errors.

## Extension boundaries

The shared contract adds `gmController: "ai"`; absence means human control. A system must
declare `supportsAiGm` and register its UI feature before offering AI control. Provider
transport and encrypted credentials are separate from Daggerheart's tools. Daggerheart is
the only shipped AI implementation. A future system requires its own prompt, action adapter
and interaction resolver; a flag does not translate Daggerheart mechanics.

This implementation calls provider APIs from Daggery. An external CLI/MCP connection with a
separate machine identity remains future work. There is no general MCP endpoint or bearer
credential for external agents.

## Verification

The server suite runs every `apps/server/src/*.test.ts`, and all tests pass. The AI memory
tests live in `apps/server/src/ai-memory.test.ts` and `apps/server/src/ai-retrieval.test.ts`;
the latter covers ranked multi-term search, proactive recall, scaled limits, cross-session
search, the previous-session recap and canon promotion from compaction. `ai-rag.test.ts` covers the
semantic layer with a deterministic fake embedder (no model download): live indexing on write, edit,
archive and remove, text-hash coalescing, fallback when the embedder is missing or fails, backfill,
visibility and archived filtering for semantic hits, a synonym query that BM25 misses, sourcebook
vector cache rebuilds and a newly added book, the in-memory catalog index (now covering
every bundled source and category with an on-disk content-hashed cache), and the mid-session
guarantee that a `canon_write` becomes semantically retrievable on the next turn after `flush()`.
`ai-rag-coverage.test.ts` covers the distinctive-phrase picker, near-duplicate collapsing and
the book-over-tile citation preference. `tools/check_rag_coverage.ts` is the end-to-end
coverage proof and writes `docs/rag-coverage.md`.
The shared fixtures in `apps/server/src/ai-test-kit.ts` keep databases in memory and replace the
model provider with a fake fetch.

The 40 tests in `ai-memory.test.ts` cover:

- Sessions: a schema 5 database migrates into one Session 1 per campaign. Sessions keep
  separate transcripts, and a turn cannot start in one session while another runs.
- Ended sessions: an ended session writes a final chapter, refuses turns and card answers,
  and keeps its transcript readable.
- Journal visibility and events: members see only shared entries and cannot write. Each
  consequential tool, each resolved roll and each resolved damage card writes an event, and
  events about hidden targets stay with the owner.
- The `journal_add` cap: a fourth note in one turn is refused, three are stored, and notes
  are owner only unless shared.
- Compaction and retry: each compaction writes one chapter, and a retry after a provider
  failure resumes from its checkpoint without a second chapter.
- Fallback: two unreadable summaries write one fallback chapter from shared events and GM
  lead sentences, and the working summary stays unchanged.
- Summarizer input: the summarizer request has no tools and does not include the GM secrets
  or the campaign state.
- Budget: a campaign of 60 Balanced turns keeps the memory and messages of each request
  within the budget plus 5,000 estimated tokens, and it compacts at least twice.
- Maximum: the budget is 60 percent of the saved window. A backlog of 400 messages is
  summarized in batches of at most about 40,000 estimated tokens, one chapter each, and the
  newest 30 percent stays verbatim. Every request stays within the budget, and the GM keeps
  the newest twelve chapters in view.
- Session header: every model request in a session carries that session's ID in the
  `x-opencode-session` header, including compaction and the end turn.
- Caps: tool results stay within 6,000 characters and remain valid JSON, `search_rules`
  returns at most six results, and the state refuses a 13th thread or a 31st NPC.
- Sessions and Begin: creating a session starts no turn. Begin opens an empty session with a
  recap when the journal has entries, and that recap stores no player message. Otherwise
  Begin stores the player's opening message. A second Begin is refused. A recap cut off before
  its first checkpoint keeps its instruction after a restart. `start` refuses request IDs that
  name internal turns. Renaming relabels the session's journal entries, a running session
  cannot be deleted, and deleting keeps its entries under the old name. The transcript returns
  the newest 60 messages and pages back through earlier ones.
- HTTP routes: the session, Begin, journal, setup, compaction, ending and deletion routes, their
  errors for ended sessions and invalid input, and the Origin check on writes.
- Memory limits: `set_memory` and `PUT /memory` refuse more than 4,000 characters and save
  nothing. When memory is over the cap, the oldest chapter goes first, then the recall block is
  dropped, then the preparations and the secrets are shortened. The preparations block,
  `get_context`, the campaign state text and the snapshot each have tests for their limits.
- Ranked retrieval: multi-word, possessive, plural and accent matches; title matches above
  body matches; visibility, archived handling and the kinds filter; cross-session journal
  search with labels and dates; and engine events ranked below notes.
- Recall: the relevant-memory block appears with IDs, session labels and dates, is left out
  when nothing matches, and is dropped before canon or secrets when memory is tight.
- Scaled limits: Lean keeps its small caps, Balanced and Rich grow on a large context window,
  Maximum grows further, and the canon list and search snippets grow with them.
- Compaction promotion: valid `canon` items become GM-only canon with source `compaction`,
  capped, deduped within a reply and skipped when the title already exists.

Four unit tests check `fitMemory` directly. The oldest chapter goes first, the preparations
are shortened once every chapter is gone, the secrets are shortened last with their own
notice, and memory under the cap is left alone. A fifth unit test checks that the recall block
is dropped before canon and secrets are shortened. End to end, requests never reach the secrets
branch, so only the unit test covers it.

The nine tests in `ai.test.ts` cover encryption isolation, migration, OpenCode Go routing,
model filtering and error redaction, quick start classes, campaign, privacy and Origin
boundaries, document changes, actual player dice, adversary damage and Armor, duplicate
resolution, and cancellation and retry without repeated Fear spending. The other 16 cover
the campaign routes and services, email login, asset uploads, WebSockets and solo play.

Model narration quality is not tested automatically. The fake model returns scripted replies,
so the tests check the engine, the stored data and the prompts. They do not check how the
narration reads. For a live check, follow the [AI GM evaluation checklist](ai-gm-eval.md).

Browser checks used a simulated native provider and an isolated database. They covered setup,
the opening, rolls, choices, retry, stop, pause and reload at 320, 390, 834 and 1440 pixels;
sessions, the recap, compacting now, ending a session, switching sessions, the journal and the
member view; and, after the opening moved to its own Begin action, a fresh session at 390 and
1440 pixels. `docs/ai-preview/qa.json` records the earlier run, which predates sessions. No paid
live inference was performed without a key that a user supplied.

## Limits

- Token counts are estimates. Daggery divides characters by 3.5, so provider token counts and the budgets can differ.
- OpenCode Go may refuse GM traffic under its terms, because OpenCode describes Go as intended for coding agent traffic. A refusal appears as a provider error, and Daggery does not switch to pay as you go billing.
- Model narration quality is not tested automatically. It needs a manual check with a real key.
