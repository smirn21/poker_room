import { useEffect, useState } from "react";
import type { UserDTO } from "@poker/shared";
import { api, getToken, setToken } from "./api";
import { TableView } from "./TableView";

type Screen = "boot" | "invite" | "lobby" | "table" | "wallet" | "admin";

function resolveInitData(): string {
  const tg = window.Telegram?.WebApp;
  if (tg?.initData) {
    tg.ready();
    tg.expand();
    return tg.initData;
  }
  // Local/dev: pick player via query ?dev=2 or default admin 1
  const params = new URLSearchParams(window.location.search);
  const id = params.get("dev") ?? "1";
  const name = params.get("name") ?? `Player${id}`;
  return `dev:${id}:${name}`;
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        ready: () => void;
        expand: () => void;
        colorScheme?: string;
      };
    };
  }
}

export function App() {
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
  const [pending, setPending] = useState<
    { id: string; amountChips: number; asset: string; user: { name: string } }[]
  >([]);
  const [depositRef, setDepositRef] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pre = params.get("invite");
    if (pre) setInviteCode(pre);
    void boot();
  }, []);

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
      setError(e instanceof Error ? e.message : "Boot failed");
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
      setError(e instanceof Error ? e.message : "Invite failed");
    }
  }

  async function createTable() {
    try {
      const r = await api.createTable({
        name: "NL Hold'em",
        smallBlind: 50,
        bigBlind: 100,
        rakePercent: Math.max(0, Math.min(20, Math.floor(rakePercent))),
        rakeCapBb: Math.max(0, Math.min(20, Math.floor(rakeCapBb))),
        maxSeats: 6,
      });
      await join(r.table.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
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
      setError(e instanceof Error ? e.message : "Join failed");
    }
  }

  async function makeDeposit() {
    try {
      const r = await api.deposit(depositAmt, "USDT");
      setDepositRef(r.intent.externalRef);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Deposit failed");
    }
  }

  async function createInvite() {
    const r = await api.createInvite(10);
    setInviteCreated(r.invite.code);
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

  if (screen === "boot") {
    return (
      <div className="app-shell">
        <h1 className="brand">Club Hold'em</h1>
        <p className="sub">Opening the room…</p>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  if (screen === "invite" || (user && !user.whitelisted)) {
    return (
      <div className="app-shell">
        <h1 className="brand">Club Hold'em</h1>
        <p className="sub">Invite-only. Enter your club code.</p>
        <div className="panel">
          <label htmlFor="invite">Invite code</label>
          <input
            id="invite"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            placeholder="CLUB-XXXXXX"
          />
          <button type="button" onClick={redeem} style={{ width: "100%" }}>
            Enter
          </button>
          {error && <p className="error">{error}</p>}
          {!getToken() && (
            <button
              type="button"
              className="secondary"
              style={{ width: "100%", marginTop: 8 }}
              onClick={boot}
            >
              Retry auth
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
        <h1 className="brand">Wallet</h1>
        <p className="sub">
          Balance <span className="balance">{user.balance}</span> chips
        </p>
        <div className="panel">
          <p className="hint">
            Crypto deposit (MVP): create an intent, pay the club wallet off-app,
            admin confirms.
          </p>
          <label htmlFor="dep">Chips to buy</label>
          <input
            id="dep"
            type="number"
            value={depositAmt}
            onChange={(e) => setDepositAmt(Number(e.target.value))}
          />
          <button type="button" onClick={makeDeposit} style={{ width: "100%" }}>
            Create USDT deposit
          </button>
          {depositRef && (
            <p className="hint" style={{ marginTop: 8 }}>
              Reference: <strong>{depositRef}</strong>
            </p>
          )}
        </div>
        <button type="button" className="secondary" onClick={() => setScreen("lobby")}>
          Back
        </button>
      </div>
    );
  }

  if (screen === "admin") {
    return (
      <div className="app-shell">
        <h1 className="brand">Admin</h1>
        <div className="panel">
          <p className="sub">Rake income (you)</p>
          <div className="balance">
            {houseStats?.balance ?? user?.balance ?? 0} chips
          </div>
          <p className="hint">
            Total collected: {houseStats?.totalHouseFees ?? 0}
          </p>
          {houseStats?.recent.slice(0, 5).map((e) => (
            <div key={e.id} className="hint">
              +{e.amount} · {new Date(e.at).toLocaleString()}
            </div>
          ))}
        </div>
        <div className="panel">
          <button type="button" onClick={createInvite} style={{ width: "100%" }}>
            Create invite
          </button>
          {inviteCreated && (
            <p className="hint" style={{ marginTop: 8 }}>
              Code: <strong>{inviteCreated}</strong>
            </p>
          )}
        </div>
        <div className="panel">
          <p className="sub">Pending deposits</p>
          {pending.length === 0 && <p className="hint">None</p>}
          {pending.map((d) => (
            <div key={d.id} className="table-item">
              <div>
                {d.user.name}: {d.amountChips} ({d.asset})
              </div>
              <button type="button" onClick={() => confirmDep(d.id)}>
                Confirm
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="secondary" onClick={() => setScreen("lobby")}>
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <h1 className="brand">Club Hold'em</h1>
      <p className="sub">Private Texas Hold'em · invite only</p>

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
            <div className="balance">{user.balance} chips</div>
          </div>
        </div>
        <div className="row">
          <button type="button" className="secondary" onClick={() => setScreen("wallet")}>
            Wallet
          </button>
          {user.role === "admin" && (
            <button type="button" className="secondary" onClick={loadAdmin}>
              Admin
            </button>
          )}
        </div>
      </div>

      <div className="tabs">
        <button type="button" className="active">
          Tables
        </button>
        <button type="button" onClick={refreshTables}>
          Refresh
        </button>
      </div>

      <div className="panel">
        <label htmlFor="buyin">Buy-in</label>
        <input
          id="buyin"
          type="number"
          value={buyIn}
          onChange={(e) => setBuyIn(Number(e.target.value))}
        />
        <label htmlFor="rake">Rake % (of pot)</label>
        <input
          id="rake"
          type="number"
          min={0}
          max={20}
          value={rakePercent}
          onChange={(e) => setRakePercent(Number(e.target.value))}
        />
        <label htmlFor="rakecap">Rake cap (× BB)</label>
        <input
          id="rakecap"
          type="number"
          min={0}
          max={20}
          value={rakeCapBb}
          onChange={(e) => setRakeCapBb(Number(e.target.value))}
        />
        <p className="hint">
          World standard: % of pot, capped in BB. No flop → no rake. Scales
          when blinds are millions.
        </p>
        <button type="button" onClick={createTable} style={{ width: "100%" }}>
          Create table & sit
        </button>
      </div>

      <div className="table-list">
        {tables.map((t) => (
          <div key={t.id} className="table-item">
            <div>
              <strong>{t.name}</strong>
              <div className="hint">
                {t.smallBlind}/{t.bigBlind} · rake {t.rakePercent}%/
                {t.rakeCapBb}BB · {t.seated}/{t.maxSeats}
              </div>
            </div>
            <button type="button" onClick={() => join(t.id)}>
              Join
            </button>
          </div>
        ))}
        {tables.length === 0 && (
          <p className="hint">No open tables — create one.</p>
        )}
      </div>

      {error && <p className="error">{error}</p>}
      <p className="hint">
        Dev: open <code>?dev=2</code> in another tab as a second player.
      </p>
    </div>
  );
}
