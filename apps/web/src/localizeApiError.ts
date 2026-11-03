import { ru, type MessageKey } from "./i18n/locales/ru";

type Vars = Record<string, string | number>;

function format(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    vars[key] === undefined ? `{${key}}` : String(vars[key]),
  );
}

function ruMsg(key: MessageKey, vars?: Vars): string {
  return format(ru[key], vars);
}

function hasCyrillic(s: string): boolean {
  return /[А-Яа-яЁё]/.test(s);
}

/** Map API / engine English errors to Russian notice copy. */
export function localizeApiError(raw: string | null | undefined): string {
  const msg = (raw ?? "").trim();
  if (!msg) return ruMsg("errGeneric");
  if (hasCyrillic(msg)) return msg;

  if (/no connection to api/i.test(msg)) return ruMsg("errBootNet");
  if (/failed to fetch|networkerror|load failed/i.test(msg))
    return ruMsg("errBootNet");
  if (/account blocked/i.test(msg)) return ruMsg("errBlocked");
  if (/not whitelisted/i.test(msg)) return ruMsg("errInvite");
  if (/invalid invite|invite expired|invite exhausted/i.test(msg))
    return ruMsg("errInvite");
  if (/table not found/i.test(msg)) return ruMsg("errTableCode");
  if (/table full/i.test(msg)) return ruMsg("errTableFull");
  if (/table closed/i.test(msg)) return ruMsg("errTableClosed");
  if (/insufficient/i.test(msg)) return ruMsg("errInsufficient");
  if (/need at least 2 seated players/i.test(msg))
    return ruMsg("errNeedPlayers");
  if (/bigBlind should be|big blind/i.test(msg)) return ruMsg("errBlinds");
  if (/only host can rename/i.test(msg)) return ruMsg("errHostOnly");
  if (/not seated/i.test(msg)) return ruMsg("errNotSeated");
  if (/seat taken|already seated/i.test(msg)) return ruMsg("errSeatTaken");
  if (/invalid seat/i.test(msg)) return ruMsg("errInvalidSeat");
  if (/need chips|need positive chips/i.test(msg)) return ruMsg("errNeedChips");
  if (/finish the hand first/i.test(msg)) return ruMsg("errFinishHand");
  if (/not in a hand/i.test(msg)) return ruMsg("errNotInHand");
  if (/not your turn/i.test(msg)) return ruMsg("errNotYourTurn");
  if (/cannot check/i.test(msg)) return ruMsg("errCannotCheck");
  if (/raise too small|minimum raise/i.test(msg))
    return ruMsg("errMinRaise");
  if (/use raise/i.test(msg)) return ruMsg("errUseRaise");
  if (/illegal action/i.test(msg)) return ruMsg("errIllegalAction");
  if (/unauthorized|forbidden/i.test(msg)) return ruMsg("errForbidden");
  if (/not found/i.test(msg)) return ruMsg("errNotFound");
  if (/request failed|internal server error/i.test(msg))
    return ruMsg("errGeneric");
  if (/usdt trc20 deposits are not configured/i.test(msg))
    return ruMsg("errDepositNotConfigured");
  if (/already processed/i.test(msg)) return ruMsg("errAlreadyProcessed");

  return ruMsg("errGeneric");
}
