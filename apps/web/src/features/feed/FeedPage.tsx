import { useEffect, useState } from "react";
import {
  demoteToCommon,
  getSettings,
  listActiveCoins,
  listRecentEvents,
  listWatchedWallets,
  promoteToPrecise,
  trackWallet,
  untrackWallet,
  updateCoinExclusions,
  updateDepositThreshold,
  updateTradeThreshold,
  updateTwapThreshold,
  WalletSlotLimitError,
  type WatchedWallet,
} from "../../lib/api.js";
import { connectRealtime, type RealtimeEvent } from "../../lib/realtime-client.js";
import { CommonWalletsPanel } from "./components/CommonWalletsPanel.js";
import { DepositThresholdPicker } from "./components/DepositThresholdPicker.js";
import { PreciseWalletPanel } from "./components/PreciseWalletPanel.js";
import { SlotFullPopup } from "./components/SlotFullPopup.js";
import { ThresholdPicker } from "./components/ThresholdPicker.js";
import { TwapThresholdPicker } from "./components/TwapThresholdPicker.js";
import { buildWalletColorMap } from "./wallet-colors.js";
import { buildWalletEmojiMap } from "./wallet-emoji.js";
import "./feed.css";

const MAX_EVENTS = 200;

// Merges REST backfill results into a live-push event list, deduping by id — a page load
// races the WS connect against the GET /events fetch, so an event can plausibly land in
// both. occurredAt is an ISO string, which sorts lexicographically the same as
// chronologically, so no Date parsing is needed just to order the merged list.
function mergeEvents(existing: RealtimeEvent[], incoming: RealtimeEvent[]): RealtimeEvent[] {
  const byId = new Map(existing.map((event) => [event.id, event]));
  for (const event of incoming) {
    if (!byId.has(event.id)) byId.set(event.id, event);
  }
  return [...byId.values()]
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, MAX_EVENTS);
}

export function FeedPage() {
  const [whaleEvents, setWhaleEvents] = useState<RealtimeEvent[]>([]);
  const [marketEvents, setMarketEvents] = useState<RealtimeEvent[]>([]);
  const [twapEvents, setTwapEvents] = useState<RealtimeEvent[]>([]);
  const [depositEvents, setDepositEvents] = useState<RealtimeEvent[]>([]);
  const [wallets, setWallets] = useState<WatchedWallet[]>([]);
  const [addressInput, setAddressInput] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [minTradeAmount, setMinTradeAmount] = useState<string | null>(null);
  const [notifyTrades, setNotifyTrades] = useState(true);
  const [isUpdatingThreshold, setIsUpdatingThreshold] = useState(false);
  const [minTwapAmount, setMinTwapAmount] = useState<string | null>(null);
  const [notifyTwaps, setNotifyTwaps] = useState(true);
  const [isUpdatingTwapThreshold, setIsUpdatingTwapThreshold] = useState(false);
  const [minDepositAmount, setMinDepositAmount] = useState<string | null>(null);
  const [notifyDeposits, setNotifyDeposits] = useState(true);
  const [isUpdatingDepositThreshold, setIsUpdatingDepositThreshold] = useState(false);
  // Shared BTC/ETH exclusion setting (users.excludeBtc/excludeEth) — feeds both the Large
  // trades and TWAPs cards, not one per table (see CoinExclusionToggle doc comment).
  const [excludeBtc, setExcludeBtc] = useState(false);
  const [excludeEth, setExcludeEth] = useState(false);
  const [isUpdatingCoinExclusions, setIsUpdatingCoinExclusions] = useState(false);
  const [trackingAddress, setTrackingAddress] = useState<string | null>(null);
  const [untrackingAddress, setUntrackingAddress] = useState<string | null>(null);
  const [togglingWalletId, setTogglingWalletId] = useState<number | null>(null);
  const [coins, setCoins] = useState<string[]>([]);
  const [selectedCoins, setSelectedCoins] = useState<string[]>([]);
  const [isSlotFullPopupOpen, setIsSlotFullPopupOpen] = useState(false);
  // Bumped after a wallet is added (or the trade threshold changes) to force the WS to
  // reconnect — RealtimeHub snapshots a client's watched addresses and trade-alert settings
  // once at connect time (see apps/api hub.ts), so changes only take effect on the next
  // connection, not live on the open socket.
  const [reconnectKey, setReconnectKey] = useState(0);

  useEffect(() => {
    listWatchedWallets()
      .then(setWallets)
      .catch((err: unknown) => {
        console.error("failed to load watched wallets", err);
      });
  }, [reconnectKey]);

  // Precise-slot/queue changes triggered by OTHER users (a slot freeing up, moving this
  // wallet up the FIFO) aren't pushed over the realtime channel yet — poll while this user
  // has a wallet actually waiting, rather than continuously.
  const hasQueuedWallet = wallets.some((w) => w.queuePosition !== undefined);
  useEffect(() => {
    if (!hasQueuedWallet) return;
    const interval = setInterval(() => {
      listWatchedWallets()
        .then(setWallets)
        .catch((err: unknown) => {
          console.error("failed to refresh watched wallets", err);
        });
    }, 10_000);
    return () => clearInterval(interval);
  }, [hasQueuedWallet]);

  useEffect(() => {
    listActiveCoins()
      .then(setCoins)
      .catch((err: unknown) => {
        console.error("failed to load coin list", err);
      });
  }, []);

  useEffect(() => {
    getSettings()
      .then((settings) => {
        setMinTradeAmount(settings.minTradeAmount);
        setNotifyTrades(settings.notifyTrades);
        setMinTwapAmount(settings.minTwapAmount);
        setNotifyTwaps(settings.notifyTwaps);
        setMinDepositAmount(settings.minDepositAmount);
        setNotifyDeposits(settings.notifyDeposits);
        setExcludeBtc(settings.excludeBtc);
        setExcludeEth(settings.excludeEth);
      })
      .catch((err: unknown) => {
        console.error("failed to load settings", err);
      });
  }, [reconnectKey]);

  // Seeds the three panels with recent matching history so they don't sit on an empty
  // "Waiting for events…" on every page load or WS reconnect (see mergeEvents doc comment
  // and GET /events on the api side) — reconnectKey mirrors the other effects above since a
  // changed watch-list/threshold changes what this backfill should return too. Also reused
  // as connectRealtime's onReconnect below, since a silent WS drop-and-reconnect can miss a
  // one-shot broadcast (see that function's doc comment) without bumping reconnectKey itself.
  function refreshRecentEvents(): void {
    listRecentEvents()
      .then((recentEvents) => {
        const whale = recentEvents.filter(
          (event) =>
            event.type !== "market_trade" &&
            event.type !== "market_twap" &&
            event.type !== "global_deposit",
        );
        const market = recentEvents.filter((event) => event.type === "market_trade");
        const twap = recentEvents.filter((event) => event.type === "market_twap");
        const deposits = recentEvents.filter((event) => event.type === "global_deposit");
        setWhaleEvents((prev) => mergeEvents(prev, whale));
        setMarketEvents((prev) => mergeEvents(prev, market));
        setTwapEvents((prev) => mergeEvents(prev, twap));
        setDepositEvents((prev) => mergeEvents(prev, deposits));
      })
      .catch((err: unknown) => {
        console.error("failed to load recent events", err);
      });
  }

  useEffect(() => {
    refreshRecentEvents();
  }, [reconnectKey]);

  useEffect(() => {
    return connectRealtime((event) => {
      // Split at the source rather than filtering one combined list — a burst of market
      // trades would otherwise be able to push whale/wallet events (rarer, higher-signal)
      // out of a shared MAX_EVENTS cap.
      if (event.type === "market_trade") {
        setMarketEvents((prev) => [event, ...prev].slice(0, MAX_EVENTS));
      } else if (event.type === "market_twap") {
        setTwapEvents((prev) => [event, ...prev].slice(0, MAX_EVENTS));
      } else if (event.type === "global_deposit") {
        setDepositEvents((prev) => [event, ...prev].slice(0, MAX_EVENTS));
      } else {
        setWhaleEvents((prev) => [event, ...prev].slice(0, MAX_EVENTS));
      }
    }, refreshRecentEvents);
  }, [reconnectKey]);

  async function handleTrackWallet(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setFormError(null);
    setIsSubmitting(true);
    try {
      await trackWallet(addressInput.trim());
      setAddressInput("");
      // wallet-watcher polls watched_wallets every 15s (apps/worker), so the new
      // subscription — and events for it — won't appear instantly.
      setReconnectKey((key) => key + 1);
    } catch (err) {
      if (err instanceof WalletSlotLimitError) {
        setIsSlotFullPopupOpen(true);
      } else {
        setFormError(err instanceof Error ? err.message : "failed to track wallet");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleTrackAddress(address: string): Promise<void> {
    setTrackingAddress(address);
    try {
      await trackWallet(address);
      setReconnectKey((key) => key + 1);
    } catch (err) {
      if (err instanceof WalletSlotLimitError) {
        setIsSlotFullPopupOpen(true);
      } else {
        console.error("failed to track address", err);
      }
    } finally {
      setTrackingAddress(null);
    }
  }

  async function handleUntrack(address: string): Promise<void> {
    setUntrackingAddress(address);
    try {
      await untrackWallet(address);
      setReconnectKey((key) => key + 1);
    } catch (err) {
      console.error("failed to untrack wallet", err);
    } finally {
      setUntrackingAddress(null);
    }
  }

  async function handleToggleTrackingMode(walletId: number): Promise<void> {
    const wallet = wallets.find((w) => w.id === walletId);
    if (!wallet) return;

    setTogglingWalletId(walletId);
    try {
      if (wallet.trackingMode === "precise" || wallet.queuePosition !== undefined) {
        // Precise -> release the slot, or queued -> cancel the request. Either way this
        // wallet goes back to plain "common".
        await demoteToCommon(walletId);
      } else {
        await promoteToPrecise(walletId);
      }
      const refreshed = await listWatchedWallets();
      setWallets(refreshed);
      // A promote/demote can free or claim a Hyperliquid subscription slot for
      // wallet-watcher — same "settings changed, reconnect to pick it up" reasoning as
      // trackWallet/untrackWallet above.
      setReconnectKey((key) => key + 1);
    } catch (err) {
      console.error("failed to toggle tracking mode", err);
    } finally {
      setTogglingWalletId(null);
    }
  }

  // Picking a preset also re-enables notifications if they were off — a user turning the
  // amount back on clearly wants alerts again, not an amount stored against a still-off
  // toggle (see handleToggleTradeNotify for the reverse direction).
  async function handleSelectThreshold(preset: string): Promise<void> {
    setIsUpdatingThreshold(true);
    try {
      const settings = await updateTradeThreshold({ amount: preset, enabled: true });
      setMinTradeAmount(settings.minTradeAmount);
      setNotifyTrades(settings.notifyTrades);
      setReconnectKey((key) => key + 1);
    } catch (err) {
      console.error("failed to update trade threshold", err);
    } finally {
      setIsUpdatingThreshold(false);
    }
  }

  // Turns notifications off without discarding the stored amount, so re-enabling (via
  // handleSelectThreshold above) restores the user's last threshold instead of resetting it.
  async function handleToggleTradeNotify(): Promise<void> {
    setIsUpdatingThreshold(true);
    try {
      const settings = await updateTradeThreshold({ enabled: false });
      setNotifyTrades(settings.notifyTrades);
      setReconnectKey((key) => key + 1);
    } catch (err) {
      console.error("failed to turn off trade notifications", err);
    } finally {
      setIsUpdatingThreshold(false);
    }
  }

  async function handleSelectTwapThreshold(preset: string): Promise<void> {
    setIsUpdatingTwapThreshold(true);
    try {
      const settings = await updateTwapThreshold({ amount: preset, enabled: true });
      setMinTwapAmount(settings.minTwapAmount);
      setNotifyTwaps(settings.notifyTwaps);
      setReconnectKey((key) => key + 1);
    } catch (err) {
      console.error("failed to update twap threshold", err);
    } finally {
      setIsUpdatingTwapThreshold(false);
    }
  }

  async function handleToggleTwapNotify(): Promise<void> {
    setIsUpdatingTwapThreshold(true);
    try {
      const settings = await updateTwapThreshold({ enabled: false });
      setNotifyTwaps(settings.notifyTwaps);
      setReconnectKey((key) => key + 1);
    } catch (err) {
      console.error("failed to turn off twap notifications", err);
    } finally {
      setIsUpdatingTwapThreshold(false);
    }
  }

  async function handleSelectDepositThreshold(preset: string): Promise<void> {
    setIsUpdatingDepositThreshold(true);
    try {
      const settings = await updateDepositThreshold({ amount: preset, enabled: true });
      setMinDepositAmount(settings.minDepositAmount);
      setNotifyDeposits(settings.notifyDeposits);
      setReconnectKey((key) => key + 1);
    } catch (err) {
      console.error("failed to update deposit threshold", err);
    } finally {
      setIsUpdatingDepositThreshold(false);
    }
  }

  async function handleToggleDepositNotify(): Promise<void> {
    setIsUpdatingDepositThreshold(true);
    try {
      const settings = await updateDepositThreshold({ enabled: false });
      setNotifyDeposits(settings.notifyDeposits);
      setReconnectKey((key) => key + 1);
    } catch (err) {
      console.error("failed to turn off deposit notifications", err);
    } finally {
      setIsUpdatingDepositThreshold(false);
    }
  }

  // Same "bump reconnectKey so the WS hub re-snapshots" reasoning as the threshold handlers
  // above — RealtimeHub reads excludeBtc/excludeEth once at connect time (see hub.ts).
  async function handleToggleExcludeBtc(value: boolean): Promise<void> {
    setIsUpdatingCoinExclusions(true);
    try {
      const settings = await updateCoinExclusions({ excludeBtc: value });
      setExcludeBtc(settings.excludeBtc);
      setReconnectKey((key) => key + 1);
    } catch (err) {
      console.error("failed to update BTC exclusion", err);
    } finally {
      setIsUpdatingCoinExclusions(false);
    }
  }

  async function handleToggleExcludeEth(value: boolean): Promise<void> {
    setIsUpdatingCoinExclusions(true);
    try {
      const settings = await updateCoinExclusions({ excludeEth: value });
      setExcludeEth(settings.excludeEth);
      setReconnectKey((key) => key + 1);
    } catch (err) {
      console.error("failed to update ETH exclusion", err);
    } finally {
      setIsUpdatingCoinExclusions(false);
    }
  }

  const trackedAddresses = new Set(wallets.map((w) => w.address.toLowerCase()));
  // Only real custom labels go in here — falling back to the full address as a "label"
  // would defeat AddressCell's own truncateAddress(address) fallback (label ?? truncated),
  // which is exactly what made every tracked wallet's row show its untruncated address on
  // the whale-activity/large-trades tables instead of the short "0x1234..abcd" form.
  const walletLabels = new Map<string, string>();
  for (const w of wallets) {
    if (w.label) walletLabels.set(w.address.toLowerCase(), w.label);
  }
  // Keyed by each wallet's own id (see wallet-colors.ts), so a wallet's color is stable for
  // its whole lifetime — untracking a different wallet never reshuffles the rest.
  const walletColors = buildWalletColorMap(wallets);
  // A second, color-independent identifying cue for the tracker lists — see wallet-emoji.ts
  // for why colors alone aren't enough once wallet count gets close to MAX_WATCHED_WALLETS.
  const walletEmojis = buildWalletEmojiMap(wallets);
  // CommonWalletsPanel gets the full list (a promoted wallet stays visible there, see its
  // own doc comment) — only PreciseWalletPanel needs a filtered view. At most one wallet can
  // ever be "precise" per user (1-slot rule, see apps/api precise-slots.ts), so preciseWallet
  // is 0-or-1 by construction, not just by convention here.
  const preciseWallet = wallets.find((w) => w.trackingMode === "precise");
  // The live-tracked wallet's own activity also gets its own feed under the Live tracker
  // table — intentionally duplicated into the shared pseudo-tracker feed below too, rather
  // than excluded from it, so "Latest whale activity" stays a complete view of all whale
  // events regardless of tracking mode.
  const preciseAddress = preciseWallet?.address.toLowerCase();
  const preciseWalletEvents = preciseAddress
    ? whaleEvents.filter((event) => event.walletAddress?.toLowerCase() === preciseAddress)
    : [];
  const pseudoWhaleEvents = whaleEvents;
  // Applied on top of already-buffered/backfilled events (not just newly-pushed ones) so
  // toggling a checkbox takes effect immediately, without waiting for the next WS reconnect —
  // the server-side filters (RealtimeHub, bot notifiers) are what actually stop future
  // pushes/messages; this is belt-and-suspenders for what's already in state.
  function isCoinExcludedByUser(coin: string | null): boolean {
    return (coin === "BTC" && excludeBtc) || (coin === "ETH" && excludeEth);
  }
  // Mirror the server-side amount gate (GET /events backfill + RealtimeHub fan-out) on the
  // client. Without this, buffered/backfilled events below a *newly raised* threshold keep
  // showing until they age out of state — the backfill on a threshold change (reconnectKey)
  // even re-adds sub-threshold history when the threshold is lowered and then raised again.
  // When notifications are off the amount is irrelevant (the table renders its "off" state),
  // so don't gate then.
  const tradeFloor = notifyTrades && minTradeAmount !== null ? Number(minTradeAmount) : 0;
  const twapFloor = notifyTwaps && minTwapAmount !== null ? Number(minTwapAmount) : 0;
  const depositFloor = notifyDeposits && minDepositAmount !== null ? Number(minDepositAmount) : 0;
  const atLeast = (min: number) => (event: RealtimeEvent) => Number(event.amountUsd ?? "0") >= min;

  const filteredMarketEvents = marketEvents
    .filter(
      (event) =>
        selectedCoins.length === 0 || (event.coin !== null && selectedCoins.includes(event.coin)),
    )
    .filter((event) => !isCoinExcludedByUser(event.coin))
    .filter(atLeast(tradeFloor));
  const filteredTwapEvents = twapEvents
    .filter((event) => !isCoinExcludedByUser(event.coin))
    .filter(atLeast(twapFloor));
  const filteredDepositEvents = depositEvents.filter(atLeast(depositFloor));

  return (
    <main className="ht-page">
      <div className="ht-columns">
        <div className="ht-column">
          <CommonWalletsPanel
            wallets={wallets}
            totalCount={wallets.length}
            walletColors={walletColors}
            walletEmojis={walletEmojis}
            addressInput={addressInput}
            onAddressInputChange={setAddressInput}
            onSubmit={(e) => void handleTrackWallet(e)}
            isSubmitting={isSubmitting}
            onUntrack={(address) => void handleUntrack(address)}
            untrackingAddress={untrackingAddress}
            formError={formError}
            onGoLive={(walletId) => void handleToggleTrackingMode(walletId)}
            togglingWalletId={togglingWalletId}
            activityEvents={pseudoWhaleEvents}
            walletLabels={walletLabels}
            trackedAddresses={trackedAddresses}
            trackingAddress={trackingAddress}
            onTrackAddress={(address) => void handleTrackAddress(address)}
          />
          <PreciseWalletPanel
            wallet={preciseWallet}
            color={
              preciseWallet ? walletColors.get(preciseWallet.address.toLowerCase()) : undefined
            }
            emoji={
              preciseWallet ? walletEmojis.get(preciseWallet.address.toLowerCase()) : undefined
            }
            onUntrack={(address) => void handleUntrack(address)}
            untrackingAddress={untrackingAddress}
            onStopLive={(walletId) => void handleToggleTrackingMode(walletId)}
            togglingWalletId={togglingWalletId}
            activityEvents={preciseWalletEvents}
            walletLabels={walletLabels}
            walletColors={walletColors}
            walletEmojis={walletEmojis}
            trackedAddresses={trackedAddresses}
            trackingAddress={trackingAddress}
            onTrackAddress={(address) => void handleTrackAddress(address)}
          />
        </div>

        <div className="ht-column">
          <ThresholdPicker
            value={minTradeAmount}
            enabled={notifyTrades}
            isUpdating={isUpdatingThreshold}
            onSelect={(preset) => void handleSelectThreshold(preset)}
            onToggleOff={() => void handleToggleTradeNotify()}
            coins={coins}
            selectedCoins={selectedCoins}
            onAddCoin={(coin) => setSelectedCoins((prev) => [...prev, coin])}
            onRemoveCoin={(coin) => setSelectedCoins((prev) => prev.filter((c) => c !== coin))}
            excludeBtc={excludeBtc}
            excludeEth={excludeEth}
            isUpdatingCoinExclusions={isUpdatingCoinExclusions}
            onToggleExcludeBtc={(value) => void handleToggleExcludeBtc(value)}
            onToggleExcludeEth={(value) => void handleToggleExcludeEth(value)}
            events={filteredMarketEvents}
            walletColors={walletColors}
            walletEmojis={walletEmojis}
            trackedAddresses={trackedAddresses}
            trackingAddress={trackingAddress}
            onTrackAddress={(address) => void handleTrackAddress(address)}
          />
          <TwapThresholdPicker
            value={minTwapAmount}
            enabled={notifyTwaps}
            isUpdating={isUpdatingTwapThreshold}
            onSelect={(preset) => void handleSelectTwapThreshold(preset)}
            onToggleOff={() => void handleToggleTwapNotify()}
            excludeBtc={excludeBtc}
            excludeEth={excludeEth}
            isUpdatingCoinExclusions={isUpdatingCoinExclusions}
            onToggleExcludeBtc={(value) => void handleToggleExcludeBtc(value)}
            onToggleExcludeEth={(value) => void handleToggleExcludeEth(value)}
            events={filteredTwapEvents}
            walletColors={walletColors}
            walletEmojis={walletEmojis}
            trackedAddresses={trackedAddresses}
            trackingAddress={trackingAddress}
            onTrackAddress={(address) => void handleTrackAddress(address)}
          />
          <DepositThresholdPicker
            value={minDepositAmount}
            enabled={notifyDeposits}
            isUpdating={isUpdatingDepositThreshold}
            onSelect={(preset) => void handleSelectDepositThreshold(preset)}
            onToggleOff={() => void handleToggleDepositNotify()}
            events={filteredDepositEvents}
            walletColors={walletColors}
            walletEmojis={walletEmojis}
            trackedAddresses={trackedAddresses}
            trackingAddress={trackingAddress}
            onTrackAddress={(address) => void handleTrackAddress(address)}
          />
        </div>
      </div>
      {isSlotFullPopupOpen && <SlotFullPopup onClose={() => setIsSlotFullPopupOpen(false)} />}
    </main>
  );
}
