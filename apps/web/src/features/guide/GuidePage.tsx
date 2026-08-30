import { isMiniApp } from "../../telegram/context.js";
import { useInView } from "./useInView.js";
import { useMiniAppBackButton } from "./useMiniAppBackButton.js";
import { useTypewriter } from "./useTypewriter.js";
import "./guide.css";

interface GuideSection {
  title: string;
  paragraphs: string[];
  /** Screenshot in apps/web/public; sections without one fall back to a placeholder box. */
  image?: string;
}

const SECTIONS: GuideSection[] = [
  {
    title: "Large trades",
    image: "/1.png",
    paragraphs: [
      "Every trade above your chosen size, across the top coins by market cap listed on Hyperliquid — not just wallets you're watching.",
      "Set a minimum size and each match shows up with the coin, side and wallet address attached, so you can start following it in one tap.",
    ],
  },
  {
    title: "TWAPs",
    image: "/2.png",
    paragraphs: [
      "Real Hyperliquid TWAP orders, exchange-wide — opened and finished, with size executed so far against the target.",
      "Click a row to see its individual suborders as they fill.",
    ],
  },
  {
    title: "Global deposits",
    image: "/3.png",
    paragraphs: [
      "Any deposit into Hyperliquid above your threshold, from any address — you don't need to be watching a wallet for its deposit to show up here.",
      "Each one comes with the depositing address and the amount, so a wallet worth tracking is one tap away.",
    ],
  },
  {
    title: "Watch any wallet",
    image: "/4.png",
    paragraphs: [
      "Add any Hyperliquid address to your watchlist and every trade it makes shows up in your Latest whale activity feed as soon as it happens, with the coin, side, size and leverage attached.",
      "This is shared-pool watching, not live tracking. Your watchlist is matched against the single public trade feed everyone sees — there's no per-wallet connection opened to Hyperliquid for it, so there's no slot limit and you can add as many addresses as you want.",
      "The trade-off is fidelity: the public feed carries fills, so you get opens, closes and position changes, but not the per-user extras — true position direction, closed PnL, TWAP suborders, deposits and withdrawals. For the one wallet you care about most, promote it to the Live tracker below to get all of that.",
    ],
  },
  {
    title: "Live tracker",
    image: "/5.png",
    paragraphs: [
      '"Go Live" on one wallet at a time for full-fidelity tracking straight from Hyperliquid\'s own per-user feed — real position direction, closed PnL, TWAP suborders, deposits and withdrawals included.',
      "Only 10 wallets can run in Live mode across all users at once, so it's reserved for the one you care about most.",
    ],
  },
];

// Full product pitch shown once, above the per-feature sections. Typed out on load
// (see useTypewriter) — segment 0 is the heading, the rest are paragraphs.
const INTRO_HEADING = "What Deep Sight is";
const INTRO_PARAGRAPHS: string[] = [
  "Deep Sight watches Hyperliquid in real time and pings you the moment something worth knowing happens — a large trade, a TWAP order, a big deposit, or any move by a wallet you follow.",
  "It runs as a Telegram bot and as this web app off one shared account. Set your size thresholds and watchlist once and the alerts follow you across both, with a live feed of positions and events here.",
  "Everything below is live exchange data — the public trade feed, Hyperliquid's own per-user feeds, and on-chain bridge deposits. No polling delay, no sampling, no wallet you had to add in advance.",
];
const INTRO_SEGMENTS: string[] = [INTRO_HEADING, ...INTRO_PARAGRAPHS];

function GuideMedia({ image, alt }: { image: string | undefined; alt: string }) {
  if (image) {
    return <img className="ht-guide-shot" src={image} alt={alt} loading="lazy" />;
  }
  return (
    <div className="ht-guide-media" aria-hidden="true">
      <span className="ht-guide-media-label">Image</span>
    </div>
  );
}

function GuideIntroVideo() {
  return (
    <video
      className="ht-guide-video"
      src="/guide-vid.mp4"
      autoPlay
      loop
      muted
      playsInline
      preload="auto"
      aria-hidden="true"
    />
  );
}

function GuideIntroCopy() {
  const { rendered, activeIndex, done } = useTypewriter(INTRO_SEGMENTS);

  // Caret sits on whichever segment is mid-type; once finished it parks at the end
  // of the last paragraph and keeps blinking.
  const caretFor = (index: number): boolean =>
    (!done && index === activeIndex) || (done && index === INTRO_SEGMENTS.length - 1);
  const caret = (
    <span className="ht-guide-caret" aria-hidden="true">
      ▋
    </span>
  );

  return (
    <div className="ht-guide-intro-copy" data-typing={done ? undefined : "true"}>
      <h2>
        {rendered[0] ?? ""}
        {caretFor(0) && caret}
      </h2>
      {INTRO_PARAGRAPHS.map((paragraph, i) => {
        const segIndex = i + 1;
        return (
          <p key={paragraph}>
            {rendered[segIndex] ?? ""}
            {caretFor(segIndex) && caret}
          </p>
        );
      })}
    </div>
  );
}

function GuideRow({ section, index }: { section: GuideSection; index: number }) {
  const { ref, inView } = useInView<HTMLElement>();
  const base = index % 2 === 1 ? "ht-guide-row ht-guide-row-reverse" : "ht-guide-row";

  return (
    <section ref={ref} className={inView ? `${base} is-visible` : base}>
      <GuideMedia image={section.image} alt={`${section.title} — screenshot`} />
      <div className="ht-guide-copy">
        <h2>{section.title}</h2>
        {section.paragraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
    </section>
  );
}

interface GuidePageProps {
  onClose: () => void;
}

export function GuidePage({ onClose }: GuidePageProps) {
  useMiniAppBackButton(onClose, true);

  return (
    <main className="ht-guide-page">
      {!isMiniApp() && (
        <button type="button" className="ht-guide-back" onClick={onClose}>
          ← Back
        </button>
      )}
      <h1 className="ht-guide-heading">How tracking works</h1>
      <section className="ht-guide-intro">
        <GuideIntroVideo />
        <GuideIntroCopy />
      </section>
      {SECTIONS.map((section, index) => (
        <GuideRow key={section.title} section={section} index={index} />
      ))}
    </main>
  );
}
