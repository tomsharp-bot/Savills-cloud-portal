import "cookie-session";

declare module "cookie-session" {
  interface CookieSessionObject {
    userId?: string;
    flashRefresh?: {
      projectId: string;
      added: string[];
      removed: string[];
      alsoOmit: boolean;
      tab: string;
    };
  }
}
