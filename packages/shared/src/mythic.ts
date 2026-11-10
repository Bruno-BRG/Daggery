/** Structured table data extracted from the Mythic oracle PDFs. */

/** Inclusive `[min, max]` roll range. */
export type MythicRange = [number, number];

/**
 * One row of a Mythic table. Depending on the source table a row carries a
 * roll `range` with either a single `text` result or multiple `cells`, or
 * named `ranges` (used by the Ask the Game Master odds chart).
 */
export interface MythicTableEntry {
  range?: MythicRange;
  text?: string;
  cells?: string[];
  /** Named range columns, e.g. `exceptionalYes`, `yes`, `no`, `exceptionalNo`. */
  ranges?: Record<string, MythicRange>;
  id?: string;
  label?: string;
  /** Set when a cell could not be read reliably from the source. */
  unclear?: boolean;
}

export interface MythicTable {
  id: string;
  title: string;
  die: string;
  columns?: string[];
  entries: MythicTableEntry[];
}

export interface MythicTablesFile {
  tables: MythicTable[];
}

export interface MythicData {
  available: boolean;
  oracle: MythicTablesFile | null;
  adventureCrafter: MythicTablesFile | null;
  locationCrafting: MythicTablesFile | null;
  collectedTables: MythicTablesFile | null;
}
