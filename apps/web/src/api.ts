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

  const res = await fetch(`${API}${path}`, { ...opts, headers, body });
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
    request<{ user: UserDTO }>("/auth/invite", {
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
    rakePercent?: number;
    rakeCapBb?: number;
    maxSeats?: number;
  }) =>
    request<{ table: { id: string } }>("/tables", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  joinTable: (id: string, buyIn: number, seatIndex?: number) =>
    request<{ seatIndex: number; user: UserDTO }>(`/tables/${id}/join`, {
      method: "POST",
      body: JSON.stringify({ buyIn, seatIndex }),
    }),
  leaveTable: (id: string) =>
    request<{ user: UserDTO }>(`/tables/${id}/leave`, { method: "POST" }),
  nextHand: (id: string) =>
    request(`/tables/${id}/next-hand`, { method: "POST" }),
  startHand: (id: string) =>
    request(`/tables/${id}/start`, { method: "POST" }),
  deposit: (amountChips: number, asset: "USDT" | "TON" = "USDT") =>
    request<{
      intent: { id: string; externalRef: string | null };
      instructions: { note: string; reference: string | null };
    }>("/wallet/deposit", {
      method: "POST",
      body: JSON.stringify({ amountChips, asset }),
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
        asset: string;
        user: { name: string };
      }[];
    }>("/admin/deposits"),
  confirmDeposit: (id: string) =>
    request(`/admin/deposits/${id}/confirm`, { method: "POST" }),
  houseIncome: () =>
    request<{
      balance: number;
      totalHouseFees: number;
      recent: { id: string; amount: number; at: string }[];
      note: string;
    }>("/admin/house"),
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
