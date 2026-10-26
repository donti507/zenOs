export type DanteUsage = { enabled: false } | {
  enabled: true;
  date: string;
  resetsAt: string;
  limit: number;
  messages: number;
  transcriptions: number;
  messagesRemaining: number;
  transcriptionsRemaining: number;
};
