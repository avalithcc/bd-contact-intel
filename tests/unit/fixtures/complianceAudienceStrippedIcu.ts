// Run in a child process by sequencesComplianceAudience.test.ts: Intl.DisplayNames is stubbed to name nothing BEFORE the
// module loads, which is how a runtime without ICU region names would behave.
(Intl as unknown as { DisplayNames: unknown }).DisplayNames = class {
  of(): undefined {
    return undefined;
  }
};

async function main() {
  const m = await import("../../../src/lib/sequences/complianceAudience");
  const audience = (over: Record<string, unknown>) => m.resolveComplianceAudience({ mobilePhone: null, phone: null, rosterCountries: [], ...over });
  console.log(
    JSON.stringify({
      recognized: m.RECOGNIZED_COUNTRIES.length,
      names: m.RECOGNIZED_COUNTRIES.reduce((n, c) => n + c.names.length, 0),
      argentinaPhone: audience({ mobilePhone: "+5491155551234" }),
      mexicoPhone: audience({ mobilePhone: "+525512345678" }),
      cubaPhone: audience({ mobilePhone: "+5351234567" }),
      iranPhone: audience({ mobilePhone: "+989121234567" }),
      germany: audience({ personCountry: "Germany" }),
      argentinaText: audience({ personCountry: "Argentina" }),
      cubaText: audience({ personCountry: "Cuba" }),
      thailand: audience({ companyCountry: "Thailand" }),
    }),
  );
}
void main();
