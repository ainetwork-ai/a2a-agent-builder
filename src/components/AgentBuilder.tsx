'use client';

import React, { useState } from 'react';
import { AgentBuilderForm, AgentConfig } from '@/types/agent';
import Link from 'next/link';
import { WalletButton } from './WalletButton';
import { useAccount } from 'wagmi';
import { transliterate } from 'transliteration';
import slugify from 'slugify';

export default function AgentBuilder() {
  const { address, isConnected } = useAccount();
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [prompt, setPrompt] = useState('');
  const [skill, setSkill] = useState({ name: '', description: '', tags: [] as string[] });
  const [tag, setTag] = useState('');
  const [generatedForm, setGeneratedForm] = useState<AgentBuilderForm | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const generateAgentFromPrompt = async () => {
    if (!prompt.trim()) {
      alert('Please enter a prompt');
      return;
    }

    setIsGenerating(true);
    try {
      const response = await fetch('/api/generate-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to generate agent');
      }

      const data = await response.json();
      setGeneratedForm(data);
    } catch (error) {
      console.error('Error generating agent:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      alert(`Failed to generate agent: ${errorMessage}\n\nPlease check the server console for detailed logs.`);
    } finally {
      setIsGenerating(false);
    }
  };

  const createAgent = () => {
    if (!generatedForm) {
      alert('Please generate an agent first');
      return;
    }

    // Use window.location.origin for dynamic URL generation
    const siteUrl = typeof window !== 'undefined' ? window.location.origin : '';

    // Convert agent name to meaningful English slug
    // Remove non-ASCII characters, convert to lowercase, replace spaces with hyphens
    const rawName = generatedForm.name ?? '';
    const romanized = transliterate(rawName);

    const agentSlug = slugify(romanized, {
      lower: true,
      strict: true,
      trim: true,
    });

    // Add timestamp suffix to ensure uniqueness
    const agentId = `${agentSlug}-${Date.now()}`;

    const newAgent: AgentConfig = {
      id: agentId,
      name: generatedForm.name,
      description: generatedForm.description,
      prompt: generatedForm.prompt,
      protocolVersion: '0.3.0',
      version: '0.1.0',
      url: `${siteUrl}/api/agents/${agentId}`,
      capabilities: {},
      defaultInputModes: ['text'],
      defaultOutputModes: ['text'],
      skills: generatedForm.skills,
      modelProvider: generatedForm.modelProvider,
      modelName: generatedForm.modelName,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    setAgents(prev => [...prev, newAgent]);
    
    // Reset form
    setPrompt('');
    setGeneratedForm(null);
  };

  const exportAgent = (agent: AgentConfig) => {
    const exportData = {
      agentCard: {
        name: agent.name,
        description: agent.description,
        protocolVersion: agent.protocolVersion,
        version: agent.version,
        url: agent.url,
        capabilities: agent.capabilities,
        defaultInputModes: agent.defaultInputModes,
        defaultOutputModes: agent.defaultOutputModes,
        skills: agent.skills,
      },
      config: {
        prompt: agent.prompt,
        modelProvider: agent.modelProvider,
        modelName: agent.modelName,
      }
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${agent.name.toLowerCase().replace(/\s+/g, '-')}-agent.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const deployAgent = async (agent: AgentConfig) => {
    // Check wallet connection
    if (!isConnected || !address) {
      alert('⚠️ Please connect your wallet to deploy an agent.');
      return;
    }

    try {
      const response = await fetch('/api/deploy-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentConfig: agent,
          creatorAddress: address,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to deploy agent');
      }

      // Update deployed status
      setAgents(prev => prev.map(a =>
        a.id === agent.id ? { ...a, deployed: true } : a
      ));

      const agentCardUrl = `${agent.url}/.well-known/agent.json`;
      alert(`✅ Agent deployed successfully!\n\n🔗 Base URL: ${agent.url}\n📄 Agent Card: ${agentCardUrl}\n\nYou can now connect to this agent from other clients.`);
    } catch (error) {
      console.error('Error deploying agent:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      alert(`❌ Failed to deploy agent: ${errorMessage}\n\nPlease check the server console for detailed logs.`);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100">
      {/* Navigation Bar */}
      <nav className="bg-white/80 backdrop-blur-md border-b border-purple-100 sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-8 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-blue-500 rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform">
              <span className="text-white text-xl font-bold">🏠</span>
            </div>
            <span className="font-bold text-gray-700 group-hover:text-purple-600 transition-colors">Home</span>
          </Link>
          <div className="flex items-center gap-3">
            <WalletButton />
            <div className="px-4 py-2 bg-gradient-to-r from-purple-100 to-blue-100 rounded-lg">
              <span className="text-sm font-semibold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
                A2A Protocol v0.3.0
              </span>
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto p-8">
        {/* Header */}
        <div className="text-center mb-12 mt-8">
          <h1 className="text-5xl font-extrabold mb-4 bg-gradient-to-r from-purple-600 via-blue-600 to-indigo-600 bg-clip-text text-transparent">
            A2A Agent Builder
          </h1>
          <p className="text-gray-600 text-lg">Build and deploy your own AI agents quickly and easily</p>
        </div>

        {/* Create New Agent Section - Centered */}
        <div className="max-w-3xl mx-auto mb-8">
          <div className="space-y-6 bg-white/90 backdrop-blur-sm p-8 rounded-2xl shadow-xl border border-purple-100 hover:shadow-2xl transition-shadow duration-300">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-blue-500 rounded-lg flex items-center justify-center">
                <span className="text-white text-xl font-bold">✨</span>
              </div>
              <h2 className="text-2xl font-bold text-gray-800">Create New Agent</h2>
            </div>
          
          <div>
            <label className="block text-sm font-semibold mb-3 text-gray-700">
              Agent Description
              <span className="text-gray-400 font-normal ml-2">(What kind of agent would you like to create?)</span>
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full p-4 border-2 border-gray-200 rounded-xl h-40 focus:border-purple-400 focus:ring-4 focus:ring-purple-100 transition-all duration-200 resize-none text-gray-900 placeholder:text-gray-400"
              placeholder="Example: Create an AI tutor that teaches Web3 and blockchain technology using the Socratic method. Guide students to find answers themselves and help them understand complex concepts step by step."
            />
          </div>

          <button
            onClick={generateAgentFromPrompt}
            disabled={isGenerating || !prompt.trim()}
            className="w-full py-4 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-xl hover:from-purple-700 hover:to-blue-700 font-bold text-lg shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 transition-all duration-200 disabled:bg-gray-300 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none"
          >
            {isGenerating ? (
              <span className="flex items-center justify-center gap-2">
                <span className="animate-spin">⚡</span> Generating...
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                🤖 Generate Agent with AI
              </span>
            )}
          </button>

          {/* Generated Preview */}
          {generatedForm && (
            <div className="mt-6 p-6 bg-gradient-to-br from-purple-50 to-blue-50 rounded-xl border-2 border-purple-200 animate-fade-in">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-lg text-purple-900 flex items-center gap-2">
                  ✨ Generated Agent
                </h3>
                <button
                  onClick={() => setIsEditing(!isEditing)}
                  className="px-4 py-2 bg-white border-2 border-purple-300 text-purple-700 rounded-lg hover:bg-purple-50 font-semibold transition text-sm"
                >
                  {isEditing ? 'Preview' : 'Edit'}
                </button>
              </div>

              {!isEditing ? (
                // Preview Mode
                <div className="space-y-4">
                  <div className="bg-white p-3 rounded-lg">
                    <span className="text-xs font-semibold text-purple-600 uppercase">Name</span>
                    <p className="font-bold text-gray-800 mt-1">{generatedForm.name}</p>
                  </div>

                  <div className="bg-white p-3 rounded-lg">
                    <span className="text-xs font-semibold text-purple-600 uppercase">Description</span>
                    <p className="text-gray-700 mt-1">{generatedForm.description}</p>
                  </div>

                  <div className="bg-white p-3 rounded-lg">
                    <span className="text-xs font-semibold text-purple-600 uppercase">Skills</span>
                    <div className="mt-2 space-y-2">
                      {generatedForm.skills.map(skill => (
                        <div key={skill.id} className="text-sm bg-purple-50 p-2 rounded">
                          <div>
                            <span className="font-semibold text-purple-700">{skill.name}:</span>
                            <span className="text-gray-700 ml-1">{skill.description}</span>
                          </div>
                          {skill.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {skill.tags.map((tag, idx) => (
                                <span key={idx} className="px-2 py-0.5 bg-purple-200 text-purple-700 rounded text-xs">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-white p-3 rounded-lg">
                    <span className="text-xs font-semibold text-purple-600 uppercase">AI Model</span>
                    <p className="text-sm font-medium text-gray-800 mt-1">{generatedForm.modelProvider} / {generatedForm.modelName}</p>
                  </div>
                </div>
              ) : (
                // Edit Mode
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-semibold text-purple-600 uppercase block mb-2">Name</label>
                    <input
                      type="text"
                      value={generatedForm.name}
                      onChange={(e) => setGeneratedForm({ ...generatedForm, name: e.target.value })}
                      className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none text-gray-900 placeholder:text-gray-400"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-purple-600 uppercase block mb-2">Description</label>
                    <textarea
                      value={generatedForm.description}
                      onChange={(e) => setGeneratedForm({ ...generatedForm, description: e.target.value })}
                      className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none resize-none text-gray-900 placeholder:text-gray-400"
                      rows={3}
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-purple-600 uppercase block mb-3">Skills</label>
                    <div className="space-y-3 mb-4">
                      {generatedForm.skills.map(skill => (
                        <div key={skill.id} className="group p-4 bg-white rounded-lg border border-gray-200 hover:border-purple-300 hover:shadow-sm transition-all">
                          <div className="flex items-start gap-3">
                            <div className="flex-1 space-y-2">
                              <input
                                type="text"
                                value={skill.name}
                                onChange={(e) => {
                                  const updatedSkills = generatedForm.skills.map(s =>
                                    s.id === skill.id ? { ...s, name: e.target.value } : s
                                  );
                                  setGeneratedForm({ ...generatedForm, skills: updatedSkills });
                                }}
                                className="w-full px-0 py-1 border-0 border-b border-transparent hover:border-gray-200 focus:border-purple-400 text-base font-semibold text-gray-800 focus:outline-none transition-colors bg-transparent placeholder:text-gray-400"
                                placeholder="Skill name"
                              />
                              <input
                                type="text"
                                value={skill.description}
                                onChange={(e) => {
                                  const updatedSkills = generatedForm.skills.map(s =>
                                    s.id === skill.id ? { ...s, description: e.target.value } : s
                                  );
                                  setGeneratedForm({ ...generatedForm, skills: updatedSkills });
                                }}
                                className="w-full px-0 py-1 border-0 text-sm text-gray-600 focus:outline-none bg-transparent placeholder:text-gray-400"
                                placeholder="Description"
                              />

                              {/* Skill Tags */}
                              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                                {skill.tags.map((tag, idx) => (
                                  <span
                                    key={idx}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-50 text-purple-700 rounded text-xs hover:bg-purple-100 transition-colors"
                                  >
                                    {tag}
                                    <button
                                      onClick={() => {
                                        const updatedSkills = generatedForm.skills.map(s =>
                                          s.id === skill.id ? { ...s, tags: s.tags.filter(t => t !== tag) } : s
                                        );
                                        setGeneratedForm({ ...generatedForm, skills: updatedSkills });
                                      }}
                                      className="hover:text-purple-900"
                                    >
                                      ✕
                                    </button>
                                  </span>
                                ))}

                                {editingSkillId === skill.id ? (
                                  <input
                                    type="text"
                                    value={tag}
                                    onChange={(e) => setTag(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        if (tag.trim()) {
                                          const updatedSkills = generatedForm.skills.map(s =>
                                            s.id === skill.id ? { ...s, tags: [...s.tags, tag.trim()] } : s
                                          );
                                          setGeneratedForm({ ...generatedForm, skills: updatedSkills });
                                          setTag('');
                                          setEditingSkillId(null);
                                        }
                                      } else if (e.key === 'Escape') {
                                        setEditingSkillId(null);
                                        setTag('');
                                      }
                                    }}
                                    onBlur={() => {
                                      if (tag.trim()) {
                                        const updatedSkills = generatedForm.skills.map(s =>
                                          s.id === skill.id ? { ...s, tags: [...s.tags, tag.trim()] } : s
                                        );
                                        setGeneratedForm({ ...generatedForm, skills: updatedSkills });
                                      }
                                      setTag('');
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
                              onClick={() => {
                                const updatedSkills = generatedForm.skills.filter(s => s.id !== skill.id);
                                setGeneratedForm({ ...generatedForm, skills: updatedSkills });
                              }}
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
                          value={skill.name}
                          onChange={(e) => setSkill({ ...skill, name: e.target.value })}
                          className="w-full px-0 py-1 border-0 border-b border-transparent hover:border-gray-200 focus:border-purple-400 text-base font-semibold text-gray-800 focus:outline-none transition-colors bg-transparent placeholder:text-gray-400"
                          placeholder="New skill name"
                        />
                        <input
                          type="text"
                          value={skill.description}
                          onChange={(e) => setSkill({ ...skill, description: e.target.value })}
                          className="w-full px-0 py-1 border-0 text-sm text-gray-600 focus:outline-none bg-transparent placeholder:text-gray-400"
                          placeholder="Description"
                        />

                        {/* Tags for new skill */}
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          {skill.tags.map((tag, idx) => (
                            <span
                              key={idx}
                              className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-50 text-purple-700 rounded text-xs"
                            >
                              {tag}
                              <button
                                onClick={() => {
                                  setSkill({ ...skill, tags: skill.tags.filter(t => t !== tag) });
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
                              value={tag}
                              onChange={(e) => setTag(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  if (tag.trim()) {
                                    setSkill({ ...skill, tags: [...skill.tags, tag.trim()] });
                                    setTag('');
                                    setEditingSkillId(null);
                                  }
                                } else if (e.key === 'Escape') {
                                  setEditingSkillId(null);
                                  setTag('');
                                }
                              }}
                              onBlur={() => {
                                if (tag.trim()) {
                                  setSkill({ ...skill, tags: [...skill.tags, tag.trim()] });
                                }
                                setTag('');
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
                          onClick={() => {
                            if (skill.name && skill.description) {
                              setGeneratedForm({
                                ...generatedForm,
                                skills: [...generatedForm.skills, { id: `skill-${Date.now()}`, ...skill }]
                              });
                              setSkill({ name: '', description: '', tags: [] });
                            }
                          }}
                          className="mt-2 w-full py-2 text-purple-600 hover:text-purple-700 font-medium text-sm transition-colors"
                        >
                          + Add Skill
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <button
                onClick={createAgent}
                className="mt-6 w-full py-3 bg-gradient-to-r from-green-500 to-emerald-500 text-white rounded-xl hover:from-green-600 hover:to-emerald-600 font-bold shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 transition-all duration-200"
              >
                ✅ Create This Agent
              </button>
            </div>
          )}
          </div>
        </div>

        {/* Created Agents Section - Show all created agents */}
        {agents.length > 0 && (
          <div className="max-w-3xl mx-auto space-y-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-lg flex items-center justify-center">
                <span className="text-white text-xl font-bold">🤖</span>
              </div>
              <h2 className="text-2xl font-bold text-gray-800">Created Agents</h2>
            </div>

            <div className="space-y-4">
              {agents.map(agent => (
                <div key={agent.id} className="bg-white/90 backdrop-blur-sm p-6 rounded-2xl shadow-xl border border-blue-100 hover:shadow-2xl hover:border-blue-300 transition-all duration-300">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="text-xl font-bold text-gray-800 mb-1">{agent.name}</h3>
                      <p className="text-gray-600 leading-relaxed">{agent.description}</p>
                    </div>
                    <div className={`px-3 py-1 rounded-full ${
                      agent.deployed
                        ? 'bg-gradient-to-br from-green-100 to-emerald-100'
                        : 'bg-gradient-to-br from-yellow-100 to-orange-100'
                    }`}>
                      <span className={`text-xs font-bold ${
                        agent.deployed ? 'text-green-700' : 'text-orange-700'
                      }`}>
                        {agent.deployed ? '✅ DEPLOYED' : '⚠️ NOT DEPLOYED'}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2 text-sm mt-4 bg-gray-50 p-4 rounded-xl">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-700">🧠 Model:</span>
                      <span className="text-gray-600">{agent.modelProvider} / {agent.modelName}</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="font-semibold text-gray-700">⚡ Skills:</span>
                      <span className="text-gray-600">{agent.skills.map(s => s.name).join(', ')}</span>
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-start gap-2">
                        <span className="font-semibold text-gray-700">🔗 Base URL:</span>
                        <code className="flex-1 bg-white px-3 py-1.5 rounded-lg text-xs border border-gray-200 break-all">{agent.url}</code>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="font-semibold text-gray-700">📄 Agent Card:</span>
                        <code className="flex-1 bg-white px-3 py-1.5 rounded-lg text-xs border border-gray-200 break-all">{agent.url}/.well-known/agent.json</code>
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 flex flex-wrap gap-2">
                    <button
                      onClick={() => deployAgent(agent)}
                      disabled={agent.deployed}
                      className={`flex-1 min-w-[120px] px-4 py-2.5 rounded-lg font-semibold shadow-md transition-all duration-200 ${
                        agent.deployed
                          ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                          : 'bg-gradient-to-r from-green-500 to-emerald-500 text-white hover:from-green-600 hover:to-emerald-600 hover:shadow-lg transform hover:-translate-y-0.5'
                      }`}
                    >
                      {agent.deployed ? '✅ Deployed' : '🚀 Deploy'}
                    </button>
                    <button
                      onClick={() => exportAgent(agent)}
                      className="flex-1 min-w-[120px] px-4 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-lg hover:from-blue-600 hover:to-indigo-600 font-semibold shadow-md hover:shadow-lg transform hover:-translate-y-0.5 transition-all duration-200"
                    >
                      💾 Export
                    </button>
                    {agent.deployed ? (
                      <a
                        href={`/?agentUrl=${encodeURIComponent(agent.url)}`}
                        className="flex-1 min-w-[120px] px-4 py-2.5 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg hover:from-purple-600 hover:to-pink-600 font-semibold shadow-md hover:shadow-lg transform hover:-translate-y-0.5 transition-all duration-200 text-center"
                      >
                        💬 Test Chat
                      </a>
                    ) : (
                      <button
                        disabled
                        className="flex-1 min-w-[120px] px-4 py-2.5 bg-gray-300 text-gray-500 rounded-lg font-semibold cursor-not-allowed"
                        title="Deploy the agent first to test chat"
                      >
                        💬 Test Chat
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}