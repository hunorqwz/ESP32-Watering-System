import fs from 'fs';
import path from 'path';

// Setup/Load .env file manually
try {
  const envPath = path.resolve('.env');
  if (fs.existsSync(envPath)) {
    const envLines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of envLines) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let val = match[2] || '';
        if (val.endsWith('\r')) val = val.slice(0, -1);
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        process.env[key] = val;
      }
    }
  }
} catch (err) {
  console.warn('Could not read .env file:', err);
}

const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const token = process.env.API_ACCESS_TOKEN || 'default-watering-system-secure-token';

async function runTests() {
  console.log('--- STARTING PERSISTENT SYSTEM NOTES CRUD TESTS ---');

  const authHeaders = {
    'Authorization': `Bearer ${token}`
  };

  const jsonHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };

  // 1. Fetch initial notes (should contain at least the seeded Welcome Note)
  console.log('\n[Test 1] Fetching notes...');
  let res = await fetch(`${baseUrl}/api/notes`, { headers: authHeaders });
  let body = await res.json();
  console.log('Fetch Status:', res.status);
  console.log('Notes count:', body.notes?.length);
  if (res.status === 200 && body.success && body.notes?.length > 0) {
    console.log('First note title:', body.notes[0].title);
    console.log('Result: SUCCESS (Notes list loaded with seed values)');
  } else {
    console.error('Result: FAILURE (Could not fetch initial notes)');
    process.exit(1);
  }

  // 2. Create a new note
  console.log('\n[Test 2] Creating a new note...');
  res = await fetch(`${baseUrl}/api/notes`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({
      title: 'Gardening Reminder',
      content: 'Fertilize the tomato plants on Sunday morning.'
    })
  });
  body = await res.json();
  console.log('Create Status:', res.status);
  console.log('Response:', body);
  if (res.status === 200 && body.success) {
    console.log('Result: SUCCESS (Note created successfully)');
  } else {
    console.error('Result: FAILURE (Could not create note)');
    process.exit(1);
  }

  // Verify it exists and get its ID
  res = await fetch(`${baseUrl}/api/notes`, { headers: authHeaders });
  body = await res.json();
  const createdNote = body.notes.find(n => n.title === 'Gardening Reminder');
  if (!createdNote) {
    console.error('Result: FAILURE (Created note not found in list)');
    process.exit(1);
  }
  const noteId = createdNote.id;
  console.log('Created note ID:', noteId);

  // 3. Update the note
  console.log('\n[Test 3] Updating the note...');
  res = await fetch(`${baseUrl}/api/notes`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({
      id: noteId,
      title: 'Gardening Reminder (Updated)',
      content: 'Fertilize the tomato plants on Sunday morning and check soil moisture.'
    })
  });
  body = await res.json();
  console.log('Update Status:', res.status);
  console.log('Response:', body);
  if (res.status === 200 && body.success) {
    console.log('Result: SUCCESS (Note updated successfully)');
  } else {
    console.error('Result: FAILURE (Could not update note)');
    process.exit(1);
  }

  // Verify update
  res = await fetch(`${baseUrl}/api/notes`, { headers: authHeaders });
  body = await res.json();
  const updatedNote = body.notes.find(n => n.id === noteId);
  if (updatedNote && updatedNote.title === 'Gardening Reminder (Updated)') {
    console.log('Updated title:', updatedNote.title);
    console.log('Result: SUCCESS (Update confirmed in list)');
  } else {
    console.error('Result: FAILURE (Update check failed)');
    process.exit(1);
  }

  // 4. Delete the note
  console.log('\n[Test 4] Deleting the note...');
  res = await fetch(`${baseUrl}/api/notes?id=${noteId}`, {
    method: 'DELETE',
    headers: authHeaders
  });
  body = await res.json();
  console.log('Delete Status:', res.status);
  console.log('Response:', body);
  if (res.status === 200 && body.success) {
    console.log('Result: SUCCESS (Note deleted successfully)');
  } else {
    console.error('Result: FAILURE (Could not delete note)');
    process.exit(1);
  }

  // Verify deletion
  res = await fetch(`${baseUrl}/api/notes`, { headers: authHeaders });
  body = await res.json();
  const deletedNote = body.notes.find(n => n.id === noteId);
  if (!deletedNote) {
    console.log('Result: SUCCESS (Deletion confirmed, note no longer in list)');
  } else {
    console.error('Result: FAILURE (Note still exists after deletion)');
    process.exit(1);
  }

  console.log('\n--- ALL persistent system notes tests completed successfully ---');
}

runTests().catch(err => {
  console.error('Validation test run failed:', err);
  process.exit(1);
});
