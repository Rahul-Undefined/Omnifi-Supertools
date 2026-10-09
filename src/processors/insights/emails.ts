const ROLE = /^(admin|administrator|info|support|sales|contact|help|billing|noreply|no-reply|donotreply|postmaster|webmaster|abuse|marketing|office|hello|team|careers|jobs|hr|press|security)@/i;
const DISPOSABLE = new Set(["mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com", "temp-mail.org", "yopmail.com", "trashmail.com", "sharklasers.com", "getnada.com", "dispostable.com", "throwawaymail.com", "maildrop.cc", "fakeinbox.com", "mohmal.com"]);
const RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const TYPO: Record<string, string> = { "gmial.com": "gmail.com", "gmal.com": "gmail.com", "gamil.com": "gmail.com", "gmail.co": "gmail.com", "hotmal.com": "hotmail.com", "hotmail.co": "hotmail.com", "yaho.com": "yahoo.com", "outlok.com": "outlook.com" };

export function cleanEmails(input: string, o: { dropRoles: boolean; dropDisposable: boolean }) {
  const found = input.match(/[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
  const valid: string[] = [];
  const invalid: string[] = [];
  const removed: string[] = [];
  const seen = new Set<string>();
  let duplicates = 0, roles = 0, disposable = 0;
  for (const raw of found) {
    let e = raw.trim().toLowerCase().replace(/^[.'-]+|[.'-]+$/g, "");
    const [local, domain] = e.split("@");
    if (domain && TYPO[domain]) e = `${local}@${TYPO[domain]}`;
    if (!RE.test(e) || e.length > 254 || local.length > 64 || /\.\./.test(e)) { invalid.push(raw); continue; }
    if (seen.has(e)) { duplicates++; continue; }
    seen.add(e);
    if (o.dropRoles && ROLE.test(e)) { roles++; removed.push(e); continue; }
    if (o.dropDisposable && DISPOSABLE.has(e.split("@")[1])) { disposable++; removed.push(e); continue; }
    valid.push(e);
  }
  return { valid, invalid, removed, duplicates, roles, disposable };
}
