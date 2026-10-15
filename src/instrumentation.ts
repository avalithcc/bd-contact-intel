/** Runs once when the server starts. Only NODE_ENV=development is ever judged. */
export async function register() {
  // The guard reads dotenv files, which the edge runtime cannot do. Keeping the
  // import inside this exact `if` lets Next drop it from the edge bundle.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { checkLocalDevTargets } = await import("@/lib/dev/localDevCheck");
    checkLocalDevTargets();
  }
}
