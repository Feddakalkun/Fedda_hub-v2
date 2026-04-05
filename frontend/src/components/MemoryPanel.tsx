import React, { useEffect, useState } from "react";

interface MemoryEntry {
  memory_id: string;
  kind: string;
  content: string;
  summary?: string;
  tags: string[];
  created_at: string;
  pinned: boolean;
  archived: boolean;
}

export default function MemoryPanel() {
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [query, setQuery] = useState("");
  const [newContent, setNewContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Replace with real user_id in production
  const user_id = "demo-user";

  const fetchMemories = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ user_id });
      if (query) params.append("query", query);
      const res = await fetch(`/api/memory/search?${params.toString()}`);
      const data = await res.json();
      setMemories(data);
    } catch (e) {
      setError("Failed to fetch memories");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMemories();
    // eslint-disable-next-line
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContent.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("user_id", user_id);
      form.append("kind", "note");
      form.append("content", newContent);
      const res = await fetch("/api/memory/add", { method: "POST", body: form });
      if (!res.ok) throw new Error("Failed to add");
      setNewContent("");
      fetchMemories();
    } catch (e) {
      setError("Failed to add memory");
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchMemories();
  };

  return (
    <div className="p-6 max-w-2xl mx-auto bg-[#18181c] rounded-xl shadow-lg mt-8">
      <h2 className="text-2xl font-bold mb-4 text-white">🧠 Memory Panel</h2>
      <form onSubmit={handleAdd} className="flex gap-2 mb-4">
        <input
          className="flex-1 px-3 py-2 rounded bg-[#23232a] text-white border border-white/10"
          placeholder="Add a new memory..."
          value={newContent}
          onChange={e => setNewContent(e.target.value)}
        />
        <button type="submit" className="px-4 py-2 rounded bg-blue-600 text-white font-bold">Add</button>
      </form>
      <form onSubmit={handleSearch} className="flex gap-2 mb-4">
        <input
          className="flex-1 px-3 py-2 rounded bg-[#23232a] text-white border border-white/10"
          placeholder="Search memories..."
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <button type="submit" className="px-4 py-2 rounded bg-slate-700 text-white">Search</button>
      </form>
      {loading && <div className="text-white">Loading...</div>}
      {error && <div className="text-red-400">{error}</div>}
      <ul className="space-y-3">
        {memories.map(m => (
          <li key={m.memory_id} className="bg-[#23232a] rounded p-4 border border-white/10">
            <div className="flex justify-between items-center">
              <span className="text-white font-semibold">{m.kind}</span>
              {m.pinned && <span className="text-yellow-400 ml-2">★</span>}
              {m.archived && <span className="text-slate-400 ml-2">(archived)</span>}
            </div>
            <div className="text-slate-200 mt-1">{m.content}</div>
            {m.summary && <div className="text-xs text-slate-400 mt-1">{m.summary}</div>}
            <div className="text-xs text-slate-500 mt-2">{new Date(m.created_at).toLocaleString()}</div>
            {m.tags.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {m.tags.map(tag => (
                  <span key={tag} className="px-2 py-0.5 rounded bg-blue-900 text-blue-200 text-xs">{tag}</span>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
      {memories.length === 0 && !loading && <div className="text-slate-400">No memories found.</div>}
    </div>
  );
}
