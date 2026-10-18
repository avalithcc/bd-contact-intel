"use client";

import { useEffect, useRef } from "react";
import { LinkedInIcon } from "@/components/icons";
import styles from "./page.module.css";

/**
 * The draggable "Guardar en el CRM" button and its copyable code
 * (linkedin-exists-check mockup, section 1). React refuses to render a
 * `javascript:` href, so the bookmarklet URL is set on the anchor after mount;
 * that attribute is what the browser reads when the link is dragged to the
 * bookmarks bar. Clicking it on this page does nothing on purpose.
 */
export function LinkedinBookmarklet({
  bookmarkletHref,
  label,
  helpId,
}: {
  bookmarkletHref: string;
  label: string;
  helpId: string;
}) {
  const anchor = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    anchor.current?.setAttribute("href", bookmarkletHref);
  }, [bookmarkletHref]);

  return (
    <a
      ref={anchor}
      className={`btn btn-primary ${styles.grab}`}
      href="#"
      draggable="true"
      aria-describedby={helpId}
      onClick={(event) => event.preventDefault()}
    >
      <LinkedInIcon className="icon" />
      {label}
    </a>
  );
}
