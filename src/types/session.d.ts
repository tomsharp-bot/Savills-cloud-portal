import "cookie-session";

declare module "cookie-session" {
  interface CookieSessionObject {
    userId?: string;
    flashOk?: string;
    flashErr?: string;
    flashRefresh?: {
      projectId: string;
      addedCount: number;
      removedCount: number;
      addedSample: string[];
      removedSample: string[];
      addedByTab: { dwelling: number; block: number; garage: number };
      alsoOmit: boolean;
      tab: string;
      fileRows: number;
      uniqueUprn: number;
      blankUprn: number;
      duplicateUprn: number;
      fileByTab: { dwelling: number; block: number; garage: number };
      storedAssets?: number;
      /** Older sessions stored the full UPRN lists. The page caps whatever is present. */
      added?: string[];
      removed?: string[];
    };
  }
}
