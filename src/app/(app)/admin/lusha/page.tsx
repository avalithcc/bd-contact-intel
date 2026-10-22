import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { initialsFromName } from "@/components/initials";
import { AdminRequiredError } from "@/lib/auth/adminRole";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { CREDITS_PER_CONTACT, MAX_PERSONAL_DAILY_CAP, getLushaLimits, lushaCycleWindow } from "@/lib/lusha/cap";
import { getLushaUsageReport } from "@/lib/lusha/adminDb";
import { getCreditSpend } from "@/lib/lusha/revealDb";
import { REPORT_PERIODS, isNewBd, parseReportPeriod, periodWindow, personalCapLines, shareOf, summarizeUsage } from "@/lib/lusha/usageReport";
import { formatArgentinaDayMonth, formatArgentinaDayMonthYear, relativeTime } from "@/lib/i18n/format";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import { LushaCapEditor, type CapEditorLabels } from "./LushaCapEditor";
import { LushaSwitch } from "./LushaSwitch";
import { RevealsKpiCard } from "./RevealsKpiCard";

export const dynamic = "force-dynamic";

const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ""));

/**
 * Administración → Lusha por BD (lusha-per-bd; mockups/lusha-por-bd.html). One switch per BD next to what that BD spent. Reads:
 * getLushaUsageReport (one query, one row per BD, disabled ones included) and getCreditSpend (the caps' own sums, day and cycle in one query). Non-admins get
 * a 404, like every admin screen. Every number comes from the lusha_reveal ledger; nothing here stores consumption.
 */
export default async function LushaAdminPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (err) {
    if (err instanceof AdminRequiredError) notFound();
    throw err;
  }
  const period = parseReportPeriod((await searchParams).period);
  const [dict, locale] = await Promise.all([getDictionary(), getLocale()]);
  const d = dict.lushaAdmin;
  const now = new Date();
  const window = periodWindow(period, now);
  const rows = await getLushaUsageReport(window, now);
  const limits = getLushaLimits();
  const spent = await getCreditSpend(now, limits.cycleStartDay);
  const cap = limits.monthlyCap;
  const resetsOn = formatArgentinaDayMonth(lushaCycleWindow(now, limits.cycleStartDay).end);
  const totals = summarizeUsage(rows);
  const day = (iso: string) => formatArgentinaDayMonthYear(new Date(`${iso}T12:00:00Z`));
  const range = { from: day(window.firstDay), to: day(window.today) };
  const periodNames = { week: d.periodWeek, month: d.periodMonth, quarter: d.periodQuarter };
  const switchLabels = (name: string) => ({
    enabled: d.enabled,
    disabled: d.disabled,
    ariaEnabled: fill(d.ariaEnabled, { name }),
    ariaDisabled: fill(d.ariaDisabled, { name }),
    dialogTitle: fill(d.dialogTitle, { name }),
    dialogBody: fill(d.dialogBody, { name }),
    dialogLimitTitle: d.dialogLimitTitle,
    dialogLimitBody: fill(d.dialogLimitBody, { cap, left: Math.max(0, cap - spent.cycle), date: resetsOn }),
    dialogRecorded: fill(d.dialogRecorded, { admin: admin.name, name }),
    dialogConfirm: d.dialogConfirm,
    cancel: d.cancel,
    toastEnabled: fill(d.toastEnabled, { name }),
    toastDisabled: fill(d.toastDisabled, { name }),
    errorSave: d.errorSave,
  });
  const capLabels: CapEditorLabels = {
    setButton: d.capSet,
    editAria: d.capEditAria,
    title: d.capTitle,
    fieldLabel: d.capField,
    placeholder: d.capPlaceholder,
    creditsOne: d.capCreditsOne,
    creditsMany: d.capCreditsMany,
    equivalence: d.capEquivalence,
    costNote: d.capCostNote,
    usedToday: d.capUsedToday,
    hintEmptySet: d.capHintEmptySet,
    hintEmptyEdit: d.capHintEmptyEdit,
    hintZeroBefore: d.capHintZeroBefore,
    hintZeroAfter: d.capHintZeroAfter,
    recordedSet: d.capRecordedSet,
    recordedChange: d.capRecordedChange,
    invalid: d.capInvalid,
    warnRailTitle: d.capWarnRailTitle,
    warnRailBody: d.capWarnRailBody,
    warnZeroTitle: d.capWarnZeroTitle,
    warnZeroBody: d.capWarnZeroBody,
    clear: d.capClear,
    cancel: d.cancel,
    save: d.capSave,
    toastSet: d.capToastSet,
    toastCleared: d.capToastCleared,
    toastBlocked: d.capToastBlocked,
    toastUnchanged: d.capToastUnchanged,
    errorSave: d.errorSave,
    personalContacts: d.personalContacts,
    personalContactsOne: d.personalContactsOne,
    personalContactsNone: d.personalContactsNone,
    personalContactsBlocked: d.personalContactsBlocked,
  };
  const split = (emails: number, phones: number) => [emails > 0 && fill(d.emailsCount, { n: emails }), phones > 0 && fill(d.phonesCount, { n: phones })].filter(Boolean).join(" · ");

  return (
    <main className="page">
      <div className="page-header">
        <div className="titles">
          <div className="eyebrow">{d.eyebrow}</div>
          <h1>
            {d.title}
            <span className="dot">.</span>
          </h1>
          <p className="meta">{fill(d.subtitle, { cap, daily: limits.dailyCap, date: resetsOn })}</p>
        </div>
        <div className="actions">
          <div className="segmented" role="group" aria-label={d.periodLabel}>
            {REPORT_PERIODS.map((p) => (
              <Link key={p} href={`/admin/lusha?period=${p}`} className={p === period ? "on" : ""} aria-current={p === period ? "page" : undefined}>
                {periodNames[p]}
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="grid-4 mb-lg">
        <div className="stat accent">
          <div className="label">{d.statCharged}</div>
          <div className="value">{totals.chargedCredits}</div>
          <div className="foot">{[fill(d.statChargedFoot, range), totals.pendingCredits > 0 && fill(d.statChargedPending, { n: totals.pendingCredits })].filter(Boolean).join(" · ")}</div>
        </div>
        <RevealsKpiCard
          value={totals.reveals}
          foot={fill(d.statRevealsFoot, { emails: totals.emails, phones: totals.phones })}
          period={period}
          subtitle={fill(totals.reveals === 1 ? d.revealsDialogSubtitleOne : d.revealsDialogSubtitle, { n: totals.reveals, ...range })}
          locale={locale}
          labels={{
            statReveals: d.statReveals,
            revealsDialogTitle: d.revealsDialogTitle,
            revealsColContact: d.revealsColContact,
            revealsColField: d.revealsColField,
            revealsColActor: d.revealsColActor,
            revealsColWhen: d.revealsColWhen,
            revealsColCredits: d.revealsColCredits,
            revealsFieldEmail: d.revealsFieldEmail,
            revealsFieldPhone: d.revealsFieldPhone,
            revealsCreditsPending: d.revealsCreditsPending,
            revealsFootnote: d.revealsFootnote,
            revealsEmpty: d.revealsEmpty,
            close: d.close,
            dialogLoading: d.dialogLoading,
            dialogError: d.dialogError,
            dialogTruncated: d.dialogTruncated,
            numberLocale: d.numberLocale,
            unnamed: dict.contact.unnamed,
          }}
        />
        <div className="stat success">
          <div className="label">{d.statEnabled}</div>
          <div className="value">
            {totals.enabled} <span className="meta">{fill(d.statEnabledOf, { n: totals.bds })}</span>
          </div>
          <div className="foot">{fill(d.statEnabledFoot, { n: totals.bds - totals.enabled })}</div>
        </div>
        <div className="stat neutral">
          <div className="label">{d.statCycle}</div>
          <div className="value">
            {spent.cycle} <span className="meta">{fill(d.statCycleOf, { cap })}</span>
          </div>
          <div className="foot">{fill(d.statCycleFoot, { date: resetsOn })}</div>
        </div>
      </div>

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>{d.colBd}</th>
              <th>{d.colLusha}</th>
              <th className="sorted">
                {d.colCharged} <span className="sort">↓</span>
              </th>
              <th>{d.colReveals}</th>
              <th>{d.colRejected}</th>
              <th>{d.colLastUse}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isNew = isNewBd(r, now);
              const share = shareOf(r.chargedCredits, totals.chargedCredits);
              return (
                <tr key={r.bdId}>
                  <td>
                    <div className="owner-chip">
                      <Avatar id={r.bdId} initials={initialsFromName(r.name)} size="sm" />
                      <span className="strong">{r.name}</span>
                      {isNew && <span className="badge badge-info">{d.newBadge}</span>}
                    </div>
                    <div className="meta">{r.role === "admin" ? `${r.email} · ${d.adminSuffix}` : r.email}</div>
                  </td>
                  <td>
                    <div className="stack-sm">
                      <LushaSwitch bdId={r.bdId} name={r.name} enabled={r.lushaEnabled} labels={switchLabels(r.name)} />
                      {!r.lushaEnabled && (r.toggledByName && r.toggledAt ? <div className="meta">{fill(d.toggledBy, { name: r.toggledByName, date: formatArgentinaDayMonth(r.toggledAt) })}</div> : isNew ? <div className="meta">{d.newDefault}</div> : null)}
                      <LushaCapEditor
                        bdId={r.bdId}
                        name={r.name}
                        adminName={admin.name}
                        cap={r.personalDailyCap}
                        headline={r.personalDailyCap === null ? "" : personalCapLines(r.personalDailyCap, d).headline}
                        contacts={r.personalDailyCap === null ? "" : personalCapLines(r.personalDailyCap, d).contacts}
                        todayCredits={r.todayCredits}
                        creditsPerContact={CREDITS_PER_CONTACT}
                        dailyRail={limits.dailyCap}
                        maxCap={MAX_PERSONAL_DAILY_CAP}
                        labels={capLabels}
                      />
                    </div>
                  </td>
                  <td>
                    <div className="stack-sm">
                      <div className="nowrap">
                        <span className="num strong">{r.chargedCredits}</span> <span className="meta">{r.chargedCredits > 0 ? fill(d.creditsShare, { pct: share }) : d.credits}</span>
                        {r.pendingCredits > 0 && <span className="meta"> · {fill(d.pending, { n: r.pendingCredits })}</span>}
                      </div>
                      {r.chargedCredits > 0 && (
                        <div className="bar-track" style={{ width: 140 }} role="img" aria-label={`${share} %`}>
                          <span className="bar-info" style={{ width: `${share}%` }} />
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="nowrap">
                    <span className="num strong">{r.emails + r.phones}</span>
                    {r.emails + r.phones > 0 && <div className="meta">{split(r.emails, r.phones)}</div>}
                  </td>
                  <td className="nowrap">
                    <span className="num">{r.rejections}</span>
                  </td>
                  <td className="nowrap">
                    <span className="soft">{r.lastUseAt ? formatArgentinaDayMonthYear(r.lastUseAt) : d.never}</span>
                    <div className="meta">{r.lastUseAt ? relativeTime(r.lastUseAt, locale) : fill(d.createdOn, { date: formatArgentinaDayMonth(r.createdAt) })}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>
                <strong>{d.total}</strong>
              </td>
              <td></td>
              <td className="nowrap">
                <span className="num strong">{totals.chargedCredits}</span> <span className="meta">{d.credits}</span>
              </td>
              <td className="nowrap">
                <span className="num strong">{totals.reveals}</span>
              </td>
              <td className="nowrap">
                <span className="num strong">{totals.rejections}</span>
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>
        <div className="table-footer">
          <span>{fill(d.footerCount, { n: totals.bds })}</span>
          <span>{fill(d.footerPeriod, { label: `${range.from} – ${range.to}` })}</span>
        </div>
      </div>
      <p className="meta mt-md">{d.footnote}</p>
    </main>
  );
}
