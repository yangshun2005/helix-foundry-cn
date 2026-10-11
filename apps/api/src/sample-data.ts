// Loopwell: a fictional B2B feedback and roadmap SaaS, seen through the five systems
// a startup like it runs on. One backbone of accounts and users is rendered in each
// system's own shape (matching Foundry's connectors), so the same customer appears as
// a PlanetScale account, a WorkOS organization, a Stripe customer, PostHog activity and
// S3 exports. Deterministic: seeded streams and a fixed anchor date, no wall clock.
import type { sampleSources } from "../../../packages/shared/src/index.js";

export type SampleSource = (typeof sampleSources)[number];
export type SampleDataset = {
  name: string;
  source: SampleSource;
  description: string;
  rows: Record<string, unknown>[];
};
// Bump when the generated data changes so existing workspaces pick up the new set.
export const SAMPLE_SET = "loopwell-v1";

const ANCHOR = Date.UTC(2026, 8, 1); // exclusive end of the data
const START = Date.UTC(2026, 0, 5);
const DAY = 86_400_000,
  HOUR = 3_600_000,
  MIN = 60_000;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(s: string) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
type Rand = () => number;
// Independent streams, so changing one system's rows never reshuffles another's.
const stream = (label: string): Rand => mulberry32(hash("loopwell:" + label));
const int = (r: Rand, lo: number, hi: number) =>
  lo + Math.floor(r() * (hi - lo + 1));
const between = (r: Rand, lo: number, hi: number) => lo + r() * (hi - lo);
const pick = <T>(r: Rand, xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
const chance = (r: Rand, p: number) => r() < p;

const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const B36 = "0123456789abcdefghijklmnopqrstuvwxyz";
const HEX = "0123456789abcdef";
const chars = (r: Rand, alphabet: string, n: number) =>
  Array.from({ length: n }, () => pick(r, alphabet.split(""))).join("");
function ulid(r: Rand, t: number) {
  let time = "",
    x = Math.floor(t);
  for (let i = 0; i < 10; i++) {
    time = B32[x % 32] + time;
    x = Math.floor(x / 32);
  }
  return time + chars(r, B32, 16);
}
function uuid7(r: Rand, t: number) {
  const h = Math.floor(t).toString(16).padStart(12, "0");
  return `${h.slice(0, 8)}-${h.slice(8)}-7${chars(r, HEX, 3)}-${pick(r, ["8", "9", "a", "b"])}${chars(r, HEX, 3)}-${chars(r, HEX, 12)}`;
}
// Each system's timestamp format, as its connector imports it.
const isoMs = (t: number) => new Date(Math.floor(t)).toISOString(); // WorkOS, PostHog
const unixIso = (t: number) =>
  new Date(Math.floor(t / 1000) * 1000).toISOString(); // Stripe
const mysql = (t: number) =>
  new Date(t).toISOString().slice(0, 19).replace("T", " "); // PlanetScale, CSV
const workHours = (r: Rand, t: number) =>
  Math.floor(t / DAY) * DAY + between(r, 8, 19) * HOUR;
const addMonths = (t: number, m: number) => {
  const d = new Date(t);
  d.setUTCMonth(d.getUTCMonth() + m);
  return d.getTime();
};
const capital = (s: string) => s[0].toUpperCase() + s.slice(1);

const campaigns = [
  [
    "paid-search-brand",
    "Google Ads: brand terms",
    "paid_search",
    "2026-01-05",
    "2026-08-31",
    9600,
  ],
  [
    "g2-reviews",
    "G2 category listing",
    "review_site",
    "2026-01-05",
    "2026-08-31",
    4800,
  ],
  [
    "product-hunt-launch",
    "Product Hunt launch",
    "community",
    "2026-02-10",
    "2026-02-20",
    1500,
  ],
  [
    "linkedin-abm-q2",
    "LinkedIn: product leaders ABM",
    "paid_social",
    "2026-04-01",
    "2026-06-30",
    24000,
  ],
  [
    "giveaway-q2",
    "Instagram: roadmap template giveaway",
    "paid_social",
    "2026-04-13",
    "2026-05-31",
    18000,
  ],
  [
    "partner-webinar-may",
    "Partner webinar: product ops",
    "partner",
    "2026-05-18",
    "2026-05-29",
    2500,
  ],
].map(([campaign_id, name, channel, start_date, end_date, spend_usd]) => ({
  campaign_id: campaign_id as string,
  name,
  channel,
  start_date: start_date as string,
  end_date: end_date as string,
  spend_usd,
}));

type Archetype =
  | "enterprise" // SSO, expands seats
  | "champion" // activates fast, expands
  | "steady"
  | "at_risk" // paying, usage fading, open bugs
  | "churned" // tickets spike, usage decays, cancels
  | "past_due" // still using, card failing
  | "trial_lost" // never converts; mostly the giveaway campaign
  | "trialing"; // signed up in the last two weeks
// [archetype, signup campaign, accounts]; membership is fixed so every pattern is testable.
const SLOTS: [Archetype, string | null, number][] = [
  ["enterprise", "linkedin-abm-q2", 3],
  ["enterprise", null, 2],
  ["champion", "paid-search-brand", 3],
  ["champion", "g2-reviews", 2],
  ["champion", "partner-webinar-may", 2],
  ["champion", "product-hunt-launch", 1],
  ["champion", null, 2],
  ["steady", "paid-search-brand", 3],
  ["steady", "g2-reviews", 3],
  ["steady", "product-hunt-launch", 2],
  ["steady", "partner-webinar-may", 1],
  ["steady", null, 3],
  ["at_risk", "paid-search-brand", 1],
  ["at_risk", "g2-reviews", 1],
  ["at_risk", "linkedin-abm-q2", 1],
  ["at_risk", "product-hunt-launch", 1],
  ["at_risk", null, 1],
  ["churned", "giveaway-q2", 3],
  ["churned", "product-hunt-launch", 2],
  ["churned", "paid-search-brand", 1],
  ["churned", null, 1],
  ["past_due", "paid-search-brand", 1],
  ["past_due", "g2-reviews", 1],
  ["past_due", null, 1],
  ["trial_lost", "giveaway-q2", 8],
  ["trial_lost", "product-hunt-launch", 2],
  ["trial_lost", "paid-search-brand", 2],
  ["trial_lost", null, 2],
  ["trialing", "paid-search-brand", 2],
  ["trialing", "g2-reviews", 1],
  ["trialing", null, 1],
];
// Signup window in days after START, per archetype.
const WINDOW: Record<Archetype, [number, number]> = {
  enterprise: [5, 140],
  champion: [0, 170],
  steady: [0, 185],
  at_risk: [0, 140],
  churned: [0, 125],
  past_due: [0, 150],
  trial_lost: [0, 200],
  trialing: [226, 236],
};
const PRICES = {
  starter: { nickname: "Starter (per seat)", amount: 2000 },
  growth: { nickname: "Growth (per seat)", amount: 4000 },
  enterprise: { nickname: "Enterprise (per seat)", amount: 6500 },
} as const;
type Tier = keyof typeof PRICES;

const NAMES_A = [
  "Ashgrove",
  "Bramble",
  "Copperline",
  "Driftwood",
  "Emberly",
  "Fernhill",
  "Glasswing",
  "Harborview",
  "Ironbark",
  "Juniper",
  "Kestrel",
  "Lanternfish",
  "Marigold",
  "Northfield",
  "Oakhurst",
  "Pinecrest",
  "Quillfeather",
  "Riverstone",
  "Saltmarsh",
  "Thistle",
];
const NAMES_B = [
  "Labs",
  "Health",
  "Logistics",
  "Studio",
  "Analytics",
  "Foods",
  "Legal",
  "Robotics",
  "Supply",
  "Energy",
  "Learning",
  "Freight",
];
const GIVEN = [
  "ava",
  "ben",
  "chloe",
  "dev",
  "elena",
  "farah",
  "gabe",
  "hana",
  "isaac",
  "jonah",
  "kira",
  "leo",
  "maya",
  "nico",
  "omar",
  "priya",
  "quinn",
  "rosa",
  "sam",
  "tara",
  "uma",
  "victor",
  "wen",
  "yusuf",
  "zoe",
];
const FAMILY = [
  "adams",
  "brooks",
  "chen",
  "diaz",
  "evans",
  "fischer",
  "garcia",
  "hughes",
  "ito",
  "jensen",
  "kim",
  "lopez",
  "morgan",
  "nakamura",
  "okafor",
  "patel",
  "reyes",
  "singh",
  "tanaka",
  "walsh",
  "xu",
  "zhang",
];

type User = {
  user_id: string;
  workos_user_id: string | null;
  person_id: string;
  given: string;
  family: string;
  email: string;
  role: string;
  joined: number;
  lastSeen: number | null;
};
type Account = {
  i: number;
  archetype: Archetype;
  campaign: string | null;
  created: number;
  account_id: string;
  name: string;
  domain: string;
  org_id: string;
  tier: Tier;
  seats: { t: number; seats: number; tier: Tier }[];
  activatedAt: number | null;
  convertedAt: number | null;
  churnAt: number | null;
  ssoAt: number | null;
  cancelScheduled: boolean;
  customer_id: string | null;
  users: User[];
};

function backbone() {
  const r = stream("accounts");
  const slots = SLOTS.flatMap(([archetype, campaign, n]) =>
    Array.from({ length: n }, () => ({ archetype, campaign })),
  );
  const names = NAMES_A.flatMap((a) => NAMES_B.map((b) => `${a} ${b}`));
  const accounts: Account[] = slots.map(({ archetype, campaign }, i) => {
    let [lo, hi] = WINDOW[archetype];
    const c = campaigns.find((x) => x.campaign_id === campaign);
    if (c) {
      lo = Math.max(lo, (Date.parse(c.start_date) - START) / DAY);
      hi = Math.min(hi, (Date.parse(c.end_date) - START) / DAY);
    }
    const created = workHours(r, START + int(r, lo, hi) * DAY);
    const name = names.splice(int(r, 0, names.length - 1), 1)[0];
    return {
      i,
      archetype,
      campaign,
      created,
      name,
      account_id: "acct_" + chars(r, B36, 8),
      domain: name.toLowerCase().replace(/[^a-z]/g, "") + ".example",
      org_id: "org_" + ulid(r, created + 2000),
      tier: "starter",
      seats: [],
      activatedAt: null,
      convertedAt: null,
      churnAt: null,
      ssoAt: null,
      cancelScheduled: false,
      customer_id: null,
      users: [],
    };
  });
  accounts.sort((a, b) => a.created - b.created);
  const nth = new Map<Archetype, number>();
  for (const a of accounts) {
    const k = nth.get(a.archetype) || 0;
    nth.set(a.archetype, k + 1);
    const activates = {
      enterprise: true,
      champion: true,
      steady: true,
      at_risk: true,
      past_due: true,
      churned: k < 3,
      trial_lost: k < 3,
      trialing: k < 2,
    }[a.archetype];
    if (activates)
      a.activatedAt =
        a.created +
        (a.archetype === "enterprise"
          ? between(r, 8, 18)
          : between(r, 1.5, 9)) *
          DAY;
    a.tier = (
      {
        enterprise: "enterprise",
        champion: "growth",
        steady: k % 2 ? "starter" : "growth",
        at_risk: "growth",
        churned: "starter",
        past_due: "growth",
        trial_lost: "starter",
        trialing: "growth",
      } as const
    )[a.archetype];
    const initial = {
      enterprise: int(r, 10, 16),
      champion: int(r, 4, 7),
      steady: int(r, 3, 6),
      at_risk: int(r, 4, 7),
      churned: int(r, 2, 4),
      past_due: int(r, 3, 5),
      trial_lost: int(r, 1, 2),
      trialing: int(r, 1, 3),
    }[a.archetype];
    a.seats.push({ t: a.created, seats: initial, tier: a.tier });
    if (!["trial_lost", "trialing"].includes(a.archetype))
      a.convertedAt = a.created + 14 * DAY - between(r, 2, 72) * HOUR;
    if (a.archetype === "enterprise") {
      a.ssoAt = a.convertedAt! + between(r, 7, 25) * DAY;
      let t = a.ssoAt + between(r, 20, 40) * DAY,
        seats = initial;
      for (let b = int(r, 1, 2); b > 0 && t < ANCHOR - 10 * DAY; b--) {
        seats += int(r, 4, 9);
        a.seats.push({ t, seats, tier: a.tier });
        t += between(r, 30, 55) * DAY;
      }
    }
    if (a.archetype === "champion") {
      const t = a.convertedAt! + between(r, 30, 70) * DAY;
      if (t < ANCHOR - 10 * DAY)
        a.seats.push({ t, seats: initial + int(r, 2, 4), tier: a.tier });
    }
    if (a.archetype === "churned")
      a.churnAt = Math.min(
        addMonths(a.convertedAt!, int(r, 2, 4)) - between(r, 1, 6) * DAY,
        ANCHOR - between(r, 2, 8) * DAY,
      );
    if (a.archetype === "at_risk") a.cancelScheduled = k < 2;
  }
  // Users: owner at signup, teammates over the first weeks, more when seats expand.
  const ru = stream("users");
  const emails = new Set<string>();
  for (const a of accounts) {
    const add = (joined: number, role: string, pending = false) => {
      let given: string, family: string, email: string;
      do {
        given = pick(ru, GIVEN);
        family = pick(ru, FAMILY);
        email = `${given}.${family}@${a.domain}`;
      } while (emails.has(email));
      emails.add(email);
      a.users.push({
        user_id: "usr_" + chars(ru, B36, 8),
        workos_user_id: pending ? null : "user_" + ulid(ru, joined + 1000),
        person_id: uuid7(ru, joined - between(ru, 1, 3) * DAY),
        given,
        family,
        email,
        role,
        joined,
        lastSeen: null,
      });
    };
    add(a.created, "owner");
    const end = Math.min(a.churnAt ?? ANCHOR, ANCHOR) - DAY;
    for (let k = 1; k < a.seats[0].seats; k++)
      add(
        Math.min(end, a.created + between(ru, 0.2, 12) * DAY),
        k === 1 && chance(ru, 0.4) ? "admin" : "member",
      );
    for (let s = 1; s < a.seats.length; s++)
      for (let k = a.seats[s - 1].seats; k < a.seats[s].seats; k++)
        add(a.seats[s].t - between(ru, 1, 48) * HOUR, "member");
    // Invited but never accepted: no WorkOS user yet.
    if (a.users.length > 3 && chance(ru, 0.5))
      add(Math.min(end, a.created + between(ru, 20, 60) * DAY), "member", true);
  }
  return accounts;
}

function posthogEvents(accounts: Account[]) {
  const r = stream("posthog");
  const events: (Record<string, unknown> & { t: number })[] = [];
  const APP = "https://app.loopwell.example";
  const sessions = new Map<string, string>();
  const sessionFor = (u: User, t: number) => {
    const day = Math.floor(t / DAY);
    const key = u.user_id + ":" + day;
    if (!sessions.has(key)) sessions.set(key, uuid7(r, day * DAY + 8 * HOUR));
    return sessions.get(key)!;
  };
  for (const a of accounts) {
    const owner = a.users[0];
    const live = a.users.filter((u) => u.workos_user_id);
    const ev = (u: User, t: number, event: string, url?: string) => {
      if (t >= ANCHOR || t < u.joined - 5 * MIN) return;
      u.lastSeen = Math.max(u.lastSeen ?? 0, t);
      const session = url ? sessionFor(u, t) : null;
      events.push({
        t,
        event_id: uuid7(r, t),
        event,
        timestamp: isoMs(t),
        distinct_id: u.user_id,
        person_id: u.person_id,
        session_id: session,
        current_url: url ? APP + url : null,
        properties: url
          ? { $lib: "web", $session_id: session, $current_url: APP + url }
          : { $lib: "posthog-node" },
      });
    };
    // Anonymous visits before signup merge into the owner's person on identify.
    if (a.campaign) {
      const anon = uuid7(r, a.created - 3 * DAY),
        session = uuid7(r, a.created - 2 * DAY);
      for (let k = int(r, 1, 3); k > 0; k--) {
        const t = a.created - k * between(r, 5, 90) * MIN;
        events.push({
          t,
          event_id: uuid7(r, t),
          event: "$pageview",
          timestamp: isoMs(t),
          distinct_id: anon,
          person_id: owner.person_id,
          session_id: session,
          current_url: `https://loopwell.example/pricing?utm_campaign=${a.campaign}`,
          properties: {
            $lib: "web",
            $session_id: session,
            $current_url: `https://loopwell.example/pricing?utm_campaign=${a.campaign}`,
            utm_campaign: a.campaign,
          },
        });
      }
    }
    for (const u of live) {
      ev(u, u.joined + 30_000, "signed_up");
      if (u !== owner)
        ev(
          owner,
          Math.max(
            owner.joined + 10 * MIN,
            u.joined - between(r, 1, 20) * HOUR,
          ),
          "teammate_invited",
          "/settings/members",
        );
    }
    if (a.activatedAt)
      ev(owner, a.activatedAt, "roadmap_published", "/roadmap");
    if (a.convertedAt)
      ev(
        owner,
        a.convertedAt - between(r, 2, 30) * MIN,
        "upgrade_clicked",
        "/settings/billing",
      );
    if (a.ssoAt) ev(owner, a.ssoAt, "sso_enabled");
    if (a.activatedAt && chance(r, 0.6))
      ev(
        owner,
        a.activatedAt + between(r, 1, 10) * DAY,
        "integration_connected",
        "/settings/integrations",
      );
    // Weekly product usage; each archetype has its own curve.
    const intensity = (t: number, week: number) => {
      const quiet = a.churnAt ?? ANCHOR;
      switch (a.archetype) {
        case "enterprise":
          return Math.min(7, 3.5 + 0.15 * week);
        case "champion":
          return 3.5;
        case "steady":
          return 2;
        case "past_due":
          return 2.5;
        case "trialing":
          return 3;
        case "at_risk": {
          const fade = ANCHOR - 42 * DAY;
          return t < fade
            ? 3
            : Math.max(0.3, 3 - (2.7 * (t - fade)) / (42 * DAY));
        }
        case "churned":
          if (t >= quiet) return 0;
          return t < quiet - 42 * DAY ? 2.2 : (2.2 * (quiet - t)) / (42 * DAY);
        case "trial_lost":
          return week < 2 ? (a.activatedAt ? 1.5 : 0.6) : 0;
      }
    };
    for (let w = 0; a.created + w * 7 * DAY < ANCHOR; w++) {
      const ws = a.created + w * 7 * DAY;
      const active = live.filter((u) => u.joined <= ws + 7 * DAY);
      const n = Math.round(
        0.5 *
          intensity(ws, w) *
          between(r, 0.6, 1.4) *
          Math.sqrt(active.length),
      );
      for (let k = 0; k < n; k++) {
        const u = chance(r, 0.35) ? owner : pick(r, active);
        const t = workHours(r, ws + between(r, 0, 7) * DAY);
        const roll = r();
        if (roll < 0.45)
          ev(u, t, "$pageview", pick(r, ["/inbox", "/ideas", "/roadmap"]));
        else if (roll < 0.7) ev(u, t, "idea_created", "/ideas");
        else if (roll < 0.9) ev(u, t, "feedback_imported");
        else if (a.activatedAt && t > a.activatedAt)
          ev(u, t, "roadmap_published", "/roadmap");
        else ev(u, t, "idea_created", "/ideas");
      }
    }
  }
  events.sort((x, y) => x.t - y.t);
  return events.map(({ t, ...row }) => row);
}

function stripe(accounts: Account[]) {
  const r = stream("stripe");
  // Stripe object IDs: prefix, "_1", then 23 base62 characters.
  const id = (prefix: string) => prefix + "_1" + chars(r, B62, 23);
  const priceIds = Object.fromEntries(
    Object.keys(PRICES).map((tier) => [tier, id("price")]),
  ) as Record<Tier, string>;
  const plan = (tier: Tier) => ({
    id: priceIds[tier],
    ...PRICES[tier],
    interval: "month",
  });
  const customers: (Record<string, unknown> & { t: number })[] = [];
  const subscriptions: (Record<string, unknown> & { t: number })[] = [];
  const invoices: (Record<string, unknown> & { t: number })[] = [];
  const pastDue = accounts.filter((a) => a.archetype === "past_due");
  for (const a of accounts) {
    if (!a.convertedAt && a.archetype !== "trialing") continue;
    const owner = a.users[0];
    const since = a.convertedAt ?? a.created + 10 * MIN;
    a.customer_id = "cus_" + chars(r, B62, 14);
    // Billing contacts rarely match the app login exactly.
    const kind = pick(r, ["owner", "owner", "owner", "cased", "billing"]);
    customers.push({
      t: since - 3 * MIN,
      customer_id: a.customer_id,
      name: chance(r, 0.3)
        ? `${a.name} ${pick(r, ["Inc.", "LLC", "Ltd"])}`
        : a.name,
      email:
        kind === "owner"
          ? owner.email
          : kind === "billing"
            ? "billing@" + a.domain
            : `${capital(owner.given)}.${capital(owner.family)}@${a.domain}`,
      delinquent: a.archetype === "past_due",
      // The app only started writing metadata in February.
      metadata:
        since < Date.UTC(2026, 1, 1) ? {} : { account_id: a.account_id },
      created: unixIso(since - 3 * MIN),
    });
    const sub = id("sub");
    const price = (tier: Tier) => PRICES[tier];
    const seatsAt = (t: number) =>
      a.seats.filter((s) => s.t <= t).at(-1) ?? a.seats[0];
    const invoice = (
      t: number,
      reason: string,
      amount: number,
      status = "paid",
    ) => {
      if (t >= ANCHOR) return;
      invoices.push({
        t,
        invoice_id: id("in"),
        customer_id: a.customer_id,
        subscription_id: sub,
        status,
        billing_reason: reason,
        amount_due: amount,
        amount_paid: status === "paid" ? amount : 0,
        currency: "usd",
        created: unixIso(t),
      });
    };
    if (a.archetype === "trialing") {
      invoice(since + 5000, "subscription_create", 0);
      subscriptions.push({
        t: since,
        subscription_id: sub,
        customer_id: a.customer_id,
        status: "trialing",
        quantity: a.seats[0].seats,
        plan: plan(a.tier),
        trial_end: unixIso(a.created + 14 * DAY),
        cancel_at_period_end: false,
        canceled_at: null,
        cancellation_details: { reason: null, feedback: null },
        created: unixIso(since),
      });
      continue;
    }
    const start = a.convertedAt!;
    const end = Math.min(a.churnAt ?? ANCHOR, ANCHOR);
    const first = a.seats[0];
    invoice(
      start + 5000,
      "subscription_create",
      first.seats * price(first.tier).amount,
    );
    const cycles: number[] = [];
    for (let m = 1; addMonths(start, m) < end; m++)
      cycles.push(addMonths(start, m));
    const failing = pastDue.indexOf(a);
    cycles.forEach((t, n) => {
      const s = seatsAt(t);
      const last = n === cycles.length - 1;
      const status =
        failing >= 0 && last
          ? "open"
          : failing === 0 && n === cycles.length - 3
            ? "uncollectible"
            : "paid";
      invoice(
        t + HOUR,
        "subscription_cycle",
        s.seats * price(s.tier).amount,
        status,
      );
    });
    // Prorated seat expansions.
    for (const step of a.seats.slice(1)) {
      if (step.t >= end) continue;
      const before = seatsAt(step.t - 1);
      const periodStart = [start, ...cycles].filter((t) => t <= step.t).at(-1)!;
      const frac =
        (addMonths(periodStart, 1) - step.t) /
        (addMonths(periodStart, 1) - periodStart);
      invoice(
        step.t,
        "subscription_update",
        Math.round(
          (step.seats - before.seats) * price(step.tier).amount * frac,
        ),
      );
    }
    const current = seatsAt(end - 1);
    subscriptions.push({
      t: start,
      subscription_id: sub,
      customer_id: a.customer_id,
      status: a.churnAt ? "canceled" : failing >= 0 ? "past_due" : "active",
      quantity: current.seats,
      plan: plan(current.tier),
      trial_end: null,
      cancel_at_period_end: a.cancelScheduled,
      canceled_at: a.churnAt
        ? unixIso(a.churnAt)
        : a.cancelScheduled
          ? unixIso(ANCHOR - between(r, 2, 12) * DAY)
          : null,
      cancellation_details: {
        reason:
          a.churnAt || a.cancelScheduled ? "cancellation_requested" : null,
        feedback: a.churnAt
          ? a.activatedAt
            ? "missing_features"
            : a.campaign === "giveaway-q2"
              ? "unused"
              : "too_expensive"
          : a.cancelScheduled
            ? "low_quality"
            : null,
      },
      created: unixIso(start),
    });
  }
  // A developer's test customer and an abandoned first checkout, both unlinked.
  const steady = accounts.filter((a) => a.archetype === "steady")[4];
  const dup = "cus_" + chars(r, B62, 14),
    dupSub = id("sub"),
    tDup = steady.convertedAt! - 2 * DAY;
  customers.push(
    {
      t: START + 33 * DAY + 5 * HOUR,
      customer_id: "cus_" + chars(r, B62, 14),
      name: "Test Customer",
      email: "dev+stripe@loopwell.example",
      delinquent: false,
      metadata: {},
      created: unixIso(START + 33 * DAY + 5 * HOUR),
    },
    {
      t: tDup,
      customer_id: dup,
      name: steady.name,
      email: steady.users[0].email,
      delinquent: false,
      metadata: { account_id: steady.account_id },
      created: unixIso(tDup),
    },
  );
  subscriptions.push({
    t: tDup,
    subscription_id: dupSub,
    customer_id: dup,
    status: "incomplete_expired",
    quantity: steady.seats[0].seats,
    plan: plan(steady.tier),
    trial_end: null,
    cancel_at_period_end: false,
    canceled_at: null,
    cancellation_details: { reason: null, feedback: null },
    created: unixIso(tDup),
  });
  invoices.push({
    t: tDup + 5000,
    invoice_id: id("in"),
    customer_id: dup,
    subscription_id: dupSub,
    status: "void",
    billing_reason: "subscription_create",
    amount_due: steady.seats[0].seats * PRICES[steady.tier].amount,
    amount_paid: 0,
    currency: "usd",
    created: unixIso(tDup + 5000),
  });
  const ordered = <T extends { t: number }>(rows: T[]) =>
    rows.sort((x, y) => x.t - y.t).map(({ t, ...row }) => row);
  return {
    customers: ordered(customers),
    subscriptions: ordered(subscriptions),
    invoices: ordered(invoices),
  };
}

function workos(accounts: Account[]) {
  const r = stream("workos");
  const organizations: (Record<string, unknown> & { t: number })[] = [];
  const connections: (Record<string, unknown> & { t: number })[] = [];
  const users: (Record<string, unknown> & { t: number })[] = [];
  const orgDomain = (domain: string, t: number) => ({
    object: "organization_domain",
    id: "org_domain_" + ulid(r, t),
    domain,
    state: "verified",
    verification_strategy: "dns",
  });
  for (const a of accounts) {
    const t = a.created + 2000;
    organizations.push({
      t,
      organization_id: a.org_id,
      name: chance(r, 0.1) ? a.name.toLowerCase() : a.name,
      // The app began setting external_id in March; older orgs are only linked from the app.
      external_id: t >= Date.UTC(2026, 2, 1) ? a.account_id : null,
      domains: a.ssoAt ? [orgDomain(a.domain, t + 5 * DAY)] : [],
      created_at: isoMs(t),
    });
    if (a.ssoAt) {
      connections.push({
        t: a.ssoAt,
        connection_id: "conn_" + ulid(r, a.ssoAt),
        organization_id: a.org_id,
        connection_type: pick(r, [
          "OktaSAML",
          "OktaSAML",
          "AzureSAML",
          "GoogleSAML",
        ]),
        state: "active",
        created_at: isoMs(a.ssoAt),
      });
    } else if (a.archetype === "champion" && chance(r, 0.3)) {
      const t2 = a.convertedAt! + between(r, 10, 40) * DAY;
      if (t2 < ANCHOR)
        connections.push({
          t: t2,
          connection_id: "conn_" + ulid(r, t2),
          organization_id: a.org_id,
          connection_type: "OktaSAML",
          state: "draft",
          created_at: isoMs(t2),
        });
    }
    for (const u of a.users)
      if (u.workos_user_id)
        users.push({
          t: u.joined,
          user_id: u.workos_user_id,
          email: u.email,
          first_name: capital(u.given),
          last_name: capital(u.family),
          email_verified: true,
          last_sign_in_at: isoMs(
            Math.min(
              ANCHOR - MIN,
              (u.lastSeen ?? u.joined) + between(r, 0, 2) * HOUR,
            ),
          ),
          created_at: isoMs(u.joined),
        });
  }
  // Loopwell's own team and QA sandbox exist only in WorkOS.
  for (const [name, domain, staff] of [
    ["Loopwell", "loopwell.example", 5],
    ["Loopwell QA Sandbox", "qa.loopwell.example", 2],
  ] as const) {
    // Loopwell moved its own team to WorkOS in February, after the first customers.
    const t = START + int(r, 38, 52) * DAY + int(r, 9, 17) * HOUR;
    organizations.push({
      t,
      organization_id: "org_" + ulid(r, t),
      name,
      external_id: null,
      domains: [orgDomain(domain, t)],
      created_at: isoMs(t),
    });
    const taken = new Set<string>();
    for (let k = 0; k < staff; k++) {
      let given: string;
      do given = pick(r, GIVEN);
      while (taken.has(given));
      taken.add(given);
      const family = pick(r, FAMILY),
        joined = t + int(r, 0, 30) * DAY;
      users.push({
        t: joined,
        user_id: "user_" + ulid(r, joined),
        email: `${given}@${domain}`,
        first_name: capital(given),
        last_name: capital(family),
        email_verified: true,
        last_sign_in_at: isoMs(ANCHOR - between(r, 1, 72) * HOUR),
        created_at: isoMs(joined),
      });
    }
  }
  const ordered = <T extends { t: number }>(rows: T[]) =>
    rows.sort((x, y) => x.t - y.t).map(({ t, ...row }) => row);
  return {
    organizations: ordered(organizations),
    users: ordered(users),
    connections: ordered(connections),
  };
}

function supportTickets(accounts: Account[]) {
  const r = stream("tickets");
  const tickets: (Record<string, unknown> & { t: number })[] = [];
  const add = (
    a: Account | null,
    t: number,
    category: string,
    priority: string,
    opts: {
      status?: string;
      satisfaction?: string | null;
      email?: string;
      channel?: string;
    } = {},
  ) => {
    if (t >= ANCHOR || t < START) return;
    const users =
      a?.users.filter((u) => u.workos_user_id && u.joined <= t) ?? [];
    const requester = users.length ? pick(r, users) : a?.users[0];
    const channel = opts.channel ?? (chance(r, 0.2) ? "email" : "in_app");
    let email = opts.email ?? requester!.email;
    // Email replies come from mail clients that capitalize addresses.
    if (!opts.email && channel === "email" && chance(r, 0.6))
      email = email.replace(/^./, (c) => c.toUpperCase());
    const age = (ANCHOR - t) / DAY;
    const status =
      opts.status ??
      (age > 21
        ? "closed"
        : age > 5
          ? "solved"
          : pick(r, ["open", "pending", "solved"]));
    tickets.push({
      t,
      ticket_id: 0,
      created_at: mysql(t),
      requester_email: email,
      // The help desk only knows the account for in-app requests.
      account_id: a && channel === "in_app" ? a.account_id : null,
      channel,
      category,
      priority,
      status,
      satisfaction:
        opts.satisfaction !== undefined
          ? opts.satisfaction
          : ["solved", "closed"].includes(status)
            ? pick(r, ["good", "good", "good", null, "bad"])
            : null,
    });
  };
  for (const a of accounts) {
    const end = Math.min(a.churnAt ?? ANCHOR, ANCHOR);
    const background = (n: number) => {
      for (let k = 0; k < n; k++)
        add(
          a,
          workHours(r, between(r, a.created + DAY, end)),
          pick(r, ["how_to", "how_to", "integration", "billing", "bug"]),
          pick(r, ["low", "normal", "normal", "high"]),
        );
    };
    switch (a.archetype) {
      case "enterprise":
        add(
          a,
          workHours(r, a.ssoAt! - between(r, 1, 5) * DAY),
          "sso_setup",
          "high",
          { satisfaction: "good" },
        );
        background(int(r, 1, 3));
        break;
      case "churned": {
        const n = int(r, 3, 5);
        for (let k = 0; k < n; k++)
          add(
            a,
            workHours(
              r,
              Math.max(a.created + DAY, a.churnAt! - between(r, 3, 45) * DAY),
            ),
            pick(r, ["bug", "bug", "billing", "how_to"]),
            pick(r, ["high", "high", "urgent", "normal"]),
            { satisfaction: pick(r, ["bad", "bad", null]) },
          );
        add(
          a,
          workHours(r, a.churnAt! - between(r, 0.2, 2) * DAY),
          "data_export",
          "normal",
          { satisfaction: null },
        );
        break;
      }
      case "at_risk":
        for (let k = int(r, 2, 3); k > 0; k--)
          add(
            a,
            workHours(r, ANCHOR - between(r, 2, 30) * DAY),
            "bug",
            pick(r, ["high", "urgent"]),
            { status: "open", satisfaction: null },
          );
        background(int(r, 0, 1));
        break;
      case "past_due":
        add(
          a,
          workHours(r, ANCHOR - between(r, 3, 20) * DAY),
          "billing",
          "high",
          { channel: "email", satisfaction: null },
        );
        background(int(r, 0, 2));
        break;
      case "champion":
      case "steady":
        background(int(r, 0, 3));
        break;
      default:
        if (chance(r, 0.35)) background(1);
    }
  }
  for (
    let k = 0;
    k < 5;
    k++ // Prospects writing in before signing up.
  )
    add(
      null,
      workHours(r, START + between(r, 20, 230) * DAY),
      pick(r, ["billing", "how_to"]),
      "low",
      {
        email: `${pick(r, GIVEN)}.${pick(r, FAMILY)}${int(r, 1, 99)}@mailbox.example`,
        channel: "email",
      },
    );
  tickets.sort((x, y) => x.t - y.t);
  return tickets.map(({ t, ...row }, k) => ({ ...row, ticket_id: 4101 + k }));
}

export function sampleDatasets(): SampleDataset[] {
  const accounts = backbone();
  const events = posthogEvents(accounts); // before WorkOS, which reads last activity
  const billing = stripe(accounts);
  const identity = workos(accounts);
  const tickets = supportTickets(accounts);
  // Mistyped campaign codes and plans that were never downgraded after cancelling.
  const giveaway = accounts.filter((a) => a.campaign === "giveaway-q2");
  const churned = accounts.filter((a) => a.archetype === "churned");
  const planetscaleAccounts = accounts.map((a) => ({
    account_id: a.account_id,
    name: a.name,
    domain: a.domain,
    plan:
      a.archetype === "trial_lost" ||
      (a.churnAt && !churned.slice(0, 2).includes(a))
        ? "free"
        : a.archetype === "trialing"
          ? "trial"
          : a.seats.at(-1)!.tier,
    signup_campaign_id:
      a.campaign && giveaway.indexOf(a) % 5 === 1
        ? a.campaign.toUpperCase()
        : a.campaign,
    workos_organization_id: a.org_id,
    stripe_customer_id: a.customer_id,
    created_at: mysql(a.created),
  }));
  const planetscaleUsers = accounts
    .flatMap((a) => a.users.map((u) => ({ a, u })))
    .sort((x, y) => x.u.joined - y.u.joined)
    .map(({ a, u }) => ({
      user_id: u.user_id,
      account_id: a.account_id,
      workos_user_id: u.workos_user_id,
      email: u.email,
      role: u.role,
      created_at: mysql(u.joined),
    }));
  return [
    {
      name: "PlanetScale · accounts",
      source: "planetscale",
      description:
        "App database (PlanetScale): one row per customer account. stripe_customer_id matches Stripe customers.customer_id, workos_organization_id matches WorkOS organizations.organization_id, signup_campaign_id matches marketing campaigns.campaign_id.",
      rows: planetscaleAccounts,
    },
    {
      name: "PlanetScale · users",
      source: "planetscale",
      description:
        "App database: people in each account (account_id). PostHog events use user_id as distinct_id. workos_user_id matches WorkOS users.user_id and is empty for invites not yet accepted.",
      rows: planetscaleUsers,
    },
    {
      name: "WorkOS · organizations",
      source: "workos",
      description:
        "WorkOS organizations; accounts.workos_organization_id points here. external_id holds the app account_id for organizations created since March. Includes Loopwell's own internal organizations.",
      rows: identity.organizations,
    },
    {
      name: "WorkOS · users",
      source: "workos",
      description:
        "WorkOS sign-in identities with last sign-in time; the app's users.workos_user_id points here.",
      rows: identity.users,
    },
    {
      name: "WorkOS · sso_connections",
      source: "workos",
      description:
        "Enterprise SSO connections per WorkOS organization_id. state active means SSO is live.",
      rows: identity.connections,
    },
    {
      name: "PostHog · events",
      source: "posthog",
      description:
        "PostHog product events. distinct_id is the app users.user_id once signed in; anonymous visits before signup share the person_id and carry utm_campaign.",
      rows: events,
    },
    {
      name: "Stripe · customers",
      source: "stripe",
      description:
        "Stripe customers; accounts.stripe_customer_id points here. Billing emails often differ from login emails.",
      rows: billing.customers,
    },
    {
      name: "Stripe · subscriptions",
      source: "stripe",
      description:
        "Stripe per-seat subscriptions by customer_id. Monthly recurring revenue is plan.amount (cents) times quantity for active and past_due subscriptions. cancel_at_period_end true means cancellation is scheduled.",
      rows: billing.subscriptions,
    },
    {
      name: "Stripe · invoices",
      source: "stripe",
      description:
        "Stripe invoices by customer_id and subscription_id, amounts in cents. billing_reason subscription_update is a seat expansion; status open or uncollectible is a failed payment.",
      rows: billing.invoices,
    },
    {
      name: "S3 · support_tickets.csv",
      source: "s3",
      description:
        "Help desk export (S3). account_id is set for in-app requests only; email requests have just requester_email, which may differ in case from the login email.",
      rows: tickets,
    },
    {
      name: "S3 · marketing_campaigns.csv",
      source: "s3",
      description:
        "Marketing campaigns (S3) with spend in dollars; accounts.signup_campaign_id records the campaign each account came from.",
      rows: campaigns,
    },
  ];
}
