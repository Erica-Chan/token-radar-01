// Token launch radar: value model, board builder and farm plans (Node 22, standard library only).
//
// The model is a comparables model, the way DeFi analysts value a protocol: a token's market
// capitalisation per dollar of TVL (MC/TVL, the sector's price-to-book), taken from the live-token
// protocols in the sealed snapshot itself, compared only inside the same category. Two guards keep
// it honest. First, the snapshot carries a market cap for only 144 of its 758 protocols, and some
// categories have one peer or none, so each category's multiple is shrunk toward the overall median
// (a standard shrinkage estimator: with n peers, the category's median gets weight n and the overall
// median gets weight 10), and each peer's own ratio is winsorised at the ratios' 95th percentile
// first, so one token with a near-zero TVL cannot set its whole category's multiple. Second, the
// and 99th percentiles, so one week's spike never decides a ranking. Age enters only as a durability
// factor with diminishing returns (log saturation), never as a prediction that a token will launch.
//
// What the snapshot cannot do is stated, not hidden: it carries no revenue or fees, so the
// revenue multiples (price-to-sales, price-to-fees) that Token Terminal prefers cannot be computed
// from it, and it carries no fully diluted valuation or supply, so the implied value below is an
// implied circulating market capitalisation, not an FDV. Nothing here is a list of protocol names:
// every number a row carries is computed from that row's own TVL, seven-day change, age and
// category, plus the peer multiples the snapshot's live protocols imply.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's named constants: the only numbers in the model that are chosen, not computed. */
export interface ModelConstants {
  /** Weight the overall median gets when a category's multiple is shrunk toward it. */
  shrinkage_prior: number;
  /** Weight of the (winsorised) seven-day TVL change in the growth multiplier. */
  growth_weight: number;
  /** Percentiles of the snapshot's own change_7d distribution used to winsorise it. */
  growth_low_pct: number;
  growth_high_pct: number;
  /** Maturity factor's floor and range: a brand-new protocol scores the floor, a 3-year one the top. */
  maturity_floor: number;
  maturity_range: number;
  /** Days of track record at which the maturity factor stops rising. */
  maturity_days: number;
  /** Age in days assumed when DefiLlama reports no listing date. */
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  shrinkage_prior: 10,
  growth_weight: 0.5,
  growth_low_pct: 0.01,
  growth_high_pct: 0.99,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1095,
  unknown_age_days: 365,
};

export const MODEL_VERSION = 'radar-2';

/** One category's comparable multiple, as the dashboard's peer table shows it. */
export interface PeerMultiple {
  category: string;
  /** Live-token protocols in this category that carry a market cap in the snapshot. */
  live_n: number;
  /** Median MC/TVL of those peers, or null when the category has no peer at all. */
  median_mctvl: number | null;
  /** The multiple the model actually applies (shrunk toward the overall median). */
  multiple: number;
}

/** Everything the model derives from the snapshot before it scores a single protocol. */
export interface ModelFit {
  model: ModelConstants;
  model_version: string;
  /** Median MC/TVL over every live-token protocol in the snapshot that carries a market cap. */
  overall_median_mctvl: number;
  /** The cap each peer's MC/TVL is winsorised at (the ratios' 95th percentile) before medians. */
  ratio_cap: number;
  /** The winsorised bounds for the seven-day change, in per cent. */
  growth_low: number;
  growth_high: number;
  peers: PeerMultiple[];
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    multiple: number;
    peers_n: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row; farm steps travel with it so the page and the board agree. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  multiple: number;
  peers_n: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  mctvl: number;
}

/** Everything the dashboard needs: the board, the live set, the peer table and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  overall_median_mctvl: number;
  ratio_cap: number;
  growth_low: number;
  growth_high: number;
  peers: PeerMultiple[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The p-th percentile (nearest rank, floor) of a list sorted ascending. */
function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const at = Math.floor(p * (sortedAsc.length - 1));
  return sortedAsc[Math.max(0, Math.min(sortedAsc.length - 1, at))]!;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/**
 * The peer multiples: for every category, the median MC/TVL of the snapshot's live-token
 * protocols in that category, shrunk toward the overall median by the shrinkage prior. A
 * category with one peer keeps almost none of its own median; a category with fifteen keeps
 * most of it; a category with no peer takes the overall median outright. No protocol name
 * enters this anywhere: the multiples come from the snapshot's own market caps and TVLs.
 */
export function fitModel(snapshot: Snapshot, model: ModelConstants = MODEL): ModelFit {
  const live = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.tvl_usd > 0);
  if (live.length === 0) throw new SnapshotError('snapshot carries no protocol with a market cap to learn multiples from');
  // Winsorise each peer's ratio at the ratios' 95th percentile first: a token with a
  // near-zero TVL can carry a ratio in the hundreds, and one such peer must never set
  // its whole category's multiple. The overall median is unaffected by the cap.
  const rawRatios = live.map((p) => (p.mcap_usd as number) / p.tvl_usd).sort((a, b) => a - b);
  const ratioCap = percentile(rawRatios, 0.95);
  const ratioOf = (p: SnapshotProtocol): number => Math.min((p.mcap_usd as number) / p.tvl_usd, ratioCap);
  const overall = median(live.map(ratioOf));
  const byCategory = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? 'Other';
    const list = byCategory.get(key);
    if (list === undefined) byCategory.set(key, [ratioOf(p)]);
    else list.push(ratioOf(p));
  }
  const categories = [...new Set(snapshot.protocols.map((p) => p.category ?? 'Other'))].sort();
  const peers: PeerMultiple[] = categories.map((category) => {
    const ratios = byCategory.get(category) ?? [];
    const med = ratios.length > 0 ? median(ratios) : null;
    const multiple = med === null ? overall : (ratios.length * med + model.shrinkage_prior * overall) / (ratios.length + model.shrinkage_prior);
    return { category, live_n: ratios.length, median_mctvl: med, multiple };
  });
  const changes = snapshot.protocols
    .map((p) => p.change_7d)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    .sort((a, b) => a - b);
  return {
    model,
    model_version: MODEL_VERSION,
    overall_median_mctvl: overall,
    ratio_cap: ratioCap,
    growth_low: percentile(changes, model.growth_low_pct),
    growth_high: percentile(changes, model.growth_high_pct),
    peers,
  };
}

/** The shrunk multiple for one protocol's category, from a fit. */
export function multipleFor(fit: ModelFit, category: string | null): { multiple: number; peers_n: number } {
  const peer = fit.peers.find((p) => p.category === (category ?? 'Other'));
  if (peer !== undefined) return { multiple: peer.multiple, peers_n: peer.live_n };
  return { multiple: fit.overall_median_mctvl, peers_n: 0 };
}

/** The three factors and the implied value one protocol gets under a fit. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  fit: ModelFit,
): { implied: number; multiple: number; peers_n: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const { multiple, peers_n } = multipleFor(fit, protocol.category);
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(fit.growth_high, Math.max(fit.growth_low, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * fit.model.growth_weight;
  const ageForModel = age ?? fit.model.unknown_age_days;
  const maturityMult =
    fit.model.maturity_floor +
    fit.model.maturity_range * (Math.log(1 + Math.max(ageForModel, 0)) / Math.log(1 + fit.model.maturity_days));
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult));
  return { implied, multiple, peers_n, growthPct, growthMult, maturityMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A name carrying a whole word wrapped, staked or staking is a product of a token that trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** A name beginning with an exchange's name is that exchange's product, not a launch of its own. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
/** Categories the watchlist rule keeps out: bridges and staked products of tokens that trade. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, and passing the watchlist's own
 * quality filters (the only difference from the watchlist is the $50M floor). A wrapped or
 * staked product of a token that already trades is never a launch, whatever its TVL.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !EXCLUDED_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !WRAPPED_WORD.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name)
  );
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, fit: ModelFit): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names, even one the snapshot no longer carries.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every rankable protocol below the watchlist floor, by TVL. Never a
  // replacement for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, fit);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      multiple: round4(s.multiple),
      peers_n: s.peers_n,
      growth_pct: round4(s.growthPct),
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

export function stepText(step: FarmStep): string {
  return `${step.text}. Cost: ${step.cost}. Time: ${step.time}.`;
}

/** The protocol's main chain, for gas and wallet wording. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** A sensible position size for a protocol of this scale. */
function capitalFor(p: SnapshotProtocol): string {
  if (p.tvl_usd >= 500_000_000) return '$1,000 to $10,000';
  if (p.tvl_usd >= 100_000_000) return '$500 to $5,000';
  return '$100 to $1,000';
}

/** What one transaction costs on the protocol's main chain. */
function gasFor(chain: string): string {
  if (chain === 'Ethereum') return '$5 to $40 per transaction in gas';
  if (chain === 'Solana' || chain === 'Base' || chain === 'Arbitrum' || chain === 'Optimism' || chain === 'Unichain') {
    return 'under $2 per transaction in gas';
  }
  return '$1 to $5 per transaction in gas';
}

/** How long to stay active: younger protocols need a longer observation window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 90;
  if (age < 90) return 90;
  if (age < 365) return 60;
  return 30;
}

/**
 * The core action for a category: what a farmer actually does in the product, in one
 * sentence. Categories the table does not name fall back to using the main product
 * regularly; the fallback is a kind of product, never a protocol name.
 */
function actionFor(p: SnapshotProtocol): string {
  const actions: Record<string, string> = {
    Lending: 'supply assets to the lending markets and, if you can manage the risk, borrow against them so the address shows both sides of the book',
    Dexs: 'provide liquidity to the busiest pools and route a few swaps through the protocol each week',
    'Risk Curators': 'deposit into the curated vaults and keep the position open while the curators rebalance',
    'Onchain Capital Allocator': 'deposit into the allocation vaults and stay deposited while the allocator rotates capital between strategies',
    Yield: 'deposit into the yield strategies and compound or restake the rewards instead of taking them out',
    'Yield Aggregator': 'deposit into the aggregated vaults and leave the position to compound across harvests',
    Derivatives: 'open a small hedged position on the derivatives market and manage it rather than leaving it untouched',
    RWA: 'buy or hold the tokenised real-world-asset products and keep them in the same wallet over time',
    CDP: 'lock collateral, mint the protocol stable asset, and keep the position safely above liquidation',
    'Basis Trading': 'take part in the basis trade the protocol runs and keep the position delta-neutral',
    'Liquidity Manager': 'deposit into the managed liquidity positions and leave them in place through rebalances',
    'Leveraged Farming': 'open a modest leveraged farming position and check the liquidation level every day',
    Chain: 'use the chain core apps and bridge assets in, so the address is active on the network itself',
    CeDeFi: 'deposit into the CeDeFi product and keep funds working through its strategies',
    'Collateral Markets': 'post collateral in the protocol markets and keep the position collateralised',
    'Governance Incentives': 'vote in governance and hold the incentivised positions the protocol rewards',
    Insurance: 'buy cover for a position you already hold and keep the policy active',
    Payments: 'route regular payments through the protocol so usage is steady rather than one-off',
    Restaking: 'restake assets through the protocol and keep the restaked position active',
    'Staking Pool': 'stake in the pool and keep the stake bonded for the full period',
    'Stablecoin Wrapper': 'wrap and hold the stable asset through the protocol wrapper',
  };
  return actions[p.category ?? ''] ?? 'use the protocol main product regularly and keep a position open in it';
}

/**
 * Five concrete farm steps for one protocol. Every step names its cost and its time, and
 * every step is built from the protocol's own fields (chain, TVL, age, category) plus the
 * tables above. No step promises a token or an airdrop: the protocol records no token,
 * and a launch is its own decision, not this board's.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const gas = gasFor(chain);
  const hold = holdDaysFor(age);
  const action = actionFor(p);
  return [
    {
      text: `Read the protocol docs and check its official site and social accounts, so you use the real product and not a copycat; confirm it records no token before you start`,
      cost: 'no money, about an hour of reading',
      time: '1 day',
    },
    {
      text: `Set up a wallet on ${chain} and fund it with ${capital} for the position plus gas money, keeping the seed phrase offline and never sharing it`,
      cost: gas,
      time: '1 day',
    },
    {
      text: `Start with ${capital}: ${action}`,
      cost: `${gas} to open the position`,
      time: `1 day to open, then at least ${hold} days active`,
    },
    {
      text: `Stay active: repeat the core action weekly, keep the position open for at least ${hold} days, and watch the protocol announcements for points or eligibility rules`,
      cost: `${gas} per repeat action`,
      time: `${hold} days minimum`,
    },
    {
      text: `Plan the exit before any launch: decide in advance when you would claim, sell or unstake, keep records for tax, and never pay anyone who messages you first about a claim`,
      cost: 'no extra cost to plan',
      time: '1 day to set up, then check weekly',
    },
  ];
}

/** The live-token set: the 24 largest by market cap, for the dashboard's comparison tab. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.tvl_usd > 0)
    .sort((a, b) => (b.mcap_usd as number) - (a.mcap_usd as number) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd as number,
      change_7d: p.change_7d,
      mctvl: round4((p.mcap_usd as number) / p.tvl_usd),
    }));
}

/** The dashboard's compact view of one board row. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    multiple: row.model.multiple,
    peers_n: row.model.peers_n,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Build the board and everything the dashboard needs from one snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData; fit: ModelFit } {
  const fit = fitModel(snapshot, model);
  const board = buildBoard(snapshot, fit);
  const live = liveRows(snapshot);
  const watchlistSize = snapshot.watchlist.length;
  const earlySize = board.length - watchlistSize;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: 'DefiLlama public API, fetched 2026-11-14',
    floor_usd: snapshot.floor_usd,
    model: fit.model,
    model_version: fit.model_version,
    overall_median_mctvl: round4(fit.overall_median_mctvl),
    ratio_cap: round4(fit.ratio_cap),
    growth_low: round4(fit.growth_low),
    growth_high: round4(fit.growth_high),
    peers: fit.peers,
    watchlist_size: watchlistSize,
    board_size: board.length,
    early_size: earlySize,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar, fit };
}

/** Parse and validate the sealed snapshot. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null) throw new SnapshotError('snapshot is not an object');
  const s = raw as Record<string, unknown>;
  if (typeof s.as_of !== 'string' || typeof s.floor_usd !== 'number' || !Array.isArray(s.protocols) || !Array.isArray(s.watchlist)) {
    throw new SnapshotError('snapshot is missing as_of, floor_usd, protocols or watchlist');
  }
  for (const p of s.protocols as Record<string, unknown>[]) {
    const keys = Object.keys(p).sort().join(',');
    if (keys !== 'category,chains,change_7d,gecko_id,listed_at,mcap_usd,name,slug,symbol,tvl_usd') {
      throw new SnapshotError(`protocol ${String(p.slug ?? '?')} does not carry exactly the ten snapshot fields`);
    }
  }
  return raw as Snapshot;
}

/** The gate's own shape, checked before anything is written: null when the board is valid. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, not 100 to 4000`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let prev = Number.POSITIVE_INFINITY;
  const firstValue = board.length > 0 ? board[0]!.implied_value_usd : 0;
  let allSame = board.length >= 2;
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (row.rank !== i + 1) return `row ${row.slug} has rank ${row.rank}, not ${i + 1}`;
    if (!slugs.has(row.slug)) return `row ${row.slug} is not one of the snapshot protocols`;
    if (seen.has(row.slug)) return `slug ${row.slug} appears twice`;
    seen.add(row.slug);
    if (row.name.trim().length === 0) return `row ${row.slug} has no name`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0 || row.implied_value_usd > 100_000_000_000_000) {
      return `row ${row.slug} has implied value ${row.implied_value_usd}`;
    }
    if (row.implied_value_usd > prev) return `implied value rises at rank ${row.rank}`;
    if (row.implied_value_usd !== firstValue) allSame = false;
    prev = row.implied_value_usd;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `row ${row.slug} has ${row.farm_steps.length} farm steps`;
    for (const step of row.farm_steps) {
      const trimmed = step.trim();
      if (trimmed.length < 20 || trimmed.length > 600) return `row ${row.slug} has a farm step of ${trimmed.length} characters`;
    }
  }
  if (allSame && board.length >= 2) return 'every implied value is the same: the board ranks nothing';
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist protocol ${slug} is missing from the board`;
  }
  return null;
}

/** The dashboard's data file: one global the page reads, no network involved. */
export function dataScript(radar: RadarData): string {
  return `window.TOKEN_RADAR_DATA = ${JSON.stringify(radar)};\n`;
}
