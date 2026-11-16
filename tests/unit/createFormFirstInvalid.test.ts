/**
 * Regression guard for the report of 2026-11-16: a BD selected 5 contacts on /sequences/new, pressed "Crear secuencia
 * con 5 contactos" and nothing happened. The button was correctly enabled — `createFormView` leaves it enabled on a
 * missing name ON PURPOSE, so that pressing it reveals the error instead of being a dead button — but the error it
 * revealed was in the Ajustes card, a screen and a half above, past the whole contact picker. From where the BD was
 * standing the button did nothing.
 *
 * So the invariant is not "the form validates", it is "a failed submit always names a field to send the BD to".
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { createFormView, firstInvalidField } from "@/lib/sequences/createForm";

const WITH_SELECTION = { selectedCount: 5, hasAccount: true };

describe("createFormView.firstInvalid", () => {
  it("reproduces the report: 5 contacts picked, no name, and the submit has somewhere to send the BD", () => {
    const v = createFormView({ name: "", cap: "5", ...WITH_SELECTION });
    assert.equal(v.valid, false, "submit does nothing");
    assert.equal(v.blocked, false, "yet the button is enabled - that pairing is what made it look dead");
    assert.equal(v.firstInvalid, "name");
  });

  it("names the cap when the name is filled and the cap is not a number", () => {
    const v = createFormView({ name: "Q4 outbound", cap: "", ...WITH_SELECTION });
    assert.equal(v.valid, false);
    assert.equal(v.firstInvalid, "cap");
  });

  it("names the cap when it is above the ceiling", () => {
    const v = createFormView({ name: "Q4 outbound", cap: "99999", ...WITH_SELECTION });
    assert.equal(v.valid, false);
    assert.equal(v.cap.error, "ceiling");
    assert.equal(v.firstInvalid, "cap");
  });

  it("prefers the name, because it is the field drawn first", () => {
    assert.equal(firstInvalidField({ nameMissing: true, capError: "invalid" }), "name");
  });

  it("names nothing when the form is valid", () => {
    const v = createFormView({ name: "Q4 outbound", cap: "5", ...WITH_SELECTION });
    assert.equal(v.valid, true);
    assert.equal(v.firstInvalid, null);
  });

  /**
   * The other half of the contract: when the button is DISABLED there is nothing to scroll to, because the reason is
   * the selection or the missing Gmail account, both of which the BD can already see from where the button is.
   */
  it("names nothing when the button is disabled for having no selection", () => {
    const v = createFormView({ name: "", cap: "5", selectedCount: 0, hasAccount: true });
    assert.equal(v.blocked, true);
    assert.equal(v.firstInvalid, "name", "the name is still flagged, but the disabled button never submits");
  });
});
