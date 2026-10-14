import assert from "node:assert/strict";
import { test } from "node:test";
import { checkStep1Subject } from "../../src/lib/sequences/approvalChecks";

test("a step 1 subject beginning with Re: or Fwd: is rejected with an explanation", () => {
  for (const subject of ["Re: senior engineers", "RE: x", "  re:x", "Fwd: intro", "FW: intro", "fwd:intro"]) {
    const result = checkStep1Subject(subject);
    assert.equal(result.ok, false, subject);
    if (!result.ok) {
      assert.equal(result.reason, "reply_prefix_subject");
      assert.match(result.explanation, /Re:|Fwd:/);
    }
  }
});

test("ordinary subjects pass, including ones that merely contain re:", () => {
  for (const subject of ["Senior engineers at Upshop", "More on re: hiring", "Regarding your roadmap", "Reach out"]) {
    assert.deepEqual(checkStep1Subject(subject), { ok: true }, subject);
  }
});
