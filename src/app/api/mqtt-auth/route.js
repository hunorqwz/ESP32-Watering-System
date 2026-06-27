import { NextResponse } from 'next/server';

export async function GET() {
  const username = process.env.EMQX_MQTT_USER;
  const password = process.env.EMQX_MQTT_PASSWORD;
  const apiUrl = process.env.EMQX_API_URL;

  // If the credentials are not set or contain placeholders, let the client know
  if (!username || !password || username.includes('your_emqx_mqtt_client') || password.includes('your_emqx_mqtt_client')) {
    return NextResponse.json(
      { success: false, error: 'MQTT credentials not configured or contain placeholder values.' },
      { status: 404 }
    );
  }

  // Derive dynamic WebSocket URL if EMQX API URL is specified
  let brokerUrl = 'wss://bcc1fdaf.ala.eu-central-1.emqxsl.com:8084/mqtt'; // Fallback default
  if (apiUrl) {
    try {
      const parsedUrl = new URL(apiUrl);
      brokerUrl = `wss://${parsedUrl.hostname}:8084/mqtt`;
    } catch (err) {
      console.error('Failed to parse EMQX_API_URL for dynamic broker resolution:', err.message);
    }
  }

  return NextResponse.json({
    success: true,
    username: username,
    password: password,
    brokerUrl: brokerUrl
  });
}

export const dynamic = 'force-dynamic';
