import { useEffect, useState, type ReactNode } from "react";
import type { UserDTO } from "@poker/shared";
import { api, getToken, setToken } from "./api";
import { TableView } from "./TableView";
import { bindTelegramBackButton, initTelegramChrome } from "./telegram";
import { useI18n } from "./i18n";
import { LanguageSwitcher } from "./i18n/LanguageSwitcher";

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
    { id: string; amountChips: number; asset: string; user: { name: string } }[]
  >([]);
  const [depositRef, setDepositRef] = useState<string | null>(null);

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

  async function boot() {
    try {
      setError(null);
      const initData = resolveInitData();
      const { token, user: u } = await api.authTelegram(initData);
      setToken(token);
      setUser(u);
      if (!u.whitelisted) {
        const params = new URLSearchParams(window.location.search);
        const pre = params.get("invite");
        if (pre) {
          const r = await api.redeemInvite(pre.trim());
          setUser(r.user);
          await refreshTables();
          const tableParam = new URLSearchParams(window.location.search).get(
            "table",
          );
          if (tableParam) {
            await openTableFromLink(tableParam, r.user);
            return;
          }
          setGate("app");
          setTab("lobby");
          return;
        }
        setGate("invite");
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
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errBoot"));
      setGate("invite");
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
      setUser(r.user);
      await refreshTables();
      const tableParam = new URLSearchParams(window.location.search).get(
        "table",
      );
      if (tableParam) {
        await openTableFromLink(tableParam, r.user);
        return;
      }
      setGate("app");
      setTab("lobby");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errInvite"));
    }
  }

  async function createTable() {
    try {
      setError(null);
      const r = await api.createTable({
        name: t("tableNameNl"),
        smallBlind: 50,
        bigBlind: 100,
        rakePercent: Math.max(0, Math.min(20, Math.floor(rakePercent))),
        rakeCapBb: Math.max(0, Math.min(20, Math.floor(rakeCapBb))),
        maxSeats: 6,
      });
      await join(r.table.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errCreate"));
    }
  }

  async function join(id: string, buyInOverride?: number) {
    try {
      setError(null);
      const r = await api.joinTable(id, buyInOverride ?? buyIn);
      setUser(r.user);
      setTableId(id);
      setGate("table");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errJoin"));
    }
  }

  /** Open table from ?table= deep link (invite). */
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
      setTableId(id);
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
      const r = await api.deposit(depositAmt, "USDT");
      setDepositRef(r.intent.externalRef);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errDeposit"));
    }
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
    setGate("admin");
    const [deps, house] = await Promise.all([
      api.pendingDeposits(),
      api.houseIncome(),
    ]);
    setPending(deps.deposits);
    setHouseStats({
      balance: house.balance,
      totalHouseFees: house.totalHouseFees,
      recent: house.recent,
    });
  }

  async function confirmDep(id: string) {
    await api.confirmDeposit(id);
    const r = await api.pendingDeposits();
    setPending(r.deposits);
    const me = await api.me();
    setUser(me.user);
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
        {error && <p className="error">{error}</p>}
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
            placeholder="CLUB-XXXXXX"
          />
          <button type="button" onClick={redeem} className="primary-wide">
            {t("enter")}
          </button>
          {error && <p className="error">{error}</p>}
          {!getToken() && (
            <button
              type="button"
              className="secondary primary-wide"
              onClick={boot}
            >
              {t("retryAuth")}
            </button>
          )}
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
            {pending.length === 0 && <p className="hint">{t("none")}</p>}
            <div className="admin-list">
              {pending.slice(0, 4).map((d) => (
                <div key={d.id} className="table-item table-item-compact">
                  <div>
                    {d.user.name}: {d.amountChips} ({d.asset})
                  </div>
                  <button type="button" onClick={() => confirmDep(d.id)}>
                    {t("confirm")}
                  </button>
                </div>
              ))}
            </div>
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
        <span className="balance-chip-label">{t("balanceShort")}</span>
        <span className="balance">{user.balance}</span>
      </button>
    </header>
  );

  const bottomNav = (
    <nav className="bottom-nav" aria-label="Main">
      {(
        [
          ["lobby", t("navLobby")],
          ["tables", t("navTables")],
          ["wallet", t("navWallet")],
          ["profile", t("navProfile")],
        ] as const
      ).map(([id, label]) => (
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
            {id === "lobby" ? "♠" : id === "tables" ? "+" : id === "wallet" ? "◎" : "☺"}
          </span>
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );

  let body: ReactNode = null;

  if (tab === "lobby") {
    body = (
      <div className="tab-pane">
        <div className="lobby-hello">
          <strong>{user.name}</strong>
          <span className="hint">{t("lobbyHint")}</span>
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
          <button type="button" className="secondary btn-compact" onClick={() => void refreshTables()}>
            {t("refresh")}
          </button>
        </div>
        <div className="table-list table-list-fit">
          {tables.map((tbl) => (
            <div key={tbl.id} className="table-item table-item-compact">
              <div>
                <strong>{tbl.name}</strong>
                <div className="hint">
                  {t("tableMeta", {
                    sb: tbl.smallBlind,
                    bb: tbl.bigBlind,
                    rake: tbl.rakePercent,
                    cap: tbl.rakeCapBb,
                    seated: tbl.seated,
                    max: tbl.maxSeats,
                  })}
                </div>
              </div>
              <button type="button" onClick={() => join(tbl.id)}>
                {t("join")}
              </button>
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
          <label htmlFor="rake">
            {t("rakePercent")}
            <input
              id="rake"
              type="number"
              min={0}
              max={20}
              value={rakePercent}
              onChange={(e) => setRakePercent(Number(e.target.value))}
            />
          </label>
          <label htmlFor="rakecap">
            {t("rakeCap")}
            <input
              id="rakecap"
              type="number"
              min={0}
              max={20}
              value={rakeCapBb}
              onChange={(e) => setRakeCapBb(Number(e.target.value))}
            />
          </label>
          <p className="hint hint-tight">{t("rakeHintShort")}</p>
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
          <p className="hint hint-tight">{t("walletHintShort")}</p>
          <label htmlFor="dep">
            {t("chipsToBuy")}
            <input
              id="dep"
              type="number"
              value={depositAmt}
              onChange={(e) => setDepositAmt(Number(e.target.value))}
            />
          </label>
          <button type="button" className="primary-wide" onClick={makeDeposit}>
            {t("createUsdtDeposit")}
          </button>
          {depositRef && (
            <p className="hint" style={{ marginTop: 8 }}>
              <RichText
                template={t("reference")}
                values={{ ref: <strong>{depositRef}</strong> }}
              />
            </p>
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
