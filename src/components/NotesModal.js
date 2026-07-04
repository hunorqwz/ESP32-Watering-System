'use client';

import { useState, useEffect } from 'react';
import { X, Plus, Trash2, Edit3, Save, StickyNote, Clock } from 'lucide-react';

export default function NotesModal({ isOpen, onClose }) {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingNote, setEditingNote] = useState(null); // { id, title, content }
  const [newNote, setNewNote] = useState(null); // { title, content }
  const [saving, setSaving] = useState(false);

  const fetchNotes = async () => {
    try {
      const res = await fetch('/api/notes');
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setNotes(json.notes || []);
        }
      }
    } catch (err) {
      console.error('Failed to load notes:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchNotes();
    }
  }, [isOpen]);

  const handleSave = async (note) => {
    if (!note.content || note.content.trim() === '') return;
    setSaving(true);
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(note)
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setEditingNote(null);
          setNewNote(null);
          await fetchNotes();
        }
      }
    } catch (err) {
      console.error('Failed to save note:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to permanently delete this note?')) return;
    try {
      const res = await fetch(`/api/notes?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          if (editingNote?.id === id) setEditingNote(null);
          await fetchNotes();
        }
      }
    } catch (err) {
      console.error('Failed to delete note:', err);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/45 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-xl w-full border border-zinc-200 shadow-2xl overflow-hidden flex flex-col h-[70vh] animate-in fade-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="flex justify-between items-center border-b border-zinc-100 p-5">
          <div className="flex items-center gap-2">
            <StickyNote className="w-5 h-5 text-blue-600" />
            <div>
              <h3 className="font-semibold text-zinc-900 text-sm">Garden Journal & System Notes</h3>
              <p className="text-[10px] text-zinc-500">Record schedules, reminders, and plant logs</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!newNote && !editingNote && (
              <button
                onClick={() => setNewNote({ title: '', content: '' })}
                className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold uppercase tracking-wider px-2.5 py-1.5 rounded-lg shadow-sm transition active:scale-95 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Note</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="text-zinc-400 hover:text-zinc-600 cursor-pointer p-1.5 rounded-lg hover:bg-zinc-50 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-zinc-50/50">
          {/* Create or Edit Form */}
          {(newNote || editingNote) && (
            <div className="bg-white border border-zinc-200 rounded-xl p-4 shadow-sm space-y-3 animate-in fade-in slide-in-from-top-4 duration-200">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">
                {editingNote ? 'Edit Note' : 'Create New Note'}
              </span>
              <input
                type="text"
                placeholder="Note Title (optional)"
                value={newNote ? newNote.title : editingNote.title}
                onChange={(e) => {
                  if (newNote) setNewNote({ ...newNote, title: e.target.value });
                  else setEditingNote({ ...editingNote, title: e.target.value });
                }}
                className="w-full bg-zinc-50 border border-zinc-200 rounded-lg py-1.5 px-3 text-xs text-zinc-800 font-semibold focus:outline-none focus:border-zinc-400"
              />
              <textarea
                placeholder="Write your observation or reminder here..."
                rows="4"
                value={newNote ? newNote.content : editingNote.content}
                onChange={(e) => {
                  if (newNote) setNewNote({ ...newNote, content: e.target.value });
                  else setEditingNote({ ...editingNote, content: e.target.value });
                }}
                className="w-full bg-zinc-50 border border-zinc-200 rounded-lg py-1.5 px-3 text-xs text-zinc-800 focus:outline-none focus:border-zinc-400 leading-relaxed resize-none"
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => {
                    setNewNote(null);
                    setEditingNote(null);
                  }}
                  className="bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg transition active:scale-95 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleSave(newNote || editingNote)}
                  disabled={saving || (newNote ? !newNote.content.trim() : !editingNote.content.trim())}
                  className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg shadow-sm transition active:scale-95 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{saving ? 'Saving...' : 'Save Note'}</span>
                </button>
              </div>
            </div>
          )}

          {/* Notes List */}
          {loading ? (
            <div className="space-y-3 py-10">
              <div className="h-10 bg-zinc-100 rounded-xl animate-pulse"></div>
              <div className="h-12 bg-zinc-100 rounded-xl animate-pulse"></div>
            </div>
          ) : notes.length === 0 ? (
            <div className="text-center py-16 text-zinc-400 text-xs italic space-y-1">
              <p>No garden journal notes created yet.</p>
              <p className="text-[10px]">Click the "New Note" button above to log your first update!</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {notes.map((note) => (
                <div
                  key={note.id}
                  className="bg-white border border-zinc-200 rounded-xl p-4 shadow-sm hover:border-zinc-300 transition-all flex flex-col justify-between"
                >
                  <div className="flex justify-between items-start gap-4">
                    <div className="space-y-1">
                      <h4 className="text-xs font-bold text-zinc-800">{note.title}</h4>
                      <p className="text-xs text-zinc-600 leading-relaxed whitespace-pre-wrap">{note.content}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => setEditingNote({ id: note.id, title: note.title, content: note.content })}
                        className="text-zinc-400 hover:text-zinc-600 hover:bg-zinc-50 p-1.5 rounded-lg transition cursor-pointer"
                        title="Edit Note"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(note.id)}
                        className="text-zinc-400 hover:text-red-500 hover:bg-red-50 p-1.5 rounded-lg transition cursor-pointer"
                        title="Delete Note"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-[9px] text-zinc-400 font-medium pt-3 mt-3 border-t border-zinc-50">
                    <Clock className="w-3 h-3 text-zinc-300" />
                    <span>Updated {new Date(note.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + new Date(note.updated_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
