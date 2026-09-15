import Link from "next/link";
import { notFound } from "next/navigation";
import { getContactById, getCurrentBd } from "@/lib/queries";

export const dynamic = "force-dynamic";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      <div className={empty ? "field-value empty" : "field-value"}>
        {empty ? "empty" : value}
      </div>
    </div>
  );
}

export default async function ContactDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const me = await getCurrentBd();
  const c = await getContactById(me.id, id);
  if (!c) notFound();

  const fullName = [c.firstName, c.lastName].filter(Boolean).join(" ");
  const profileUrl = `https://${c.profileKey}`;

  return (
    <main style={{ maxWidth: 720 }}>
      <div className="header">
        <span className="logo">
          avalith<span className="dot">.</span>
        </span>
        <Link className="secondary-btn" href="/">
          ← back
        </Link>
      </div>

      <div style={{ marginBottom: "1.5rem" }}>
        <div className="eyebrow">// contact</div>
        <h1>
          {fullName || "unnamed"}
          <span className="dot">.</span>
        </h1>
      </div>

      <section className="panel">
        <Field label="first_name" value={c.firstName} />
        <Field label="last_name" value={c.lastName} />
        <Field label="company" value={c.company} />
        <Field label="position" value={c.position} />
        <Field label="industry" value={c.industry} />
        <Field label="email" value={c.email} />
        <Field label="connected_on" value={c.connectedOn} />
        <Field
          label="linkedin_profile"
          value={
            c.profileKey ? (
              <a href={profileUrl} target="_blank" rel="noopener noreferrer">
                {profileUrl}
              </a>
            ) : null
          }
        />
        <Field
          label="team_overlap"
          value={
            c.overlapWith.length ? (
              <span className="badge">also in {c.overlapWith.join(", ")}</span>
            ) : null
          }
        />
        <Field
          label="added_to_base"
          value={new Date(c.createdAt).toLocaleDateString()}
        />
      </section>
    </main>
  );
}
