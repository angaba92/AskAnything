import { hasSubstantiveAnswer } from "./responsePolicy";

export class BatchRequestError extends Error {
  constructor(message: string, public status = 0) {
    super(message);
    this.name = "BatchRequestError";
  }
}

export interface BatchAnswer {
  answer: string;
  expert: string;
  tools: string;
  reviewRequired: boolean;
  reviewReason: string;
}

export async function readBatchAnswer(response: Response): Promise<BatchAnswer> {
  if (response.status === 401 || response.status === 403) {
    throw new BatchRequestError("App authentication failed. Sign in again before resuming.", response.status);
  }
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new BatchRequestError(`The app returned HTTP ${response.status} without JSON. Check the app connection before resuming.`, response.status);
  }
  const data: unknown = await response.json();
  if (!data || typeof data !== "object") throw new BatchRequestError("The app returned an invalid response.");
  const value = data as Record<string, unknown>;
  if (!response.ok) {
    const reason = typeof value.reviewReason === "string" ? value.reviewReason : "";
    throw new BatchRequestError(
      [typeof value.error === "string" ? value.error : `HTTP ${response.status}`, reason].filter(Boolean).join(" "),
      response.status,
    );
  }
  if (typeof value.answer !== "string" || !hasSubstantiveAnswer(value.answer)) {
    throw new BatchRequestError("No substantive answer was returned. Add notes and use Redo, or retry this row manually.", 422);
  }
  return {
    answer: value.answer,
    expert: typeof value.expert === "string" ? value.expert : "",
    tools: typeof value.tools === "string" ? value.tools : "",
    reviewRequired: value.reviewRequired === true,
    reviewReason: typeof value.reviewReason === "string" ? value.reviewReason : "",
  };
}
