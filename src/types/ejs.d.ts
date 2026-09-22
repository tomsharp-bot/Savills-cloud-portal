declare module "ejs" {
  export function render(
    template: string,
    data?: Record<string, unknown>,
    opts?: { filename?: string }
  ): string;
}
