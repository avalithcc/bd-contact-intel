/**
 * The handful of `chrome.*` APIs this extension uses, declared by hand so it needs no `@types/chrome`
 * dependency. Add a member here only when the code starts using it.
 */
declare namespace chrome {
  namespace runtime {
    const id: string;
    interface MessageSender {
      id?: string;
      url?: string;
      tab?: { id?: number; url?: string };
    }
    function getManifest(): { version: string };
    function sendMessage(message: unknown): Promise<unknown>;
    const onMessage: {
      addListener(
        callback: (message: unknown, sender: MessageSender, sendResponse: (response: unknown) => void) => boolean | void,
      ): void;
    };
  }
  namespace storage {
    namespace local {
      function get(keys: string | string[]): Promise<Record<string, unknown>>;
      function set(items: Record<string, unknown>): Promise<void>;
    }
  }
  namespace tabs {
    function create(createProperties: { url: string }): Promise<unknown>;
  }
}

/** Replaced by esbuild at build time (extension/build.ts). */
declare const __CRM_ORIGIN__: string;
declare const __CARD_CSS__: string;
