'use client';

import { useState, useEffect } from 'react';
import { Skill } from '@/types/agent';

interface EditAgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  agent: {
    id: string;
    name: string;
    description: string;
    url: string;
    skills: Skill[];
    modelProvider: string;
    modelName: string;
    prompt: string;
  };
  onSuccess: () => void;
}

export default function EditAgentModal({ isOpen, onClose, agent, onSuccess }: EditAgentModalProps) {
  const [formData, setFormData] = useState({
    name: agent.name,
    description: agent.description,
    url: agent.url,
    skills: agent.skills,
    modelProvider: 'gemini' as const,
    modelName: 'gemini-2.5-flash',
    prompt: agent.prompt,
  });

  const [newSkill, setNewSkill] = useState({ name: '', description: '', tags: [] as string[] });
  const [tagInput, setTagInput] = useState('');
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setFormData({
        name: agent.name,
        description: agent.description,
        url: agent.url,
        skills: agent.skills,
        modelProvider: 'gemini',
        modelName: 'gemini-2.5-flash',
        prompt: agent.prompt,
      });
    }
  }, [isOpen, agent]);

  const handleAddSkillTag = (skillId: string) => {
    if (!tagInput.trim()) return;

    const updatedSkills = formData.skills.map(skill => {
      if (skill.id === skillId) {
        if (skill.tags.includes(tagInput.trim())) {
          alert('Tag already exists in this skill');
          return skill;
        }
        return {
          ...skill,
          tags: [...skill.tags, tagInput.trim()]
        };
      }
      return skill;
    });

    setFormData(prev => ({ ...prev, skills: updatedSkills }));
    setTagInput('');
  };

  const handleRemoveSkillTag = (skillId: string, tagToRemove: string) => {
    const updatedSkills = formData.skills.map(skill => {
      if (skill.id === skillId) {
        return {
          ...skill,
          tags: skill.tags.filter(tag => tag !== tagToRemove)
        };
      }
      return skill;
    });

    setFormData(prev => ({ ...prev, skills: updatedSkills }));
  };

  const handleAddSkill = () => {
    if (!newSkill.name || !newSkill.description) {
      alert('Please fill in skill name and description');
      return;
    }

    const skill: Skill = {
      id: `skill-${Date.now()}`,
      ...newSkill,
    };

    setFormData(prev => ({
      ...prev,
      skills: [...prev.skills, skill]
    }));

    setNewSkill({ name: '', description: '', tags: [] });
  };

  const handleRemoveSkill = (skillId: string) => {
    setFormData(prev => ({
      ...prev,
      skills: prev.skills.filter(s => s.id !== skillId)
    }));
  };

  const handleSave = async () => {
    if (!formData.name || !formData.description || !formData.prompt || formData.skills.length === 0) {
      alert('Please fill in all required fields');
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch(`/api/agents/${agent.id}/edit`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        throw new Error('Failed to update agent');
      }

      alert('✅ Agent updated successfully!');
      onSuccess();
      onClose();
    } catch (error) {
      console.error('Error updating agent:', error);
      alert('❌ Failed to update agent. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-purple-600 to-blue-600 text-white p-6 rounded-t-2xl">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold">✏️ Edit Agent</h2>
            <button
              onClick={onClose}
              className="text-white hover:bg-white/20 rounded-lg p-2 transition"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Form */}
        <div className="p-6 space-y-6">
          {/* Name */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Agent Name *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none transition text-gray-900 placeholder:text-gray-400"
              placeholder="e.g., Socrates Web3 Tutor"
            />
          </div>

          {/* URL */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Agent URL *
            </label>
            <input
              type="text"
              value={formData.url}
              onChange={(e) => setFormData(prev => ({ ...prev, url: e.target.value }))}
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none transition text-gray-900 placeholder:text-gray-400"
              placeholder="e.g., https://example.com/agents/my-agent"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Description *
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none transition resize-none text-gray-900 placeholder:text-gray-400"
              rows={3}
              placeholder="Describe what your agent does..."
            />
          </div>

          {/* System Prompt */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              System Prompt *
            </label>
            <textarea
              value={formData.prompt}
              onChange={(e) => setFormData(prev => ({ ...prev, prompt: e.target.value }))}
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none transition resize-none text-gray-900 placeholder:text-gray-400"
              rows={6}
              placeholder="Define the agent's behavior, personality, and instructions..."
            />
          </div>

          {/* Skills */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-3">
              Skills * (at least one required)
            </label>

            {/* Existing Skills */}
            <div className="space-y-3 mb-4">
              {formData.skills.map(skill => (
                <div key={skill.id} className="group p-4 bg-white rounded-lg border border-gray-200 hover:border-purple-300 hover:shadow-sm transition-all">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 space-y-2">
                      <div className="font-semibold text-gray-800 text-base">{skill.name}</div>
                      <div className="text-sm text-gray-600">{skill.description}</div>

                      {/* Skill Tags - Inline */}
                      <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        {skill.tags.map((tag, idx) => (
                          <span
                            key={idx}
                            className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-50 text-purple-700 rounded text-xs hover:bg-purple-100 transition-colors"
                          >
                            {tag}
                            <button
                              onClick={() => handleRemoveSkillTag(skill.id, tag)}
                              className="hover:text-purple-900"
                            >
                              ✕
                            </button>
                          </span>
                        ))}

                        {editingSkillId === skill.id ? (
                          <input
                            type="text"
                            value={tagInput}
                            onChange={(e) => setTagInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleAddSkillTag(skill.id);
                                setEditingSkillId(null);
                              } else if (e.key === 'Escape') {
                                setEditingSkillId(null);
                                setTagInput('');
                              }
                            }}
                            onBlur={() => {
                              if (tagInput.trim()) {
                                handleAddSkillTag(skill.id);
                              }
                              setTagInput('');
                              setEditingSkillId(null);
                            }}
                            className="w-20 px-2 py-0.5 border-0 border-b border-purple-300 rounded-none text-xs focus:border-purple-500 focus:outline-none text-gray-900 placeholder:text-gray-400"
                            placeholder="tag"
                            autoFocus
                          />
                        ) : (
                          <button
                            onClick={() => setEditingSkillId(skill.id)}
                            className="px-2 py-0.5 text-gray-400 hover:text-purple-600 rounded text-xs transition-colors"
                          >
                            + tag
                          </button>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemoveSkill(skill.id)}
                      className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-all"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Add New Skill */}
            <div className="group p-4 bg-gray-50 hover:bg-white rounded-lg border-2 border-dashed border-gray-300 hover:border-purple-300 transition-all">
              <div className="space-y-2">
                <input
                  type="text"
                  value={newSkill.name}
                  onChange={(e) => setNewSkill({ ...newSkill, name: e.target.value })}
                  className="w-full px-0 py-1 border-0 border-b border-transparent hover:border-gray-200 focus:border-purple-400 text-base font-semibold text-gray-800 focus:outline-none transition-colors bg-transparent placeholder:text-gray-400"
                  placeholder="New skill name"
                />
                <input
                  type="text"
                  value={newSkill.description}
                  onChange={(e) => setNewSkill({ ...newSkill, description: e.target.value })}
                  className="w-full px-0 py-1 border-0 text-sm text-gray-600 focus:outline-none bg-transparent placeholder:text-gray-400"
                  placeholder="Description"
                />

                {/* Tags for new skill */}
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  {newSkill.tags.map((tag, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-50 text-purple-700 rounded text-xs"
                    >
                      {tag}
                      <button
                        onClick={() => {
                          setNewSkill({ ...newSkill, tags: newSkill.tags.filter(t => t !== tag) });
                        }}
                        className="hover:text-purple-900"
                      >
                        ✕
                      </button>
                    </span>
                  ))}

                  {editingSkillId === 'new-skill' ? (
                    <input
                      type="text"
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (tagInput.trim()) {
                            setNewSkill({ ...newSkill, tags: [...newSkill.tags, tagInput.trim()] });
                            setTagInput('');
                            setEditingSkillId(null);
                          }
                        } else if (e.key === 'Escape') {
                          setEditingSkillId(null);
                          setTagInput('');
                        }
                      }}
                      onBlur={() => {
                        if (tagInput.trim()) {
                          setNewSkill({ ...newSkill, tags: [...newSkill.tags, tagInput.trim()] });
                        }
                        setTagInput('');
                        setEditingSkillId(null);
                      }}
                      className="w-20 px-2 py-0.5 border-0 border-b border-purple-300 rounded-none text-xs focus:border-purple-500 focus:outline-none text-gray-900 placeholder:text-gray-400"
                      placeholder="tag"
                      autoFocus
                    />
                  ) : (
                    <button
                      onClick={() => setEditingSkillId('new-skill')}
                      className="px-2 py-0.5 text-gray-400 hover:text-purple-600 rounded text-xs transition-colors"
                    >
                      + tag
                    </button>
                  )}
                </div>

                <button
                  onClick={handleAddSkill}
                  className="mt-2 w-full py-2 text-purple-600 hover:text-purple-700 font-medium text-sm transition-colors"
                >
                  + Add Skill
                </button>
              </div>
            </div>
          </div>

          {/* AI Model - Fixed to gemini-2.5-flash */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              AI Model
            </label>
            <div className="px-4 py-3 bg-gray-100 border-2 border-gray-200 rounded-lg text-gray-700">
              🧠 gemini-2.5-flash
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-gray-50 p-6 rounded-b-2xl border-t border-gray-200 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 bg-white border-2 border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-semibold transition"
            disabled={isSaving}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex-1 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 font-semibold shadow-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? 'Saving...' : '💾 Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
