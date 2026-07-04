import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  try {
    const sql = getDb();
    const notes = await sql`
      SELECT id, title, content, created_at, updated_at 
      FROM system_notes
      ORDER BY updated_at DESC
    `;
    return NextResponse.json({ success: true, notes });
  } catch (error) {
    console.error('Failed to fetch notes:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to retrieve notes from database.', details: error.message },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    const payload = await request.json();
    const { id, title, content } = payload || {};

    if (!content) {
      return NextResponse.json(
        { success: false, error: 'Note content is required.' },
        { status: 400 }
      );
    }

    const sql = getDb();
    const finalTitle = title && title.trim() !== '' ? title.trim() : 'Untitled Note';

    if (id) {
      // Update existing note
      await sql`
        UPDATE system_notes
        SET title = ${finalTitle}, content = ${content}, updated_at = CURRENT_TIMESTAMP
        WHERE id = ${parseInt(id, 10)}
      `;
      return NextResponse.json({ success: true, message: 'Note updated successfully.' });
    } else {
      // Insert new note
      await sql`
        INSERT INTO system_notes (title, content)
        VALUES (${finalTitle}, ${content})
      `;
      return NextResponse.json({ success: true, message: 'Note saved successfully.' });
    }
  } catch (error) {
    console.error('Failed to save note:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to save note in database.', details: error.message },
      { status: 500 }
    );
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Missing parameter: id is required.' },
        { status: 400 }
      );
    }

    const sql = getDb();
    await sql`
      DELETE FROM system_notes
      WHERE id = ${parseInt(id, 10)}
    `;
    return NextResponse.json({ success: true, message: 'Note deleted successfully.' });
  } catch (error) {
    console.error('Failed to delete note:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete note.', details: error.message },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
