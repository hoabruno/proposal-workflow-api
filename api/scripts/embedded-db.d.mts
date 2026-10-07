export function startEmbeddedDb(options: {
  dir: string;
  port: number;
  database: string;
  persistent?: boolean;
}): Promise<{ url: string; stop: () => Promise<void> }>;
