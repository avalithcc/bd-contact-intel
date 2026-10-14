# Lusha Identity Match Specification

## Purpose

Lusha matching is fuzzy and costs money: 6 of 25 live probes matched a different domain, and one (`aument.io` matched to a different company at `www.aumenta.do` with a different LinkedIn slug) was a genuine false positive. The BD must see who Lusha matched, and be able to reject it, before the revealing charge.

## Requirements

### Requirement: The matched identity is shown before the reveal charge

After a search and before any reveal charge, the system MUST show the BD the matched identity returned by Lusha: name, company, company domain and LinkedIn URL, next to the CRM Contact's own name, company, domain and LinkedIn for comparison. The reveal MUST NOT be charged until the BD explicitly confirms the match.

The first attempt on a Contact involves two steps: the search (about 1 credit, stated in the first dialog) and then the reveal. The identity confirmation sits between them, so a rejected match avoids the reveal charge.

#### Scenario: Identity displayed

- GIVEN a first email attempt was confirmed and the search returned a match
- WHEN the search settles
- THEN a dialog shows Lusha's name, company, domain and LinkedIn beside the Contact's
- AND states the reveal price
- AND no reveal charge has been made

#### Scenario: Harmless domain variant

- GIVEN the CRM domain is `mercadolibre.com` and Lusha returns `careers-meli.mercadolibre.com`
- WHEN the identity dialog opens
- THEN both domains are shown unmodified so the BD can judge the match

### Requirement: The BD can reject the match

The identity dialog MUST offer a reject action. Rejecting MUST NOT charge a reveal, MUST NOT write any value to the Contact, and MUST be recorded in the ledger as a rejected match with the actor BD. The rejection is NOT permanent: it stops the automatic offer of the reveal, but the BD can start an explicit new search (see the re-search requirement). No charge occurs beyond the search already spent.

#### Scenario: False positive rejected

- GIVEN Lusha matched `Aument` at `aument.io` to `Aumenta GT` at `www.aumenta.do` with a different LinkedIn slug
- WHEN the BD rejects the match
- THEN no reveal credit is charged and nothing is written to the Contact
- AND the ledger records a rejected match for that Contact

#### Scenario: Rejected match is not automatically re-offered

- GIVEN a match was rejected for a Contact
- WHEN the About pane renders later
- THEN the reveal controls are not offered, with copy that the Lusha match was rejected
- AND a "buscar de nuevo" action is available instead
- AND no search is made automatically

### Requirement: A rejected match can be re-searched explicitly, at the cost of a new search

After a rejection the system MUST offer an explicit manual "buscar de nuevo" action. It MUST pass through the normal confirmation dialog stating the 1-credit search cost, MUST charge a new search credit, MUST count that credit against the global daily cap, and MUST be refused before any Lusha call when the cap would be exceeded. The new search result supersedes the rejected one, and the flow continues with the normal identity confirmation. Nothing in the ledger MUST prevent a later successful search or reveal for that Contact, no matter how many times earlier matches were rejected.

#### Scenario: Re-search is allowed and charged

- GIVEN a Contact whose match was rejected
- WHEN the BD confirms "buscar de nuevo"
- THEN one new search is sent and 1 credit is recorded in the ledger
- AND the credit counts toward the day's cap

#### Scenario: Re-search refused at the cap

- GIVEN a rejected Contact and the day's credits are exhausted (or fewer than 1 remains)
- WHEN the BD requests "buscar de nuevo"
- THEN it is refused before any Lusha call with the daily-limit copy, and nothing is charged

#### Scenario: Re-search after the CRM domain is corrected

- GIVEN the match was rejected because the CRM company domain was wrong, and the BD then corrects the domain
- WHEN the BD confirms "buscar de nuevo"
- THEN the search matches the correct organisation
- AND the normal identity confirmation is shown, followed by the reveal confirmation on acceptance

#### Scenario: Repeated rejection

- GIVEN a re-search returns another wrong match
- WHEN the BD rejects it
- THEN it is recorded as another rejection and "buscar de nuevo" remains available
- AND no earlier rejection blocks a later successful search or reveal for that Contact

### Requirement: A confirmed match is recorded with the reveal

When the BD confirms the match, the matched identity MUST remain stored in the ledger alongside the revealed value, so the provenance of a revealed value is auditable.

#### Scenario: Provenance retained

- GIVEN the BD confirmed a match and the email was revealed
- WHEN the ledger is inspected
- THEN the matched name, company, domain and LinkedIn are stored with the revealed value

### Requirement: A reused stored match is shown on later reveals

When a later reveal (for example phone) uses an already-stored search, the dialog MUST show the stored matched identity again. An earlier confirmation of the match for another field is sufficient and MUST NOT demand a second confirmation of the identity itself.

#### Scenario: Phone after confirmed email

- GIVEN the match was confirmed during the email reveal
- WHEN the BD opens the phone dialog
- THEN the stored identity is shown for reference and the confirm action is the price confirmation only
