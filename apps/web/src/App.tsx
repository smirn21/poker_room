import { useEffect, useState, type ReactNode } from "react";
import type { UserDTO } from "@poker/shared";
import { api, getToken, setToken } from "./api";
import { TableView } from "./TableView";
import { bindTelegramBackButton, initTelegramChrome } from "./telegram";
import { useI18n } from "./i18n";
import { LanguageSwitcher } from "./i18n/LanguageSwitcher";

type Screen = "boot" | "invite" | "lobby" | "table" | "wallet" | "admin";

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
  const [screen, setScreen] = useState<Screen>("boot");
  const [user, setUser] = useState<UserDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState("");
  const [tables, setTables] = useState<
    {
      id: string;
      name: string;
      smallBlind: number;
      bigBlind: number;
      rakePercent: number;
      rakeCapBb: number;
      maxSeats: number;
      seated: number;
    }[]
  >([]);
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
    if (screen === "lobby" || screen === "boot" || screen === "invite") {
      document.body.classList.remove("has-tg-back");
      return;
    }
    const goBack = () => {
      if (screen === "table") {
        setTableId(null);
        void refreshTables().then(() => setScreen("lobby"));
        return;
      }
      setScreen("lobby");
    };
    const unbind = bindTelegramBackButton(goBack);
    if (window.Telegram?.WebApp?.BackButton) {
      document.body.classList.add("has-tg-back");
    }
    return () => {
      unbind();
      document.body.classList.remove("has-tg-back");
    };
  }, [screen]);

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
          setScreen("lobby");
          return;
        }
        setScreen("invite");
        return;
      }
      await refreshTables();
      setScreen("lobby");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errBoot"));
      setScreen("invite");
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
      setScreen("lobby");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errInvite"));
    }
  }

  async function createTable() {
    try {
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

  async function join(id: string) {
    try {
      setError(null);
      const r = await api.joinTable(id, buyIn);
      setUser(r.user);
      setTableId(id);
      setScreen("table");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errJoin"));
    }
  }

  async function makeDeposit() {
    try {
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

  async function loadAdmin() {
    setScreen("admin");
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

  const shellHeader = (
    <div className="shell-header">
      <h1 className="brand">{t("brand")}</h1>
      <LanguageSwitcher />
    </div>
  );

  if (screen === "boot") {
    return (
      <div className="app-shell">
        {shellHeader}
        <p className="sub">{t("openingRoom")}</p>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  if (screen === "invite" || (user && !user.whitelisted)) {
    return (
      <div className="app-shell">
        {shellHeader}
        <p className="sub">{t("inviteOnly")}</p>
        <div className="panel">
          <label htmlFor="invite">{t("inviteCode")}</label>
          <input
            id="invite"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            placeholder="CLUB-XXXXXX"
          />
          <button type="button" onClick={redeem} style={{ width: "100%" }}>
            {t("enter")}
          </button>
          {error && <p className="error">{error}</p>}
          {!getToken() && (
            <button
              type="button"
              className="secondary"
              style={{ width: "100%", marginTop: 8 }}
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

  if (screen === "table" && tableId) {
    return (
      <div className="app-shell">
        <TableView
          tableId={tableId}
          user={user}
          onUser={setUser}
          onBack={() => {
            setTableId(null);
            void refreshTables().then(() => setScreen("lobby"));
          }}
        />
      </div>
    );
  }

  if (screen === "wallet") {
    return (
      <div className="app-shell">
        {shellHeader}
        <p className="sub">
          <RichText
            template={t("balanceLabel")}
            values={{
              balance: <span className="balance">{user.balance}</span>,
            }}
          />
        </p>
        <div className="panel">
          <p className="hint">{t("walletHint")}</p>
          <label htmlFor="dep">{t("chipsToBuy")}</label>
          <input
            id="dep"
            type="number"
            value={depositAmt}
            onChange={(e) => setDepositAmt(Number(e.target.value))}
          />
          <button type="button" onClick={makeDeposit} style={{ width: "100%" }}>
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
        <button
          type="button"
          className="secondary"
          onClick={() => setScreen("lobby")}
        >
          {t("back")}
        </button>
      </div>
    );
  }

  if (screen === "admin") {
    return (
      <div className="app-shell">
        {shellHeader}
        <div className="panel">
          <p className="sub">{t("rakeIncome")}</p>
          <div className="balance">
            {houseStats?.balance ?? user?.balance ?? 0} {t("chips")}
          </div>
          <p className="hint">
            {t("totalCollected", {
              amount: houseStats?.totalHouseFees ?? 0,
            })}
          </p>
          {houseStats?.recent.slice(0, 5).map((e) => (
            <div key={e.id} className="hint">
              +{e.amount} · {new Date(e.at).toLocaleString()}
            </div>
          ))}
        </div>
        <div className="panel">
          <button type="button" onClick={createInvite} style={{ width: "100%" }}>
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
        </div>
        <div className="panel">
          <p className="sub">{t("pendingDeposits")}</p>
          {pending.length === 0 && <p className="hint">{t("none")}</p>}
          {pending.map((d) => (
            <div key={d.id} className="table-item">
              <div>
                {d.user.name}: {d.amountChips} ({d.asset})
              </div>
              <button type="button" onClick={() => confirmDep(d.id)}>
                {t("confirm")}
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="secondary"
          onClick={() => setScreen("lobby")}
        >
          {t("back")}
        </button>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {shellHeader}
      <p className="sub">{t("privateHoldem")}</p>

      <div className="panel row spread">
        <div className="row" style={{ gap: "0.65rem" }}>
          {user.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt=""
              width={36}
              height={36}
              style={{ borderRadius: "50%" }}
            />
          ) : null}
          <div>
            <div>{user.name}</div>
            <div className="balance">
              {user.balance} {t("chips")}
            </div>
          </div>
        </div>
        <div className="row">
          <button
            type="button"
            className="secondary"
            onClick={() => setScreen("wallet")}
          >
            {t("wallet")}
          </button>
          {user.role === "admin" && (
            <button type="button" className="secondary" onClick={loadAdmin}>
              {t("admin")}
            </button>
          )}
        </div>
      </div>

      <div className="tabs">
        <button type="button" className="active">
          {t("tables")}
        </button>
        <button type="button" onClick={refreshTables}>
          {t("refresh")}
        </button>
      </div>

      <div className="panel">
        <label htmlFor="buyin">{t("buyIn")}</label>
        <input
          id="buyin"
          type="number"
          value={buyIn}
          onChange={(e) => setBuyIn(Number(e.target.value))}
        />
        <label htmlFor="rake">{t("rakePercent")}</label>
        <input
          id="rake"
          type="number"
          min={0}
          max={20}
          value={rakePercent}
          onChange={(e) => setRakePercent(Number(e.target.value))}
        />
        <label htmlFor="rakecap">{t("rakeCap")}</label>
        <input
          id="rakecap"
          type="number"
          min={0}
          max={20}
          value={rakeCapBb}
          onChange={(e) => setRakeCapBb(Number(e.target.value))}
        />
        <p className="hint">{t("rakeHint")}</p>
        <button type="button" onClick={createTable} style={{ width: "100%" }}>
          {t("createTableSit")}
        </button>
      </div>

      <div className="table-list">
        {tables.map((tbl) => (
          <div key={tbl.id} className="table-item">
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
        {tables.length === 0 && <p className="hint">{t("noTables")}</p>}
      </div>

      {error && <p className="error">{error}</p>}
      <p className="hint">
        <RichText
          template={t("devHint")}
          values={{ code: <code>?dev=2</code> }}
        />
      </p>
    </div>
  );
}
