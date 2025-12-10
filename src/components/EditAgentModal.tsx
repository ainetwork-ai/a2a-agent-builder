'use client';

import { useState, useEffect } from 'react';
import { Skill, AgentBuilderForm, Intent } from '@/types/agent';
import { useAccount } from 'wagmi';
import { AgentForm } from './AgentForm';
import { useToast } from '@/contexts/ToastContext';
import { safeFetch } from '@/lib/utils/safeFetch';

interface EditAgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  agent: {
    id: string;
    name: string;
    description: string;
    url: string;
    skills: Skill[];
    intents?: Intent[];
    modelProvider: string;
    modelName: string;
    prompt: string;
  };
  onSuccess: () => void;
}

export default function EditAgentModal({ isOpen, onClose, agent, onSuccess }: EditAgentModalProps) {
  const { address } = useAccount();
  const toast = useToast();
  const [formData, setFormData] = useState({
    name: agent.name,
    description: agent.description,
    url: agent.url,
    skills: agent.skills,
    intents: agent.intents,
    modelProvider: agent.modelProvider as 'google' | 'openai' | 'anthropic',
    modelName: agent.modelName,
    prompt: agent.prompt,
  });

  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setFormData({
        name: agent.name,
        description: agent.description,
        url: agent.url,
        skills: agent.skills,
        intents: agent.intents,
        modelProvider: agent.modelProvider as 'google' | 'openai' | 'anthropic',
        modelName: agent.modelName,
        prompt: agent.prompt,
      });
    }
  }, [isOpen, agent.id]); // agent 전체 대신 agent.id만 의존성으로

  const handleSave = async (data: AgentBuilderForm & { url?: string }) => {
    const {
      name,
      description,
      url,
      modelProvider,
      modelName,
      prompt,
    } = data;

    const requiredFields = [];
    if (!name.trim()) requiredFields.push('Agent Name');
    if (!description.trim()) requiredFields.push('description');
    if (!url?.trim()) requiredFields.push('Agent URL');
    if (!modelProvider) requiredFields.push('modelProvider');
    if (!modelName) requiredFields.push('modelName');
    if (!prompt.trim()) requiredFields.push('System Prompt');

    if (requiredFields.length > 0) {
      toast.warning(`Please fill in the following required fields: ${requiredFields.join(', ')}.`);
      return;
    }

    setIsSaving(true);
    try {
      await safeFetch(`/api/agents/${agent.id}/edit`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          address,
        }),
      });

      toast.success('Agent updated successfully!');
      onSuccess();
      onClose();
    } catch (error) {
      console.error('Error updating agent:', error);
      toast.error('Failed to update agent. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-purple-600 to-blue-600 text-white p-4 sm:p-6 rounded-t-2xl z-10">
          <div className="flex items-center justify-between">
            <h2 className="text-xl sm:text-2xl font-bold">✏️ Edit Agent</h2>
            <button
              onClick={onClose}
              className="text-white hover:bg-white/20 rounded-lg p-1.5 sm:p-2 transition w-8 h-8 flex items-center justify-center"
            >
              <span className="text-xl">✕</span>
            </button>
          </div>
        </div>

        {/* Form */}
        <div className="p-4 sm:p-6">
          <AgentForm
            initialData={formData}
            onSubmit={handleSave}
            onCancel={onClose}
            isSubmitting={isSaving}
            submitLabel="💾 Save Changes"
          />
        </div>
      </div>
    </div>
  );
}
