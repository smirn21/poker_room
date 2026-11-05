import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { UserDTO } from "@poker/shared";
import { api, setToken } from "./api";
import { TableView } from "./TableView";
import {
  bindTelegramBackButton,
  initTelegramChrome,
  requestTelegramFullscreen,
} from "./telegram";
import {
  readPendingTableId,
  resolveLaunchInviteCode,
  writePendingTableId,
} from "./telegramLinks";
import { useI18n } from "./i18n";
import { LanguageSwitcher } from "./i18n/LanguageSwitcher";
import { BrandLogo } from "./BrandLogo";
import { LobbyFaceCards } from "./LobbyFaceCards";
import { CenterNotice } from "./CenterNotice";
import { localizeApiError } from "./localizeApiError";
import {
  IconArrowRight,
  IconChip,
  IconLobby,
  IconProfile,
  IconRefresh,
  IconTables,
  IconTrash,
  IconUsers,
  IconWallet,
} from "./Icons";
import { preloadDeckImages } from "./preloadCards";
import { preloadSfx, unlockAudio } from "./sounds";

type Gate = "boot" | "invite" | "app" | "table" | "admin";
type Tab = "lobby" | "tables" | "wallet" | "profile";

/** Keep focused wallet fields above the soft keyboard (iOS / Telegram). */
function nearestScrollParent(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if (
      (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
      node.scrollHeight > node.clientHeight + 1
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

/** Keep focused wallet fields in the visible viewport above the soft keyboard. */
/** Digits-only draft for chip/blind inputs (allows empty while typing). */
function digitsOnly(raw: string): string {
  return raw.replace(/\D/g, "");
}

function parseChips(raw: string, fallback = 0): number {
  const n = Number.parseInt(digitsOnly(raw), 10);
  return Number.isFinite(n) ? n : fallback;
}

function scrollFieldAboveKeyboard(el: HTMLElement) {
  const run = () => {
    const vv = window.visualViewport;
    const viewTop = vv?.offsetTop ?? 0;
    const viewBottom = viewTop + (vv?.height ?? window.innerHeight);
    // Keep field in the upper half so labels + caret stay clear of the keyboard.
    const targetTop = viewTop + Math.min(120, (viewBottom - viewTop) * 0.22);
    const targetBottom = viewTop + (viewBottom - viewTop) * 0.48;
    const rect = el.getBoundingClientRect();
    const scroller = nearestScrollParent(el);
    if (!scroller) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    let delta = 0;
    if (rect.bottom > targetBottom) delta = rect.bottom - targetBottom;
    else if (rect.top < targetTop) delta = rect.top - targetTop;
    if (Math.abs(delta) > 2) {
      scroller.scrollTop += delta;
    }
  };

  run();
  window.requestAnimationFrame(run);
  const delays = [80, 180, 320, 480, 700];
  const timers = delays.map((ms) => window.setTimeout(run, ms));
  const vv = window.visualViewport;
  const onVv = () => run();
  vv?.addEventListener("resize", onVv);
  vv?.addEventListener("scroll", onVv);
  const clear = () => {
    for (const id of timers) window.clearTimeout(id);
    vv?.removeEventListener("resize", onVv);
    vv?.removeEventListener("scroll", onVv);
    el.removeEventListener("blur", clear);
  };
  el.addEventListener("blur", clear, { once: true });
}

type TableRow = {
  id: string;
  name: string;
  smallBlind: number;
  bigBlind: number;
  rakePercent: number;
  rakeCapBb: number;
  maxSeats: number;
  seated: number;
};

/**
 * Real Telegram Mini App session, or explicit ?dev=1 probe.
 * Never invent Player1 when opened as a plain link without WebApp initData.
 * Read initData before expand/fullscreen — some clients clear it on early fullscreen.
 */
async function resolveInitData(): Promise<string | null> {
  const params = new URLSearchParams(window.location.search);
  const wantDev = params.has("dev");
  // telegram-web-app.js always defines WebApp; empty initData + platform "unknown"
  // means we're not in a real Telegram client.
  const inTelegramClient = () => {
    const tg = window.Telegram?.WebApp as
      | { initData?: string; platform?: string }
      | undefined;
    if (!tg) return false;
    const p = (tg.platform ?? "").toLowerCase();
    return p !== "" && p !== "unknown";
  };

  const deadline = Date.now() + (wantDev ? 400 : 5000);
  while (Date.now() < deadline) {
    const raw = window.Telegram?.WebApp?.initData;
    if (raw) {
      initTelegramChrome({ fullscreen: false });
      return raw;
    }
    if (wantDev && !inTelegramClient()) break;
    await new Promise((r) => window.setTimeout(r, 50));
  }

  if (window.Telegram?.WebApp?.initData) {
    initTelegramChrome({ fullscreen: false });
    return window.Telegram.WebApp.initData;
  }

  if (!wantDev) return null;
  const id = params.get("dev") || "1";
  const name = params.get("name") ?? `Player${id}`;
  initTelegramChrome({ fullscreen: false });
  return `dev:${id}:${name}`;
}

function RichText({
  template,
  values,
}: {
  template: string;
  values: Record<string, ReactNode>;
}) {
  const parts = template.split(/(\{\w+\})/g);
  return (
    <>
      {parts.map((part, i) => {
        const m = part.match(/^\{(\w+)\}$/);
        if (m && m[1] in values) {
          return <span key={i}>{values[m[1]]}</span>;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

export function App() {
  const { t } = useI18n();
  const [gate, setGate] = useState<Gate>("boot");
  const [tab, setTab] = useState<Tab>("lobby");
  const [user, setUser] = useState<UserDTO | null>(null);
  const [error, setErrorRaw] = useState<string | null>(null);
  const [tables, setTables] = useState<TableRow[]>([]);
  const [rakePercent, setRakePercent] = useState(5);
  const [rakeCapBb, setRakeCapBb] = useState(3);
  const [houseStats, setHouseStats] = useState<{
    balance: number;
    totalHouseFees: number;
    recent: { id: string; amount: number; at: string }[];
  } | null>(null);
  const [tableId, setTableId] = useState<string | null>(null);
  const [pendingTableId, setPendingTableId] = useState<string | null>(() =>
    readPendingTableId(),
  );
  const [buyIn, setBuyIn] = useState("2000");
  const [smallBlind, setSmallBlind] = useState("50");
  const [bigBlind, setBigBlind] = useState("100");
  const [newTableName, setNewTableName] = useState("");
  const [depositAmt, setDepositAmt] = useState("5000");
  const [withdrawAmt, setWithdrawAmt] = useState("");
  const [withdrawAddress, setWithdrawAddress] = useState("");
  const [withdrawRate, setWithdrawRate] = useState(100);
  const [withdrawals, setWithdrawals] = useState<
    {
      id: string;
      status: string;
      amountChips: number;
      amountUsdt: string;
      address: string;
      network: string;
      createdAt: string;
    }[]
  >([]);
  const [okNotice, setOkNoticeRaw] = useState<string | null>(null);
  const [tgIdCopied, setTgIdCopied] = useState(false);
  const [pending, setPending] = useState<
    {
      id: string;
      amountChips: number;
      amountUsdt: string | null;
      asset: string;
      network?: string;
      expiresAt?: string | null;
      user: { name: string; telegramId: string };
    }[]
  >([]);
  const [unmatched, setUnmatched] = useState<
    {
      id: string;
      txid: string;
      amountUsdt: string;
      fromAddress: string | null;
      note: string | null;
    }[]
  >([]);
  const [tronhooksInfo, setTronhooksInfo] = useState<{
    enabled: boolean;
    hasApiKey: boolean;
    hasSecret: boolean;
    webhookUrl: string | null;
    lastEventAt: string | null;
    lastError: string | null;
    lastResult: string | null;
  } | null>(null);
  const [depositPayAddress, setDepositPayAddress] = useState<string | null>(
    null,
  );
  const [depositInstr, setDepositInstr] = useState<{
    address: string;
    amountUsdt: string;
    amountChips: number;
    reference: string | null;
    expiresAt: string | null;
    note: string;
    intentId: string;
  } | null>(null);
  const [depositCopied, setDepositCopied] = useState<"addr" | "amt" | null>(
    null,
  );
  const [adjustTgId, setAdjustTgId] = useState("");
  const [adjustAmt, setAdjustAmt] = useState("1000");
  const [adjustTarget, setAdjustTarget] = useState<UserDTO | null>(null);
  const [adjustMeta, setAdjustMeta] = useState<{
    referredBy: { id: string; name: string; telegramId: string } | null;
    referralCount: number;
    blockedAt: string | null;
    blockedReason: string | null;
  } | null>(null);
  const [blockReason, setBlockReason] = useState("");
    const [referral, setReferral] = useState<{
    code: string;
    inviteesCount: number;
    telegramStartLink: string | null;
    miniAppLink: string;
  } | null>(null);
  const [referralCopied, setReferralCopied] = useState(false);

  const setError = useCallback((msg: string | null) => {
    setOkNoticeRaw(null);
    setErrorRaw(msg == null ? null : localizeApiError(msg));
  }, []);

  const setOkNotice = useCallback((msg: string | null) => {
    setErrorRaw(null);
    setOkNoticeRaw(msg);
  }, []);

  const clearNotice = useCallback(() => {
    setErrorRaw(null);
    setOkNoticeRaw(null);
  }, []);

  const withNotice = useCallback(
    (node: ReactNode) => (
      <>
        <CenterNotice
          text={error ?? okNotice}
          variant={error ? "error" : "ok"}
          onClose={clearNotice}
        />
        {node}
      </>
    ),
    [error, okNotice, clearNotice],
  );

  useEffect(() => {
    initTelegramChrome();
    void boot();
    return () => {
      document.documentElement.classList.remove("invite-compose");
    };
  }, []);

  // Warm deck PNGs + SFX + unlock audio on first gesture (Telegram / iOS)
  useEffect(() => {
    preloadDeckImages();
    void preloadSfx();
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("touchstart", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("touchstart", unlock);
    };
  }, []);

  useEffect(() => {
    if (gate !== "invite") {
      document.documentElement.classList.remove("invite-compose");
    }
  }, [gate]);

  useEffect(() => {
    if (gate === "app" && tab === "profile" && user?.whitelisted && !user.blocked) {
      void loadReferral();
    }
  }, [gate, tab, user?.id, user?.whitelisted, user?.blocked]);

  useEffect(() => {
    if (gate === "app" && tab === "wallet" && user?.whitelisted && !user.blocked) {
      void refreshWithdrawals();
    }
  }, [gate, tab, user?.id, user?.whitelisted, user?.blocked]);

  useEffect(() => {
    if (gate === "boot" || gate === "invite" || gate === "app") {
      document.body.classList.remove("has-tg-back");
      return;
    }
    const goBack = () => {
      if (gate === "table") {
        setTableId(null);
        void refreshTables().then(() => {
          setGate("app");
          setTab("lobby");
        });
        return;
      }
      if (gate === "admin") {
        setGate("app");
        setTab("profile");
        return;
      }
      setGate("app");
      setTab("lobby");
    };
    const unbind = bindTelegramBackButton(goBack);
    if (window.Telegram?.WebApp?.BackButton) {
      document.body.classList.add("has-tg-back");
    }
    return () => {
      unbind();
      document.body.classList.remove("has-tg-back");
    };
  }, [gate]);

  function rememberPendingTable(id: string) {
    writePendingTableId(id);
    setPendingTableId(id);
  }

  function clearPendingTable() {
    writePendingTableId(null);
    setPendingTableId(null);
  }

  async function afterInviteOrAuth(
    u: UserDTO,
    opts?: { tableId?: string | null },
  ) {
    setUser(u);
    if (opts?.tableId) {
      await openTableFromLink(opts.tableId, u);
      return;
    }
    await refreshTables();
    const pending = readPendingTableId();
    if (pending && u.balance > 0) {
      await openTableFromLink(pending, u);
      return;
    }
    if (pending && u.balance <= 0) {
      setGate("app");
      setTab("wallet");
      setError(t("tableWaitingDeposit"));
      return;
    }
    setGate("app");
    setTab("lobby");
  }

  async function boot() {
    try {
      setError(null);
      setGate("boot");
      const initData = await resolveInitData();
      if (!initData) {
        setError(t("errOpenFromTelegram"));
        setGate("boot");
        return;
      }
      const { token, user: u } = await api.authTelegram(initData);
      setToken(token);
      setUser(u);
      requestTelegramFullscreen();
      if (u.blocked) {
        setGate("app");
        setTab("profile");
        setError(t("errBlocked"));
        return;
      }
      const pre = resolveLaunchInviteCode();
      if (!u.whitelisted) {
        if (pre) {
          const r = await api.redeemInvite(pre.trim());
          await afterInviteOrAuth(r.user, { tableId: r.tableId ?? null });
          return;
        }
        setGate("invite");
        return;
      }
      // Already in club — honour REF / REF_TBL / startapp / ?invite= deep links
      if (pre) {
        try {
          const r = await api.redeemInvite(pre.trim());
          await afterInviteOrAuth(r.user, { tableId: r.tableId ?? null });
          return;
        } catch {
          /* invalid invite → fall through to lobby / pending */
        }
      }
      await afterInviteOrAuth(u);
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("errBoot");
      const net =
        /failed to fetch|network|load failed|timeout|503|502|530/i.test(msg);
      setError(net ? t("errBootNet") : msg || t("errBoot"));
      setGate("boot");
    }
  }

  async function refreshTables() {
    const r = await api.tables();
    setTables(r.tables);
  }

  function mapJoinError(raw: string): string {
    if (!raw.trim()) return t("errJoin");
    return localizeApiError(raw);
  }

  async function sitPendingTable() {
    if (!user || !pendingTableId) return;
    await openTableFromLink(pendingTableId, user);
  }

  async function createTable() {
    try {
      setError(null);
      const sb = Math.max(1, parseChips(smallBlind, 1));
      const bb = Math.max(sb * 2, parseChips(bigBlind, sb * 2));
      if (bb < sb * 2) {
        setError(t("errBlinds"));
        return;
      }
      setSmallBlind(String(sb));
      setBigBlind(String(bb));
      const name = newTableName.trim().slice(0, 40);
      const r = await api.createTable({
        ...(name ? { name } : {}),
        smallBlind: sb,
        bigBlind: bb,
        maxSeats: 9,
      });
      await join(r.table.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errCreate"));
    }
  }

  async function saveClubRake() {
    try {
      setError(null);
      setOkNotice(null);
      const r = await api.updateClubSettings({
        rakePercent: Math.max(0, Math.min(20, Math.floor(rakePercent))),
        rakeCapBb: Math.max(0, Math.min(20, Math.floor(rakeCapBb))),
      });
      setRakePercent(r.rakePercent);
      setRakeCapBb(r.rakeCapBb);
      setOkNotice(t("clubRakeSaved", { n: r.tablesUpdated }));
      await refreshTables();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errClubRake"));
    }
  }

  async function adminDeleteTable(id: string) {
    if (!window.confirm(t("confirmDeleteTable"))) return;
    try {
      setError(null);
      await api.adminDeleteTable(id);
      await refreshTables();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errDeleteTable"));
    }
  }

  async function join(id: string, buyInOverride?: number) {
    try {
      setError(null);
      const r = await api.joinTable(
        id,
        buyInOverride ?? Math.max(1, parseChips(buyIn)),
      );
      setUser(r.user);
      setTableId(r.tableId ?? id);
      setGate("table");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errJoin"));
    }
  }

  /** Open table from deep link / startapp (cuid or TBL- code). */
  async function openTableFromLink(id: string, u: UserDTO) {
    try {
      setError(null);
      if (u.balance <= 0) {
        rememberPendingTable(id);
        setGate("app");
        setTab("wallet");
        setError(t("tableWaitingDeposit"));
        return;
      }
      const amount = Math.min(Math.max(1, parseChips(buyIn)), u.balance);
      const r = await api.joinTable(id, amount);
      setUser(r.user);
      setTableId(r.tableId ?? id);
      clearPendingTable();
      setGate("table");
    } catch (e) {
      const raw = e instanceof Error ? e.message : "";
      if (/insufficient/i.test(raw)) {
        rememberPendingTable(id);
        setGate("app");
        setTab("wallet");
        setError(t("tableWaitingDeposit"));
        return;
      }
      setError(mapJoinError(raw));
      setGate("app");
      setTab("lobby");
    }
  }

  async function makeDeposit() {
    try {
      setError(null);
      setDepositCopied(null);
      const chips = Number.parseInt(depositAmt.replace(/\D/g, ""), 10);
      if (!Number.isFinite(chips) || chips < 1) {
        setError(t("errDepositAmount"));
        return;
      }
      const r = await api.deposit(chips, "USDT");
      setDepositInstr({
        address: r.instructions.address,
        amountUsdt: r.instructions.amountUsdt,
        amountChips: r.instructions.amountChips,
        reference: r.instructions.reference,
        expiresAt: r.instructions.expiresAt,
        note: r.instructions.note,
        intentId: r.intent.id,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errDeposit"));
    }
  }

  async function refreshWithdrawals() {
    try {
      const [cfg, list] = await Promise.all([
        api.withdrawConfig(),
        api.myWithdrawals(),
      ]);
      setWithdrawRate(cfg.chipsPerUsdt);
      setWithdrawals(list.withdrawals);
    } catch {
      /* ignore */
    }
  }

  async function makeWithdraw() {
    if (!user) return;
    try {
      setError(null);
      setOkNotice(null);
      const chips = Number.parseInt(withdrawAmt.replace(/\D/g, ""), 10);
      const addr = withdrawAddress.trim();
      if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(addr)) {
        setError(t("errWithdrawAddress"));
        return;
      }
      if (
        !Number.isFinite(chips) ||
        chips < withdrawRate ||
        chips % withdrawRate !== 0 ||
        chips > user.balance
      ) {
        setError(t("errWithdrawAmount"));
        return;
      }
      const r = await api.createWithdraw(chips, addr);
      setUser(r.user);
      setWithdrawAmt("");
      setOkNotice(t("withdrawCreated"));
      await refreshWithdrawals();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errWithdraw"));
    }
  }

  async function copyDepositField(kind: "addr" | "amt") {
    if (!depositInstr) return;
    const text =
      kind === "addr" ? depositInstr.address : depositInstr.amountUsdt;
    try {
      await navigator.clipboard.writeText(text);
      setDepositCopied(kind);
      setOkNotice(t("noticeCopied"));
      window.setTimeout(() => setDepositCopied(null), 2000);
    } catch {
      setError(t("copyFailed"));
    }
  }

  async function copyTelegramId() {
    if (!user?.telegramId) return;
    try {
      await navigator.clipboard.writeText(String(user.telegramId));
      setTgIdCopied(true);
      setOkNotice(t("noticeCopied"));
      window.setTimeout(() => setTgIdCopied(false), 2000);
    } catch {
      setError(t("copyFailed"));
    }
  }

  async function refreshAdminDeposits() {
    const [deps, um] = await Promise.all([
      api.pendingDeposits(),
      api.unmatchedDeposits().catch(() => ({ unmatched: [] })),
    ]);
    setPending(deps.deposits);
    setTronhooksInfo(deps.tronhooks ?? null);
    setDepositPayAddress(deps.payAddress);
    setUnmatched(um.unmatched);
  }

  async function openAdmin() {
    setError(null);
    setOkNotice(null);
    setAdjustTarget(null);
    setGate("admin");
    const [deps, house, club, um] = await Promise.all([
      api.pendingDeposits(),
      api.houseIncome(),
      api.clubSettings(),
      api.unmatchedDeposits().catch(() => ({ unmatched: [] })),
    ]);
    setPending(deps.deposits);
    setTronhooksInfo(deps.tronhooks ?? null);
    setDepositPayAddress(deps.payAddress);
    setUnmatched(um.unmatched);
    setHouseStats({
      balance: house.balance,
      totalHouseFees: house.totalHouseFees,
      recent: house.recent,
    });
    setRakePercent(club.rakePercent);
    setRakeCapBb(club.rakeCapBb);
  }

  async function confirmDep(id: string) {
    await api.confirmDeposit(id);
    await refreshAdminDeposits();
    const me = await api.me();
    setUser(me.user);
  }

  async function cancelDep(id: string) {
    await api.cancelDeposit(id);
    await refreshAdminDeposits();
  }

  async function registerTronhooksNow() {
    try {
      setError(null);
      const r = await api.registerTronhooksWatch(false);
      if (r.secret) {
        setOkNotice(t("tronhooksSecretOnce", { secret: r.secret }));
      } else {
        setOkNotice(r.hint ?? t("registerTronhooks"));
      }
      await refreshAdminDeposits();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errTronhooksRegister"));
    }
  }

  async function lookupAdjustTarget() {
    const id = adjustTgId.trim();
    if (!id) return;
    setError(null);
    setOkNotice(null);
    try {
      const r = await api.lookupUserByTelegram(id);
      setAdjustTarget(r.user);
      setAdjustMeta({
        referredBy: r.referredBy,
        referralCount: r.referralCount,
        blockedAt: r.blockedAt,
        blockedReason: r.blockedReason,
      });
    } catch (e) {
      setAdjustTarget(null);
      setAdjustMeta(null);
      setError(e instanceof Error ? e.message : t("errLookup"));
    }
  }

  async function toggleBlockTarget(block: boolean) {
    const id = adjustTgId.trim();
    if (!id) return;
    setError(null);
    setOkNotice(null);
    try {
      if (block) {
        const r = await api.blockUser(id, blockReason.trim() || undefined);
        setAdjustTarget(r.user);
        setAdjustMeta((m) =>
          m
            ? {
                ...m,
                blockedAt: new Date().toISOString(),
                blockedReason: blockReason.trim() || "Blocked by admin",
              }
            : m,
        );
        setOkNotice(t("blockOk"));
      } else {
        const r = await api.unblockUser(id);
        setAdjustTarget(r.user);
        setAdjustMeta((m) =>
          m ? { ...m, blockedAt: null, blockedReason: null } : m,
        );
        setOkNotice(t("unblockOk"));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errBlock"));
    }
  }

  async function loadReferral() {
    try {
      const r = await api.referral();
      setReferral(r);
    } catch {
      setReferral(null);
    }
  }

  async function shareReferralLink() {
    if (!referral) return;
    const url = referral.telegramStartLink ?? referral.miniAppLink;
    const text = t("clubInviteShareText", { code: referral.code });
    try {
      if (navigator.share) {
        await navigator.share({ title: t("brand"), text, url });
        return;
      }
    } catch {
      /* fall through to copy */
    }
    try {
      await navigator.clipboard.writeText(url);
      setReferralCopied(true);
      setOkNotice(t("noticeCopied"));
      window.setTimeout(() => setReferralCopied(false), 2000);
    } catch {
      setError(t("copyFailed"));
    }
  }

  async function adjustBalance(sign: 1 | -1) {
    const id = adjustTgId.trim();
    const amt = Math.abs(Math.floor(parseChips(adjustAmt)));
    if (!id || amt < 1) return;
    setError(null);
    setOkNotice(null);
    try {
      const r = await api.adjustBalance(id, sign * amt);
      setAdjustTarget(r.user);
      setOkNotice(t("adjustOk", { balance: r.user.balance }));
      if (user && r.user.id === user.id) setUser(r.user);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errAdjust"));
    }
  }

  const gateHeader = (
    <header className="app-topbar">
      <div className="brand-lockup">
        <BrandLogo size="sm" />
        <h1 className="brand brand-sm">{t("brand")}</h1>
      </div>
      <LanguageSwitcher className="lang-switch-compact" />
    </header>
  );

  if (gate === "boot") {
    return withNotice(
      <div className="app-shell app-shell-fit boot-screen">
        <div className="boot-brand">
          <BrandLogo size="lg" decorative={false} />
          <h1 className="brand">{t("brand")}</h1>
          <p className="sub">{t("openingRoom")}</p>
        </div>
        <LanguageSwitcher className="lang-switch-compact boot-lang" />
        {error && (
          <button
              type="button"
              className="primary-wide"
              onClick={() => void boot()}
            >
              {t("retryAuth")}
            </button>
        )}
      </div>,
    );
  }

  if (gate === "invite" || (user && !user.whitelisted)) {
    return withNotice(
      <div className="app-shell app-shell-fit invite-gate">
        {gateHeader}
        <div className="invite-gate-body">
          <div className="invite-welcome">
            <h2 className="invite-title">{t("inviteWelcome")}</h2>
            <p className="invite-lead">{t("inviteLead")}</p>
            <ul className="invite-points">
              <li>{t("invitePointSeats")}</li>
              <li>{t("invitePointTable")}</li>
              <li>{t("invitePointWallet")}</li>
            </ul>
          </div>
          <div className="panel invite-panel">
            <p className="invite-how">{t("inviteHow")}</p>
            <p className="hint hint-tight">{t("inviteNeedLink")}</p>
            <button
              type="button"
              className="secondary primary-wide"
              onClick={() => void boot()}
            >
              {t("retryAuth")}
            </button>
          </div>
        </div>
      </div>,
    );
  }

  if (!user) return withNotice(null);

  if (gate === "table" && tableId) {
    return withNotice(
      <div className="app-shell app-shell-fit">
        <TableView
          tableId={tableId}
          user={user}
          onUser={setUser}
          onBack={() => {
            setTableId(null);
            void refreshTables().then(() => {
              setGate("app");
              setTab("lobby");
            });
          }}
          onTopUp={() => {
            rememberPendingTable(tableId);
            setTableId(null);
            setGate("app");
            setTab("wallet");
          }}
        />
      </div>,
    );
  }

  if (gate === "admin") {
    return withNotice(
      <div className="app-shell app-shell-fit">
        <header className="app-topbar">
          <button
            type="button"
            className="secondary btn-compact"
            onClick={() => {
              setGate("app");
              setTab("profile");
            }}
          >
            {t("back")}
          </button>
          <h1 className="brand brand-sm">{t("clubSettings")}</h1>
          <LanguageSwitcher className="lang-switch-compact" />
        </header>
        <div className="admin-cards">
          <section className="panel panel-compact admin-card">
            <h2 className="card-title">{t("cardClubRake")}</h2>
            <p className="hint hint-tight">{t("clubRakeHint")}</p>
            <label htmlFor="club-rake">
              {t("rakePercent")}
              <input
                id="club-rake"
                type="number"
                min={0}
                max={20}
                value={rakePercent}
                onChange={(e) => setRakePercent(Number(e.target.value))}
              />
            </label>
            <label htmlFor="club-rakecap">
              {t("rakeCap")}
              <input
                id="club-rakecap"
                type="number"
                min={0}
                max={20}
                value={rakeCapBb}
                onChange={(e) => setRakeCapBb(Number(e.target.value))}
              />
            </label>
            <p className="hint hint-tight">{t("rakeHintShort")}</p>
            <button
              type="button"
              className="primary-wide"
              onClick={() => void saveClubRake()}
            >
              {t("saveClubRake")}
            </button>
          </section>

          <section className="panel panel-compact admin-card">
            <h2 className="card-title">{t("cardBalanceAdjust")}</h2>
            <p className="hint hint-tight">{t("balanceAdjustHint")}</p>
            <label htmlFor="adj-tg">
              {t("telegramIdLabel")}
              <input
                id="adj-tg"
                inputMode="numeric"
                autoComplete="off"
                value={adjustTgId}
                onChange={(e) => {
                  setAdjustTgId(e.target.value.replace(/[^\d]/g, ""));
                  setAdjustTarget(null);
                  setAdjustMeta(null);
                  setOkNotice(null);
                }}
                placeholder="123456789"
              />
            </label>
            <div className="row">
              <button
                type="button"
                className="secondary btn-compact"
                onClick={() => void lookupAdjustTarget()}
                disabled={!adjustTgId.trim()}
              >
                {t("lookupPlayer")}
              </button>
            </div>
            {adjustTarget && (
              <div className="player-found-block">
                <p className="player-found">
                  {t("playerFound", {
                    name: adjustTarget.name,
                    balance: adjustTarget.balance,
                  })}
                  {adjustTarget.blocked || adjustMeta?.blockedAt
                    ? ` · ${t("userBlockedBadge")}`
                    : ""}
                </p>
                <p className="hint hint-tight">
                  {adjustMeta?.referredBy
                    ? t("referredByLabel", {
                        name: adjustMeta.referredBy.name,
                        id: adjustMeta.referredBy.telegramId,
                      })
                    : t("referredByNone")}
                  {adjustMeta
                    ? ` · ${t("referralCount", { n: adjustMeta.referralCount })}`
                    : ""}
                </p>
                {adjustMeta?.blockedReason && (
                  <p className="hint hint-tight">{adjustMeta.blockedReason}</p>
                )}
                <label htmlFor="block-reason">
                  {t("blockReasonPlaceholder")}
                  <input
                    id="block-reason"
                    value={blockReason}
                    onChange={(e) => setBlockReason(e.target.value)}
                    placeholder={t("blockReasonPlaceholder")}
                  />
                </label>
                <div className="row adjust-actions">
                  {adjustTarget.blocked || adjustMeta?.blockedAt ? (
                    <button
                      type="button"
                      className="secondary btn-compact"
                      onClick={() => void toggleBlockTarget(false)}
                    >
                      {t("unblockUser")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="secondary btn-compact"
                      onClick={() => void toggleBlockTarget(true)}
                      disabled={adjustTarget.role === "admin"}
                    >
                      {t("blockUser")}
                    </button>
                  )}
                </div>
              </div>
            )}
            <label htmlFor="adj-amt">
              {t("adjustAmount")}
              <input
                id="adj-amt"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                enterKeyHint="done"
                autoComplete="off"
                value={adjustAmt}
                onChange={(e) => setAdjustAmt(digitsOnly(e.target.value))}
                onFocus={(e) => scrollFieldAboveKeyboard(e.currentTarget)}
              />
            </label>
            <div className="row adjust-actions">
              <button
                type="button"
                className="btn-compact"
                onClick={() => void adjustBalance(1)}
                disabled={!adjustTgId.trim() || parseChips(adjustAmt) < 1}
              >
                {t("creditBalance")}
              </button>
              <button
                type="button"
                className="secondary btn-compact"
                onClick={() => void adjustBalance(-1)}
                disabled={!adjustTgId.trim() || parseChips(adjustAmt) < 1}
              >
                {t("debitBalance")}
              </button>
            </div>
            
          </section>

          <section className="panel panel-compact admin-card">
            <h2 className="card-title">{t("cardDeposits")}</h2>
            <p className="hint hint-tight">
              {t("depositAdminHint")}
            </p>
            {depositPayAddress && (
              <p className="hint hint-tight mono-wrap">
                {t("depositClubAddress")}: <strong>{depositPayAddress}</strong>
              </p>
            )}
            {tronhooksInfo && (
              <p className="hint hint-tight mono-wrap">
                {t("depositHooksStatus", {
                  on: tronhooksInfo.enabled ? t("on") : t("off"),
                  url: tronhooksInfo.webhookUrl ?? "—",
                  at: tronhooksInfo.lastEventAt
                    ? new Date(tronhooksInfo.lastEventAt).toLocaleString()
                    : "—",
                  result: tronhooksInfo.lastResult ?? "—",
                  err: tronhooksInfo.lastError ?? "—",
                })}
              </p>
            )}
            <button
              type="button"
              className="secondary primary-wide"
              onClick={() => void registerTronhooksNow()}
            >
              {t("registerTronhooks")}
            </button>
            {pending.length === 0 && <p className="hint">{t("none")}</p>}
            <div className="admin-list">
              {pending.slice(0, 8).map((d) => (
                <div key={d.id} className="table-item table-item-compact">
                  <div>
                    <div>
                      {d.user.name}: {d.amountChips} {t("chips")}
                      {d.amountUsdt ? ` · ${d.amountUsdt} USDT` : ""}
                    </div>
                    <div className="tg-id">
                      {t("telegramIdShort", { id: d.user.telegramId })}
                      {d.expiresAt
                        ? ` · ${t("expiresAt", {
                            t: new Date(d.expiresAt).toLocaleTimeString(),
                          })}`
                        : ""}
                    </div>
                  </div>
                  <div className="row">
                    <button type="button" onClick={() => void confirmDep(d.id)}>
                      {t("confirm")}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => void cancelDep(d.id)}
                    >
                      {t("cancel")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {unmatched.length > 0 && (
              <>
                <h3 className="card-title" style={{ marginTop: 12 }}>
                  {t("unmatchedDeposits")}
                </h3>
                <div className="admin-list">
                  {unmatched.slice(0, 6).map((u) => (
                    <div key={u.id} className="table-item table-item-compact">
                      <div>
                        <div>
                          {u.amountUsdt} USDT
                        </div>
                        <div className="hint mono-wrap">{u.txid}</div>
                        {u.note && <div className="hint">{u.note}</div>}
                      </div>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() =>
                          void api
                            .ignoreUnmatchedDeposit(u.id)
                            .then(() => refreshAdminDeposits())
                        }
                      >
                        {t("ignore")}
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>

          <section className="panel panel-compact admin-card">
            <h2 className="card-title">{t("cardRake")}</h2>
            <div className="balance">
              {houseStats?.balance ?? user.balance} {t("chips")}
            </div>
            <p className="hint">
              {t("totalCollected", {
                amount: houseStats?.totalHouseFees ?? 0,
              })}
            </p>
            <div className="admin-list">
              {houseStats?.recent.slice(0, 3).map((e) => (
                <div key={e.id} className="hint">
                  +{e.amount} · {new Date(e.at).toLocaleString()}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>,
    );
  }

  const topbar = (
    <header className="app-topbar">
      <LanguageSwitcher className="lang-switch-compact" />
      <button
        type="button"
        className="balance-chip"
        onClick={() => setTab("wallet")}
        title={t("wallet")}
      >
        <IconChip size={16} className="balance-chip-ico" />
        <span className="balance-chip-label">{t("balanceShort")}</span>
        <span className="balance">{user.balance}</span>
      </button>
    </header>
  );

  const navIcon = {
    lobby: IconLobby,
    tables: IconTables,
    wallet: IconWallet,
    profile: IconProfile,
  } as const;

  const bottomNav = (
    <nav className="bottom-nav" aria-label="Main">
      {(
        [
          ["lobby", t("navLobby")],
          ["tables", t("navTables")],
          ["wallet", t("navWallet")],
          ["profile", t("navProfile")],
        ] as const
      ).map(([id, label]) => {
        const Icon = navIcon[id];
        return (
          <button
            key={id}
            type="button"
            className={tab === id ? "bottom-nav-item active" : "bottom-nav-item"}
            onClick={() => {
              setTab(id);
              setError(null);
              if (id === "lobby") void refreshTables();
            }}
          >
            <span className="bottom-nav-icon" aria-hidden>
              <Icon size={22} />
            </span>
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );

  let body: ReactNode = null;

  if (user.blocked) {
    body = (
      <div className="tab-pane">
        <section className="panel panel-compact">
          <h2 className="card-title">{t("accountBlockedTitle")}</h2>
          <p className="hint">{t("accountBlockedBody")}</p>
        </section>
      </div>
    );
  } else if (tab === "lobby") {
    const openCount = tables.length;
    const seatedSum = tables.reduce((n, tbl) => n + tbl.seated, 0);
    body = (
      <div className="tab-pane">
        <div className="lobby-hello">
          <div className="lobby-hero">
            <BrandLogo size="lg" decorative={false} className="lobby-hero-logo" />
            <h1 className="lobby-hero-brand">{t("brand")}</h1>
          </div>
          <div className="lobby-player-row">
            {user.avatarUrl ? (
              <img
                className="lobby-player-avatar"
                src={user.avatarUrl}
                alt=""
                width={44}
                height={44}
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="lobby-player-avatar lobby-player-avatar-fallback">
                {(user.name ?? "?")[0]}
              </div>
            )}
            <div className="user-identity">
              <strong>{user.name}</strong>
              <button
                type="button"
                className="tg-id tg-id-btn"
                title={t("tapToCopyId")}
                onClick={() => void copyTelegramId()}
              >
                {tgIdCopied
                  ? t("copied")
                  : t("telegramIdShort", { id: user.telegramId })}
              </button>
            </div>
          </div>
          <span className="hint">{t("lobbyHint")}</span>
        </div>

        <div className="lobby-stats" aria-label={t("lobbyStats")}>
          <div className="lobby-stat">
            <IconUsers size={14} />
            <span>{t("lobbySeated", { n: seatedSum })}</span>
          </div>
          <div className="lobby-stat">
            <IconTables size={14} />
            <span>{t("lobbyTablesOpen", { n: openCount })}</span>
          </div>
        </div>

        <div className="row spread lobby-toolbar">
          <label className="inline-field" htmlFor="buyin-lobby">
            {t("buyIn")}
            <input
              id="buyin-lobby"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              enterKeyHint="done"
              autoComplete="off"
              value={buyIn}
              onChange={(e) => setBuyIn(digitsOnly(e.target.value))}
              onFocus={(e) => scrollFieldAboveKeyboard(e.currentTarget)}
            />
          </label>
          <button
            type="button"
            className="secondary btn-compact btn-icon"
            onClick={() => void refreshTables()}
            aria-label={t("refresh")}
            title={t("refresh")}
          >
            <IconRefresh size={18} />
          </button>
        </div>
        <div className="table-list table-list-fit">
          {tables.map((tbl, i) => (
            <div
              key={tbl.id}
              className={`table-card table-card-${i % 2 === 0 ? "teal" : "amber"}`}
            >
              <div className="table-card-main">
                <div className="table-card-top">
                  <strong className="table-card-name">{tbl.name}</strong>
                  <span className="table-status-pill">{t("tableActive")}</span>
                </div>
                <div className="table-card-meta">
                  {t("tableBlinds", { sb: tbl.smallBlind, bb: tbl.bigBlind })}
                </div>
                <div className="table-card-facts">
                  <span>
                    <IconUsers size={13} />{" "}
                    {t("tablePlayers", {
                      seated: tbl.seated,
                      max: tbl.maxSeats,
                    })}
                  </span>
                  <span>
                    <IconChip size={13} />{" "}
                    {t("tableBuyInHint", {
                      amount: Math.max(1, parseChips(buyIn)),
                    })}
                  </span>
                </div>
                <div className="table-card-actions">
                  <button
                    type="button"
                    className="table-enter-btn"
                    onClick={() => join(tbl.id)}
                  >
                    {t("enterTable")}
                    <IconArrowRight size={16} />
                  </button>
                  {user.role === "admin" && (
                    <button
                      type="button"
                      className="secondary btn-icon btn-danger-text"
                      onClick={() => void adminDeleteTable(tbl.id)}
                      title={t("deleteTable")}
                      aria-label={t("deleteTable")}
                    >
                      <IconTrash size={16} />
                    </button>
                  )}
                </div>
              </div>
              <LobbyFaceCards tableId={tbl.id} />
            </div>
          ))}
          {tables.length === 0 && <p className="hint center-hint">{t("noTables")}</p>}
        </div>
      </div>
    );
  } else if (tab === "tables") {
    body = (
      <div className="tab-pane">
        <h2 className="pane-title">{t("createTableTitle")}</h2>
        <div className="panel panel-compact create-grid">
          <div className="blinds-row">
            <label htmlFor="sb">
              {t("smallBlind")}
              <input
                id="sb"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                enterKeyHint="next"
                autoComplete="off"
                value={smallBlind}
                onChange={(e) => {
                  const next = digitsOnly(e.target.value);
                  setSmallBlind(next);
                  if (next) {
                    const sb = parseChips(next);
                    if (sb > 0) setBigBlind(String(sb * 2));
                  }
                }}
                onFocus={(e) => scrollFieldAboveKeyboard(e.currentTarget)}
              />
            </label>
            <label htmlFor="bb">
              {t("bigBlind")}
              <input
                id="bb"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                enterKeyHint="next"
                autoComplete="off"
                value={bigBlind}
                onChange={(e) => setBigBlind(digitsOnly(e.target.value))}
                onFocus={(e) => scrollFieldAboveKeyboard(e.currentTarget)}
              />
            </label>
          </div>
          <p className="hint hint-tight">{t("blindsHint")}</p>
          <label htmlFor="table-name-new">
            {t("tableNameField")}
            <input
              id="table-name-new"
              type="text"
              maxLength={40}
              enterKeyHint="next"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder={t("tableNamePlaceholder")}
              value={newTableName}
              onChange={(e) => setNewTableName(e.target.value.slice(0, 40))}
              onFocus={(e) => scrollFieldAboveKeyboard(e.currentTarget)}
            />
          </label>
          <label htmlFor="buyin">
            {t("buyIn")}
            <input
              id="buyin"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              enterKeyHint="done"
              autoComplete="off"
              value={buyIn}
              onChange={(e) => setBuyIn(digitsOnly(e.target.value))}
              onFocus={(e) => scrollFieldAboveKeyboard(e.currentTarget)}
            />
          </label>
          <button type="button" className="primary-wide" onClick={createTable}>
            {t("createTableSit")}
          </button>
        </div>
        
      </div>
    );
  } else if (tab === "wallet") {
    body = (
      <div className="tab-pane wallet-pane">
        <h2 className="pane-title">{t("wallet")}</h2>
        <p className="balance-line">
          <RichText
            template={t("balanceLabel")}
            values={{
              balance: <span className="balance">{user.balance}</span>,
            }}
          />
        </p>
        <p className="hint hint-tight wallet-rate">
          {t("chipsRate", { rate: withdrawRate })}
        </p>
        {pendingTableId && (
          <div className="panel panel-compact pending-table-panel">
            <p className="hint hint-tight">{t("pendingTableHint")}</p>
            <button
              type="button"
              className="primary-wide"
              disabled={user.balance <= 0}
              onClick={() => void sitPendingTable()}
            >
              {t("sitPendingTable")}
            </button>
          </div>
        )}
        <div className="panel panel-compact">
          <h3 className="pane-subtitle">{t("withdrawTitle")}</h3>
          <p className="hint hint-tight">
            {t("withdrawHint", { rate: withdrawRate })}
          </p>
          <label htmlFor="wd-amt">
            {t("chipsToWithdraw")}
            <input
              id="wd-amt"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              enterKeyHint="next"
              autoComplete="off"
              value={withdrawAmt}
              onChange={(e) =>
                setWithdrawAmt(e.target.value.replace(/\D/g, ""))
              }
              onFocus={(e) => scrollFieldAboveKeyboard(e.currentTarget)}
            />
          </label>
          {(() => {
            const chips = Number.parseInt(withdrawAmt.replace(/\D/g, ""), 10);
            if (
              !Number.isFinite(chips) ||
              chips < withdrawRate ||
              chips % withdrawRate !== 0
            ) {
              return null;
            }
            const usdt = (chips / withdrawRate).toFixed(2);
            return (
              <p className="hint hint-tight">
                {t("withdrawPreview", { usdt })}
              </p>
            );
          })()}
          <label htmlFor="wd-addr">
            {t("withdrawAddress")}
            <input
              id="wd-addr"
              type="text"
              inputMode="text"
              enterKeyHint="done"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder={t("withdrawAddressPlaceholder")}
              value={withdrawAddress}
              onChange={(e) => setWithdrawAddress(e.target.value.trim())}
              onFocus={(e) => scrollFieldAboveKeyboard(e.currentTarget)}
            />
          </label>
          <button
            type="button"
            className="primary-wide"
            onClick={() => void makeWithdraw()}
            disabled={
              !withdrawAmt.replace(/\D/g, "") || !withdrawAddress.trim()
            }
          >
            {t("createWithdraw")}
          </button>
          
          {withdrawals.length > 0 && (
            <div className="withdraw-history">
              <p className="hint hint-tight">{t("withdrawHistory")}</p>
              <ul className="withdraw-list">
                {withdrawals.slice(0, 8).map((w) => (
                  <li key={w.id} className="withdraw-row">
                    <span>
                      {w.amountChips} → {w.amountUsdt} USDT
                    </span>
                    <span className={`withdraw-status status-${w.status}`}>
                      {w.status === "pending"
                        ? t("withdrawPending")
                        : w.status === "paid"
                          ? t("withdrawPaid")
                          : w.status === "rejected"
                            ? t("withdrawRejected")
                            : w.status}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="panel panel-compact">
          <p className="hint hint-tight">{t("walletHintUsdt")}</p>
          <label htmlFor="dep">
            {t("chipsToBuy")}
            <input
              id="dep"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              enterKeyHint="done"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              value={depositAmt}
              onChange={(e) =>
                setDepositAmt(e.target.value.replace(/\D/g, ""))
              }
              onFocus={(e) => scrollFieldAboveKeyboard(e.currentTarget)}
            />
          </label>
          <button
            type="button"
            className="primary-wide"
            onClick={() => void makeDeposit()}
            disabled={!depositAmt.replace(/\D/g, "")}
          >
            {t("createUsdtDeposit")}
          </button>
          {depositInstr && (
            <div className="deposit-paybox">
              <p className="hint hint-tight">{t("depositExactHint")}</p>
              <div className="deposit-row">
                <span className="deposit-label">{t("depositNetwork")}</span>
                <strong>USDT · TRC20</strong>
              </div>
              <div className="deposit-row">
                <span className="deposit-label">{t("depositAmount")}</span>
                <strong className="mono">{depositInstr.amountUsdt}</strong>
                <button
                  type="button"
                  className="secondary btn-compact"
                  onClick={() => void copyDepositField("amt")}
                >
                  {depositCopied === "amt" ? t("copied") : t("copy")}
                </button>
              </div>
              <div className="deposit-row">
                <span className="deposit-label">{t("depositAddress")}</span>
                <strong className="mono mono-wrap">{depositInstr.address}</strong>
                <button
                  type="button"
                  className="secondary btn-compact"
                  onClick={() => void copyDepositField("addr")}
                >
                  {depositCopied === "addr" ? t("copied") : t("copy")}
                </button>
              </div>
              {depositInstr.expiresAt && (
                <p className="hint">
                  {t("expiresAt", {
                    t: new Date(depositInstr.expiresAt).toLocaleString(),
                  })}
                </p>
              )}
              {depositInstr.reference && (
                <p className="hint">
                  <RichText
                    template={t("reference")}
                    values={{ ref: <strong>{depositInstr.reference}</strong> }}
                  />
                </p>
              )}
              <p className="hint hint-tight">{t("depositExactNote")}</p>
            </div>
          )}
        </div>
        
      </div>
    );
  } else {
    body = (
      <div className="tab-pane profile-pane">
        <div className="profile-card panel panel-compact">
          {user.avatarUrl ? (
            <img
              className="profile-avatar"
              src={user.avatarUrl}
              alt=""
              width={56}
              height={56}
            />
          ) : (
            <div className="profile-avatar profile-avatar-fallback">
              {(user.name ?? "?")[0]}
            </div>
          )}
          <div>
            <div className="profile-name">{user.name}</div>
            <button
              type="button"
              className="tg-id tg-id-btn"
              title={t("tapToCopyId")}
              onClick={() => void copyTelegramId()}
            >
              {tgIdCopied
                ? t("copied")
                : t("telegramIdShort", { id: user.telegramId })}
            </button>
            <div className="hint">
              {user.role === "admin" ? t("roleAdmin") : t("rolePlayer")}
            </div>
            <div className="balance">
              {user.balance} {t("chips")}
            </div>
          </div>
        </div>
        {user.role === "admin" && (
          <button
            type="button"
            className="gear-btn"
            onClick={() => void openAdmin()}
            aria-label={t("clubSettings")}
          >
            <span aria-hidden>⚙</span>
            <span>{t("clubSettings")}</span>
          </button>
        )}
        {user.blocked ? (
          <section className="panel panel-compact">
            <h2 className="card-title">{t("accountBlockedTitle")}</h2>
            <p className="hint">{t("accountBlockedBody")}</p>
          </section>
        ) : (
          <>
            <section className="panel panel-compact profile-invite">
              <h2 className="card-title">{t("referralTitle")}</h2>
              <p className="hint hint-tight">{t("referralHint")}</p>
              {referral ? (
                <div className="invite-code-block">
                  <button
                    type="button"
                    className="invite-code-btn"
                    onClick={() => void shareReferralLink()}
                    title={t("copyReferral")}
                  >
                    <span className="invite-code-label">{t("inviteCode")}</span>
                    <strong className="invite-code-value">{referral.code}</strong>
                  </button>
                  <p className="hint hint-tight">
                    {t("referralCount", { n: referral.inviteesCount })}
                  </p>
                  <div className="invite-actions">
                    <button
                      type="button"
                      className="primary-wide"
                      onClick={() => void shareReferralLink()}
                    >
                      {t("shareReferral")}
                    </button>
                  </div>
                  <p className="hint invite-copy-hint">
                    {referralCopied ? t("copied") : t("copyReferral")}
                  </p>
                </div>
              ) : (
                <button
                  type="button"
                  className="secondary primary-wide"
                  onClick={() => void loadReferral()}
                >
                  {t("shareReferral")}
                </button>
              )}
            </section>
          </>
        )}
        
        <p className="hint center-hint hint-tight">{t("profileHint")}</p>
      </div>
    );
  }

  return withNotice(
    <div className="app-shell app-shell-nav">
      {topbar}
      <main className="app-main">{body}</main>
      {bottomNav}
    </div>,
  );
}
