'use client';

import React, { useState, useEffect } from 'react';
import { AgentBuilderForm, Skill, Intent } from '@/types/agent';
import { getDisplayModelName } from '@/lib/utils/modelUtils';

interface AgentFormProps {
  initialData: AgentBuilderForm & { url?: string };
  onSubmit: (data: AgentBuilderForm & { url?: string }) => void;
  onCancel?: () => void;
  onAutoComplete?: (currentData: AgentBuilderForm & { url?: string }) => void;
  isSubmitting?: boolean;
  isAutoCompleting?: boolean;
  submitLabel?: string;
  showAutoComplete?: boolean;
}

export function AgentForm({ initialData, onSubmit, onCancel, onAutoComplete, isSubmitting = false, isAutoCompleting = false, submitLabel = 'Save', showAutoComplete = false }: AgentFormProps) {
  const [formData, setFormData] = useState(initialData);

  // State for tag inputs (keyed by skill ID)
  const [tagInputs, setTagInputs] = useState<Record<string, string>>({});
  const [focusedSkillId, setFocusedSkillId] = useState<string | null>(null);

  useEffect(() => {
    setFormData(initialData);
  }, [initialData]);

  const handleSkillChange = (skillId: string, field: keyof Skill, value: string | string[]) => {
    setFormData(prev => ({
      ...prev,
      skills: prev.skills.map(s => s.id === skillId ? { ...s, [field]: value } : s)
    }));
  };

  const handleAddTag = (skillId: string, tag: string) => {
    const trimmedTag = tag.trim();
    if (!trimmedTag) return;

    setFormData(prev => ({
      ...prev,
      skills: prev.skills.map(s => {
        if (s.id === skillId && !s.tags.includes(trimmedTag)) {
          return { ...s, tags: [...s.tags, trimmedTag] };
        }
        return s;
      })
    }));
    setTagInputs(prev => ({ ...prev, [skillId]: '' }));
  };

  const handleRemoveTag = (skillId: string, tagToRemove: string) => {
    setFormData(prev => ({
      ...prev,
      skills: prev.skills.map(s => 
        s.id === skillId 
          ? { ...s, tags: s.tags.filter(t => t !== tagToRemove) }
          : s
      )
    }));
  };

  const handleKeyDownTag = (e: React.KeyboardEvent<HTMLInputElement>, skillId: string) => {
    const val = tagInputs[skillId] || '';
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      handleAddTag(skillId, val);
    } else if (e.key === 'Backspace' && val === '') {
      // Remove last tag if input is empty
      const skill = formData.skills.find(s => s.id === skillId);
      if (skill && skill.tags.length > 0) {
        handleRemoveTag(skillId, skill.tags[skill.tags.length - 1]);
      }
    }
  };

  const addSkill = () => {
    const newSkill: Skill = {
      id: `skill-${Date.now()}`,
      name: '',
      description: '',
      tags: []
    };
    setFormData(prev => ({ ...prev, skills: [...prev.skills, newSkill] }));
  };

  const removeSkill = (skillId: string) => {
    setFormData(prev => ({
      ...prev,
      skills: prev.skills.filter(s => s.id !== skillId)
    }));
  };

  const addIntent = () => {
    const newIntent: Intent = { name: '', description: '', prompt: '' };
    setFormData(prev => ({
      ...prev,
      intents: [...(prev.intents || []), newIntent]
    }));
  };

  const removeIntent = (index: number) => {
    setFormData(prev => ({
      ...prev,
      intents: (prev.intents || []).filter((_, i) => i !== index)
    }));
  };

  const handleIntentChange = (index: number, field: keyof Intent, value: string) => {
    setFormData(prev => ({
      ...prev,
      intents: (prev.intents || []).map((intent, i) => 
        i === index ? { ...intent, [field]: value } : intent
      )
    }));
  };

  return (
    <div className="space-y-6">
      {/* Basic Info */}
      {/* Basic Info */}
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div>
            <label className="block text-base font-bold text-gray-900">Agent Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full mt-2 px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent text-base text-gray-900 placeholder:text-gray-400 transition-all bg-white"
              placeholder="e.g. Crypto Tutor"
            />
          </div>

          <div>
            <label className="block text-base font-bold text-gray-900">AI Model</label>
            <div className="mt-2 w-full px-4 py-3 border border-gray-200 rounded-xl bg-gray-50 text-gray-700 font-medium flex items-center gap-2">
              <span>🧠</span> {formData.modelProvider} / {getDisplayModelName(formData.modelName)}
            </div>
          </div>
        </div>

        {formData.url !== undefined && (
          <div>
            <label className="block text-base font-bold text-gray-900">Agent URL</label>
            <p className="text-sm text-gray-500 mt-1">The public endpoint for your agent</p>
            <input
              type="text"
              value={formData.url}
              onChange={(e) => setFormData({ ...formData, url: e.target.value })}
              className="w-full mt-2 px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent text-base text-gray-900 placeholder:text-gray-400 transition-all bg-white"
              placeholder="https://..."
            />
          </div>
        )}

        <div>
          <label className="block text-base font-bold text-gray-900">Description</label>
          <p className="text-sm text-gray-500 mt-1">Input description project for overview</p>
          <textarea
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            onFocus={(e) => (e.target.rows = 5)}
            onBlur={(e) => (e.target.rows = 3)}
            className="w-full mt-2 px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none text-gray-900 placeholder:text-gray-400 transition-all bg-white text-base"
            rows={3}
            placeholder="Describe what this agent does..."
          />
        </div>

        <div>
          <label className="block text-base font-bold text-gray-900">System Prompt</label>
          <p className="text-sm text-gray-500 mt-1">
            Define the agent&apos;s behavior, personality, and instructions
          </p>
          <textarea
            value={formData.prompt}
            onChange={(e) => setFormData({ ...formData, prompt: e.target.value })}
            onFocus={(e) => (e.target.rows = 10)}
            onBlur={(e) => (e.target.rows = 6)}
            className="w-full mt-2 px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none text-gray-900 placeholder:text-gray-400 transition-all font-mono bg-white text-base"
            rows={6}
            placeholder="You are a helpful assistant..."
          />
        </div>
      </div>

      <hr className="border-gray-200" />

      {/* Skills Section */}
      {/* Skills Section */}
      <div>
        <div className="mb-4">
          <label className="block text-lg font-bold text-gray-900">Skills</label>
          <p className="text-sm text-gray-500 mt-1">
            Set up your agent&apos;s capabilities and tools
          </p>
        </div>

        <div className="space-y-3 mb-4">
          {formData.skills.map((skill, idx) => (
            <div
              key={skill.id}
              className="bg-white border border-gray-200 rounded-xl overflow-hidden transition-all hover:border-purple-300 hover:shadow-sm"
            >
              {/* Card Header - Mimics the "List Item" look */}
              <div className="bg-gray-50 px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-gray-700 text-sm">
                    {skill.name || `Skill #${idx + 1}`}
                  </span>
                </div>
                <button
                  onClick={() => removeSkill(skill.id)}
                  className="text-gray-400 hover:text-red-500 transition-colors p-1.5 rounded-md hover:bg-white"
                  title="Remove skill"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M2 4H14M5.33333 4V2.66667C5.33333 2.29848 5.63181 2 6 2H10C10.3682 2 10.6667 2.29848 10.6667 2.66667V4M12.6667 4V13.3333C12.6667 13.7015 12.3682 14 12 14H4C3.63181 14 3.33333 13.7015 3.33333 13.3333V4"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>

              <div className="p-4 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 uppercase tracking-wide mb-1.5">
                      Skill Name
                    </label>
                    <input
                      type="text"
                      value={skill.name}
                      onChange={(e) => handleSkillChange(skill.id, 'name', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent text-base bg-gray-50 focus:bg-white transition-colors"
                      placeholder="e.g. Technical Analysis"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 uppercase tracking-wide mb-1.5">
                      Description
                    </label>
                    <textarea
                      value={skill.description}
                      onChange={(e) => handleSkillChange(skill.id, 'description', e.target.value)}
                      onFocus={(e) => (e.target.rows = 3)}
                      onBlur={(e) => (e.target.rows = 1)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none bg-gray-50 focus:bg-white transition-all text-base"
                      rows={1}
                      placeholder="Brief description..."
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wide mb-1.5">
                    Tags
                  </label>
                  <div
                    className={`flex flex-wrap gap-2 p-2 border rounded-lg bg-gray-50 min-h-[42px] transition-all ${
                      focusedSkillId === skill.id
                        ? 'ring-2 ring-purple-500 border-transparent bg-white'
                        : 'border-gray-200'
                    }`}
                    onClick={() => {
                      const input = document.getElementById(`tag-input-${skill.id}`);
                      input?.focus();
                    }}
                  >
                    {skill.tags.map((tag, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-purple-100 text-purple-700 rounded-md text-sm font-medium shadow-sm"
                      >
                        {tag}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveTag(skill.id, tag);
                          }}
                          className="hover:text-purple-900 ml-0.5 text-purple-400"
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                    <input
                      id={`tag-input-${skill.id}`}
                      type="text"
                      value={tagInputs[skill.id] || ''}
                      onChange={(e) =>
                        setTagInputs((prev) => ({ ...prev, [skill.id]: e.target.value }))
                      }
                      onKeyDown={(e) => handleKeyDownTag(e, skill.id)}
                      onFocus={() => setFocusedSkillId(skill.id)}
                      onBlur={() => setFocusedSkillId(null)}
                      className="flex-1 min-w-[120px] bg-transparent outline-none text-sm py-1"
                      placeholder={skill.tags.length === 0 ? 'Type tag and press Enter...' : ''}
                    />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={addSkill}
          className="w-full py-3 border border-gray-200 text-gray-600 rounded-xl hover:border-purple-500 hover:text-purple-600 hover:bg-purple-50 font-semibold transition-all flex items-center justify-center gap-2 bg-white shadow-sm"
        >
          <span>+</span> Add Skill
        </button>
      </div>

      <hr className="border-gray-200" />

      {/* Intents Section */}
      {/* Intents Section */}
      <div>
        <div className="mb-4">
          <label className="block text-lg font-bold text-gray-900">
            Intents <span className="text-sm font-normal text-gray-500 ml-2">(Optional)</span>
          </label>
          <p className="text-sm text-gray-500 mt-1">Define specific actions or responses</p>
        </div>

        <div className="space-y-3 mb-4">
          {(formData.intents || []).map((intent, idx) => (
            <div
              key={idx}
              className="bg-white border border-gray-200 rounded-xl overflow-hidden transition-all hover:border-purple-300 hover:shadow-sm"
            >
              {/* Card Header */}
              <div className="bg-gray-50 px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-gray-700 text-sm">
                    {intent.name || `Intent #${idx + 1}`}
                  </span>
                </div>
                <button
                  onClick={() => removeIntent(idx)}
                  className="text-gray-400 hover:text-red-500 transition-colors p-1.5 rounded-md hover:bg-white"
                  title="Remove intent"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M2 4H14M5.33333 4V2.66667C5.33333 2.29848 5.63181 2 6 2H10C10.3682 2 10.6667 2.29848 10.6667 2.66667V4M12.6667 4V13.3333C12.6667 13.7015 12.3682 14 12 14H4C3.63181 14 3.33333 13.7015 3.33333 13.3333V4"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>

              <div className="p-4 space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wide mb-1.5">
                    Intent Name
                  </label>
                  <input
                    type="text"
                    value={intent.name}
                    onChange={(e) => handleIntentChange(idx, 'name', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-gray-50 focus:bg-white transition-colors text-base"
                    placeholder="e.g. welcome_message"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wide mb-1.5">
                    Description
                  </label>
                  <textarea
                    value={intent.description}
                    onChange={(e) => handleIntentChange(idx, 'description', e.target.value)}
                    onFocus={(e) => (e.target.rows = 4)}
                    onBlur={(e) => (e.target.rows = 2)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none bg-gray-50 focus:bg-white transition-all text-base"
                    rows={2}
                    placeholder="When to trigger this intent..."
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wide mb-1.5">
                    Prompt
                  </label>
                  <textarea
                    value={intent.prompt}
                    onChange={(e) => handleIntentChange(idx, 'prompt', e.target.value)}
                    onFocus={(e) => (e.target.rows = 6)}
                    onBlur={(e) => (e.target.rows = 3)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none bg-gray-50 focus:bg-white transition-all text-base"
                    rows={3}
                    placeholder="What the agent should know or say..."
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={addIntent}
          className="w-full py-3 border border-gray-200 text-gray-600 rounded-xl hover:border-purple-500 hover:text-purple-600 hover:bg-purple-50 font-semibold transition-all flex items-center justify-center gap-2 bg-white shadow-sm"
        >
          <span>+</span> Add Intent
        </button>
      </div>

      {/* Actions */}
      <div className="space-y-3 pt-4">
        <div className="flex gap-3">
          {onCancel && (
            <button
              onClick={onCancel}
              className="flex-1 py-3 bg-white border-2 border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 font-bold transition-all"
            >
              Cancel
            </button>
          )}
          {showAutoComplete && onAutoComplete && (
            <button
              onClick={() => onAutoComplete(formData)}
              disabled={isAutoCompleting || isSubmitting}
              className="flex-1 py-2.5 text-sm bg-gradient-to-r from-green-500 to-emerald-500 text-white rounded-xl hover:from-green-600 hover:to-emerald-600 font-semibold shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
            >
              {isAutoCompleting ? (
                <span className="flex items-center justify-center gap-1.5">
                  <span className="animate-spin">⚡</span>{' '}
                  <span className="hidden sm:inline">Auto-Completing...</span>
                  <span className="sm:hidden">Loading...</span>
                </span>
              ) : (
                <span className="flex items-center justify-center gap-1.5">
                  <span>✨</span> <span className="hidden sm:inline">AI Auto-Complete</span>
                  <span className="sm:hidden">AI Auto</span>
                </span>
              )}
            </button>
          )}
          <button
            onClick={() => onSubmit(formData)}
            disabled={isSubmitting || isAutoCompleting}
            className="flex-1 py-2.5 text-sm bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-xl hover:from-purple-700 hover:to-blue-700 font-semibold shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
          >
            {isSubmitting ? 'Saving...' : submitLabel}
          </button>
        </div>

        {showAutoComplete && (
          <p className="text-xs text-gray-500 text-center">
            💡 <strong>Tip:</strong> Fill in the fields you need, then use AI Auto-Complete for the rest. Intents are not auto-generated.
          </p>
        )}
      </div>
    </div>
  );
}
