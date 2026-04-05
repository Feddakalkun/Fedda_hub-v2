"""
FEDDA Brain Memory Models
"""
from typing import List, Optional, Literal
from pydantic import BaseModel, Field
from datetime import datetime

class MemoryEntry(BaseModel):
    memory_id: str
    user_id: str
    kind: Literal['fact', 'preference', 'goal', 'task', 'note', 'idea', 'bookmark', 'correction', 'ephemeral_note', 'hypothesis', 'summary']
    content: str
    summary: Optional[str] = None
    source: Literal['user', 'system', 'external_api'] = 'user'
    created_at: datetime
    last_used: Optional[datetime] = None
    importance: int = 3
    archived: bool = False
    pinned: bool = False
    privacy: Literal['private', 'shared_to_workspace'] = 'private'
    tags: List[str] = Field(default_factory=list)
    project_id: Optional[str] = None
    parent_id: Optional[str] = None
    attachments: List[str] = Field(default_factory=list)
    version: int = 1
    superseded_by: Optional[str] = None
    deleted: bool = False
    deleted_at: Optional[datetime] = None
    retention_until: Optional[datetime] = None

class TaskEntry(BaseModel):
    task_id: str
    user_id: str
    title: str
    description: Optional[str] = None
    status: Literal['todo', 'in_progress', 'done', 'cancelled'] = 'todo'
    due_at: Optional[datetime] = None
    reminder_at: Optional[datetime] = None
    recurrence: Optional[str] = None
    priority: int = 3
    project_id: Optional[str] = None
    parent_id: Optional[str] = None
    created_at: datetime
    completed_at: Optional[datetime] = None
    archived: bool = False
    tags: List[str] = Field(default_factory=list)
    attachments: List[str] = Field(default_factory=list)
    deleted: bool = False
    deleted_at: Optional[datetime] = None

class ProjectEntry(BaseModel):
    project_id: str
    user_id: str
    name: str
    description: Optional[str] = None
    created_at: datetime
    archived: bool = False
    tags: List[str] = Field(default_factory=list)
    deleted: bool = False
    deleted_at: Optional[datetime] = None

class AssetEntry(BaseModel):
    asset_id: str
    user_id: str
    type: Literal['image', 'video', 'audio', 'file', 'url', 'prompt_json']
    url: str
    created_at: datetime
    description: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    deleted: bool = False
    deleted_at: Optional[datetime] = None
