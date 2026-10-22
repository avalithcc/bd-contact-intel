import assert from "node:assert/strict";
import { test } from "node:test";
import { appendFooter } from "@/lib/sequences/complianceFooter";
import { complianceRefusal, extractUnsubscribeUrl } from "@/lib/sequences/complianceGate";
import { COMPLIANCE_CONFIG } from "@/lib/sequences/config";
import { buildUnsubscribeUrl, generateUnsubscribeToken } from "@/lib/sequences/unsubscribeToken";

const URL_OK = buildUnsubscribeUrl("https://crm.example.test", generateUnsubscribeToken());

// Fixtures come from the real footer producer, never a hand-typed footer.
function footed(address: "miami" | "mdp") {
  const r = appendFooter("Hello Jane, a short note.", COMPLIANCE_CONFIG, address, "en", URL_OK);
  assert.equal(r.status, "ok");
  return r.status === "ok" ? r.body : "";
}

test("a body carrying its own address's footer and a link passes", () => {
  assert.equal(complianceRefusal("miami", footed("miami"), COMPLIANCE_CONFIG), null);
  assert.equal(complianceRefusal("mdp", footed("mdp"), COMPLIANCE_CONFIG), null);
});

test("no address, or an address the config does not carry, is unmapped_market", () => {
  assert.equal(complianceRefusal(null, footed("miami"), COMPLIANCE_CONFIG), "unmapped_market");
  assert.equal(complianceRefusal("mdp", footed("mdp"), { miami: COMPLIANCE_CONFIG.miami }), "unmapped_market");
});

test("a body footed for a different address, a missing link or an edited-away footer is missing_footer", () => {
  assert.equal(complianceRefusal("miami", footed("mdp"), COMPLIANCE_CONFIG), "missing_footer");
  assert.equal(complianceRefusal("mdp", footed("miami"), COMPLIANCE_CONFIG), "missing_footer");
  assert.equal(complianceRefusal("miami", footed("miami").replace(URL_OK, ""), COMPLIANCE_CONFIG), "missing_footer");
  assert.equal(complianceRefusal("miami", "Body", COMPLIANCE_CONFIG), "missing_footer");
});

test("the refusal is pinned by literal text, not by reading the config it checks", () => {
  const link = "https://crm.example.test/api/unsubscribe?t=" + "a".repeat(43);
  const optOut = 'If you would rather not receive further emails from us, use the link below or simply reply with "unsubscribe".';
  const miami = `Hi\n\n--\nAvalith Corporation, 470 Ansin Blvd Ste G, Hallandale, FL 33009, USA\n\n${optOut}\n${link}`;
  const mdp = `Hi\n\n--\nAvalith, Formosa 2531, B7600 Mar del Plata, Buenos Aires, Argentina\n\n${optOut}\n${link}`;
  assert.equal(complianceRefusal("miami", miami, COMPLIANCE_CONFIG), null);
  assert.equal(complianceRefusal("mdp", mdp, COMPLIANCE_CONFIG), null);
  assert.equal(complianceRefusal("miami", mdp, COMPLIANCE_CONFIG), "missing_footer");
  assert.equal(complianceRefusal("mdp", miami, COMPLIANCE_CONFIG), "missing_footer");
});

test("extractUnsubscribeUrl returns the link the footer producer wrote, and null when there is none", () => {
  assert.equal(extractUnsubscribeUrl(footed("miami")), URL_OK);
  assert.equal(extractUnsubscribeUrl("no link here"), null);
});
