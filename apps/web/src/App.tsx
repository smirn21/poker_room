import { useEffect, useState, type ReactNode } from "react";
import type { UserDTO } from "@poker/shared";
import { api, setToken } from "./api";
import { TableView } from "./TableView";
import { bindTelegramBackButton, initTelegramChrome } from "./telegram";
import { useI18n } from "./i18n";
import { LanguageSwitcher } from "./i18n/LanguageSwitcher";
import { LobbyFaceCards } from "./LobbyFaceCards";
import {
  IconArrowRight,
  IconChip,
  IconLobby,
  IconProfile,
  IconRefresh,
  IconSpadeMark,
  IconTables,
  IconTrash,
  IconUsers,
  IconWallet,
} from "./Icons";

type Gate = "boot" | "invite" | "app" | "table" | "admin";
type Tab = "lobby" | "tables" | "wallet" | "profile";

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

function resolveInitData(): string {
  const tg = initTelegramChrome();
  if (tg?.initData) return tg.initData;
  const params = new URLSearchParams(window.location.search);
  const id = params.get("dev") ?? "1";
  const name = params.get("name") ?? `Player${id}`;
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
  const [error, setError] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState("");
  const [tables, setTables] = useState<TableRow[]>([]);
  const [rakePercent, setRakePercent] = useState(5);
  const [rakeCapBb, setRakeCapBb] = useState(3);
  const [houseStats, setHouseStats] = useState<{
    balance: number;
    totalHouseFees: number;
    recent: { id: string; amount: number; at: string }[];
  } | null>(null);
  const [tableId, setTableId] = useState<string | null>(null);
  const [buyIn, setBuyIn] = useState(2000);
  const [depositAmt, setDepositAmt] = useState(5000);
  const [inviteCreated, setInviteCreated] = useState<string | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);
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
  const [depositWatch, setDepositWatch] = useState<{
    enabled: boolean;
    address: string | null;
    lastOkAt: string | null;
    lastError: string | null;
  } | null>(null);
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
  const [adjustAmt, setAdjustAmt] = useState(1000);
  const [adjustTarget, setAdjustTarget] = useState<UserDTO | null>(null);
  const [adjustMsg, setAdjustMsg] = useState<string | null>(null);

  useEffect(() => {
    initTelegramChrome();
    const params = new URLSearchParams(window.location.search);
    const pre = params.get("invite");
    if (pre) setInviteCode(pre);
    void boot();
  }, []);

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
    const tableParam = new URLSearchParams(window.location.search).get(
      "table",
    );
    if (tableParam) {
      await openTableFromLink(tableParam, u);
      return;
    }
    setGate("app");
    setTab("lobby");
  }

  async function boot() {
    try {
      setError(null);
      setGate("boot");
      const initData = resolveInitData();
      const { token, user: u } = await api.authTelegram(initData);
      setToken(token);
      setUser(u);
      if (!u.whitelisted) {
        const params = new URLSearchParams(window.location.search);
        const pre = params.get("invite") ?? params.get("table");
        if (pre) {
          const r = await api.redeemInvite(pre.trim());
          await afterInviteOrAuth(r.user, { tableId: r.tableId ?? null });
          return;
        }
        setGate("invite");
        return;
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

  async function redeem() {
    try {
      setError(null);
      const r = await api.redeemInvite(inviteCode.trim());
      await afterInviteOrAuth(r.user, { tableId: r.tableId ?? null });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errInvite"));
    }
  }

  /** Lobby: sit by TBL- code (or club code that maps to a table). */
  async function sitByCode() {
    try {
      setError(null);
      const code = inviteCode.trim();
      if (!code) return;
      const r = await api.redeemInvite(code);
      setUser(r.user);
      if (r.tableId) {
        await join(r.tableId);
        return;
      }
      // Plain club invite — just refresh lobby
      await refreshTables();
      setInviteCode("");
    } catch (e) {
      // Fallback: try join endpoint directly (cuid / TBL-)
      try {
        await join(inviteCode.trim());
      } catch {
        setError(e instanceof Error ? e.message : t("errInvite"));
      }
    }
  }

  async function createTable() {
    try {
      setError(null);
      const r = await api.createTable({
        smallBlind: 50,
        bigBlind: 100,
        maxSeats: 6,
      });
      await join(r.table.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errCreate"));
    }
  }

  async function saveClubRake() {
    try {
      setError(null);
      setAdjustMsg(null);
      const r = await api.updateClubSettings({
        rakePercent: Math.max(0, Math.min(20, Math.floor(rakePercent))),
        rakeCapBb: Math.max(0, Math.min(20, Math.floor(rakeCapBb))),
      });
      setRakePercent(r.rakePercent);
      setRakeCapBb(r.rakeCapBb);
      setAdjustMsg(t("clubRakeSaved", { n: r.tablesUpdated }));
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
      const r = await api.joinTable(id, buyInOverride ?? buyIn);
      setUser(r.user);
      setTableId(r.tableId ?? id);
      setGate("table");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errJoin"));
    }
  }

  /** Open table from ?table= deep link (cuid or TBL- code). */
  async function openTableFromLink(id: string, u: UserDTO) {
    try {
      setError(null);
      if (u.balance <= 0) {
        setGate("app");
        setTab("wallet");
        setError(t("errJoin"));
        return;
      }
      const amount = Math.min(buyIn, u.balance);
      const r = await api.joinTable(id, amount);
      setUser(r.user);
      setTableId(r.tableId ?? id);
      setGate("table");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errJoin"));
      setGate("app");
      setTab("lobby");
    }
  }

  async function makeDeposit() {
    try {
      setError(null);
      setDepositCopied(null);
      const r = await api.deposit(depositAmt, "USDT");
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

  async function copyDepositField(kind: "addr" | "amt") {
    if (!depositInstr) return;
    const text =
      kind === "addr" ? depositInstr.address : depositInstr.amountUsdt;
    try {
      await navigator.clipboard.writeText(text);
      setDepositCopied(kind);
      window.setTimeout(() => setDepositCopied(null), 2000);
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
    setDepositWatch(deps.watch);
    setTronhooksInfo(deps.tronhooks ?? null);
    setDepositPayAddress(deps.payAddress);
    setUnmatched(um.unmatched);
  }

  async function createInvite() {
    const r = await api.createInvite(10);
    setInviteCreated(r.invite.code);
    setInviteCopied(false);
  }

  async function copyInviteCode() {
    if (!inviteCreated) return;
    try {
      await navigator.clipboard.writeText(inviteCreated);
      setInviteCopied(true);
      window.setTimeout(() => setInviteCopied(false), 2000);
    } catch {
      setError(t("copyFailed"));
    }
  }

  async function openAdmin() {
    setError(null);
    setAdjustMsg(null);
    setAdjustTarget(null);
    setGate("admin");
    const [deps, house, club, um] = await Promise.all([
      api.pendingDeposits(),
      api.houseIncome(),
      api.clubSettings(),
      api.unmatchedDeposits().catch(() => ({ unmatched: [] })),
    ]);
    setPending(deps.deposits);
    setDepositWatch(deps.watch);
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

  async function pollDepsNow() {
    try {
      setError(null);
      const r = await api.pollDeposits();
      setAdjustMsg(
        t("depositPollOk", {
          matched: r.matched,
          unmatched: r.unmatched,
          expired: r.expired,
        }),
      );
      await refreshAdminDeposits();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errDepositPoll"));
    }
  }

  async function registerTronhooksNow() {
    try {
      setError(null);
      const r = await api.registerTronhooksWatch(false);
      if (r.secret) {
        setAdjustMsg(t("tronhooksSecretOnce", { secret: r.secret }));
      } else {
        setAdjustMsg(r.hint ?? t("registerTronhooks"));
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
    setAdjustMsg(null);
    try {
      const r = await api.lookupUserByTelegram(id);
      setAdjustTarget(r.user);
    } catch (e) {
      setAdjustTarget(null);
      setError(e instanceof Error ? e.message : t("errLookup"));
    }
  }

  async function adjustBalance(sign: 1 | -1) {
    const id = adjustTgId.trim();
    const amt = Math.abs(Math.floor(adjustAmt));
    if (!id || amt < 1) return;
    setError(null);
    setAdjustMsg(null);
    try {
      const r = await api.adjustBalance(id, sign * amt);
      setAdjustTarget(r.user);
      setAdjustMsg(t("adjustOk", { balance: r.user.balance }));
      if (user && r.user.id === user.id) setUser(r.user);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errAdjust"));
    }
  }

  const gateHeader = (
    <header className="app-topbar">
      <h1 className="brand brand-sm">{t("brand")}</h1>
      <LanguageSwitcher className="lang-switch-compact" />
    </header>
  );

  if (gate === "boot") {
    return (
      <div className="app-shell app-shell-fit">
        {gateHeader}
        <p className="sub">{t("openingRoom")}</p>
        {error && (
          <>
            <p className="error">{error}</p>
            <button
              type="button"
              className="primary-wide"
              onClick={() => void boot()}
            >
              {t("retryAuth")}
            </button>
          </>
        )}
      </div>
    );
  }

  if (gate === "invite" || (user && !user.whitelisted)) {
    return (
      <div className="app-shell app-shell-fit">
        {gateHeader}
        <p className="sub">{t("inviteOnly")}</p>
        <div className="panel panel-compact">
          <label htmlFor="invite">{t("inviteCode")}</label>
          <input
            id="invite"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            placeholder={`${t("tableCodePlaceholder")} / CLUB-…`}
            autoCapitalize="characters"
            autoCorrect="off"
          />
          <button type="button" onClick={redeem} className="primary-wide">
            {t("enter")}
          </button>
          {error && <p className="error">{error}</p>}
          <button
            type="button"
            className="secondary primary-wide"
            onClick={() => void boot()}
          >
            {t("retryAuth")}
          </button>
        </div>
      </div>
    );
  }

  if (!user) return null;

  if (gate === "table" && tableId) {
    return (
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
        />
      </div>
    );
  }

  if (gate === "admin") {
    return (
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
                  setAdjustMsg(null);
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
              <p className="player-found">
                {t("playerFound", {
                  name: adjustTarget.name,
                  balance: adjustTarget.balance,
                })}
              </p>
            )}
            <label htmlFor="adj-amt">
              {t("adjustAmount")}
              <input
                id="adj-amt"
                type="number"
                min={1}
                value={adjustAmt}
                onChange={(e) => setAdjustAmt(Number(e.target.value))}
              />
            </label>
            <div className="row adjust-actions">
              <button
                type="button"
                className="btn-compact"
                onClick={() => void adjustBalance(1)}
                disabled={!adjustTgId.trim() || adjustAmt < 1}
              >
                {t("creditBalance")}
              </button>
              <button
                type="button"
                className="secondary btn-compact"
                onClick={() => void adjustBalance(-1)}
                disabled={!adjustTgId.trim() || adjustAmt < 1}
              >
                {t("debitBalance")}
              </button>
            </div>
            {adjustMsg && <p className="ok-msg">{adjustMsg}</p>}
          </section>

          <section className="panel panel-compact admin-card">
            <h2 className="card-title">{t("cardInvites")}</h2>
            <button type="button" className="primary-wide" onClick={createInvite}>
              {t("createInvite")}
            </button>
            {inviteCreated && (
              <div className="invite-code-block">
                <button
                  type="button"
                  className="invite-code-btn"
                  onClick={() => void copyInviteCode()}
                  title={t("tapToCopy")}
                >
                  <span className="invite-code-label">{t("inviteCode")}</span>
                  <strong className="invite-code-value">{inviteCreated}</strong>
                </button>
                <p className="hint invite-copy-hint">
                  {inviteCopied ? t("copied") : t("tapToCopy")}
                </p>
              </div>
            )}
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
            {depositWatch && (
              <p className="hint hint-tight">
                {t("depositWatchStatus", {
                  on: depositWatch.enabled ? t("on") : t("off"),
                  at: depositWatch.lastOkAt
                    ? new Date(depositWatch.lastOkAt).toLocaleString()
                    : "—",
                  err: depositWatch.lastError ?? "—",
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
            <button
              type="button"
              className="secondary primary-wide"
              onClick={() => void pollDepsNow()}
            >
              {t("pollTronNow")}
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
        {error && <p className="error">{error}</p>}
      </div>
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

  if (tab === "lobby") {
    const openCount = tables.length;
    const seatedSum = tables.reduce((n, tbl) => n + tbl.seated, 0);
    body = (
      <div className="tab-pane">
        <div className="lobby-hello">
          <div className="lobby-brand-row">
            <span className="brand-mark" aria-hidden>
              <IconSpadeMark size={18} />
            </span>
            <div className="user-identity">
              <strong>{user.name}</strong>
              <span className="tg-id" title={t("telegramIdLabel")}>
                {t("telegramIdShort", { id: user.telegramId })}
              </span>
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
              type="number"
              value={buyIn}
              onChange={(e) => setBuyIn(Number(e.target.value))}
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
        <div className="lobby-code-row">
          <label className="inline-field grow" htmlFor="table-code-lobby">
            {t("tableCodeJoin")}
            <input
              id="table-code-lobby"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              placeholder={t("tableCodePlaceholder")}
              autoCapitalize="characters"
              autoCorrect="off"
            />
          </label>
          <button
            type="button"
            className="btn-compact"
            onClick={() => void sitByCode()}
            disabled={!inviteCode.trim()}
          >
            {t("sitByCode")}
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
                    {t("tableBuyInHint", { amount: buyIn })}
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
        {error && <p className="error">{error}</p>}
      </div>
    );
  } else if (tab === "tables") {
    body = (
      <div className="tab-pane">
        <h2 className="pane-title">{t("createTableTitle")}</h2>
        <div className="panel panel-compact create-grid">
          <label htmlFor="buyin">
            {t("buyIn")}
            <input
              id="buyin"
              type="number"
              value={buyIn}
              onChange={(e) => setBuyIn(Number(e.target.value))}
            />
          </label>
          <button type="button" className="primary-wide" onClick={createTable}>
            {t("createTableSit")}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    );
  } else if (tab === "wallet") {
    body = (
      <div className="tab-pane">
        <h2 className="pane-title">{t("wallet")}</h2>
        <p className="balance-line">
          <RichText
            template={t("balanceLabel")}
            values={{
              balance: <span className="balance">{user.balance}</span>,
            }}
          />
        </p>
        <div className="panel panel-compact">
          <p className="hint hint-tight">{t("walletHintUsdt")}</p>
          <label htmlFor="dep">
            {t("chipsToBuy")}
            <input
              id="dep"
              type="number"
              value={depositAmt}
              onChange={(e) => setDepositAmt(Number(e.target.value))}
            />
          </label>
          <button
            type="button"
            className="primary-wide"
            onClick={() => void makeDeposit()}
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
              <p className="hint hint-tight">{depositInstr.note}</p>
            </div>
          )}
        </div>
        {error && <p className="error">{error}</p>}
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
            <div className="tg-id" title={t("telegramIdLabel")}>
              {t("telegramIdShort", { id: user.telegramId })}
            </div>
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
        <p className="hint center-hint hint-tight">{t("profileHint")}</p>
      </div>
    );
  }

  return (
    <div className="app-shell app-shell-nav">
      {topbar}
      <main className="app-main">{body}</main>
      {bottomNav}
    </div>
  );
}
