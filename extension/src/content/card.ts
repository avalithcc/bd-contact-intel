/**
 * The in-page card: a closed shadow root on <html> (so LinkedIn's CSS cannot touch it and ours cannot touch
 * LinkedIn), rendered from a CardView with createElement/textContent only. No innerHTML, so nothing read from
 * the CRM or the page can become markup. Markup and copy follow the approved mockup, section 1.
 */
import type { BodyView, CardView } from "./viewModel";
import { STRINGS as S } from "../shared/strings";
import { CARD_LOCAL_CSS } from "./cardStyles";

export interface CardHandlers {
  /** The primary button of the current body (view, add, sign in or retry). */
  onAction(kind: BodyView["kind"]): void;
  onCollapse(): void;
  onExpand(): void;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const ICONS = {
  minus: ["M5 12h14"],
  plus: ["M12 5v14M5 12h14"],
  external: ["M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"],
  info: ["M12 16v-4M12 8h.01"],
  warning: ["m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z", "M12 9v4M12 17h.01"],
} as const;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { className?: string; text?: string; attrs?: Record<string, string> } = {},
  children: (Node | null)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.text !== undefined) node.textContent = props.text;
  for (const [name, value] of Object.entries(props.attrs ?? {})) node.setAttribute(name, value);
  for (const child of children) if (child) node.append(child);
  return node;
}

function icon(name: keyof typeof ICONS, withCircle = false): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  if (withCircle) {
    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("cx", "12");
    circle.setAttribute("cy", "12");
    circle.setAttribute("r", "10");
    svg.append(circle);
  }
  for (const d of ICONS[name]) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

export class Card {
  private host: HTMLElement | null = null;
  private root: ShadowRoot | null = null;

  constructor(private readonly handlers: CardHandlers) {}

  mount(): void {
    if (this.host?.isConnected) return;
    this.host = el("div", { attrs: { id: "crm-avalith-linkedin-card" } });
    this.root = this.host.attachShadow({ mode: "closed" });
    // A constructed stylesheet is not subject to the page's Content-Security-Policy (an injected <style> can be).
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`${__CARD_CSS__}\n${CARD_LOCAL_CSS}`);
    this.root.adoptedStyleSheets = [sheet];
    document.documentElement.append(this.host);
  }

  unmount(): void {
    this.host?.remove();
    this.host = null;
    this.root = null;
  }

  render(view: CardView, collapsed: boolean): void {
    this.mount();
    const root = this.root!;
    root.querySelector(".xcard, .xpill")?.remove();
    root.append(collapsed ? this.pill(view) : this.card(view));
  }

  private pill(view: CardView): HTMLElement {
    const { pill } = view;
    const button = el(
      "button",
      { className: "xpill", attrs: { type: "button", "aria-label": pill.ariaLabel, "aria-expanded": "false" } },
      [
        el("span", { className: "xmark", text: "a." }),
        pill.dot ? el("span", { className: `dotstate ${pill.dot}`, attrs: { "aria-hidden": "true" } }) : null,
        document.createTextNode(pill.label),
      ],
    );
    button.addEventListener("click", () => this.handlers.onExpand());
    return button;
  }

  private card(view: CardView): HTMLElement {
    const collapse = el("button", { className: "btn btn-ghost btn-icon btn-sm", attrs: { type: "button", "aria-label": S.collapse } }, [
      icon("minus"),
    ]);
    collapse.addEventListener("click", () => this.handlers.onCollapse());
    const head = el("div", { className: "xcard-head" }, [
      el("span", { className: "xmark", text: "a." }),
      el("strong", { text: S.product }),
      view.badge ? el("span", { className: `badge badge-${view.badge.tone}`, text: view.badge.text }) : null,
      collapse,
    ]);
    const aside = el("aside", { className: "xcard", attrs: { role: "complementary", "aria-label": S.cardLabel } }, [
      head,
      el("div", { className: "xcard-body" }, this.body(view.body)),
    ]);
    if (view.busy) aside.setAttribute("aria-busy", "true");
    return aside;
  }

  private action(kind: BodyView["kind"], label: string, className: string, iconName?: keyof typeof ICONS, busy = false): HTMLElement {
    const button = el("button", { className: `btn ${className} btn-block`, attrs: { type: "button" } }, [
      iconName ? icon(iconName) : null,
      document.createTextNode(label),
    ]);
    if (busy) {
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
    }
    button.addEventListener("click", () => this.handlers.onAction(kind));
    return button;
  }

  private body(body: BodyView): (Node | null)[] {
    switch (body.kind) {
      case "loading":
        return [
          el("div", { className: "row", attrs: { role: "status" } }, [
            el("span", { className: "spin", attrs: { "aria-hidden": "true" } }),
            el("span", { text: body.message }),
          ]),
          el("div", { className: "skeleton w-70" }),
          el("div", { className: "skeleton w-50" }),
        ];
      case "found":
        return [
          el("div", { className: "row" }, [
            el("span", { className: `avatar avatar-lg ${body.avatarClass}`, text: body.initials }),
            el("div", { className: "grow" }, [
              el("strong", { text: body.name }),
              body.subtitle ? el("div", { className: "meta", text: body.subtitle }) : null,
            ]),
          ]),
          el("div", { className: "xmeta" }, [
            body.ownerName
              ? el("div", {}, [
                  el("span", { className: "k", text: S.owner }),
                  el("br"),
                  el("span", { className: "owner-chip" }, [
                    el("span", { className: `avatar avatar-sm avatar-bd ${body.ownerAvatarClass}`, text: body.ownerInitials }),
                    document.createTextNode(body.ownerName),
                  ]),
                ])
              : null,
            body.lastActivity
              ? el("div", {}, [el("span", { className: "k", text: S.lastActivity }), el("br"), document.createTextNode(body.lastActivity)])
              : null,
          ]),
          this.action("found", body.actionLabel, "btn-primary", "external"),
          el("p", { className: "help", text: body.help }),
        ];
      case "not_found":
        return [
          el("div", { className: "stack-sm" }, [
            el("span", { className: "badge badge-neutral", text: body.badge }),
            el("p", { text: body.message }),
          ]),
          this.action("not_found", body.actionLabel, "btn-primary", "plus", body.actionBusy),
          el("p", { className: "help", text: body.help }),
        ];
      case "signed_out":
        return [
          el("div", { className: "alert alert-info", attrs: { role: "status" } }, [icon("info", true), el("div", { text: body.message })]),
          this.action("signed_out", body.actionLabel, "btn-primary"),
          el("p", { className: "help", text: body.help }),
        ];
      case "error":
        return [
          el("div", { className: "alert alert-danger", attrs: { role: "alert" } }, [icon("warning"), el("div", { text: body.message })]),
          this.action("error", body.actionLabel, "btn-secondary"),
        ];
    }
  }
}
