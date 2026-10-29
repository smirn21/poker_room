import type { UserDTO } from "@poker/shared";

const API = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

/** Scope tokens by ?dev= so multi-player iframes don't clobber each other */
function tokenKey(): string {
  const params = new URLSearchParams(window.location.search);
  const dev = params.get("dev");
  return dev ? `poker_token_dev_${dev}` : "poker_token";
}

export function getToken(): string | null {
  return localStorage.getItem(tokenKey());
}

export function setToken(token: string): void {
  localStorage.setItem(tokenKey(), token);
}

async function request<T>(
  path: string,
  opts: RequestInit = {},
): Promise<T> {
  const method = (opts.method ?? "GET").toUpperCase();
  const headers = new Headers(opts.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let body = opts.body;
  // Fastify rejects Content-Type: application/json with an empty body
  if (method !== "GET" && method !== "HEAD") {
    headers.set("Content-Type", "application/json");
    if (body === undefined || body === null) {
      body = "{}";
    }
  }

  let res: Response;
  try {
    res = await fetch(`${API}${path}`, { ...opts, headers, body });
  } catch {
    let host = API;
    try {
      host = new URL(API).host;
    } catch {
      /* keep raw */
    }
    throw new Error(`No connection to API (${host})`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      (data as { error?: string }).error || res.statusText || "Request failed",
    );
  }
  return data as T;
}

export const api = {
  authTelegram: (initData: string) =>
    request<{ token: string; user: UserDTO }>("/auth/telegram", {
      method: "POST",
      body: JSON.stringify({ initData }),
    }),
  redeemInvite: (code: string) =>
    request<{ user: UserDTO; tableId?: string }>("/auth/invite", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),
  me: () => request<{ user: UserDTO }>("/me"),
  tables: () =>
    request<{
      tables: {
        id: string;
        name: string;
        smallBlind: number;
        bigBlind: number;
        rakePercent: number;
        rakeCapBb: number;
        maxSeats: number;
        seated: number;
      }[];
    }>("/tables"),
  createTable: (body: {
    name?: string;
    smallBlind?: number;
    bigBlind?: number;
    maxSeats?: number;
  }) =>
    request<{
      table: { id: string; name?: string; inviteCode?: string | null };
    }>("/tables", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  clubSettings: () =>
    request<{ rakePercent: number; rakeCapBb: number }>("/club/settings"),
  updateClubSettings: (body: { rakePercent: number; rakeCapBb: number }) =>
    request<{
      rakePercent: number;
      rakeCapBb: number;
      tablesUpdated: number;
    }>("/admin/club/settings", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  renameTable: (id: string, name: string) =>
    request<{ table: { id: string; name: string } }>(
      `/tables/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ name }),
      },
    ),
  adminDeleteTable: (id: string) =>
    request<{ ok: boolean }>(`/admin/tables/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  joinTable: (id: string, buyIn: number, seatIndex?: number) =>
    request<{ seatIndex: number; user: UserDTO; tableId?: string }>(
      `/tables/${encodeURIComponent(id)}/join`,
      {
        method: "POST",
        body: JSON.stringify({ buyIn, seatIndex }),
      },
    ),
  leaveTable: (id: string) =>
    request<{ user: UserDTO; tableDeleted?: boolean }>(
      `/tables/${id}/leave`,
      { method: "POST" },
    ),
  rebuyTable: (id: string, buyIn: number) =>
    request<{ user: UserDTO }>(`/tables/${id}/rebuy`, {
      method: "POST",
      body: JSON.stringify({ buyIn }),
    }),
  nextHand: (id: string) =>
    request(`/tables/${id}/next-hand`, { method: "POST" }),
  startHand: (id: string) =>
    request(`/tables/${id}/start`, { method: "POST" }),
  depositConfig: () =>
    request<{
      enabled: boolean;
      network: string;
      asset: string;
      address: string | null;
      chipsPerUsdt: number;
      ttlMinutes: number;
      watchEnabled: boolean;
    }>("/wallet/deposit/config"),
  deposit: (amountChips: number, asset: "USDT" = "USDT") =>
    request<{
      intent: {
        id: string;
        status: string;
        amountChips: number;
        amountUsdt: string;
        amountUsdtMicro: number | null;
        asset: string;
        network: string;
        payAddress: string | null;
        externalRef: string | null;
        expiresAt: string | null;
      };
      instructions: {
        network: string;
        asset: string;
        address: string;
        amountUsdt: string;
        amountChips: number;
        reference: string | null;
        expiresAt: string | null;
        note: string;
      };
    }>("/wallet/deposit", {
      method: "POST",
      body: JSON.stringify({ amountChips, asset }),
    }),
  myDeposits: () =>
    request<{
      deposits: {
        id: string;
        status: string;
        amountChips: number;
        amountUsdt: string | null;
        payAddress: string | null;
        txid: string | null;
        expiresAt: string | null;
        createdAt: string;
      }[];
    }>("/wallet/deposits"),
  cancelMyDeposit: (id: string) =>
    request<{ ok: boolean }>(`/wallet/deposits/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
    }),
  ledger: () => request<{ entries: unknown[] }>("/wallet/ledger"),
  createInvite: (maxUses = 5) =>
    request<{ invite: { code: string; maxUses: number } }>("/admin/invites", {
      method: "POST",
      body: JSON.stringify({ maxUses }),
    }),
  pendingDeposits: () =>
    request<{
      deposits: {
        id: string;
        amountChips: number;
        amountUsdt: string | null;
        asset: string;
        network: string;
        status: string;
        payAddress: string | null;
        expiresAt: string | null;
        txid: string | null;
        user: { name: string; telegramId: string };
      }[];
      watch: {
        enabled: boolean;
        address: string | null;
        lastOkAt: string | null;
        lastError: string | null;
      };
      tronhooks?: {
        enabled: boolean;
        hasApiKey: boolean;
        hasSecret: boolean;
        webhookUrl: string | null;
        lastEventAt: string | null;
        lastError: string | null;
        lastResult: string | null;
      };
      payAddress: string | null;
      chipsPerUsdt: number;
    }>("/admin/deposits"),
  registerTronhooksWatch: (forceRecreate = false) =>
    request<{
      ok: boolean;
      watchId: string;
      webhookUrl: string;
      secret: string | null;
      created: boolean;
      reused: boolean;
      hint: string | null;
    }>("/admin/deposits/tronhooks/register", {
      method: "POST",
      body: JSON.stringify({ forceRecreate }),
    }),
  unmatchedDeposits: () =>
    request<{
      unmatched: {
        id: string;
        txid: string;
        amountUsdt: string;
        fromAddress: string | null;
        note: string | null;
        createdAt: string;
      }[];
    }>("/admin/deposits/unmatched"),
  pollDeposits: () =>
    request<{
      ok: boolean;
      matched: number;
      unmatched: number;
      expired: number;
    }>("/admin/deposits/poll", { method: "POST" }),
  confirmDeposit: (id: string, txid?: string) =>
    request(`/admin/deposits/${encodeURIComponent(id)}/confirm`, {
      method: "POST",
      body: JSON.stringify(txid ? { txid } : {}),
    }),
  cancelDeposit: (id: string) =>
    request(`/admin/deposits/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
    }),
  ignoreUnmatchedDeposit: (id: string) =>
    request(`/admin/deposits/unmatched/${encodeURIComponent(id)}/ignore`, {
      method: "POST",
    }),
  linkUnmatchedDeposit: (id: string, intentId: string) =>
    request(`/admin/deposits/unmatched/${encodeURIComponent(id)}/link`, {
      method: "POST",
      body: JSON.stringify({ intentId }),
    }),
  houseIncome: () =>
    request<{
      balance: number;
      totalHouseFees: number;
      recent: { id: string; amount: number; at: string }[];
      note: string;
    }>("/admin/house"),
  lookupUserByTelegram: (telegramId: string) =>
    request<{ user: UserDTO }>(
      `/admin/users/by-telegram/${encodeURIComponent(telegramId.trim())}`,
    ),
  adjustBalance: (telegramId: string, amount: number) =>
    request<{ user: UserDTO }>("/admin/wallet/adjust", {
      method: "POST",
      body: JSON.stringify({ telegramId: telegramId.trim(), amount }),
    }),
  chatHistory: (tableId: string) =>
    request<{
      messages: {
        id: string;
        name: string;
        avatarUrl: string | null;
        text: string;
        at: string;
        userId: string;
      }[];
    }>(`/tables/${tableId}/chat`),
};
