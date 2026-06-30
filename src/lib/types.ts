export type ThreadStatus = "New" | "InProgress" | "Waiting" | "Done";

export const STATUSES: ThreadStatus[] = ["New", "InProgress", "Waiting", "Done"];

export const STATUS_LABEL: Record<ThreadStatus, string> = {
  New: "New",
  InProgress: "In progress",
  Waiting: "Waiting",
  Done: "Done",
};

export const STATUS_COLOR: Record<ThreadStatus, string> = {
  New: "bg-blue-100 text-blue-700",
  InProgress: "bg-amber-100 text-amber-700",
  Waiting: "bg-purple-100 text-purple-700",
  Done: "bg-green-100 text-green-700",
};

export interface ThreadListItem {
  id: string;
  title: string;
  status: ThreadStatus;
  tags: string[];
  updatedAt: string;
  lastMessage: string;
}

export interface ChatMessage {
  id: string;
  role: "human" | "ai";
  text: string;
  seqId: number;
  createdAt: string;
  meta?: {
    agentMetadata?: { toolsUsed?: string[]; expertSelected?: string };
    artifactMetadata?: { type?: string };
    interactionId?: string;
  };
}

export interface ThreadDetail {
  id: string;
  title: string;
  status: ThreadStatus;
  tags: string[];
  messages: ChatMessage[];
}
