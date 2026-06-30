import { NextResponse } from "next/server";
import {
  copilotAuthStatus,
  startDeviceLogin,
  CopilotConfigError,
} from "@/lib/copilotClient";

export const dynamic = "force-dynamic";

/** GET /api/copilot/auth → estado de la sesión de Copilot. */
export async function GET() {
  try {
    return NextResponse.json(await copilotAuthStatus());
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/** POST /api/copilot/auth → inicia el device-code flow y devuelve el código. */
export async function POST() {
  try {
    const info = await startDeviceLogin();
    return NextResponse.json({
      userCode: info.userCode,
      verificationUri: info.verificationUri,
      message: info.message,
    });
  } catch (err) {
    if (err instanceof CopilotConfigError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
