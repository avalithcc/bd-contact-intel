/**
 * Fills EMPTY `person.phone` / `person.mobile_phone` from the signature the
 * contact themselves wrote in an inbound Gmail message already stored in
 * `email_message.body_text`. Free, repeatable (re-run as more mail backfills),
 * and deliberately conservative: a smaller trustworthy result beats a bigger
 * dirty one. Extraction is pure and unit-tested in src/lib/signaturePhones/.
 *
 * THE THREE TRAPS AND HOW EACH IS HANDLED
 *   1. Quote boundaries. A body carries the whole thread, with everyone's
 *      signature. Only the text above the EARLIEST marker is read: "On ...
 *      wrote:" / "El ... escribió:" (also wrapped over lines), lines starting
 *      with ">", "-----Original Message-----" / "-----Mensaje original-----",
 *      an Outlook "____" rule, a De:/From: header block, a Forwarded marker.
 *      A body with no marker is read whole and COUNTED separately (riskier).
 *   2. Numbers that are not phones. CUIT/CUIL, dates, times, postal codes,
 *      order/invoice/bank references, fax lines, anything inside a URL or an
 *      email address, wrong lengths, and numbers with no phone label on the
 *      line (unless an international "+" number of 10+ digits). Survivors are
 *      validated with src/lib/phone.ts; an extension is dropped (it would turn
 *      the tel: link into dead text).
 *   3. Attribution. Only direction = 'inbound' rows. The sync links an inbound
 *      message to a person only through the From address (classify.ts), but
 *      email_message.person_id is a snapshot (the person may have been merged
 *      or re-emailed since), so it is NOT trusted: the read re-checks that
 *      lower(from_address) still equals person.email_normalized and that the
 *      person is not merged. Otherwise the row is skipped and counted.
 *
 * DATA CONTRACT
 *   - Fill-empty only, per column. Kind comes from the LABEL, never from the
 *     number's shape: cel/móvil/whatsapp = mobile, "tel fijo"/landline =
 *     landline, a bare "Tel:" or an unlabelled "+" number = kind not stated.
 *   - One number: mobile -> mobile_phone, otherwise phone; skipped if the
 *     person already has any number.
 *   - A labelled landline AND a labelled mobile are two facts: landline ->
 *     phone, mobile -> mobile_phone, each only if empty (and never a number the
 *     other column already holds).
 *   - Two different numbers of the SAME stated kind: no write for that column,
 *     counted, left for a human (no "most frequent"). Several numbers where
 *     any label does not state its kind: no write, counted separately.
 *   - Agreement: the audit_log metadata lists, per filled person, how many
 *     distinct messages carried the written number (supportingMessages).
 *   - One person_property_history row per fill, source 'signature_extract'
 *     (never 'edit': that would make the owner sticky and freeze the contact
 *     out of the automatic last-worked rule).
 *
 * WHAT IT WILL NOT TOUCH: names, emails, company, owner, status; outbound
 * mail; persons that already have a number. It creates no persons and no
 * activities. Output is counts only: never a body, number, name or address.
 *
 * IDEMPOTENT: filled persons now have a number, so a second run fills nothing
 * and adds no history.
 *
 * REVERT (the one audit_log row has action 'extract_signature_phones'):
 *   UPDATE person p SET phone = NULL FROM person_property_history h
 *     WHERE h.source = 'signature_extract' AND h.property = 'phone'
 *       AND h.person_id = p.id AND p.phone = h.new_value;
 *   UPDATE person p SET mobile_phone = NULL FROM person_property_history h
 *     WHERE h.source = 'signature_extract' AND h.property = 'mobilePhone'
 *       AND h.person_id = p.id AND p.mobile_phone = h.new_value;
 *   (the guard leaves any number a BD edited since untouched), then delete
 *   those history rows. Run it in one transaction.
 *
 * EXIT CODES: 0 success (dry run or write); 1 bad arguments or any failed
 * check (nothing written).
 *
 * DRY RUN IS THE DEFAULT (read-only transaction). Usage (do NOT run --execute
 * automatically: this touches the real database):
 *   npx tsx --env-file=.env.local scripts/extract-signature-phones.ts [--limit=<n>]
 *   npx tsx --env-file=.env.local scripts/extract-signature-phones.ts --execute --actor=<bd id> [--limit=<n>]
 */
import { formatSignatureReport } from "../src/lib/signaturePhones/analyze";
import { dryRunSignaturePhones, executeSignaturePhones } from "../src/lib/signaturePhones/db";

function parseArgs(argv: readonly string[]) {
  let execute = false;
  let actor: string | null = null;
  let limit: number | null = null;
  for (const arg of argv) {
    if (arg === "--execute") execute = true;
    else if (arg.startsWith("--actor=")) actor = arg.slice("--actor=".length);
    else if (arg.startsWith("--limit=")) {
      limit = Number(arg.slice("--limit=".length));
      if (!Number.isInteger(limit) || limit < 1) throw new Error("--limit must be a positive integer.");
    } else throw new Error(`Unknown argument: ${arg}. Valid: --limit=<n>, --execute, --actor=<bd id>`);
  }
  if (execute && !actor) throw new Error("--execute requires --actor=<bd id> for the audit log.");
  return { execute, actor, limit };
}

async function main() {
  const { execute, actor, limit } = parseArgs(process.argv.slice(2));
  if (!execute) {
    console.log("DRY RUN (read-only transaction)\n");
    console.log(formatSignatureReport((await dryRunSignaturePhones(limit)).report).join("\n"));
    console.log("\nNothing written. Re-run with --execute --actor=<bd id> to apply.");
    return;
  }
  const { plan, report, auditLogId } = await executeSignaturePhones(actor!, limit);
  console.log(formatSignatureReport(report).join("\n"));
  console.log(auditLogId ? `\nFilled ${plan.fills.length} person(s). audit_log id: ${auditLogId}` : "\nNothing to write.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
