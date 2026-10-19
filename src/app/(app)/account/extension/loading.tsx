import styles from "./guide.module.css";

/** Skeleton while the guide renders: breadcrumb, title, then the tab bar and two step rows. */
export default function Loading() {
  return (
    <main className="page page-narrow" aria-busy="true">
      <div className={styles.guide}>
        <div className="breadcrumbs mb-md" aria-hidden="true">
          <span className="skeleton" style={{ width: "10rem", height: "1rem" }} />
        </div>
        <span className="skeleton" style={{ display: "block", width: "60%", height: "2rem" }} />
        <div className="mt-xl">
          {[0, 1, 2].map((i) => (
            <div key={i} className={styles.step} aria-hidden="true">
              <span className={styles.stepN} />
              <span className="skeleton" style={{ display: "block", width: "70%", height: "3rem" }} />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
