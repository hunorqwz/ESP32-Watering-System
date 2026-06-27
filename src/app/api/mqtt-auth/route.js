import { NextResponse } from 'next/server';

export async function GET() {
  const username = process.env.EMQX_MQTT_USER;
  const password = process.env.EMQX_MQTT_PASSWORD;

  // If the credentials are not set or contain placeholders, let the client know
  if (!username || !password || username.includes('your_emqx_mqtt_client') || password.includes('your_emqx_mqtt_client')) {
    return NextResponse.json(
      { success: false, error: 'MQTT credentials not configured or contain placeholder values.' },
      { status: 404 }
    );
  }

  return NextResponse.json({
    success: true,
    username: username,
    password: password
  });
}

export const dynamic = 'force-dynamic';
